import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';
import { ChatStore, buildResearchContext, requestResearchReply } from '../server/chat';
import { ConnectionManager } from '../server/connection';
import { chatResponseSchema, type ChatProposal } from '../shared/chat';

const emptyProposal = (): ChatProposal => ({
  summary: 'A proposed reduction to review.',
  nodes: [],
  edges: [],
  goals: [],
  assessments: [],
});
const proposedNode = {
  tempId: 'new:lemma',
  title: 'Conditional intermediate lemma',
  summary: 'A candidate reduction; not yet proved.',
  content: 'Assume $x>0$. The missing step remains open.',
  type: 'Lemma' as const,
  tags: ['candidate'],
};
const response = (proposal: ChatProposal | null = null) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({ content: 'A possible approach, still unverified.', proposal }),
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'research-chat-test-'));
  const path = join(directory, 'research.sqlite');
  const store = new Store(path, false);
  const program = new ProgramStore(store);
  const connection = new ConnectionManager({
    filePath: join(directory, 'connection.json'),
    environment: {},
  });
  return {
    directory,
    path,
    store,
    program,
    connection,
    close: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function provider(fn: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return fn as typeof fetch;
}

test('local worksheet is honestly labeled, never changes mathematics, and survives a database reload', async () => {
  const f = fixture();
  try {
    const chat = new ChatStore(f.store, f.program, f.connection);
    const session = chat.createSession();
    const before = f.store.state();
    const result = await chat.send(session.id, { content: 'Prove $P=NP$.', mode: 'audit' });
    assert.equal(result.assistantMessage.provider, 'local');
    assert.equal(result.assistantMessage.proposal, null);
    assert.match(result.assistantMessage.content, /no GPT model was called/);
    assert.deepEqual(f.store.state(), before);
    assert.equal(chat.messages(session.id).length, 2);
    const second = new Store(f.path, false);
    try {
      const restored = new ChatStore(second, new ProgramStore(second), f.connection);
      assert.equal(restored.messages(session.id)[0].content, 'Prove $P=NP$.');
      assert.equal(restored.sessions()[0].title, 'Prove $P=NP$.');
      assert.ok(!JSON.stringify(restored.state()).includes('baseFingerprint'));
    } finally {
      second.close();
    }
  } finally {
    f.close();
  }
});

test('Responses request uses strict output, store:false, live context and bounded history', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key', model: 'test-model' });
    let captured: Record<string, any> = {};
    const request = provider(async (_url, options) => {
      captured = JSON.parse(String(options?.body));
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-key');
      return response();
    });
    await requestResearchReply(
      f.connection,
      '{"goals":[]}',
      [{ role: 'assistant', content: 'Earlier question' }],
      'Find the first gap',
      'audit',
      request,
    );
    assert.equal(captured.store, false);
    assert.equal(captured.model, 'test-model');
    assert.equal(captured.text.format.strict, true);
    assert.equal(captured.text.format.schema.additionalProperties, false);
    assert.match(captured.instructions, /Restatement/);
    assert.match(captured.input[0].content, /audit/);
    assert.equal(captured.input.at(-1).content, 'Find the first gap');
    assert.ok(!JSON.stringify(captured).includes('test-key'));
  } finally {
    f.close();
  }
});

