import type { ProgramState } from './program';
import type { ResearchState } from './types';

/** Goal obligations plus the attacks that target them and their recorded predecessor routes. */
export function programNodeIds(
  goalId: string,
  program: Pick<ProgramState, 'goals'>,
  state: Pick<ResearchState, 'nodes' | 'edges'>,
) {
  const goalIds = new Set([goalId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const goal of program.goals) {
      if (goal.parentGoalId && goalIds.has(goal.parentGoalId) && !goalIds.has(goal.id)) {
        goalIds.add(goal.id);
        changed = true;
      }
    }
  }
  const ids = new Set(
    program.goals.filter((goal) => goalIds.has(goal.id)).flatMap((goal) => goal.linkedNodeIds),
  );
  const addDependencies = () => {
    let added = true;
    while (added) {
      added = false;
      for (const edge of state.edges) {
        if (
          edge.edgeType === 'depends_on' &&
          ids.has(edge.sourceNodeId) &&
          !ids.has(edge.targetNodeId)
        ) {
          ids.add(edge.targetNodeId);
          added = true;
        }
      }
    }
  };
  addDependencies();
  const core = new Set(ids);
  const approachIds = new Set(
    state.nodes.filter((node) => node.type === 'Approach').map((node) => node.id),
  );
  for (const edge of state.edges) {
    if (
      edge.edgeType === 'depends_on' &&
      approachIds.has(edge.sourceNodeId) &&
      core.has(edge.targetNodeId)
    )
      ids.add(edge.sourceNodeId);
  }
  // Preserve the competing/retired route history without flooding scope through related_to.
  changed = true;
  while (changed) {
    changed = false;
    for (const edge of state.edges) {
      if (
        edge.edgeType !== 'supersedes' ||
        !approachIds.has(edge.sourceNodeId) ||
        !approachIds.has(edge.targetNodeId)
      )
        continue;
      if (ids.has(edge.sourceNodeId) && !ids.has(edge.targetNodeId)) {
        ids.add(edge.targetNodeId);
        changed = true;
      }
      if (ids.has(edge.targetNodeId) && !ids.has(edge.sourceNodeId)) {
        ids.add(edge.sourceNodeId);
        changed = true;
      }
    }
  }
  addDependencies();
  return ids;
}
