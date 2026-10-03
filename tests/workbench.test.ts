import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';
import { ChatStore, buildResearchContext } from '../server/chat';
import { ConnectionManager } from '../server/connection';
import { WorkbenchStore } from '../server/workbench';
import { claimKey } from '../server/workbench-basis';
import { candidateDraftSchema, parseTranscript, type CandidateDraft } from '../shared/workbench';
const statement =
  'For the restricted family, the remaining obstruction is a single rank condition.';
const draft: CandidateDraft = {
  title: 'A restricted reduction',
  kind: 'Reduction',
  classification: 'New reduction',
  statement,
  sourceQuote: statement,
  baseline: 'The baseline has two unresolved independent conditions.',
  gain: 'The restricted family needs only the stated rank condition.',
  mechanism: 'Eliminate the first condition by the supplied equivalence calculation.',
  evidence: 'A proposed calculation, still requiring a researcher check.',
  gap: 'The rank condition itself is not established.',
  nextCheck: 'Check both directions on the smallest admissible instance.',
  relatedNodeIds: [],
};
const reason =
  'The explicit reduction removes one independent obligation for this restricted family.';
const verification =
  'I checked both directions of the supplied reduction under its stated assumptions.';
function fixture() {
  const store = new Store(':memory:', false);
  const program = new ProgramStore(store);
  const goal = program.createGoal({
    title: 'Test goal',
    statement: 'Resolve the rank condition in the restricted family.',
    baseline: 'Two independent conditions remain.',
    successCriteria: 'An explicit correct reduction.',
  });
  const connection = new ConnectionManager({
    filePath: '/private/tmp/research-workbench-test-no-key.json',
    environment: {},
  });
  const chat = new ChatStore(store, program, connection);
  const notebook = new WorkbenchStore(store, program, chat);
  return { store, program, goal, connection, chat, notebook, close: () => store.db.close() };
}
function imported(f: ReturnType<typeof fixture>, reply = statement) {
  const session = f.chat.importSession({
    title: 'Research session',
    source: 'Provided transcript',
    goalId: f.goal.id,
    turns: [
      { role: 'user', content: 'Find a useful intermediate reduction.' },
      { role: 'assistant', content: reply },
    ],
  });
  return { session, message: f.chat.messages(session.id)[1] };
}
// Candidate records contain additional provenance fields; parse just the draft fields for review.
const pick = (c: unknown) => {
  const value = c as Record<string, unknown>;
  return candidateDraftSchema.parse(
    Object.fromEntries(Object.keys(draft).map((k) => [k, value[k]])),
  );
};
function accept(
  f: ReturnType<typeof fixture>,
  id: string,
  decision = 'Advance',
  details: Partial<CandidateDraft> = {},
) {
  const c = f.notebook.get(id);
  return f.notebook.update(id, {
    revision: c.revision,
    draft: { ...pick(c), ...details },
    decision,
    reason,
    verification,
  });
}

test('import preserves complete turns and explicit reply provenance without calling a model or changing the graph', () => {
  const f = fixture();
  try {
    const before = f.store.state();
    const { session, message } = imported(f);
    const [prompt, reply] = f.chat.messages(session.id);
    assert.equal(reply.provider, 'imported');
    assert.equal(reply.replyToId, prompt.id);
    assert.equal(reply.content, statement);
    assert.deepEqual(f.store.state(), before);
    assert.deepEqual(parseTranscript('User: Question\nAssistant: A $x^2$ calculation.'), [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'A $x^2$ calculation.' },
    ]);
    assert.throws(() => parseTranscript('Unlabeled text'), /Start with/);
    assert.equal(message.goalId, f.goal.id);
  } finally {
    f.close();
  }
});

test('fabricated source quotations reject and automatic extraction is idempotent and unreviewed', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    assert.throws(
      () => f.notebook.create(message.id, { ...draft, sourceQuote: 'Invented quotation' }),
      /exact passage/,
    );
    f.notebook.capture(message.id, [draft]);
    f.notebook.capture(message.id, [draft]);
    const all = f.notebook.state().candidates;
    assert.equal(all.length, 1);
    assert.equal(all[0].decision, 'Unreviewed');
    assert.equal(all[0].integratedNodeId, null);
    assert.equal(f.store.state().nodes.length, 0);
  } finally {
    f.close();
  }
});

test('restatements, missing independent checks and identical before/after claims cannot count as advances', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const c = f.notebook.create(message.id, draft);
    assert.throws(
      () => accept(f, c.id, 'Advance', { classification: 'Restatement' }),
      /restatement/,
    );
    assert.throws(() => accept(f, c.id, 'Advance', { gain: draft.baseline }), /equivalent/);
    assert.throws(
      () =>
        f.notebook.update(c.id, {
          revision: 1,
          draft,
          decision: 'Advance',
          reason,
          verification: '',
        }),
      /verification/,
    );
    const reviewed = accept(f, c.id, 'Reformulation', { classification: 'Restatement' });
    // A reformulation may be privately admitted for methodological value without becoming an advance.
    const admitted = f.notebook.integrate(c.id, {
      revision: reviewed.revision,
      admitToProject: true,
    });
    assert.equal(admitted.node.epistemicStatus, 'Unverified');
    assert.equal(admitted.candidate.decision, 'Reformulation');
    assert.equal(f.store.state().nodes.length, 1);
  } finally {
    f.close();
  }
});

