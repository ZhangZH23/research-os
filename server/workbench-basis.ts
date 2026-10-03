import { createHash } from 'node:crypto';
import type { Store } from './domain-store';
import type { ProgramStore } from './program-store';
import type { Candidate, ReviewBasis } from '../shared/workbench';
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Preserve mathematical case and grouping; this detects textual repetition, not equivalence.
export const claimKey = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');
export function reviewBasis(
  store: Store,
  program: ProgramStore,
  goalId: string | null,
  nodeIds: string[],
): ReviewBasis {
  const goal = goalId ? program.state().goals.find((g) => g.id === goalId) : undefined;
  const state = store.state();
  const scope = new Set(nodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of state.edges)
      if (
        edge.edgeType === 'depends_on' &&
        scope.has(edge.sourceNodeId) &&
        !scope.has(edge.targetNodeId)
      ) {
        scope.add(edge.targetNodeId);
        changed = true;
      }
  }
  nodeIds = [...scope];
  return {
    goalId,
    goalHash: goal
      ? digest({
          statement: goal.statement,
          baseline: goal.baseline,
          successCriteria: goal.successCriteria,
        })
      : '',
    nodes: [...new Set(nodeIds)]
      .sort()
      .map((id) => ({
        id,
        hash: digest({
          node: state.nodes.find((n) => n.id === id) ?? null,
          dependencies: state.edges.filter(
            (e) => e.sourceNodeId === id && e.edgeType === 'depends_on',
          ),
        }),
      })),
  };
}
export function basisChanged(basis: ReviewBasis, store: Store, program: ProgramStore) {
  return (
    digest(basis) !==
    digest(
      reviewBasis(
        store,
        program,
        basis.goalId,
        basis.nodes.map((n) => n.id),
      ),
    )
  );
}
export function integratedFingerprint(store: Store, nodeId: string) {
  const state = store.state();
  return digest({
    node: state.nodes.find((n) => n.id === nodeId) ?? null,
    dependencies: state.edges
      .filter((e) => e.sourceNodeId === nodeId && e.edgeType === 'depends_on')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
}
export function candidateStale(c: Candidate, store: Store, program: ProgramStore) {
  return (
    basisChanged(c.basis, store, program) ||
    !!(c.integratedNodeId && c.integratedHash !== integratedFingerprint(store, c.integratedNodeId))
  );
}
