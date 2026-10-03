import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';
import { programNodeIds } from '../shared/program-scope';

test('goal scope includes attacks aimed at obligations and the whole superseded approach chain', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const target = store.createNode({ title: 'Target', type: 'Theorem' });
    const obligation = store.createNode({ title: 'Key lemma', type: 'Lemma' });
    const active = store.createNode({ title: 'Current attack', type: 'Approach' });
    const old = store.createNode({
      title: 'Failed attack',
      type: 'Approach',
      epistemicStatus: 'Abandoned',
    });
    const oldest = store.createNode({
      title: 'Earlier attack',
      type: 'Approach',
      epistemicStatus: 'Superseded',
    });
    const extra = store.createNode({ title: 'Historical route premise', type: 'Lemma' });
    const makeEdge = (sourceNodeId: string, targetNodeId: string, edgeType = 'depends_on') =>
      store.createEdge({ sourceNodeId, targetNodeId, edgeType });
    makeEdge(target.id, obligation.id);
    makeEdge(active.id, obligation.id);
    makeEdge(active.id, old.id, 'supersedes');
    makeEdge(old.id, oldest.id, 'supersedes');
    makeEdge(oldest.id, extra.id);
    const goal = program.createGoal({
      title: 'Goal',
      statement: 'Prove the target',
      linkedNodeIds: [target.id],
    });
    const scope = programNodeIds(goal.id, program.state(), store.state());
    assert.deepEqual(
      [...scope].sort(),
      [target.id, obligation.id, active.id, old.id, oldest.id, extra.id].sort(),
    );
    // Starting from the retired route must also reveal its replacement, rather than suggesting the route is isolated.
    const historyGoal = program.createGoal({
      title: 'Retrospective',
      statement: 'Reassess the failed route',
      linkedNodeIds: [oldest.id],
    });
    const history = programNodeIds(historyGoal.id, program.state(), store.state());
    assert.ok(history.has(active.id));
    assert.ok(history.has(obligation.id));
  } finally {
    store.close();
  }
});

test('scope excludes unrelated routes and does not expand supersedes through non-Approach nodes', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const target = store.createNode({ title: 'Local target', type: 'Lemma' });
    const approach = store.createNode({ title: 'Relevant route', type: 'Approach' });
    const other = store.createNode({ title: 'Unrelated route', type: 'Approach' });
    const note = store.createNode({ title: 'Bridge note', type: 'Note' });
    const otherTarget = store.createNode({ title: 'Different goal', type: 'Lemma' });
    store.createEdge({
      sourceNodeId: approach.id,
      targetNodeId: target.id,
      edgeType: 'depends_on',
    });
    store.createEdge({
      sourceNodeId: other.id,
      targetNodeId: otherTarget.id,
      edgeType: 'depends_on',
    });
    store.createEdge({ sourceNodeId: other.id, targetNodeId: approach.id, edgeType: 'related_to' });
    store.createEdge({ sourceNodeId: approach.id, targetNodeId: note.id, edgeType: 'supersedes' });
    store.createEdge({ sourceNodeId: note.id, targetNodeId: other.id, edgeType: 'supersedes' });
    const goal = program.createGoal({
      title: 'Goal',
      statement: 'Resolve the local target',
      linkedNodeIds: [target.id],
    });
    const scope = programNodeIds(goal.id, program.state(), store.state());
    assert.deepEqual([...scope].sort(), [target.id, approach.id].sort());
  } finally {
    store.close();
  }
});

test('descendant milestones and cyclic graph history produce a finite stable scope', () => {
  const store = new Store(':memory:', false);
  try {
    const program = new ProgramStore(store);
    const a = store.createNode({ title: 'A', type: 'Approach' });
    const b = store.createNode({ title: 'B', type: 'Approach' });
    const lemma = store.createNode({ title: 'A cyclic obligation', type: 'Lemma' });
    const root = program.createGoal({
      title: 'Ultimate target',
      statement: 'Target',
      kind: 'Ultimate',
    });
    program.createGoal({
      title: 'Milestone',
      statement: 'First step',
      parentGoalId: root.id,
      linkedNodeIds: [a.id],
    });
    store.createEdge({ sourceNodeId: a.id, targetNodeId: b.id, edgeType: 'supersedes' });
    store.createEdge({ sourceNodeId: b.id, targetNodeId: a.id, edgeType: 'supersedes' });
    store.createEdge({ sourceNodeId: a.id, targetNodeId: lemma.id, edgeType: 'depends_on' });
    store.createEdge({ sourceNodeId: lemma.id, targetNodeId: a.id, edgeType: 'depends_on' });
    const state = store.state();
    const forward = [...programNodeIds(root.id, program.state(), state)].sort();
    const reversed = [
      ...programNodeIds(root.id, program.state(), { ...state, edges: [...state.edges].reverse() }),
    ].sort();
    assert.deepEqual(forward, [a.id, b.id, lemma.id].sort());
    assert.deepEqual(reversed, forward);
  } finally {
    store.close();
  }
});

test('every demo milestone exposes the active attack and its failed predecessor without unrelated notes', () => {
  const store = new Store(':memory:');
  try {
    const program = new ProgramStore(store).state();
    const state = store.state();
    for (const goal of program.goals) {
      const scope = programNodeIds(goal.id, program, state);
      assert.ok(scope.has('active-approach'), goal.title);
      assert.ok(scope.has('failed-approach'), goal.title);
      assert.ok(scope.has('root-barrier'), goal.title);
      assert.ok(!scope.has('research-note'), goal.title);
    }
  } finally {
    store.close();
  }
});
