import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store, LEGACY_PROJECT_ID } from '../server/domain-store';
import { ProgramStore } from '../server/program-store';
import { ChatStore, buildResearchContext } from '../server/chat';
import { ConnectionManager } from '../server/connection';
import { WorkbenchStore } from '../server/workbench';
import { candidateDraftSchema, type CandidateDraft } from '../shared/workbench';

// Synthetic independent projects deliberately use unrelated mathematical topics.
const statement = 'Every vertex of this finite graph has even degree.';
const draft: CandidateDraft = {
  title: 'Even degree observation',
  kind: 'Claim',
  classification: 'Routine consequence',
  statement,
  sourceQuote: statement,
  baseline: 'The degree parity was not recorded.',
  gain: 'Record this finite example only.',
  mechanism: 'Count the incident edges of each vertex.',
  evidence: 'Human observation, unverified.',
  gap: 'No general graph statement follows.',
  nextCheck: 'Recount the explicitly supplied example.',
  relatedNodeIds: [],
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  const legacy = new Store(db, false);
  for (const [id, title] of [
    ['graphs', 'Synthetic graph parity'],
    ['geometry', 'Synthetic circle geometry'],
  ])
    db.prepare('INSERT INTO projects VALUES(?,?)').run(
      id,
      JSON.stringify({
        id,
        title,
        description: '',
        createdAt: '2026-01-01',
        visibility: 'private',
      }),
    );
  const make = (id: string) => {
    const store = new Store(db, true, id);
    const program = new ProgramStore(store);
    const connection = new ConnectionManager({
      filePath: '/private/tmp/research-scope-no-key.json',
      environment: {},
    });
    const chat = new ChatStore(store, program, connection);
    const notebook = new WorkbenchStore(store, program, chat);
    return { store, program, connection, chat, notebook };
  };
  return { db, legacy, a: make('graphs'), b: make('geometry') };
}
function importReply(
  f: ReturnType<typeof fixture>['a'],
  goalId: string | null = null,
  content = statement,
) {
  const session = f.chat.importSession({
    title: 'Synthetic transcript',
    source: 'Synthetic test',
    goalId,
    originalTranscript: `Assistant: ${content}`,
    turns: [{ role: 'assistant', content }],
  });
  return f.chat.messages(session.id)[0];
}
function review(
  f: ReturnType<typeof fixture>['a'],
  id: string,
  decision: 'Useful partial result' | 'Rejected' | 'Reformulation' = 'Useful partial result',
) {
  const c = f.notebook.get(id);
  const fields = Object.keys(candidateDraftSchema.shape);
  return f.notebook.update(id, {
    revision: c.revision,
    draft: Object.fromEntries(fields.map((k) => [k, c[k as keyof typeof c]])),
    decision,
    reason: 'Scoped review of the explicitly supplied finite observation.',
    verification: '',
  });
}

