import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { belief, dependencyClosure, frontier } from '../shared/epistemics';
import { manualExtraction, openAI } from '../server/ingestion';
import {
  proposalSchema,
  nodeInputSchema,
  type ReviewItem,
  type ResearchNode,
  type ResearchEdge,
  type IngestionDraft,
} from '../shared/types';

test('node creation, editing, status changes, and retained history', () => {
  const s = new Store(':memory:', false);
  const n = s.transaction(() =>
    s.createNode({ title: 'Initial claim', type: 'Claim', tags: ['test'] }),
  );
  assert.equal(n.epistemicStatus, 'Unverified');
  assert.equal(n.originType, 'Human');
  s.transaction(() =>
    s.updateNode(n.id, { title: 'Precise claim', content: 'Full argument' }, 'Wording clarified'),
  );
  assert.throws(
    () => s.transaction(() => s.updateNode(n.id, { epistemicStatus: 'Proved' }, '')),
    /reason/,
  );
  assert.equal(s.getNode(n.id).epistemicStatus, 'Unverified');
  s.transaction(() =>
    s.updateNode(n.id, { epistemicStatus: 'Numerically Supported' }, 'Exact finite cases recorded'),
  );
  s.transaction(() =>
    s.updateNode(
      n.id,
      { epistemicStatus: 'Proved', humanVerified: true },
      'A complete symbolic proof was reviewed',
    ),
  );
  const events = s.state().events.filter((e) => e.eventType === 'status_changed');
  assert.equal(events.length, 2);
  assert.deepEqual(
    events
      .map((e) => [
        JSON.parse(e.previousValue!).epistemicStatus,
        JSON.parse(e.newValue!).epistemicStatus,
      ])
      .sort(),
    [
      ['Numerically Supported', 'Proved'],
      ['Unverified', 'Numerically Supported'],
    ].sort(),
  );
  assert.ok(events.every((e) => e.reason.length));
  s.close();
});
test('SQLite persistence survives close and reopening, without reseeding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-os-'));
  const path = join(dir, 'test.sqlite');
  try {
    let s = new Store(path);
    const before = s.state().nodes.length;
    const n = s.transaction(() => s.createNode({ title: 'Persisted claim', type: 'Claim' }));
    s.close();
    s = new Store(path);
    assert.equal(s.getNode(n.id).title, 'Persisted claim');
    assert.equal(s.state().nodes.length, before + 1);
    assert.ok(s.state().events.some((e) => e.nodeId === n.id));
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('status changes roll back if event logging fails', () => {
  const s = new Store(':memory:', false);
  const n = s.createNode({ title: 'Atomic claim', type: 'Claim' });
  s.db.exec(
    "CREATE TRIGGER reject_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  assert.throws(
    () => s.transaction(() => s.updateNode(n.id, { epistemicStatus: 'Proved' }, 'Test rollback')),
    /audit unavailable/,
  );
  assert.equal(s.getNode(n.id).epistemicStatus, 'Unverified');
  s.close();
});
function fixture() {
  const s = new Store(':memory:', false);
  const make = (title: string, extra: object = {}) =>
    s.createNode({ title, type: 'Claim', ...extra });
  return {
    s,
    make,
    edge: (sourceNodeId: string, targetNodeId: string, edgeType = 'depends_on') =>
      s.createEdge({ sourceNodeId, targetNodeId, edgeType }),
  };
}
test('proved result warns about transitive dependencies and deduplicates diamonds', () => {
  const { s, make, edge } = fixture();
  const a = make('Theorem', { type: 'Theorem', epistemicStatus: 'Proved', humanVerified: true }),
    b = make('Left', { epistemicStatus: 'Proved', humanVerified: true }),
    c = make('Right', { epistemicStatus: 'Proved', humanVerified: true }),
    d = make('Unverified assumption');
  edge(a.id, b.id);
  edge(a.id, c.id);
  edge(b.id, d.id);
  edge(c.id, d.id);
  const info = belief(a.id, s.state().nodes, s.state().edges);
  assert.equal(info.unresolved.length, 1);
  assert.equal(info.unresolved[0].id, d.id);
  assert.match(info.warnings[0], /depends on 1/);
  assert.equal(info.allDependenciesVerified, false);
  s.close();
});
test('cycles warn even when all participants are marked Proved and reviewed', () => {
  const { s, make, edge } = fixture();
  const a = make('A', { epistemicStatus: 'Proved', humanVerified: true }),
    b = make('B', { epistemicStatus: 'Proved', humanVerified: true });
  edge(a.id, b.id);
  edge(b.id, a.id);
  const info = belief(a.id, s.state().nodes, s.state().edges);
  assert.equal(info.cycle, true);
  assert.equal(info.allDependenciesVerified, false);
  assert.ok(info.warnings.some((w) => w.includes('Circular')));
  s.close();
});
test('evidence direction, numerical caution, and no automatic promotion', () => {
  const { s, make, edge } = fixture();
  const claim = make('Result', { epistemicStatus: 'Plausible' }),
    evidence = make('Finite check', {
      type: 'Evidence',
      epistemicStatus: 'Numerically Supported',
      originType: 'Human',
    }),
    experiment = make('Planned experiment', { type: 'Experiment' }),
    counter = make('Unverified counterexample', { type: 'Counterexample' });
  edge(claim.id, experiment.id, 'tested_by');
  let info = belief(claim.id, s.state().nodes, s.state().edges);
  assert.equal(info.experiments.length, 1);
  assert.equal(info.support.length, 0);
  assert.ok(!info.warnings.some((w) => w.includes('Numerical support')));
  edge(evidence.id, claim.id, 'supports');
  edge(counter.id, claim.id, 'contradicts');
  info = belief(claim.id, s.state().nodes, s.state().edges);
  assert.ok(info.warnings.some((w) => w.includes('Numerical support')));
  assert.ok(info.warnings.some((w) => w.includes('contradictory')));
  assert.equal(info.dependencies.length, 0);
  assert.equal(s.getNode(claim.id).epistemicStatus, 'Plausible');
  s.close();
});
test('edge validation, experiment type invariant, deletion, and retained snapshots', () => {
  const { s, make, edge } = fixture();
  const a = make('Claim'),
    b = make('Test', { type: 'Experiment' });
  const e = edge(a.id, b.id, 'tested_by');
  assert.throws(() => edge(a.id, a.id), /distinct/);
  assert.throws(() => edge(a.id, 'missing'), /not found/);
  assert.throws(() => edge(a.id, b.id, 'tested_by'), /UNIQUE/);
  assert.throws(
    () => s.transaction(() => s.updateNode(b.id, { type: 'Note' }, 'Rename type')),
    /tested_by/,
  );
  s.transaction(() => s.deleteNode(b.id, 'Retired test'));
  assert.equal(s.state().edges.length, 0);
  assert.ok(
    s.state().events.some((x) => x.eventType === 'node_deleted' && x.previousValue?.includes(e.id)),
  );
  s.close();
});
test('frontier is deterministic, explains scores, and ranks unresolved bottlenecks', () => {
  const s = new Store(':memory:');
  const state = s.state();
  const now = new Date();
  const ranked = frontier(state.nodes, state.edges, now);
  assert.equal(ranked[0].node.id, 'root-barrier');
  assert.ok(ranked[0].downstream >= 4);
  assert.ok(ranked[0].reasons.some((r) => r.includes('downstream')));
  assert.ok(
    !ranked.some(
      (r) => r.node.epistemicStatus === 'Disproved' || r.node.epistemicStatus === 'Abandoned',
    ),
  );
  assert.ok(ranked.some((r) => r.node.id === 'draft-proof'));
  assert.deepEqual(
    ranked.map((r) => [r.node.id, r.score]),
    frontier([...state.nodes].reverse(), [...state.edges].reverse(), now).map((r) => [
      r.node.id,
      r.score,
    ]),
  );
  for (const r of ranked)
    assert.equal(
      r.score,
      r.reasons.reduce((sum, x) => sum + Number(x.match(/\(\+(\d+)\)/)![1]), 0),
    );
  s.close();
});
test('ingestion validates shapes, duplicate IDs, endpoints, and cautious defaults', () => {
  const p = manualExtraction(
    'Claim: Every case is solved.\n\nOpen question: Why does the estimate hold?',
  );
  assert.equal(p.items[0].type, 'Claim');
  assert.equal(p.items[1].type, 'Open Question');
  assert.throws(() => proposalSchema.parse({ ...p, items: [p.items[0], p.items[0]] }), /unique/);
  assert.throws(
    () =>
      proposalSchema.parse({
        ...p,
        edges: [
          {
            sourceTempId: 'missing',
            targetTempId: 'item-1',
            edgeType: 'depends_on',
            explanation: '',
          },
        ],
      }),
    /distinct proposed/,
  );
  assert.throws(() =>
    proposalSchema.parse({ items: [{ ...p.items[0], type: 'Fact' }], edges: [] }),
  );
  assert.throws(() => nodeInputSchema.parse({ title: '', type: 'Claim' }));
  assert.throws(() => nodeInputSchema.parse({ title: 'A', type: 'Claim', confidence: 1.2 }));
  assert.throws(() =>
    nodeInputSchema.parse({ title: 'A', type: 'Claim', epistemicStatus: 'Definitely true' }),
  );
  assert.throws(() =>
    nodeInputSchema.parse({ title: 'A', type: 'Claim', links: ['javascript:alert(1)'] }),
  );
});
test('review commits create/merge/discard, preserve transcript, filter edges, and prevent replays', () => {
  const s = new Store(':memory:', false);
  const existing = s.createNode({
    title: 'Existing claim',
    type: 'Claim',
    content: 'Original proof',
    epistemicStatus: 'Proved',
    humanVerified: true,
  });
  const p = manualExtraction('Claim: A.\n\nClaim: B.\n\nClaim: C.');
  p.edges = [
    {
      sourceTempId: 'item-1',
      targetTempId: 'item-2',
      edgeType: 'depends_on',
      explanation: 'A needs B',
    },
    {
      sourceTempId: 'item-1',
      targetTempId: 'item-3',
      edgeType: 'depends_on',
      explanation: 'Dropped prerequisite',
    },
  ];
  const d = s.saveDraft(p, 'Full original transcript', 'Test session', 'manual');
  const items: ReviewItem[] = p.items.map((i, n) => ({
    ...i,
    decision: n === 0 ? 'create' : n === 1 ? 'merge' : 'discard',
    ...(n === 1 ? { mergeNodeId: existing.id } : {}),
    epistemicStatus: 'Proved',
    humanVerified: true,
  }));
  const result = s.commitDraft(d.id, items, p.edges);
  assert.equal(result.created.length, 1);
  const created = result.created[0];
  assert.equal(created.epistemicStatus, 'Unverified');
  assert.equal(created.originType, 'AI-extracted');
  assert.equal(created.humanVerified, false);
  assert.equal(s.getNode(existing.id).epistemicStatus, 'Proved');
  assert.equal(s.getNode(existing.id).humanVerified, false);
  assert.match(s.getNode(existing.id).content, /Original proof/);
  assert.match(s.getNode(existing.id).content, /Unverified material/);
  assert.equal(s.getNode(result.sessionId).content, 'Full original transcript');
  assert.equal(s.state().edges.filter((e) => e.edgeType === 'depends_on').length, 1);
  assert.ok(!s.state().nodes.some((n) => n.title === 'Claim: C.'));
  assert.throws(() => s.commitDraft(d.id, items, p.edges), /already committed/);
  s.close();
});
test('failed ingestion leaves no partial session, items, or events', () => {
  const s = new Store(':memory:', false);
  const p = manualExtraction('Claim: A.\n\nClaim: B.');
  const draft = s.saveDraft(p, 'Transcript', 'Atomic import', 'manual');
  const before = s.state();
  const items: ReviewItem[] = p.items.map((i, n) => ({
    ...i,
    decision: n ? 'merge' : 'create',
    ...(n ? { mergeNodeId: 'missing' } : {}),
  }));
  assert.throws(() => s.commitDraft(draft.id, items, []), /not found/);
  assert.deepEqual(s.state(), before);
  assert.equal(s.getDraft(draft.id).committedAt, null);
  s.close();
});
test('seed history records genuine chronological status transitions', () => {
  const s = new Store(':memory:');
  const events = s.state().events;
  const created = events.find(
    (e) => e.nodeId === 'strong-conjecture' && e.eventType === 'node_created',
  )!;
  const changed = events.find(
    (e) => e.nodeId === 'strong-conjecture' && e.eventType === 'status_changed',
  )!;
  assert.equal(JSON.parse(created.newValue!).epistemicStatus, 'Plausible');
  assert.equal(JSON.parse(changed.previousValue!).epistemicStatus, 'Plausible');
  assert.equal(JSON.parse(changed.newValue!).epistemicStatus, 'Disproved');
  assert.ok(changed.createdAt > created.createdAt);
  assert.ok(events.every((e, i) => i === 0 || e.createdAt <= events[i - 1].createdAt));
  s.close();
});
test('structured OpenAI transport uses strict schema, server key, and handles refusals/incomplete responses', async () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-never-sent';
  try {
    const mock: typeof fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: '{"items":[],"edges":[]}' }] }],
        }),
      );
    };
    assert.equal(
      await openAI('instructions', 'input', { type: 'object' }, mock),
      '{"items":[],"edges":[]}',
    );
    await assert.rejects(
      openAI('', '', undefined, async () => new Response(JSON.stringify({ status: 'incomplete' }))),
      /incomplete/,
    );
    await assert.rejects(
      openAI(
        '',
        '',
        undefined,
        async () =>
          new Response(
            JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }),
          ),
      ),
      /declined/,
    );
    await assert.rejects(
      openAI('', '', undefined, async () => new Response('error', { status: 429 })),
      /429/,
    );
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});
test('substantive edits clear stale verification unless explicitly re-affirmed', () => {
  const s = new Store(':memory:', false);
  const n = s.createNode({
    title: 'Reviewed result',
    type: 'Claim',
    content: 'Old proof',
    epistemicStatus: 'Proved',
    humanVerified: true,
  });
  s.transaction(() => s.updateNode(n.id, { content: 'Changed argument' }, 'Argument changed'));
  assert.equal(s.getNode(n.id).humanVerified, false);
  s.transaction(() =>
    s.updateNode(
      n.id,
      { content: 'Checked argument', humanVerified: true },
      'New argument checked',
    ),
  );
  assert.equal(s.getNode(n.id).humanVerified, true);
  s.transaction(() =>
    s.updateNode(n.id, { title: 'A different proposition' }, 'Statement changed'),
  );
  assert.equal(s.getNode(n.id).humanVerified, false);
  s.transaction(() => s.updateNode(n.id, { humanVerified: true }, 'Rechecked'));
  s.transaction(() => s.updateNode(n.id, { summary: 'A stronger scope' }, 'Scope changed'));
  assert.equal(s.getNode(n.id).humanVerified, false);
  s.close();
});
test('local ingestion tolerates Markdown separators and empty headings', () => {
  const p = manualExtraction(
    'Claim: A\n\n---\n\n***\n\n#\n\nClaim: B\n\n##\nDetails of the argument',
  );
  assert.equal(p.items.length, 3);
  assert.ok(p.items.every((item) => item.title.trim().length > 0));
  assert.equal(p.items[2].title, 'Details of the argument');
});
