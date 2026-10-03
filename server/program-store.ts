import { createHash, randomUUID } from 'node:crypto';
import {
  contributionInputSchema,
  goalInputSchema,
  type ContributionAssessment,
  type ContributionInput,
  type GoalInput,
  type ProgramState,
  type ResearchGoal,
} from '../shared/program';
import { dependencyClosure } from '../shared/epistemics';
import type { ResearchEdge, ResearchNode } from '../shared/types';
import { seedNodes } from './seed';
import type { Store } from './store';

let savepointSequence = 0;
const resultTypes = new Set(['Claim', 'Conjecture', 'Lemma', 'Theorem', 'Counterexample']);
const nodeFingerprint = (node: ResearchNode) =>
  createHash('sha256').update(JSON.stringify(node)).digest('hex');

function isReviewedResult(
  node: ResearchNode | undefined,
  nodes: ResearchNode[],
  edges: ResearchEdge[],
) {
  if (
    !node ||
    !resultTypes.has(node.type) ||
    node.epistemicStatus !== 'Proved' ||
    !node.humanVerified
  )
    return false;
  const dependencies = dependencyClosure(node.id, nodes, edges);
  return (
    !dependencies.cycle &&
    dependencies.nodes.every((n) => n.epistemicStatus === 'Proved' && n.humanVerified)
  );
}