test('explicit projects start empty, stay independent, and unknown selection never creates a project', () => {
  const f = fixture();
  try {
    assert.equal(f.a.store.projectId, 'graphs');
    assert.deepEqual(f.a.store.state().nodes, []);
    assert.deepEqual(f.b.program.state().goals, []);
    assert.deepEqual(f.a.chat.sessions(), []);
    const a = f.a.store.createNode({ title: 'Parity', type: 'Claim' });
    const b = f.b.store.createNode({ title: 'Circle', type: 'Claim' });
    assert.deepEqual(
      f.a.store.state().nodes.map((n) => n.id),
      [a.id],
    );
    assert.deepEqual(
      f.b.store.state().nodes.map((n) => n.id),
      [b.id],
    );
    assert.equal(a.projectId, 'graphs');
    assert.equal(f.a.store.state().project.title, 'Synthetic graph parity');
    assert.throws(() => new Store(f.db, true, 'absent'), /Project not found/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM projects').get()!.n, 3);
  } finally {
    f.db.close();
  }
});

test('forged cross-project node, edge, goal, draft, assessment, session and candidate IDs fail closed', () => {
  const f = fixture();
  try {
    const a = f.a.store.createNode({ title: 'Parity', type: 'Claim' });
    const b = f.b.store.createNode({ title: 'Circle', type: 'Claim' });
    const goal = f.b.program.createGoal({
      title: 'Circle goal',
      statement: 'A circle-specific question',
      linkedNodeIds: [b.id],
    });
    const session = f.b.chat.createSession();
    const message = importReply(f.b);
    const candidate = f.b.notebook.create(message.id, draft);
    const savedDraft = f.b.store.saveDraft(
      { items: [], edges: [] },
      'Private geometry source',
      'Geometry',
      'manual',
    );
    for (const action of [
      () => f.a.store.getNode(b.id),
      () => f.a.store.updateNode(b.id, { title: 'Forged' }, 'Attempt'),
      () => f.a.store.deleteNode(b.id, 'Attempt'),
      () =>
        f.a.store.createEdge({ sourceNodeId: a.id, targetNodeId: b.id, edgeType: 'depends_on' }),
      () => f.a.program.getGoal(goal.id),
      () =>
        f.a.program.createGoal({
          title: 'Forged goal',
          statement: 'Wrong scope',
          parentGoalId: goal.id,
        }),
      () =>
        f.a.program.createGoal({
          title: 'Forged node link',
          statement: 'Wrong scope',
          linkedNodeIds: [b.id],
        }),
      () => f.a.program.saveAssessment(b.id, {}),
      () => f.a.store.getDraft(savedDraft.id),
      () => f.a.chat.session(session.id),
      () => f.a.chat.messages(session.id),
      () => f.a.chat.updateSession(session.id, { draft: 'Overwrite' }),
      () => f.a.notebook.get(candidate.id),
      () => f.a.notebook.create(message.id, draft),
      () => buildResearchContext(f.a.store, f.a.program, [b.id]),
      () => buildResearchContext(f.a.store, f.a.program, [], goal.id),
    ])
      assert.throws(action, /not found|Choose/);
    assert.equal(f.a.notebook.state().candidates.length, 0);
    assert.equal(f.a.chat.messages().length, 0);
    assert.equal(f.a.program.state().assessments.length, 0);
    assert.equal(f.b.store.getNode(b.id).title, 'Circle');
  } finally {
    f.db.close();
  }
});

test('missing project metadata maps only to the legacy project and never the selected project', () => {
  const f = fixture();
  try {
    f.db
      .prepare('INSERT INTO chat_sessions VALUES(?,?)')
      .run(
        'old-session',
        JSON.stringify({
          id: 'old-session',
          title: 'Original private chat',
          createdAt: '',
          updatedAt: '',
        }),
      );
    f.db
      .prepare('INSERT INTO drafts VALUES(?,?)')
      .run(
        'old-draft',
        JSON.stringify({
          id: 'old-draft',
          items: [],
          edges: [],
          transcript: 'Original private source',
        }),
      );
    const legacyChat = new ChatStore(f.legacy, new ProgramStore(f.legacy), f.a.connection);
    assert.equal(legacyChat.sessions()[0].id, 'old-session');
    assert.equal(f.legacy.rows('drafts').length, 1);
    assert.equal(f.a.chat.sessions().length, 0);
    assert.equal(f.b.store.rows('drafts').length, 0);
    assert.equal(f.legacy.projectId, LEGACY_PROJECT_ID);
  } finally {
    f.db.close();
  }
});

test('new related context stays nonlogical, explicit premises stay explicit, admission never asserts proof or publication', () => {
  const f = fixture();
  try {
    const context = f.a.store.createNode({ title: 'Related example', type: 'Note' });
    const premise = f.a.store.createNode({ title: 'Finite domain assumption', type: 'Lemma' });
    const message = importReply(f.a);
    const c = f.a.notebook.create(message.id, {
      ...draft,
      relatedNodeIds: [context.id],
      premiseNodeIds: [premise.id],
    });
    const reviewed = review(f.a, c.id, 'Reformulation');
    const admitted = f.a.notebook.integrate(c.id, {
      revision: reviewed.revision,
      admitToProject: true,
    });
    const edges = f.a.store.state().edges.filter((e) => e.sourceNodeId === admitted.node.id);
    assert.deepEqual(
      edges.map((e) => [e.targetNodeId, e.edgeType]).sort(),
      [
        [premise.id, 'depends_on'],
        [context.id, 'related_to'],
      ].sort(),
    );
    assert.equal(admitted.node.epistemicStatus, 'Unverified');
    assert.equal(admitted.node.humanVerified, false);
    assert.equal(f.a.store.state().project.visibility, 'private');
    assert.match(admitted.candidate.history.at(-1)!.action, /private/);
    assert.equal(
      f.a.notebook.integrate(c.id, { revision: reviewed.revision, admitToProject: true })
        .alreadyApplied,
      true,
    );
  } finally {
    f.db.close();
  }
});

test('legacy premise selections are preserved as attributed assertions without changing source text', () => {
  const f = fixture();
  try {
    const node = f.a.store.createNode({ title: 'Old chosen premise', type: 'Lemma' });
    const message = importReply(f.a);
    const c = f.a.notebook.create(message.id, { ...draft, relatedNodeIds: [node.id] });
    const raw = { ...c };
    delete raw.premiseNodeIds;
    f.db
      .prepare('UPDATE workbench_candidates SET data=? WHERE id=?')
      .run(JSON.stringify(raw), c.id);
    const loaded = f.a.notebook.get(c.id);
    assert.deepEqual(loaded.premiseNodeIds, [node.id]);
    assert.equal(loaded.legacyPremiseSelection, true);
    assert.equal(loaded.sourceQuote, c.sourceQuote);
  } finally {
    f.db.close();
  }
});

test('nested transactions roll back admission callback and all graph/audit changes together', () => {
  const f = fixture();
  try {
    const message = importReply(f.a),
      c = f.a.notebook.create(message.id, draft),
      reviewed = review(f.a, c.id);
    const notebook = new WorkbenchStore(f.a.store, f.a.program, f.a.chat, () => {
      f.a.store.transaction(() =>
        f.a.store.createNode({ title: 'Partial hook write', type: 'Note' }),
      );
      throw new Error('Injected engine failure');
    });
    const before = f.a.store.state();
    assert.throws(
      () =>
        f.a.store.transaction(() =>
          notebook.integrate(c.id, { revision: reviewed.revision, admitToProject: true }),
        ),
      /Injected/,
    );
    assert.deepEqual(f.a.store.state(), before);
    assert.equal(f.a.notebook.get(c.id).integratedNodeId, null);
  } finally {
    f.db.close();
  }
});

test('older relevant failures survive newer unrelated and same-goal records in bounded retrieval', () => {
  const f = fixture();
  try {
    const goal = f.a.program.createGoal({
      title: 'Parity goal',
      statement: 'Understand parity in finite graphs.',
    });
    const unrelated = f.a.program.createGoal({
      title: 'Another graph question',
      statement: 'An unrelated coloring question.',
    });
    const failure = f.a.notebook.create(importReply(f.a, goal.id).id, {
      ...draft,
      title: 'Important old failed route',
    });
    review(f.a, failure.id, 'Rejected');
    for (let i = 0; i < 48; i++)
      f.a.notebook.create(importReply(f.a, i % 2 ? goal.id : unrelated.id).id, {
        ...draft,
        title: `Later observation ${i}`,
      });
    f.b.notebook.create(importReply(f.b).id, {
      ...draft,
      title: 'Private geometry result',
      statement: 'GEOMETRY PRIVATE SENTINEL',
    });
    const context = buildResearchContext(f.a.store, f.a.program, [], goal.id);
    const payload = JSON.parse(context.text);
    assert.equal(payload.reviewedWork[0].id, failure.id);
    assert.equal(payload.reviewedWork[0].decision, 'Rejected');
    assert.equal(payload.reviewedWork.length, 25);
    assert.ok(!context.text.includes('GEOMETRY PRIVATE SENTINEL'));
    assert.equal(context.summary.manifest?.projectId, 'graphs');
    assert.match(
      context.summary.manifest?.selected.find((r) => r.id === failure.id)?.reason ?? '',
      /failure/,
    );
  } finally {
    f.db.close();
  }
});

test('a delayed model response remains bound to its original project after another tab selects a different project', async () => {
  const f = fixture();
  try {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    f.a.connection.update({ apiKey: 'synthetic-test-key' });
    const chat = new ChatStore(
      f.a.store,
      f.a.program,
      f.a.connection,
      (async () => pending) as typeof fetch,
    );
    const session = chat.createSession();
    const response = chat.send(session.id, { content: 'Inspect graph parity.', notebook: true });
    const otherSession = f.b.chat.createSession('Circle session in a different tab');
    f.b.chat.updateSession(otherSession.id, { draft: 'A geometry draft.' });
    resolve(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ content: statement, candidates: [draft], proposal: null }),
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await response;
    assert.equal(result.assistantMessage.projectId, 'graphs');
    assert.equal(chat.messages(session.id).length, 2);
    assert.equal(f.b.chat.messages().length, 0);
    assert.equal(f.b.chat.session(otherSession.id).draft, 'A geometry draft.');
  } finally {
    f.db.close();
  }
});

