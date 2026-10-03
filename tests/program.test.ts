import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';
import { createProgramRouter } from '../server/program-routes';

const goalInput = {
  title: 'Improve the bound',
  statement: String.raw`Prove $f(n)\le n^{1/2}$.`,
  successCriteria: 'Give a proof for every positive integer n.',
  baseline: String.raw`Only $f(n)\le n$ is known.`,
};
const assessmentInput = {
  classification: 'New reduction',
  before: 'The original bound required resolving the full optimization problem.',
  after: 'The target follows from a stated local inequality.',
  mechanism: 'A telescoping decomposition proves the implication.',
  check: 'The reduction was checked line by line; the local inequality remains open.',
  verdict: 'Accepted',
  reviewer: 'Researcher',
};

test('program seeding adds measurable goals without modifying graph or mathematical statuses', () => {
  const store = new Store(':memory:');
  try {
    const previous = store.state();
    const program = new ProgramStore(store);
    assert.equal(program.state().goals.length, 4);
    assert.equal(program.state().assessments.length, 5);
    const ultimate = program.state().goals.find((g) => g.kind === 'Ultimate')!;
    assert.match(ultimate.statement, /unproved/);
    assert.match(ultimate.statement, /q\/4/);
    assert.match(ultimate.baseline, /q\/5/);
    assert.ok(program.state().goals.every((g) => g.successCriteria && g.nextAction));
    assert.ok(program.state().goals.every((g) => g.status !== 'Achieved'));
    assert.equal(
      program.state().assessments.find((a) => a.nodeId === 'interpolation')!.classification,
      'Routine consequence',
    );
    assert.equal(
      program.state().assessments.find((a) => a.nodeId === 'rank-hypothesis')!.verdict,
      'Needs work',
    );
    assert.deepEqual(store.state().nodes, previous.nodes);
    assert.deepEqual(store.state().edges, previous.edges);
    const events = store.state().events;
    assert.equal(events.length, previous.events.length + 9);
    new ProgramStore(store);
    assert.equal(program.state().goals.length, 4);
    assert.equal(store.state().events.length, events.length);
  } finally {
    store.close();
  }
});

test('empty/custom projects do not receive a demo agenda, including on later reinitialization', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    assert.deepEqual(program.state(), { goals: [], assessments: [] });
    store.createNode({ title: 'A custom claim', type: 'Claim' });
    new ProgramStore(store);
    assert.deepEqual(program.state(), { goals: [], assessments: [] });
  } finally {
    store.close();
  }
});

test('initialization skips a rewritten problem and never assesses an edited demo lemma', () => {
  const custom = new Store(':memory:');
  const edited = new Store(':memory:');
  try {
    custom.updateNode('main-conjecture', { content: 'My new independent question' }, 'New project');
    assert.equal(new ProgramStore(custom).state().goals.length, 0);
    edited.updateNode(
      'interpolation',
      { content: 'My own stronger intermediate result' },
      'Research edit',
    );
    const program = new ProgramStore(edited);
    assert.equal(program.state().goals.length, 4);
    assert.ok(!program.state().assessments.some((a) => a.nodeId === 'interpolation'));
    assert.equal(edited.getNode('interpolation').content, 'My own stronger intermediate result');
  } finally {
    custom.close();
    edited.close();
  }
});