test('review alone stays private; explicit integration is atomic, idempotent and never marks a proof or goal complete', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const c = f.notebook.create(message.id, draft);
    const accepted = accept(f, c.id);
    assert.equal(f.store.state().nodes.length, 0);
    assert.throws(() =>
      f.notebook.integrate(c.id, { revision: accepted.revision, publishToProject: false }),
    );
    const first = f.notebook.integrate(c.id, {
      revision: accepted.revision,
      publishToProject: true,
    });
    const second = f.notebook.integrate(c.id, {
      revision: accepted.revision,
      publishToProject: true,
    });
    assert.equal(first.node.id, second.node.id);
    assert.equal(second.alreadyApplied, true);
    assert.equal(f.store.state().nodes.length, 1);
    assert.equal(first.node.epistemicStatus, 'Unverified');
    assert.equal(first.node.humanVerified, false);
    assert.equal(f.program.getGoal(f.goal.id).status, 'Active');
    assert.ok(f.program.getGoal(f.goal.id).linkedNodeIds.includes(first.node.id));
    assert.equal(f.notebook.state().candidates[0].stale, false);
    assert.throws(() => accept(f, c.id), /already integrated/);
  } finally {
    f.close();
  }
});

test('a repeated statement in a later prompt cannot accumulate another accepted advance', () => {
  const f = fixture();
  try {
    const a = imported(f);
    const c = f.notebook.create(a.message.id, draft);
    const accepted = accept(f, c.id);
    f.notebook.integrate(c.id, { revision: accepted.revision, publishToProject: true });
    const b = imported(f);
    const repeated = f.notebook.create(b.message.id, draft);
    assert.ok(f.notebook.state().candidates.find((c) => c.id === repeated.id)?.duplicateOf);
    assert.throws(() => accept(f, repeated.id), /already integrated/);
    assert.equal(f.store.state().nodes.length, 1);
  } finally {
    f.close();
  }
});

test('goal changes invalidate pending reviews; explicit re-review rebases without rewriting the source', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const c = f.notebook.create(message.id, draft);
    const accepted = accept(f, c.id);
    f.program.updateGoal(f.goal.id, { baseline: 'A stronger known result changes the baseline.' });
    assert.equal(f.notebook.state().candidates[0].stale, true);
    assert.throws(
      () => f.notebook.integrate(c.id, { revision: accepted.revision, publishToProject: true }),
      /context changed/,
    );
    const next = f.notebook.update(c.id, {
      revision: accepted.revision,
      draft: { ...draft, baseline: 'A stronger known result changes the baseline.' },
      decision: 'Useful partial result',
      reason,
      verification,
      refreshBasis: true,
    });
    assert.equal(f.notebook.state().candidates[0].stale, false);
    assert.equal(next.original.baseline, draft.baseline);
    assert.equal(f.chat.messages().find((m) => m.id === message.id)?.content, statement);
  } finally {
    f.close();
  }
});

test('a late graph validation failure rolls back the new node and the candidate integration together', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const c = f.notebook.create(message.id, draft);
    const accepted = accept(f, c.id);
    const before = f.store.state();
    const old = f.program.saveAssessment;
    f.program.saveAssessment = () => {
      throw new Error('Injected review failure');
    };
    assert.throws(
      () => f.notebook.integrate(c.id, { revision: accepted.revision, publishToProject: true }),
      /Injected/,
    );
    f.program.saveAssessment = old;
    assert.deepEqual(f.store.state(), before);
    assert.equal(f.notebook.get(c.id).integratedNodeId, null);
  } finally {
    f.close();
  }
});

test('changing an integrated result excludes it from current progress while retaining its past review', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const c = f.notebook.create(message.id, draft);
    const accepted = accept(f, c.id);
    const result = f.notebook.integrate(c.id, {
      revision: accepted.revision,
      publishToProject: true,
    });
    f.store.updateNode(
      result.node.id,
      { content: 'A revised claim with different assumptions.' },
      'Human correction',
    );
    const current = f.notebook.state().candidates[0];
    assert.equal(current.stale, true);
    assert.equal(current.decision, 'Advance');
    assert.ok(current.history.some((h) => h.action === 'Admitted to private research record'));
  } finally {
    f.close();
  }
});