test('reviewed proposal atomically creates goals, nodes, relationships and unreviewed assessments only once', async () => {
  const f = fixture();
  try {
    const baseline = f.store.createNode({
      title: 'Baseline',
      type: 'Claim',
      epistemicStatus: 'Proved',
      humanVerified: true,
    });
    f.connection.update({ apiKey: 'test-key' });
    const p = emptyProposal();
    p.nodes = [proposedNode];
    p.edges = [
      {
        sourceNodeId: 'new:lemma',
        targetNodeId: baseline.id,
        edgeType: 'depends_on',
        explanation: 'Assumes the baseline bound; missing proof obligation retained.',
      },
    ];
    p.goals = [
      {
        tempId: 'goal:target',
        existingGoalId: null,
        title: 'Sharper bound',
        statement: 'Establish the stronger bound for all inputs.',
        successCriteria: 'A complete proof including degenerate cases.',
        baseline: 'The weaker bound is given.',
        kind: 'Ultimate',
        parentGoalId: null,
        linkedNodeIds: ['new:lemma'],
        nextAction: 'Test the first boundary case.',
      },
    ];
    p.assessments = [
      {
        nodeId: 'new:lemma',
        classification: 'New reduction',
        before: 'Full problem',
        after: 'One smaller obligation',
        mechanism: 'Candidate decomposition, unverified',
        check: 'Prove equivalence and test boundary cases',
      },
    ];
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const session = chat.createSession();
    const { assistantMessage } = await chat.send(session.id, {
      content: 'Propose one real intermediate goal',
      mode: 'explore',
      contextNodeIds: [baseline.id],
    });
    assert.equal(assistantMessage.proposalStatus, 'pending');
    assert.equal(f.store.state().nodes.length, 1);
    const applied = chat.apply(assistantMessage.id);
    const created = f.store.getNode(applied.nodeIds[0]);
    assert.equal(created.epistemicStatus, 'Unverified');
    assert.equal(created.humanVerified, false);
    assert.equal(created.originType, 'AI agent');
    assert.equal(f.program.state().assessments[0].verdict, 'Unreviewed');
    assert.equal(f.program.state().goals[0].status, 'Active');
    assert.deepEqual(f.program.state().goals[0].linkedNodeIds, [created.id]);
    assert.equal(f.store.state().edges[0].targetNodeId, baseline.id);
    assert.throws(() => chat.apply(assistantMessage.id), /no longer pending/);
    assert.equal(chat.messages(session.id)[1].proposalStatus, 'applied');
    assert.equal(f.store.getNode(baseline.id).humanVerified, true);
  } finally {
    f.close();
  }
});

test('stale proposals reject after human graph or program edits without partial writes', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key' });
    const p = emptyProposal();
    p.nodes = [proposedNode];
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const { assistantMessage } = await chat.send(chat.createSession().id, {
      content: 'Suggest a lemma',
    });
    f.program.createGoal({ title: 'A new human target', statement: 'A precise target.' });
    assert.throws(() => chat.apply(assistantMessage.id), /changed after this proposal/);
    assert.equal(f.store.state().nodes.length, 0);
    assert.equal(chat.messages().at(-1)?.proposalStatus, 'pending');
  } finally {
    f.close();
  }
});

test('unknown references, dependency cycles, self edges, and fabricated proof statuses are rejected', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key' });
    const a = f.store.createNode({ title: 'A', type: 'Lemma' });
    const b = f.store.createNode({ title: 'B', type: 'Lemma' });
    f.store.createEdge({ sourceNodeId: a.id, targetNodeId: b.id, edgeType: 'depends_on' });
    for (const edge of [
      {
        sourceNodeId: b.id,
        targetNodeId: a.id,
        edgeType: 'depends_on' as const,
        explanation: 'Circular',
      },
      {
        sourceNodeId: b.id,
        targetNodeId: 'missing',
        edgeType: 'supports' as const,
        explanation: 'Invented',
      },
      {
        sourceNodeId: b.id,
        targetNodeId: b.id,
        edgeType: 'supports' as const,
        explanation: 'Self',
      },
    ]) {
      const p = emptyProposal();
      p.nodes = [proposedNode];
      p.edges = [edge];
      const chat = new ChatStore(
        f.store,
        f.program,
        f.connection,
        provider(async () => response(p)),
      );
      const result = await chat.send(chat.createSession().id, { content: 'Review this' });
      assert.ok(result.assistantMessage.error);
      assert.equal(result.assistantMessage.proposal, null);
    }
    const illegal = emptyProposal();
    assert.throws(() =>
      chatResponseSchema.parse({
        content: 'Done',
        proposal: { ...illegal, nodes: [{ ...proposedNode, epistemicStatus: 'Proved' }] },
      }),
    );
    assert.equal(f.store.state().nodes.length, 2);
  } finally {
    f.close();
  }
});