test('goals persist, partial updates preserve the baseline, and all edits are audited', () => {
  const directory = mkdtempSync(join(tmpdir(), 'research-program-'));
  const path = join(directory, 'program.sqlite');
  let store = new Store(path, false);
  try {
    let program = new ProgramStore(store);
    const goal = program.createGoal(goalInput);
    const updated = program.updateGoal(goal.id, { title: 'Precise target', status: 'Blocked' });
    assert.equal(updated.baseline, goalInput.baseline);
    assert.equal(updated.statement, goalInput.statement);
    assert.equal(updated.successCriteria, goalInput.successCriteria);
    const events = store.state().events;
    assert.equal(events.length, 2);
    const changed = events.find((e) => e.eventType === 'goal_status_changed')!;
    assert.equal(JSON.parse(changed.previousValue!).title, goalInput.title);
    assert.equal(JSON.parse(changed.newValue!).title, 'Precise target');
    store.close();
    store = new Store(path, false);
    program = new ProgramStore(store);
    assert.deepEqual(program.getGoal(goal.id), updated);
    assert.equal(program.state().goals.length, 1);
    assert.equal(store.state().events.length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('goal references and hierarchy reject missing nodes, duplicate links, and cycles atomically', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const root = program.createGoal(goalInput);
    const child = program.createGoal({ ...goalInput, title: 'Subproblem', parentGoalId: root.id });
    const before = program.state();
    const events = store.state().events.length;
    assert.throws(() => program.updateGoal(root.id, { parentGoalId: child.id }), /cycle/);
    assert.throws(() => program.updateGoal(root.id, { parentGoalId: root.id }), /cycle/);
    assert.throws(() => program.createGoal({ ...goalInput, parentGoalId: 'missing' }), /not found/);
    assert.throws(
      () => program.createGoal({ ...goalInput, linkedNodeIds: ['missing'] }),
      /not found/,
    );
    assert.throws(() => program.updateGoal(child.id, { kind: 'Ultimate' }), /cannot have a parent/);
    assert.throws(() => program.updateGoal('missing', { title: 'Unknown' }), /not found/);
    const node = store.createNode({ title: 'A link', type: 'Lemma' });
    assert.throws(
      () => program.updateGoal(root.id, { linkedNodeIds: [node.id, node.id] }),
      /unique/,
    );
    assert.deepEqual(program.state(), before);
    assert.equal(store.state().events.length, events + 1);
  } finally {
    store.close();
  }
});

test('completion is an explicit judgment requiring criteria and reviewed acyclic proof evidence', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const proof = store.createNode({
      title: 'Target theorem',
      type: 'Theorem',
      epistemicStatus: 'Proved',
    });
    const hypothesis = store.createNode({ title: 'Unresolved hypothesis', type: 'Lemma' });
    const goal = program.createGoal({ ...goalInput, linkedNodeIds: [proof.id] });
    assert.throws(() => program.updateGoal(goal.id, { status: 'Achieved' }), /human-verified/);
    store.updateNode(proof.id, { humanVerified: true }, 'Reviewed');
    const dependency = store.createEdge({
      sourceNodeId: proof.id,
      targetNodeId: hypothesis.id,
      edgeType: 'depends_on',
    });
    assert.throws(() => program.updateGoal(goal.id, { status: 'Achieved' }), /human-verified/);
    store.updateNode(
      hypothesis.id,
      { humanVerified: true, epistemicStatus: 'Proved' },
      'Reviewed the hypothesis proof',
    );
    const cycle = store.createEdge({
      sourceNodeId: hypothesis.id,
      targetNodeId: proof.id,
      edgeType: 'depends_on',
    });
    assert.throws(() => program.updateGoal(goal.id, { status: 'Achieved' }), /human-verified/);
    store.deleteEdge(cycle.id);
    assert.throws(
      () => program.updateGoal(goal.id, { status: 'Achieved', successCriteria: ' ' }),
      /success criteria/,
    );
    assert.equal(program.getGoal(goal.id).status, 'Active');
    assert.equal(program.updateGoal(goal.id, { status: 'Achieved' }).status, 'Achieved');
    assert.equal(store.getNode(proof.id).epistemicStatus, 'Proved');
    assert.ok(dependency.id);
  } finally {
    store.close();
  }
});