test('recorded rejections enter later model context and no-result turn judgments cannot contradict accepted candidates', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    f.chat.reviewTurn(message.id, {
      decision: 'No new result',
      reason: 'The attempted step only restates the missing rank condition.',
    });
    assert.equal(
      f.chat.messages().find((m) => m.id === message.id)?.turnReview?.decision,
      'No new result',
    );
    const c = f.notebook.create(message.id, draft);
    accept(f, c.id, 'Rejected');
    const context = JSON.parse(buildResearchContext(f.store, f.program, [], f.goal.id).text);
    assert.equal(context.reviewedWork[0].decision, 'Rejected');
    const c2 = f.notebook.create(message.id, { ...draft, title: 'Another candidate' });
    accept(f, c2.id);
    assert.equal(f.chat.messages().find((m) => m.id === message.id)?.turnReview?.decision, 'Open');
    assert.equal(
      f.chat.messages().find((m) => m.id === message.id)?.turnReviewHistory?.[0].decision,
      'No new result',
    );
    assert.throws(
      () => f.chat.reviewTurn(message.id, { decision: 'No new result', reason }),
      /accepted candidates/,
    );
  } finally {
    f.close();
  }
});

test('structured GPT candidates retain the exact prompt and an invalid extract does not destroy the readable reply', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'mock' });
    const request = (async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    content: statement,
                    proposal: null,
                    candidates: [draft, { ...draft, sourceQuote: 'Not in the reply' }],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const chat = new ChatStore(f.store, f.program, f.connection, request);
    const session = chat.createSession();
    const result = await chat.send(session.id, {
      content: 'Find one reduction.',
      goalId: f.goal.id,
      progressCriterion: 'Remove one independent obligation.',
    });
    assert.equal(result.assistantMessage.replyToId, result.userMessage.id);
    assert.equal(result.assistantMessage.candidates?.length, 1);
    assert.ok(result.assistantMessage.extractionNote);
    assert.equal(result.assistantMessage.content, statement);
    assert.ok(result.assistantMessage.reviewBasis);
    assert.equal(result.assistantMessage.error, undefined);
  } finally {
    f.close();
  }
});

test('newly selected premises and their dependencies invalidate reviews after a change', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const premise = f.store.createNode({
      title: 'Extra premise',
      type: 'Lemma',
      content: 'The initial premise.',
    });
    const dependency = f.store.createNode({
      title: 'Earlier fact',
      type: 'Lemma',
      content: 'The earlier fact.',
    });
    f.store.createEdge({
      sourceNodeId: premise.id,
      targetNodeId: dependency.id,
      edgeType: 'depends_on',
    });
    const c = f.notebook.create(message.id, { ...draft, relatedNodeIds: [premise.id] });
    assert.equal(f.notebook.state().candidates[0].stale, false);
    accept(f, c.id);
    assert.equal(f.notebook.state().candidates[0].stale, false);
    f.store.updateNode(dependency.id, { content: 'A changed hypothesis.' }, 'Changed premise');
    assert.equal(f.notebook.state().candidates[0].stale, true);
  } finally {
    f.close();
  }
});

test('an explicit no-goal session never silently assigns candidates to an unrelated goal', () => {
  const f = fixture();
  try {
    const session = f.chat.importSession({
      title: 'No goal',
      source: 'Transcript',
      goalId: null,
      turns: [{ role: 'assistant', content: statement }],
    });
    const c = f.notebook.create(f.chat.messages(session.id)[0].id, draft);
    assert.equal(c.goalId, null);
    assert.equal(c.basis.goalId, null);
    const a = accept(f, c.id);
    f.notebook.integrate(c.id, { revision: a.revision, publishToProject: true });
    assert.equal(f.program.getGoal(f.goal.id).linkedNodeIds.length, 0);
  } finally {
    f.close();
  }
});

test('changed integrated dependency edges invalidate both displayed progress and later GPT context', () => {
  const f = fixture();
  try {
    const { message } = imported(f);
    const c = f.notebook.create(message.id, draft),
      a = accept(f, c.id);
    const result = f.notebook.integrate(c.id, { revision: a.revision, publishToProject: true });
    const premise = f.store.createNode({
      title: 'New premise',
      type: 'Lemma',
      content: 'An extra assumption.',
    });
    f.store.createEdge({
      sourceNodeId: result.node.id,
      targetNodeId: premise.id,
      edgeType: 'depends_on',
    });
    assert.equal(f.notebook.state().candidates[0].stale, true);
    assert.equal(
      JSON.parse(buildResearchContext(f.store, f.program, [], f.goal.id).text).reviewedWork[0]
        .stale,
      true,
    );
  } finally {
    f.close();
  }
});

test('repetition checks preserve mathematical case and TeX grouping', () => {
  assert.notEqual(claimKey('$N=n$'), claimKey('$n=n$'));
  assert.notEqual(claimKey(String.raw`$\frac{x}{yz}$`), claimKey(String.raw`$\frac{xy}{z}$`));
  assert.equal(claimKey(' The same   statement. '), claimKey('The same statement.'));
});
