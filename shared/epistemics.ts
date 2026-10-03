import { CLAIM_TYPES, type ResearchNode, type ResearchEdge } from './types';
const retired = new Set(['Disproved', 'Abandoned', 'Superseded']);

export function dependencyClosure(id: string, nodes: ResearchNode[], edges: ResearchEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const active = new Set<string>();
  let cycle = false;
  const visit = (current: string) => {
    if (active.has(current)) {
      cycle = true;
      return;
    }
    if (visited.has(current)) return;
    visited.add(current);
    active.add(current);
    edges
      .filter((e) => e.sourceNodeId === current && e.edgeType === 'depends_on')
      .forEach((e) => visit(e.targetNodeId));
    active.delete(current);
  };
  visit(id);
  visited.delete(id);
  return {
    nodes: [...visited].map((x) => byId.get(x)).filter((n): n is ResearchNode => !!n),
    cycle,
  };
}
export function belief(id: string, nodes: ResearchNode[], edges: ResearchEdge[]) {
  const node = nodes.find((n) => n.id === id)!;
  const incoming = edges.filter((e) => e.targetNodeId === id);
  const outgoing = edges.filter((e) => e.sourceNodeId === id);
  const resolve = (es: ResearchEdge[], direction: 'sourceNodeId' | 'targetNodeId') =>
    es.map((e) => nodes.find((n) => n.id === e[direction])).filter((n): n is ResearchNode => !!n);
  const dependencies = resolve(
    outgoing.filter((e) => e.edgeType === 'depends_on'),
    'targetNodeId',
  );
  const closure = dependencyClosure(id, nodes, edges);
  const unresolved = closure.nodes.filter(
    (n) => n.epistemicStatus !== 'Proved' || !n.humanVerified,
  );
  const support = resolve(
    incoming.filter((e) => ['supports', 'proves'].includes(e.edgeType)),
    'sourceNodeId',
  );
  const counterevidence = resolve(
    incoming.filter((e) => ['contradicts', 'disproves'].includes(e.edgeType)),
    'sourceNodeId',
  );
  const experiments = [
    ...resolve(
      outgoing.filter((e) => e.edgeType === 'tested_by'),
      'targetNodeId',
    ),
    ...support.filter((n) => n.type === 'Experiment'),
  ].filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i);
  const warnings: string[] = [];
  if (node.epistemicStatus === 'Proved' && unresolved.length)
    warnings.push(
      `Marked Proved, but depends on ${unresolved.length} unresolved or unreviewed ${unresolved.length === 1 ? 'claim' : 'claims'}. A status label is not a verified proof.`,
    );
  if (counterevidence.length)
    warnings.push(
      `This claim has ${counterevidence.length} contradictory evidence ${counterevidence.length === 1 ? 'item' : 'items'}. Review their scope and validity.`,
    );
  if (node.originType.startsWith('AI') && !node.humanVerified)
    warnings.push('This item originated from AI and has not been human-verified.');
  if (
    support.some(
      (n) => n.originType === 'Numerical' || n.epistemicStatus === 'Numerically Supported',
    )
  )
    warnings.push('Numerical support does not constitute a proof.');
  if (closure.cycle)
    warnings.push(
      'Circular dependency detected. This chain cannot establish an independent proof.',
    );
  if (node.epistemicStatus === 'Proved' && !node.humanVerified)
    warnings.push('This proof label has not been human-verified.');
  if (support.some((n) => retired.has(n.epistemicStatus)))
    warnings.push('Some supporting items are disproved, abandoned, or superseded.');
  return {
    node,
    incoming,
    outgoing,
    dependencies,
    unresolved,
    support,
    counterevidence,
    experiments,
    warnings,
    cycle: closure.cycle,
    allDependenciesVerified: unresolved.length === 0 && !closure.cycle,
  };
}
export function frontier(nodes: ResearchNode[], edges: ResearchEdge[], now = new Date()) {
  return nodes
    .filter(
      (n) =>
        !retired.has(n.epistemicStatus) &&
        [
          'Claim',
          'Conjecture',
          'Lemma',
          'Theorem',
          'Open Question',
          'Approach',
          'Experiment',
        ].includes(n.type),
    )
    .map((node) => {
      const analysis = belief(node.id, nodes, edges);
      let score = 0;
      const reasons: string[] = [];
      const downstream = nodes.filter(
        (n) =>
          n.id !== node.id &&
          !retired.has(n.epistemicStatus) &&
          dependencyClosure(n.id, nodes, edges).nodes.some((d) => d.id === node.id),
      ).length;
      const add = (points: number, reason: string) => {
        score += points;
        reasons.push(`${reason} (+${points})`);
      };
      const unresolved = node.epistemicStatus !== 'Proved' || !node.humanVerified;
      if (downstream && unresolved)
        add(
          Math.min(downstream * 15, 75),
          `${downstream} downstream ${downstream === 1 ? 'item depends' : 'items depend'} on this unresolved result`,
        );
      if (node.type === 'Open Question') add(30, 'Open research question');
      if (analysis.counterevidence.length) add(25, 'Contradictory evidence needs review');
      if (analysis.cycle) add(30, 'Circular argument needs repair');
      if (analysis.unresolved.length)
        add(
          Math.min(analysis.unresolved.length * 5, 20),
          `${analysis.unresolved.length} unresolved dependencies`,
        );
      if (node.epistemicStatus === 'Proved' && (analysis.unresolved.length || !node.humanVerified))
        add(25, 'Proof status needs an integrity review');
      if (node.type === 'Approach') add(12, 'Active approach');
      if (node.type === 'Experiment' && node.epistemicStatus === 'Unverified')
        add(15, 'Proposed experiment');
      if (
        CLAIM_TYPES.includes(node.type) &&
        unresolved &&
        (!analysis.support.length || node.confidence < 0.5)
      )
        add(10, 'Weak or missing support');
      const age = (now.getTime() - new Date(node.updatedAt).getTime()) / 86400000;
      if (unresolved && age >= 14) add(8, 'Not revisited in at least 14 days');
      if (unresolved && (now.getTime() - new Date(node.createdAt).getTime()) / 86400000 < 7)
        add(5, 'New unresolved item');
      return { node, score, reasons, downstream, stale: age >= 14, analysis };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
}