test('visible mathematical answers survive malformed extraction and incomplete generation without admitting changes', async () => {
  const f = fixture();
  try {
    f.a.connection.update({ apiKey: 'synthetic-test-key' });
    for (const status of ['completed', 'incomplete']) {
      const request = (async () =>
        new Response(
          JSON.stringify({
            status,
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      content: statement,
                      proposal: { unsupported: true },
                      candidates: [],
                    }),
                  },
                ],
              },
            ],
          }),
        )) as typeof fetch;
      const chat = new ChatStore(f.a.store, f.a.program, f.a.connection, request);
      const result = await chat.send(chat.createSession().id, {
        content: 'Give a finite observation.',
      });
      assert.equal(result.assistantMessage.content, statement);
      assert.ok(result.assistantMessage.error);
      assert.equal(result.assistantMessage.proposal, null);
      assert.ok(result.assistantMessage.visibleProviderOutput?.includes(statement));
      assert.equal(
        result.assistantMessage.requestOutcome,
        status === 'incomplete' ? 'incomplete' : 'completed',
      );
    }
    assert.equal(f.a.store.state().nodes.length, 0);
  } finally {
    f.db.close();
  }
});

test('human-authored imported observations are first-class candidate sources and preserve original import text', () => {
  const f = fixture();
  try {
    const original = `User: Human observation 😀\r\n${statement}\r\n`;
    const session = f.a.chat.importSession({
      title: 'Human observation',
      source: 'Human supplied note',
      goalId: null,
      originalTranscript: original,
      turns: [{ role: 'user', content: statement }],
    });
    const c = f.a.notebook.create(f.a.chat.messages(session.id)[0].id, draft);
    const reviewed = review(f.a, c.id);
    assert.equal(f.a.chat.session(session.id).originalTranscript, original);
    assert.equal(
      f.a.notebook.integrate(c.id, { revision: reviewed.revision, admitToProject: true }).node
        .epistemicStatus,
      'Unverified',
    );
  } finally {
    f.db.close();
  }
});