test('cyclic new goal hierarchy rolls back already-created nodes and audit events', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key' });
    const p = emptyProposal();
    p.nodes = [proposedNode];
    const g = {
      existingGoalId: null,
      title: 'Cyclic milestone',
      statement: 'Pending claim',
      successCriteria: 'Exact proof',
      baseline: 'Unknown',
      kind: 'Milestone' as const,
      linkedNodeIds: ['new:lemma'],
      nextAction: 'Audit cycle',
    };
    p.goals = [
      { ...g, tempId: 'goal:a', parentGoalId: 'goal:b' },
      { ...g, tempId: 'goal:b', parentGoalId: 'goal:a' },
    ];
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const result = await chat.send(chat.createSession().id, {
      content: 'Suggest a goal hierarchy',
    });
    const before = f.store.state();
    assert.throws(() => chat.apply(result.assistantMessage.id), /cycle/);
    assert.deepEqual(f.store.state(), before);
    assert.equal(f.program.state().goals.length, 0);
    assert.equal(chat.messages().at(-1)?.proposalStatus, 'pending');
  } finally {
    f.close();
  }
});

test('provider failure, refusal, invalid JSON, and incomplete output retain prompts without graph changes', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key' });
    const variants = [
      () => new Response('sensitive provider error body', { status: 401 }),
      () => new Response(JSON.stringify({ status: 'incomplete', output: [] })),
      () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ content: [{ type: 'refusal', text: 'No' }] }],
          }),
        ),
      () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ content: [{ type: 'output_text', text: 'not json' }] }],
          }),
        ),
    ];
    for (const make of variants) {
      const chat = new ChatStore(
        f.store,
        f.program,
        f.connection,
        provider(async () => make()),
      );
      const session = chat.createSession();
      const result = await chat.send(session.id, { content: 'My saved prompt' });
      assert.ok(result.assistantMessage.error);
      assert.equal(chat.messages(session.id).length, 2);
      assert.ok(!result.assistantMessage.error.includes('sensitive provider'));
      assert.equal(result.assistantMessage.proposal, null);
    }
    assert.equal(f.store.state().nodes.length, 0);
  } finally {
    f.close();
  }
});

test('discard is persisted and cannot later be applied', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key' });
    const p = emptyProposal();
    p.nodes = [proposedNode];
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const result = await chat.send(chat.createSession().id, { content: 'Suggest a lemma' });
    assert.equal(chat.discard(result.assistantMessage.id).proposalStatus, 'discarded');
    assert.throws(() => chat.apply(result.assistantMessage.id), /no longer pending/);
    assert.equal(f.store.state().nodes.length, 0);
  } finally {
    f.close();
  }
});

test('connection secrets are memory-only by default and optional files have owner-only permissions', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-secret', model: 'test-model', persist: false });
    assert.equal(f.connection.status().source, 'memory');
    assert.ok(!JSON.stringify(f.connection.status()).includes('test-secret'));
    f.connection.update({ persist: true });
    const file = join(f.directory, 'connection.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).apiKey, 'test-secret');
    const restored = new ConnectionManager({ filePath: file, environment: {} });
    assert.equal(restored.get().apiKey, 'test-secret');
    let checked = '';
    const result = await restored.test(
      provider(async (url, options) => {
        checked = String(url);
        assert.equal(options?.method, undefined);
        return new Response('{}');
      }),
    );
    assert.match(checked, /\/models\/test-model$/);
    assert.equal(result.ok, true);
    restored.update({ disconnect: true });
    assert.equal(restored.get().apiKey, undefined);
    assert.equal(
      new ConnectionManager({ filePath: file, environment: {} }).status().configured,
      false,
    );
  } finally {
    f.close();
  }
});