test('contribution acceptance requires the concrete delta and a reviewer without promoting truth status', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const node = store.createNode({ title: 'Candidate reduction', type: 'Claim' });
    const first = program.saveAssessment(node.id, {
      classification: 'Restatement',
      verdict: 'Needs work',
    });
    assert.equal(first.verdict, 'Needs work');
    assert.throws(
      () => program.saveAssessment(node.id, { ...assessmentInput, check: '' }),
      /independent check/,
    );
    assert.throws(
      () => program.saveAssessment(node.id, { ...assessmentInput, reviewer: ' ' }),
      /reviewer/,
    );
    assert.throws(
      () => program.saveAssessment(node.id, { ...assessmentInput, classification: 'Unassessed' }),
      /classification/,
    );
    assert.throws(() => program.saveAssessment('missing', assessmentInput), /not found/);
    const accepted = program.saveAssessment(node.id, assessmentInput);
    assert.equal(accepted.verdict, 'Accepted');
    assert.equal(store.getNode(node.id).epistemicStatus, 'Unverified');
    assert.equal(store.getNode(node.id).humanVerified, false);
    assert.equal(program.state().assessments.length, 1);
    const event = store
      .state()
      .events.find((e) => e.eventType === 'contribution_assessed' && e.previousValue)!;
    assert.equal(JSON.parse(event.previousValue!).classification, 'Restatement');
    assert.equal(JSON.parse(event.newValue!).classification, 'New reduction');
    store.deleteNode(node.id, 'Delete test claim');
    assert.equal(program.state().assessments.length, 0);
    assert.ok(store.state().events.some((e) => e.eventType === 'contribution_assessed'));
  } finally {
    store.close();
  }
});

test('program writes roll back with their audit records, including inside an enclosing chat transaction', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const node = store.createNode({ title: 'Atomic claim', type: 'Claim' });
    const before = program.state();
    const events = store.state().events;
    assert.throws(
      () =>
        store.transaction(() => {
          const goal = program.createGoal(goalInput);
          program.updateGoal(goal.id, { title: 'Nested edit' });
          program.saveAssessment(node.id, { classification: 'Restatement' });
          throw new Error('Chat apply failed');
        }),
      /Chat apply failed/,
    );
    assert.deepEqual(program.state(), before);
    assert.deepEqual(store.state().events, events);
    const existing = program.createGoal(goalInput);
    store.db.exec(
      "CREATE TRIGGER reject_program_audit BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    assert.throws(() => program.createGoal(goalInput), /audit unavailable/);
    assert.throws(
      () => program.updateGoal(existing.id, { title: 'Must roll back' }),
      /audit unavailable/,
    );
    assert.throws(
      () => program.saveAssessment(node.id, { classification: 'Restatement' }),
      /audit unavailable/,
    );
    assert.equal(program.state().goals.length, 1);
    assert.equal(program.getGoal(existing.id).title, goalInput.title);
    assert.equal(program.state().assessments.length, 0);
  } finally {
    store.close();
  }
});

