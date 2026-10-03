import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manualExtraction } from '../server/ingestion';
import { Store } from '../server/store';
import type { ReviewItem } from '../shared/types';

test('local extraction keeps display equations with their argument and preserves source', () => {
  const argument = String.raw`Claim: Let $A$ be the evaluation matrix.

\[
A = \begin{pmatrix}
1 & 0 \\

0 & 1
\end{pmatrix}.
\]

Therefore $\det(A)=1$.`;
  const result = manualExtraction(`${argument}\n\nQuestion: Does this extend to all $q$?`);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].content, argument);
  assert.equal(result.items[0].title, 'Claim: Let $A$ be the evaluation matrix.');
  assert.equal(result.items[1].type, 'Open Question');
  assert.equal(result.items[0].summary, 'Claim: Let $A$ be the evaluation matrix.');
});

test('a short grouped proof uses its introduction as the summary without duplicating the proof', () => {
  const introduction = String.raw`Lemma: The map $T$ is injective.`;
  const argument = String.raw`${introduction}

\begin{proof}
If $T(f)=0$, then $f=0$ by the root bound.
\end{proof}`;
  assert.ok(argument.length < 300);
  const result = manualExtraction(argument);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].summary, introduction);
  assert.equal(result.items[0].content, argument);
});

test('local extraction preserves nested theorem and proof environments across blank lines', () => {
  const argument = String.raw`\begin{lemma}[Evaluation bound]
For $f \in \mathbb{F}_q[x]$, consider the map below.

\begin{align*}
T(f) &= (f(a_1),\ldots,f(a_n)) \\

\ker T &= \{0\}.
\end{align*}
\end{lemma}

\begin{proof}
Suppose $T(f)=0$.

The root bound forces $f=0$.
\end{proof}`;
  const result = manualExtraction(`${argument}\n\nClaim: A separate result.`);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].content, argument);
  assert.equal(result.items[0].type, 'Lemma');
  assert.equal(result.items[1].content, 'Claim: A separate result.');
});

test('local extraction treats fenced source and headings inside it as literal content', () => {
  const source = [
    'Experiment: Evaluate the following source.',
    '',
    '```python',
    '# Claim: this is a comment, not a proposed node',
    'formula = r"\\[x^2\\]"',
    '',
    'print(formula)',
    '```',
    '',
    'This remains an unexecuted example.',
  ].join('\n');
  const result = manualExtraction(`${source}\n\nClaim: Independent statement.`);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].content, source);
  assert.equal(result.items[0].type, 'Experiment');
});

test('local extraction does not truncate a formula in the title or summary', () => {
  const formula = `$${Array.from({ length: 35 }, (_, i) => `x_{${i}}`).join('+')}=0$`;
  const source =
    `Claim: ${formula} with this additional explanatory text. ${'A remark. '.repeat(20)}`.trim();
  const item = manualExtraction(source).items[0];
  assert.equal(item.content, source);
  assert.ok(item.title.length <= 250);
  assert.equal((item.title.match(/\$/g) ?? []).length % 2, 0);
  assert.equal((item.summary.match(/\$/g) ?? []).length % 2, 0);
  assert.ok(item.summary.includes(formula));
});

test('a formula longer than the summary limit stays complete in content', () => {
  const source = `$$${Array.from({ length: 400 }, (_, i) => `x_{${i}}`).join('+')}=0$$`;
  const item = manualExtraction(source).items[0];
  assert.equal(item.content, source);
  assert.ok(item.title.length > 0 && item.title.length <= 250);
  assert.ok(item.summary.length <= 2000);
  assert.doesNotMatch(item.title, /\$/);
  assert.doesNotMatch(item.summary, /\$/);
});

test('incomplete display math stays in a single review item', () => {
  const source = String.raw`Claim: An unfinished derivation.

\[
x = y

Question: Is this equality justified?`;
  const result = manualExtraction(source);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].content, source);
});

test('inline and escaped dollar notation does not change ordinary item boundaries', () => {
  const source = String.raw`Claim: We have \(x=y\) and $z=0$; the literal cost is \$5.

Question: What changes over $\mathbb{F}_5$?`;
  const result = manualExtraction(source);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].content, source.split('\n\n')[0]);
  assert.equal(result.items[1].title, String.raw`Question: What changes over $\mathbb{F}_5$?`);
});

test('reviewed LaTeX survives SQLite reopening in nodes, transcripts, drafts, and audit events', () => {
  const argument = String.raw`Lemma: The evaluation map $T$ is injective.

\begin{proof}
For $f \in \mathbb{F}_q[x]$ of degree less than $n$, assume

\begin{align*}
T(f) &= (f(a_1),\ldots,f(a_n)) = 0, \\
\#\{a_i:f(a_i)=0\} &= n > \deg f.
\end{align*}

The root bound gives $f=0$, provided the $a_i$ are distinct.
\end{proof}`;
  const transcript = `\n  ${argument}\n\n`;
  const directory = mkdtempSync(join(tmpdir(), 'research-math-ingestion-'));
  const path = join(directory, 'math.sqlite');
  let store: Store | undefined;
  try {
    store = new Store(path, false);
    const proposal = manualExtraction(transcript);
    assert.equal(proposal.items.length, 1);
    const draft = store.saveDraft(proposal, transcript, 'LaTeX review regression', 'manual');
    const reviewed: ReviewItem[] = proposal.items.map((item) => ({
      ...item,
      decision: 'create',
      epistemicStatus: 'Proved',
      humanVerified: true,
    }));
    const { created, sessionId } = store.commitDraft(draft.id, reviewed, []);
    assert.equal(created.length, 1);
    assert.equal(created[0].content, argument);
    assert.equal(created[0].epistemicStatus, 'Unverified');
    assert.equal(created[0].humanVerified, false);
    assert.equal(store.getNode(sessionId).content, transcript);
    store.close();
    store = undefined;
    store = new Store(path, false);

    const persisted = store.getNode(created[0].id);
    assert.equal(persisted.content, argument);
    assert.equal(persisted.epistemicStatus, 'Unverified');
    assert.equal(persisted.humanVerified, false);
    assert.equal(store.getNode(sessionId).content, transcript);
    assert.equal(store.getDraft(draft.id).items[0].content, argument);
    assert.equal(store.getDraft(draft.id).transcript, transcript);
    assert.ok(store.getDraft(draft.id).committedAt);
    const events = store.state().events;
    for (const [nodeId, content] of [
      [persisted.id, argument],
      [sessionId, transcript],
    ]) {
      const event = events.find(
        (entry) => entry.nodeId === nodeId && entry.eventType === 'node_created',
      );
      assert.ok(event?.newValue);
      assert.equal(JSON.parse(event.newValue).content, content);
    }
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