test('context selects live node evidence, bounds large data, and rejects missing selections', () => {
  const f = fixture();
  try {
    const nodes = Array.from({ length: 12 }, (_, i) =>
      f.store.createNode({
        title: `Claim ${i}`,
        type: 'Claim',
        content: 'x'.repeat(99999),
        provenanceText: 'p'.repeat(19999),
      }),
    );
    const goal = f.program.createGoal({
      title: 'Goal',
      statement: 'Exact target',
      linkedNodeIds: [nodes[0].id],
    });
    const context = buildResearchContext(
      f.store,
      f.program,
      nodes.map((n) => n.id),
      goal.id,
    );
    assert.ok(context.text.length <= 100000);
    assert.equal(context.summary.truncated, true);
    assert.ok(context.summary.nodeIds.includes(nodes[0].id));
    assert.ok(context.summary.goalIds.includes(goal.id));
    assert.throws(() => buildResearchContext(f.store, f.program, ['absent']), /not found/);
    assert.throws(() => buildResearchContext(f.store, f.program, [], 'absent'), /not found/);
  } finally {
    f.close();
  }
});

test('concurrent sends in one session are rejected without duplicating saved user turns', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key' });
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => pending),
    );
    const session = chat.createSession();
    const first = chat.send(session.id, { content: 'First question' });
    await assert.rejects(
      chat.send(session.id, { content: 'Second question' }),
      /already in progress/,
    );
    assert.equal(chat.messages(session.id).length, 1);
    finish(response());
    await first;
    assert.equal(chat.messages(session.id).length, 2);
  } finally {
    f.close();
  }
});

test('chat proposals cannot overwrite a contribution already accepted by a human reviewer', async () => {
  const f = fixture();
  try {
    const node = f.store.createNode({ title: 'Reviewed reduction', type: 'Lemma' });
    f.program.saveAssessment(node.id, {
      classification: 'New reduction',
      before: 'Global obstruction',
      after: 'Finite local obligation',
      mechanism: 'Explicit map with verified inverse',
      check: 'All cases reviewed',
      verdict: 'Accepted',
      reviewer: 'Researcher',
    });
    const p = emptyProposal();
    p.assessments = [
      {
        nodeId: node.id,
        classification: 'Restatement',
        before: 'Unknown',
        after: 'Unknown',
        mechanism: 'Unreviewed objection',
        check: 'Review again',
      },
    ];
    f.connection.update({ apiKey: 'test-key' });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const result = await chat.send(chat.createSession().id, { content: 'Audit novelty' });
    assert.match(result.assistantMessage.error ?? '', /accepted human contribution/);
    assert.equal(f.program.state().assessments[0].verdict, 'Accepted');
    assert.equal(f.program.state().assessments[0].reviewer, 'Researcher');
  } finally {
    f.close();
  }
});

test('reply provenance retains the actual request model when connection settings change in flight', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'test-key', model: 'original-model' });
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => pending),
    );
    const turn = chat.send(chat.createSession().id, { content: 'Inspect this reduction' });
    f.connection.update({ model: 'new-model' });
    finish(response());
    assert.equal((await turn).assistantMessage.model, 'original-model');
  } finally {
    f.close();
  }
});

test('goal context preserves complete long targets and baselines during next-action updates', async () => {
  const f = fixture();
  try {
    const statement =
      'For every admissible input, '.repeat(160) + 'the final quantifier must be retained.';
    const baseline =
      'Known bound with its assumptions. '.repeat(170) + 'Critical exception at the boundary.';
    const goal = f.program.createGoal({
      title: 'Precise target',
      statement,
      baseline,
      successCriteria: 'A proof for every input',
      kind: 'Ultimate',
      nextAction: 'Inspect one case',
    });
    const context = buildResearchContext(f.store, f.program, [], goal.id);
    const supplied = JSON.parse(context.text).goals[0];
    assert.equal(supplied.statement, statement);
    assert.equal(supplied.baseline, baseline);
    assert.ok(statement.length > 4000);
    assert.ok(baseline.length > 4000);
    const p = emptyProposal();
    p.goals = [
      {
        tempId: 'goal:update',
        existingGoalId: goal.id,
        title: goal.title,
        statement,
        baseline,
        successCriteria: goal.successCriteria,
        kind: goal.kind,
        parentGoalId: null,
        linkedNodeIds: [],
        nextAction: 'Check the boundary exception first',
      },
    ];
    f.connection.update({ apiKey: 'test-key' });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const { assistantMessage } = await chat.send(chat.createSession().id, {
      content: 'Update the next investigation',
      goalId: goal.id,
    });
    assert.equal(assistantMessage.proposalStatus, 'pending');
    chat.apply(assistantMessage.id);
    const updated = f.program.getGoal(goal.id);
    assert.equal(updated.statement, statement);
    assert.equal(updated.baseline, baseline);
    assert.equal(updated.nextAction, 'Check the boundary exception first');
  } finally {
    f.close();
  }
});