test('program router persists goal and contribution workflows through its HTTP contract', async () => {
  const store = new Store(':memory:', false);
  const program = new ProgramStore(store);
  const app = express();
  app.use(express.json());
  app.use('/api/program', createProgramRouter(program));
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(/not found/i.test(error.message) ? 404 : 400).json({ error: error.message });
    },
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/api/program${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.deepEqual(await (await request('')).json(), { goals: [], assessments: [] });
    const create = await request('/goals', 'POST', goalInput);
    assert.equal(create.status, 201);
    const goal = await create.json();
    const update = await request(`/goals/${goal.id}`, 'PATCH', { status: 'Blocked' });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).baseline, goalInput.baseline);
    assert.equal((await request('/goals/missing', 'PATCH', { title: 'No' })).status, 404);
    assert.equal(
      (await request('/goals', 'POST', { ...goalInput, linkedNodeIds: ['missing'] })).status,
      404,
    );
    const node = store.createNode({ title: 'Candidate', type: 'Claim' });
    assert.equal((await request(`/assessments/${node.id}`, 'PUT', assessmentInput)).status, 200);
    const state = await (await request('')).json();
    assert.equal(state.goals.length, 1);
    assert.equal(state.assessments.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test('accepted assessments become stale after node revisions without changing the saved verdict or audit', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const node = store.createNode({
      title: 'Reviewed reduction',
      type: 'Lemma',
      content: 'Original reduction',
    });
    const accepted = program.saveAssessment(node.id, assessmentInput);
    assert.equal(accepted.basisUpdatedAt, node.updatedAt);
    assert.ok(accepted.basisFingerprint);
    assert.equal(program.state().assessments[0].stale, false);
    const rawBefore = store.db
      .prepare('SELECT data FROM contribution_assessments WHERE node_id=?')
      .get(node.id);
    store.updateNode(node.id, { content: 'A substantively different reduction' }, 'Changed proof');
    // Simulate a same-millisecond revision: the content fingerprint must still invalidate it.
    const edited = { ...store.getNode(node.id), updatedAt: node.updatedAt };
    store.db.prepare('UPDATE nodes SET data=? WHERE id=?').run(JSON.stringify(edited), node.id);
    const eventsBeforeRead = store.state().events;
    const assessment = program.state().assessments[0];
    assert.equal(assessment.stale, true);
    assert.equal(assessment.verdict, 'Accepted');
    assert.deepEqual(
      store.db.prepare('SELECT data FROM contribution_assessments WHERE node_id=?').get(node.id),
      rawBefore,
    );
    assert.deepEqual(store.state().events, eventsBeforeRead);
    program.saveAssessment(node.id, {
      ...assessmentInput,
      check: 'Rechecked the changed reduction',
    });
    assert.equal(program.state().assessments[0].stale, false);
    assert.equal(program.state().assessments[0].verdict, 'Accepted');
  } finally {
    store.close();
  }
});

test('legacy assessments without a recorded node basis require review', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const node = store.createNode({ title: 'Legacy reduction', type: 'Lemma' });
    const assessment = program.saveAssessment(node.id, assessmentInput);
    delete assessment.basisUpdatedAt;
    delete assessment.basisFingerprint;
    store.db
      .prepare('UPDATE contribution_assessments SET data=? WHERE node_id=?')
      .run(JSON.stringify(assessment), node.id);
    assert.equal(program.state().assessments[0].stale, true);
    assert.equal(program.state().assessments[0].verdict, 'Accepted');
  } finally {
    store.close();
  }
});

test('achieved goals warn when proof evidence is invalidated or deleted while preserving the recorded judgment', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const proof = store.createNode({
      title: 'Reviewed target',
      type: 'Theorem',
      epistemicStatus: 'Proved',
      humanVerified: true,
    });
    const goal = program.createGoal({
      ...goalInput,
      status: 'Achieved',
      linkedNodeIds: [proof.id],
    });
    assert.deepEqual(program.state().goals[0].warnings, []);
    store.updateNode(proof.id, { content: 'A changed, unreviewed proof' }, 'New proof');
    const rawBefore = program.getGoal(goal.id);
    const eventsBefore = store.state().events;
    assert.equal(program.state().goals[0].status, 'Achieved');
    assert.ok(
      program
        .state()
        .goals[0].warnings?.some((warning) => warning.includes('Completion needs review')),
    );
    assert.deepEqual(program.getGoal(goal.id), rawBefore);
    assert.deepEqual(store.state().events, eventsBefore);
    store.updateNode(proof.id, { humanVerified: true }, 'Rechecked the revised proof');
    assert.deepEqual(program.state().goals[0].warnings, []);
    store.deleteNode(proof.id, 'Evidence retracted');
    const state = program.state();
    assert.equal(state.goals[0].status, 'Achieved');
    assert.equal(state.goals[0].warnings?.length, 2);
    assert.ok(state.goals[0].warnings?.some((warning) => warning.includes('missing')));
    assert.ok(
      state.goals[0].warnings?.some((warning) => warning.includes('Completion needs review')),
    );
  } finally {
    store.close();
  }
});