/** Research objectives and contribution reviews are separate from mathematical truth status. */
export class ProgramStore {
  constructor(readonly store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS research_goals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contribution_assessments (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS program_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.atomic(() => {
      if (store.db.prepare("SELECT key FROM program_metadata WHERE key='initialized-v1'").get())
        return;
      this.seedIllustrativeProgram();
      store.db
        .prepare('INSERT INTO program_metadata(key,value) VALUES(?,?)')
        .run('initialized-v1', new Date().toISOString());
    });
  }

  /** SAVEPOINTs are atomic both standalone and inside a chat's outer Store transaction. */
  private atomic<T>(action: () => T): T {
    const name = `research_program_${++savepointSequence}`;
    this.store.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = action();
      this.store.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      this.store.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      this.store.db.exec(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }

  state(): ProgramState {
    const goals = this.store.db.prepare('SELECT data FROM research_goals ORDER BY rowid').all() as {
      data: string;
    }[];
    const assessments = this.store.db
      .prepare('SELECT data FROM contribution_assessments ORDER BY rowid')
      .all() as { data: string }[];
    const { nodes, edges } = this.store.state();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return {
      goals: goals.map((row) => {
        const goal = JSON.parse(row.data) as ResearchGoal;
        const warnings: string[] = [];
        const missingCount = goal.linkedNodeIds.filter((id) => !byId.has(id)).length;
        if (missingCount)
          warnings.push(
            `${missingCount} linked research ${missingCount === 1 ? 'item is' : 'items are'} missing. Review the goal's evidence links.`,
          );
        if (
          goal.status === 'Achieved' &&
          !goal.linkedNodeIds.some((id) => isReviewedResult(byId.get(id), nodes, edges))
        )
          warnings.push(
            'Completion needs review: no linked result currently has a human-verified proof with resolved, acyclic dependencies. The recorded Achieved judgment has been retained.',
          );
        return { ...goal, warnings };
      }),
      assessments: assessments.map((row) => {
        const assessment = JSON.parse(row.data) as ContributionAssessment;
        const node = byId.get(assessment.nodeId);
        const stale =
          !node ||
          !assessment.basisUpdatedAt ||
          !assessment.basisFingerprint ||
          assessment.basisUpdatedAt !== node.updatedAt ||
          assessment.basisFingerprint !== nodeFingerprint(node);
        return { ...assessment, stale };
      }),
    };
  }

  getGoal(id: string): ResearchGoal {
    const row = this.store.db.prepare('SELECT data FROM research_goals WHERE id=?').get(id) as
      { data: string } | undefined;
    if (!row) throw new Error('Research goal not found');
    return JSON.parse(row.data) as ResearchGoal;
  }

  private validateGoal(input: GoalInput, id: string) {
    if (new Set(input.linkedNodeIds).size !== input.linkedNodeIds.length)
      throw new Error('Goal node links must be unique');
    for (const nodeId of input.linkedNodeIds) this.store.getNode(nodeId);
    if (input.kind === 'Ultimate' && input.parentGoalId)
      throw new Error('An ultimate goal cannot have a parent; use a milestone for a subgoal');
    const ancestors = new Set([id]);
    let parentId = input.parentGoalId;
    while (parentId) {
      if (ancestors.has(parentId)) throw new Error('Goal hierarchy cannot contain a cycle');
      ancestors.add(parentId);
      parentId = this.getGoal(parentId).parentGoalId;
    }
    if (input.status === 'Achieved') {
      if (!input.successCriteria.trim())
        throw new Error('An achieved goal needs explicit success criteria');
      const { nodes, edges } = this.store.state();
      const hasReviewedResult = input.linkedNodeIds.some((nodeId) =>
        isReviewedResult(
          nodes.find((n) => n.id === nodeId),
          nodes,
          edges,
        ),
      );
      if (!hasReviewedResult)
        throw new Error(
          'Before marking a goal achieved, link a human-verified proved result with no unresolved or circular dependencies and check that it meets the success criteria',
        );
    }
  }

  createGoal(raw: unknown): ResearchGoal {
    return this.atomic(() => {
      const input = goalInputSchema.parse(raw);
      const id = randomUUID();
      this.validateGoal(input, id);
      const now = new Date().toISOString();
      const goal: ResearchGoal = { ...input, id, createdAt: now, updatedAt: now };
      this.store.db
        .prepare('INSERT INTO research_goals(id,project_id,data) VALUES(?,?,?)')
        .run(id, this.store.state().project.id, JSON.stringify(goal));
      this.store.event(null, goal.title, 'goal_created', null, goal, 'Research goal created');
      return goal;
    });
  }

  updateGoal(id: string, raw: unknown): ResearchGoal {
    return this.atomic(() => {
      const previous = this.getGoal(id);
      // Partial updates preserve the recorded baseline, criteria, and links unless supplied.
      const patch = goalInputSchema.partial().parse(raw);
      const input = goalInputSchema.parse({ ...previous, ...patch });
      this.validateGoal(input, id);
      const goal: ResearchGoal = { ...previous, ...input, updatedAt: new Date().toISOString() };
      this.store.db
        .prepare('UPDATE research_goals SET data=? WHERE id=?')
        .run(JSON.stringify(goal), id);
      this.store.event(
        null,
        goal.title,
        previous.status === goal.status ? 'goal_updated' : 'goal_status_changed',
        previous,
        goal,
        goal.status === 'Achieved' && previous.status !== 'Achieved'
          ? 'Researcher marked the goal achieved against its success criteria and linked reviewed evidence'
          : 'Research goal updated',
      );
      return goal;
    });
  }

  saveAssessment(nodeId: string, raw: unknown): ContributionAssessment {
    return this.atomic(() => {
      const node = this.store.getNode(nodeId);
      const input = contributionInputSchema.parse(raw);
      if (input.verdict === 'Accepted') {
        if (input.classification === 'Unassessed')
          throw new Error('Choose a contribution classification before accepting an assessment');
        if (
          ![input.before, input.after, input.mechanism, input.check, input.reviewer].every((x) =>
            x.trim(),
          )
        )
          throw new Error(
            'An accepted assessment requires a baseline, a concrete change, a mechanism, an independent check, and a reviewer',
          );
      }
      const row = this.store.db
        .prepare('SELECT data FROM contribution_assessments WHERE node_id=?')
        .get(nodeId) as { data: string } | undefined;
      const previous = row ? (JSON.parse(row.data) as ContributionAssessment) : null;
      const assessment: ContributionAssessment = {
        ...input,
        nodeId,
        updatedAt: new Date().toISOString(),
        basisUpdatedAt: node.updatedAt,
        basisFingerprint: nodeFingerprint(node),
      };
      this.store.db
        .prepare(
          'INSERT INTO contribution_assessments(node_id,data) VALUES(?,?) ON CONFLICT(node_id) DO UPDATE SET data=excluded.data',
        )
        .run(nodeId, JSON.stringify(assessment));
      this.store.event(
        nodeId,
        node.title,
        'contribution_assessed',
        previous,
        assessment,
        'Contribution assessment recorded; this does not change proof status or establish literature novelty',
      );
      return assessment;
    });
  }

  private seedIllustrativeProgram() {
    const nodes = this.store.rows<ResearchNode>('nodes');
    const byId = new Map(nodes.map((node) => [node.id, node]));
    // Never attach a demo research agenda to an empty/custom project or a rewritten problem.
    const matchesDemo = (id: string) => {
      const node = byId.get(id);
      const original = seedNodes.find((candidate) => candidate.id === id);
      return (
        !!node && !!original && node.title === original.title && node.content === original.content
      );
    };
    const required = [
      'main-conjecture',
      'source',
      'root-barrier',
      'rank-hypothesis',
      'active-approach',
      'next-experiment',
      'conditional-theorem',
      'draft-proof',
      'interpolation',
      'pairwise-bound',
    ];
    if (
      !matchesDemo('main-conjecture') ||
      !matchesDemo('source') ||
      required.some((id) => !byId.has(id))
    )
      return;
    const ultimate = this.createGoal({
      title: 'Beat the cubic pairwise expansion bound',
      kind: 'Ultimate',
      status: 'Active',
      statement: String.raw`**Illustrative, unproved target.** For the first-order jet graph on polynomials of degree at most $3$ over $\mathbb{F}_q$, prove or refute the following: there is $q_0$ such that, for every prime $q\ge q_0$ and every set $S$ with $|S|\le\lfloor q/4\rfloor$,

$$|N(S)|\ge\frac{9}{10}q|S|.$$

The proposed improvement is a research target, not an established theorem or a claim of literature novelty.`,
      baseline: String.raw`The repeated-root lemma gives $|N(f)\cap N(g)|\le1$ for distinct cubics. Thus $|N(S)|\ge q|S|-\binom{|S|}{2}$, which ensures $9/10$ expansion only for $|S|\le q/5+1$. Rephrasing this bound or a missing rank hypothesis does not improve it.`,
      successCriteria: String.raw`Supply either a complete proof with a stated $q_0$ and all quantifiers, or a checked family of counterexamples at arbitrarily large prime $q$. A finite sweep or a conditional theorem alone does not settle this asymptotic target. Explain explicitly how the range $\lfloor q/4\rfloor$ exceeds the pairwise baseline.`,
      parentGoalId: null,
      linkedNodeIds: ['main-conjecture', 'conditional-theorem', 'pairwise-bound'],
      nextAction:
        'Classify repeated-site collision cycles, then determine whether the resulting bounds improve the total collision budget.',
    });
    this.createGoal({
      title: 'Classify the first repeated-site rank defects',
      statement: String.raw`For three cubic polynomials, classify the rank and kernel of the $6\times12$ jet-collision matrix for every equality pattern of $(a,b,c)$; state the allowed characteristic.`,
      baseline: String.raw`The demo checks $60$ distinct-site triples over $\mathbb{F}_5$. Repeated-site patterns and symbolic field-uniform arguments are still missing.`,
      successCriteria:
        'Give an exhaustive pattern list with symbolic rank proofs or verified counterexamples, including all-equal, exactly-two-equal, and distinct sites. Save reproducible finite checks as supporting evidence only.',
      parentGoalId: ultimate.id,
      linkedNodeIds: ['root-barrier', 'next-experiment', 'active-approach'],
      nextAction:
        'Enumerate all 125 triples over F5 and inspect kernel bases by equality pattern; then derive the symbolic dependencies.',
    });
    this.createGoal({
      title: 'Make the rank-to-expansion step quantitative',
      statement:
        'State an explicit rank or overlap estimate and derive the exact expansion range it would imply, accounting for every degenerate stratum.',
      baseline:
        'The current rank hypothesis omits quantifiers and characteristic restrictions. The conditional theorem does not yet calculate a stronger set-size range.',
      successCriteria: String.raw`Write a complete conditional reduction with every hypothesis exposed; derive a numeric collision budget sufficient for $|S|\le\lfloor q/4\rfloor$. Show precisely which estimate improves on $\binom{|S|}{2}$ and which assumptions remain unproved.`,
      parentGoalId: ultimate.id,
      linkedNodeIds: ['rank-hypothesis', 'conditional-theorem', 'root-barrier'],
      nextAction:
        'Try the proposed rank statement on the smallest degenerate strata and calculate its actual effect on neighborhood size.',
    });
    this.createGoal({
      title: 'Close the proof or construct an asymptotic obstruction',
      statement:
        'Resolve the explicit target after separating the elementary baseline, a proved conditional reduction, and the remaining structural conjecture.',
      status: 'Blocked',
      baseline:
        'The draft proof assumes the unresolved rank hypothesis. Its Proved label is not a complete argument and carries no human verification.',
      successCriteria:
        'Link a human-checked complete proof with all dependencies discharged, or a human-checked counterexample family satisfying the ultimate goal’s quantifiers. Record the exact improvement or obstruction, not a restatement of the question.',
      parentGoalId: ultimate.id,
      linkedNodeIds: ['main-conjecture', 'draft-proof', 'rank-hypothesis'],
      nextAction:
        'Resolve the degenerate-stratum and quantitative-reduction milestones before attempting to close the proof.',
    });
    const assessments: [string, ContributionInput][] = [
      [
        'interpolation',
        {
          classification: 'Routine consequence',
          before: String.raw`The basic conditions are $h(a)=h'(a)=0$ for $h=f-g$.`,
          after: String.raw`Conclude $(x-a)^2\mid h$ and hence $2t\le\deg h$ for $t$ distinct common jets.`,
          mechanism:
            'Polynomial division by a squared linear factor; multiply coprime factors at distinct sites. This is an elementary baseline fact.',
          check:
            'The complete division argument is present in the node. It does not by itself improve the pairwise expansion range. Review the demo proof before relying on it.',
          verdict: 'Unreviewed',
          reviewer: 'Illustrative assessment; awaiting researcher review',
        },
      ],
      [
        'pairwise-bound',
        {
          classification: 'Routine consequence',
          before: String.raw`The repeated-root lemma gives $2t\le\deg(f-g)$.`,
          after: String.raw`For distinct cubics, $t\le1$, so the union bound gives $|N(S)|\ge q|S|-\binom{|S|}{2}$.`,
          mechanism:
            'Substitute degree at most three, then apply the elementary pairwise union bound. This establishes the baseline, not the desired improvement.',
          check: String.raw`Check the degree argument and compare the resulting range $|S|\le q/5+1$ with the target $\lfloor q/4\rfloor$.`,
          verdict: 'Unreviewed',
          reviewer: 'Illustrative assessment; awaiting researcher review',
        },
      ],
      [
        'rank-hypothesis',
        {
          classification: 'Restatement',
          before:
            'The desired expansion improvement needs uniform control of collision dependencies, including repeated sites.',
          after:
            'The current node asks whether the collision matrix has expected rank; no quantified theorem or rank lower bound is supplied.',
          mechanism:
            'No new mechanism is established yet. Calling the bottleneck a rank hypothesis organizes the problem but does not discharge it.',
          check:
            'Write the precise matrix family, field assumptions, rank lower bound, and a proved implication to the target. Until then, count this as an open obligation.',
          verdict: 'Needs work',
          reviewer: 'Illustrative assessment',
        },
      ],
      [
        'active-approach',
        {
          classification: 'Unassessed',
          before: 'Treating all collision equations as independent fails at repeated sites.',
          after:
            'The proposed approach splits collision graphs by site multiplicity; no complete classification or quantitative gain is proved yet.',
          mechanism:
            'Potential mechanism: isolate degenerate strata before counting overlaps. This is a proposed technique, not an established contribution.',
          check:
            'Test the all-equal and exactly-two-equal site strata and exhibit a bound that survives summation over all patterns.',
          verdict: 'Unreviewed',
          reviewer: 'Illustrative assessment; awaiting researcher review',
        },
      ],
      [
        'draft-proof',
        {
          classification: 'Restatement',
          before: 'The collision-rank hypothesis and degenerate-pattern control remain unresolved.',
          after:
            'The draft labels the conclusion proved while assuming the same unresolved hypothesis.',
          mechanism:
            'No missing argument has been discharged. The proof label is overconfident and the dependency audit still exposes the gap.',
          check:
            'Identify a new proved intermediate claim and show how it removes a precise dependency. The current draft cannot be used to mark the ultimate goal achieved.',
          verdict: 'Needs work',
          reviewer: 'Illustrative assessment',
        },
      ],
    ];
    for (const [nodeId, input] of assessments) {
      if (matchesDemo(nodeId)) this.saveAssessment(nodeId, input);
    }
  }
}