test('large goal contexts drop optional goals instead of truncating the selected target', () => {
  const f = fixture();
  try {
    const fields = {
      title: 'Long target',
      statement: 's'.repeat(19000),
      baseline: 'b'.repeat(9900),
      successCriteria: 'c'.repeat(9900),
      nextAction: 'n'.repeat(9900),
    };
    const selected = f.program.createGoal({ ...fields, kind: 'Ultimate' });
    for (let i = 0; i < 3; i++)
      f.program.createGoal({
        ...fields,
        title: `Optional milestone ${i}`,
        parentGoalId: selected.id,
      });
    const context = buildResearchContext(f.store, f.program, [], selected.id);
    const supplied = JSON.parse(context.text);
    assert.ok(context.text.length <= 95000);
    assert.equal(context.summary.truncated, true);
    assert.equal(supplied.goals[0].id, selected.id);
    assert.equal(supplied.goals[0].statement, selected.statement);
    assert.equal(supplied.goals[0].baseline, selected.baseline);
    assert.ok(context.summary.goalIds.length < f.program.state().goals.length);
  } finally {
    f.close();
  }
});

test('existing goals omitted from current context cannot be updated by a chat proposal', async () => {
  const f = fixture();
  try {
    const selected = f.program.createGoal({
      title: 'Selected goal',
      statement: 'Target A',
      kind: 'Ultimate',
    });
    const omitted = f.program.createGoal({
      title: 'Unrelated goal',
      statement: 'Target B',
      kind: 'Ultimate',
    });
    const p = emptyProposal();
    p.goals = [
      {
        tempId: 'goal:unseen',
        existingGoalId: omitted.id,
        title: omitted.title,
        statement: 'Do not replace unseen source',
        baseline: '',
        successCriteria: '',
        kind: 'Ultimate',
        parentGoalId: null,
        linkedNodeIds: [],
        nextAction: 'New action',
      },
    ];
    f.connection.update({ apiKey: 'test-key' });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const { assistantMessage } = await chat.send(chat.createSession().id, {
      content: 'Update my target',
      goalId: selected.id,
    });
    assert.match(assistantMessage.error ?? '', /not included in the current research context/);
    assert.equal(assistantMessage.proposal, null);
    assert.equal(f.program.getGoal(omitted.id).statement, 'Target B');
  } finally {
    f.close();
  }
});

test('application rechecks saved context scope before replacing an existing goal', async () => {
  const f = fixture();
  try {
    const goal = f.program.createGoal({
      title: 'Selected goal',
      statement: 'Original quantified target',
      kind: 'Ultimate',
    });
    const p = emptyProposal();
    p.goals = [
      {
        tempId: 'goal:update',
        existingGoalId: goal.id,
        title: goal.title,
        statement: goal.statement,
        baseline: '',
        successCriteria: '',
        kind: 'Ultimate',
        parentGoalId: null,
        linkedNodeIds: [],
        nextAction: 'A new action',
      },
    ];
    f.connection.update({ apiKey: 'test-key' });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      provider(async () => response(p)),
    );
    const { assistantMessage } = await chat.send(chat.createSession().id, {
      content: 'Update the next step',
      goalId: goal.id,
    });
    const row = f.store.db
      .prepare('SELECT data FROM chat_messages WHERE id=?')
      .get(assistantMessage.id) as { data: string };
    const saved = JSON.parse(row.data);
    saved.context.goalIds = [];
    f.store.db
      .prepare('UPDATE chat_messages SET data=? WHERE id=?')
      .run(JSON.stringify(saved), assistantMessage.id);
    assert.throws(
      () => chat.apply(assistantMessage.id),
      /not included in the current research context/,
    );
    assert.equal(f.program.getGoal(goal.id).nextAction, '');
  } finally {
    f.close();
  }
});
