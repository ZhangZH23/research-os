import type { EdgeInput, NodeInput } from '../shared/types';
export const project = {
  id: 'hidden-derivatives',
  title: 'Improving Lossless Expansion Using Hidden Derivatives',
  description:
    'An illustrative research program over finite fields. Track the gap between a promising construction and a complete argument. Speculative results and experiment records are demo data, not published findings.',
};
type SeedNode = Partial<NodeInput> &
  Pick<NodeInput, 'title' | 'type' | 'epistemicStatus'> & { id: string; age?: number };
// Frozen text baseline for the one-time, exact-match formatting migration.
export const legacySeedNodes: SeedNode[] = [
  {
    id: 'main-conjecture',
    title: 'Hidden derivatives give near-lossless expansion',
    type: 'Conjecture',
    epistemicStatus: 'Plausible',
    confidence: 0.56,
    summary: 'Can first-order jets preserve almost all neighbors of small polynomial sets?',
    content:
      'For polynomials f of degree at most d over F_q, connect f to (a, f(a), f′(a)) for each a ∈ F_q. Seek a range of set sizes k for which |N(S)| ≥ (1−ε)q|S|. The small-set union bound is understood; stronger expansion for larger sets remains conjectural. This is an illustrative research target, not a published result.',
    tags: ['expansion', 'main-result'],
    age: 6,
  },
  {
    id: 'interpolation',
    title: 'Two common jets force a repeated-root factor',
    type: 'Lemma',
    epistemicStatus: 'Proved',
    confidence: 1,
    humanVerified: true,
    summary: 'A shared value and derivative at a implies (x−a)² divides f−g.',
    content:
      'Let h=f−g. Divide h by (x−a)²: h=(x−a)²Q+b(x−a)+c. Evaluating h(a)=0 gives c=0; evaluating h′(a)=0 gives b=0. Therefore (x−a)² divides h. For t distinct sites, the pairwise coprime factors multiply, so 2t ≤ deg(h) for nonzero h. This algebraic argument works in every characteristic with the ordinary first derivative.',
    tags: ['interpolation', 'proof'],
    provenanceText:
      'Elementary proof included in full. Human verification is simulated for this demo.',
    age: 8,
  },
  {
    id: 'pairwise-bound',
    title: 'Cubic pairs share at most one neighbor',
    type: 'Claim',
    epistemicStatus: 'Proved',
    confidence: 1,
    humanVerified: true,
    summary: 'Distinct polynomials of degree ≤ 3 have at most one common first-order jet.',
    content:
      'If distinct cubics f,g share jets at two distinct sites a,b, then (x−a)²(x−b)² divides f−g by the repeated-root lemma. This contradicts deg(f−g)≤3. Thus |N(f)∩N(g)|≤1.',
    tags: ['proof', 'collision-bound'],
    age: 5,
  },
  {
    id: 'conditional-theorem',
    title: 'Expansion beyond the pairwise bound',
    type: 'Theorem',
    epistemicStatus: 'Conditional',
    confidence: 0.6,
    summary:
      'A stronger neighborhood bound follows if the proposed collision-rank hypothesis holds.',
    content:
      'Working conditional argument: use independence of collision constraints to control high-order overlaps, then sharpen inclusion–exclusion. The rank hypothesis and uniform treatment of degenerate site patterns remain unresolved. No unconditional expansion theorem is asserted here.',
    tags: ['main-result', 'conditional'],
    age: 3,
  },
  {
    id: 'rank-hypothesis',
    title: 'Hidden-derivative rank hypothesis',
    type: 'Claim',
    epistemicStatus: 'Unverified',
    confidence: 0.35,
    originType: 'AI agent',
    originName: 'Exploratory assistant',
    summary: 'Do collision constraints have the expected rank outside identifiable degeneracies?',
    content:
      'Proposed hypothesis: matrices built from jet equalities on a cycle have generic rank after removing repeated-site degeneracies. Quantifiers, the allowable collision graph, and field-characteristic restrictions still need a precise formulation. The three-site F5 check cannot establish this general statement.',
    tags: ['rank', 'bottleneck', 'AI'],
    age: 18,
  },
  {
    id: 'root-barrier',
    title: 'Can degenerate collision patterns be classified?',
    type: 'Open Question',
    epistemicStatus: 'Unverified',
    confidence: 0.2,
    summary: 'Repeated sites can make collision equations dependent.',
    content:
      'Classify rank defects when multiple pairwise collisions occur at the same evaluation site. Determine which defects can be isolated without losing the desired neighborhood bound. Next step: enumerate repeated-site patterns and inspect exact nullspaces.',
    tags: ['root-finding', 'bottleneck'],
    age: 16,
  },
  {
    id: 'numerical-experiment',
    title: 'Three-site collision matrix over F₅',
    type: 'Experiment',
    epistemicStatus: 'Numerically Supported',
    confidence: 0.7,
    originType: 'Numerical',
    originName: 'Illustrative exact-arithmetic notebook',
    summary: 'Demo record: all 60 ordered distinct-site triples produce rank 6.',
    content:
      'For cubic coefficient vectors f,g,h (12 variables), form the 6 rows J_a(f−g)=0, J_b(g−h)=0, J_c(h−f)=0 where J_a(p)=(p(a),p′(a)). Enumerate 5·4·3=60 ordered distinct-site triples in F5 and compute rank by modular Gaussian elimination. The demo record reports rank 6 for all triples. Reproduce with npm run demo:rank (scripts/rank-demo.ts). This is finite evidence only; the app does not automatically execute experiments.',
    tags: ['F5', 'rank', 'finite-check'],
    provenanceText:
      'Reproducible exact finite calculation: scripts/rank-demo.ts. Run npm run demo:rank. Finite evidence only; no general theorem is established.',
    age: 2,
  },
  {
    id: 'finite-evidence',
    title: 'Finite cases are consistent with generic rank',
    type: 'Evidence',
    epistemicStatus: 'Numerically Supported',
    confidence: 0.65,
    originType: 'Numerical',
    originName: 'Demo experiment summary',
    summary: 'The distinct-site F₅ cases do not reveal a rank defect.',
    content:
      'This evidence is limited to three distinct sites, three cubic polynomials, and F5. It does not address repeated sites, larger collision graphs, or general fields.',
    tags: ['finite-check'],
    age: 2,
  },
  {
    id: 'failed-approach',
    title: 'Failed approach I: ignore jet collisions',
    type: 'Approach',
    epistemicStatus: 'Abandoned',
    confidence: 0.1,
    summary: 'Counting each polynomial’s neighbors as disjoint overestimates expansion.',
    content:
      'Abandoned because f=0 and g=x² share a jet at a=0. Over F5 their two neighborhoods have a union of size 9, not 10. The disjoint-neighborhood shortcut is invalid. A stronger approach must count collisions explicitly and also handle common-site linear dependencies such as J_a(f−g)+J_a(g−h)=J_a(f−h).',
    tags: ['failed', 'rank'],
    provenanceText: 'Demo research retrospective. Abandonment reason retained in the activity log.',
    age: 4,
  },
  {
    id: 'strong-conjecture',
    title: 'Distinct cubics have disjoint jet neighborhoods',
    type: 'Conjecture',
    epistemicStatus: 'Disproved',
    confidence: 0,
    summary: 'The overly strong zero-collision conjecture fails already over F₅.',
    content:
      'Rejected assertion: distinct cubic polynomials have disjoint first-order jet neighborhoods. The pair f=0 and g=x² agrees in value and first derivative at a=0.',
    tags: ['failed', 'counterexample'],
    age: 4,
  },
  {
    id: 'counterexample',
    title: 'The pair 0 and x² shares a jet at zero',
    type: 'Counterexample',
    epistemicStatus: 'Proved',
    confidence: 1,
    humanVerified: true,
    summary: 'Over F₅, two neighborhoods of size 5 have a union of size 9.',
    content:
      'Take f(x)=0 and g(x)=x² over F5. At a=0 both values and both derivatives are zero. At every nonzero a, g(a)≠0, so the neighborhoods share exactly (0,0,0). Hence their union has size 5+5−1=9, refuting disjointness.',
    tags: ['F5', 'exact'],
    age: 4,
  },
  {
    id: 'active-approach',
    title: 'Separate generic and degenerate site patterns',
    type: 'Approach',
    epistemicStatus: 'Heuristic',
    confidence: 0.55,
    summary: 'Stratify collision graphs before applying a rank argument.',
    content:
      'Enumerate collision graphs, group by evaluation-site multiplicity, and derive rank bounds per stratum. Start with three polynomials and three sites. Use exact finite-field checks to search for obstructions, then formulate a symbolic statement.',
    tags: ['active', 'rank'],
    age: 1,
  },
  {
    id: 'next-experiment',
    title: 'Enumerate repeated-site rank defects',
    type: 'Experiment',
    epistemicStatus: 'Unverified',
    confidence: 0.3,
    summary: 'Next: include repeated sites in the F₅ collision-matrix sweep.',
    content:
      'Planned experiment. Enumerate all 125 ordered triples (a,b,c) ∈ F5³. Group rank and nullspace by equality pattern of sites. Compare the 60 distinct-site cases with repeated-site strata. Save executable code and exact outputs as evidence.',
    tags: ['next-step', 'rank'],
    age: 1,
  },
  {
    id: 'source',
    title: 'Project definitions: polynomial jet graph',
    type: 'Source / Paper',
    epistemicStatus: 'Unverified',
    confidence: 0.8,
    originType: 'Human',
    summary: 'Internal definitions and notation for the illustrative project.',
    content:
      'This internal source note is not a published paper. Left vertices: polynomials of degree ≤d over Fq. Right vertices: Fq³. Edge f→(a,f(a),f′(a)) for every a. Each left vertex has degree q. Neighborhood expansion asks how large the union of these q-element sets remains for small collections of polynomials.',
    tags: ['definitions', 'internal-source'],
    age: 20,
  },
  {
    id: 'draft-proof',
    title: 'Draft: generic-rank argument closes the gap',
    type: 'Theorem',
    epistemicStatus: 'Proved',
    confidence: 0.6,
    originType: 'AI agent',
    originName: 'Demo agent run',
    summary:
      'An intentionally overconfident proof label, retained to demonstrate dependency warnings.',
    content:
      'This demo draft incorrectly treats the hidden-derivative rank hypothesis as established. It is marked Proved to demonstrate that Research OS flags an unsafe proof label and unresolved transitive dependencies. It should be downgraded until the missing arguments are supplied.',
    tags: ['review-needed', 'AI'],
    age: 1,
  },
  {
    id: 'agent-run',
    title: 'Exploratory session: collision-rank argument',
    type: 'Agent Run',
    epistemicStatus: 'Unverified',
    originType: 'AI agent',
    originName: 'Demo agent',
    summary: 'Proposed a generic-rank reduction; review found missing assumptions.',
    content:
      'Illustrative session transcript: “The collision constraints appear independent for distinct sites. Perhaps this yields the improved expansion bound.” Human review: this does not cover degenerate patterns or prove the rank hypothesis.',
    tags: ['session', 'AI'],
    age: 3,
  },
  {
    id: 'research-note',
    title: 'Scope of the evidence',
    type: 'Note',
    epistemicStatus: 'Heuristic',
    summary: 'Keep finite verification, symbolic proof, and hypotheses separate.',
    content:
      'Finite sweeps guide conjecture formation. They cannot certify arbitrary field sizes or collision graphs. Record failed directions alongside successful arguments to avoid rediscovering the same obstruction.',
    tags: ['methodology'],
    age: 1,
  },
];
// Only presentation changes belong here: the underlying statements and proof statuses
// are shared with the legacy seed, so migration can preserve all research metadata.
export const mathSeedText: Record<
  string,
  Partial<Pick<NodeInput, 'title' | 'summary' | 'content' | 'provenanceText'>>
> = {
  'main-conjecture': {
    content: String.raw`For polynomials $f$ of degree at most $d$ over $\mathbb{F}_q$, connect $f$ to the first-order jet

$$
\bigl(a, f(a), f'(a)\bigr), \qquad a \in \mathbb{F}_q.
$$

Seek a range of set sizes $k$ for which

$$
|N(S)| \ge (1-\varepsilon)q|S|.
$$

The small-set union bound is understood; stronger expansion for larger sets remains conjectural. This is an illustrative research target, not a published result.`,
  },
  interpolation: {
    summary: String.raw`A shared value and derivative at $a$ implies $(x-a)^2 \mid f-g$.`,
    content: String.raw`**Proof.** Let $h=f-g$. Divide $h$ by $(x-a)^2$:

$$
h(x)=(x-a)^2Q(x)+b(x-a)+c.
$$

Evaluating $h(a)=0$ gives $c=0$; evaluating $h'(a)=0$ gives $b=0$. Therefore

$$
(x-a)^2 \mid h.
$$

For $t$ distinct sites, the pairwise coprime factors multiply, so

$$
2t \le \deg h \qquad \text{for } h \ne 0.
$$

This algebraic argument works in every characteristic with the ordinary first derivative.`,
  },
  'pairwise-bound': {
    summary: String.raw`Distinct polynomials of degree $\le 3$ have at most one common first-order jet.`,
    content: String.raw`**Proof.** If distinct cubics $f,g$ share jets at two distinct sites $a,b$, then the repeated-root lemma gives

$$
(x-a)^2(x-b)^2 \mid f-g.
$$

This contradicts $\deg(f-g)\le 3$. Thus

$$
|N(f) \cap N(g)| \le 1.
$$`,
  },
  'rank-hypothesis': {
    content: String.raw`**Proposed hypothesis.** Matrices built from jet equalities on a cycle have generic rank after removing repeated-site degeneracies.

Quantifiers, the allowable collision graph, and field-characteristic restrictions still need a precise formulation. The three-site $\mathbb{F}_5$ check cannot establish this general statement.`,
  },
  'numerical-experiment': {
    title: String.raw`Three-site collision matrix over $\mathbb{F}_5$`,
    summary: String.raw`Demo record: all $60$ ordered distinct-site triples produce rank $6$.`,
    content:
      String.raw`For cubic coefficient vectors $f,g,h$ ($12$ variables), form the $6$ rows

$$
\begin{aligned}
J_a(f-g)&=0, \\
J_b(g-h)&=0, \\
J_c(h-f)&=0,
\end{aligned}
\qquad J_a(p)=\bigl(p(a),p'(a)\bigr).
$$

Enumerate $5\cdot 4\cdot 3=60$ ordered distinct-site triples in $\mathbb{F}_5$ and compute rank by modular Gaussian elimination. The demo record reports rank $6$ for all triples.

Reproduce with ` +
      '`npm run demo:rank` (`scripts/rank-demo.ts`).' +
      String.raw`

This is finite evidence only; the app does not automatically execute experiments.`,
    provenanceText:
      'Reproducible exact finite calculation: `scripts/rank-demo.ts`. Run `npm run demo:rank`. Finite evidence only; no general theorem is established.',
  },
  'finite-evidence': {
    summary: String.raw`The distinct-site $\mathbb{F}_5$ cases do not reveal a rank defect.`,
    content: String.raw`This evidence is limited to three distinct sites, three cubic polynomials, and $\mathbb{F}_5$. It does not address repeated sites, larger collision graphs, or general fields.`,
  },
  'failed-approach': {
    content: String.raw`Abandoned because $f=0$ and $g=x^2$ share a jet at $a=0$. Over $\mathbb{F}_5$ their two neighborhoods have a union of size $9$, not $10$. The disjoint-neighborhood shortcut is invalid.

A stronger approach must count collisions explicitly and also handle common-site linear dependencies such as

$$
J_a(f-g)+J_a(g-h)=J_a(f-h).
$$`,
  },
  'strong-conjecture': {
    summary: String.raw`The overly strong zero-collision conjecture fails already over $\mathbb{F}_5$.`,
    content: String.raw`**Rejected assertion.** Distinct cubic polynomials have disjoint first-order jet neighborhoods.

The pair $f=0$ and $g=x^2$ agrees in value and first derivative at $a=0$.`,
  },
  counterexample: {
    title: String.raw`The pair $0$ and $x^2$ shares a jet at zero`,
    summary: String.raw`Over $\mathbb{F}_5$, two neighborhoods of size $5$ have a union of size $9$.`,
    content: String.raw`Take $f(x)=0$ and $g(x)=x^2$ over $\mathbb{F}_5$. At $a=0$ both values and both derivatives are zero.

At every nonzero $a$, $g(a)\ne 0$, so the neighborhoods share exactly $(0,0,0)$. Hence

$$
|N(f)\cup N(g)|=5+5-1=9,
$$

refuting disjointness.`,
  },
  'next-experiment': {
    summary: String.raw`Next: include repeated sites in the $\mathbb{F}_5$ collision-matrix sweep.`,
    content: String.raw`**Planned experiment.** Enumerate all $125$ ordered triples

$$
(a,b,c) \in \mathbb{F}_5^3.
$$

Group rank and nullspace by equality pattern of sites. Compare the $60$ distinct-site cases with repeated-site strata. Save executable code and exact outputs as evidence.`,
  },
  source: {
    content: String.raw`This internal source note is not a published paper.

- **Left vertices:** polynomials of degree $\le d$ over $\mathbb{F}_q$.
- **Right vertices:** $\mathbb{F}_q^3$.
- **Edges:** for every evaluation site $a\in\mathbb{F}_q$,

$$
f \longrightarrow \bigl(a,f(a),f'(a)\bigr).
$$

Each left vertex has degree $q$. Neighborhood expansion asks how large the union of these $q$-element sets remains for small collections of polynomials.`,
  },
};

export const seedNodes: SeedNode[] = legacySeedNodes.map((node) => ({
  ...node,
  ...mathSeedText[node.id],
}));

const e = (
  sourceNodeId: string,
  targetNodeId: string,
  edgeType: EdgeInput['edgeType'],
  explanation: string,
): EdgeInput => ({ sourceNodeId, targetNodeId, edgeType, explanation });
export const seedEdges = [
  e(
    'main-conjecture',
    'conditional-theorem',
    'depends_on',
    'The proposed route goes through the conditional rank argument.',
  ),
  e(
    'conditional-theorem',
    'rank-hypothesis',
    'depends_on',
    'Requires the unresolved rank statement.',
  ),
  e('conditional-theorem', 'pairwise-bound', 'depends_on', 'Uses the baseline collision bound.'),
  e('pairwise-bound', 'interpolation', 'depends_on', 'Shared jets force repeated roots.'),
  e('rank-hypothesis', 'root-barrier', 'depends_on', 'The degeneracy scope must be resolved.'),
  e('numerical-experiment', 'rank-hypothesis', 'supports', 'Only a finite distinct-site check.'),
  e(
    'rank-hypothesis',
    'numerical-experiment',
    'tested_by',
    'A restricted finite test of the general hypothesis.',
  ),
  e(
    'finite-evidence',
    'rank-hypothesis',
    'supports',
    'Finite observations motivate the conjectured rank.',
  ),
  e(
    'finite-evidence',
    'numerical-experiment',
    'derived_from',
    'Summary of the illustrative experiment.',
  ),
  e('counterexample', 'strong-conjecture', 'disproves', 'One shared jet refutes disjointness.'),
  e('counterexample', 'failed-approach', 'contradicts', 'Collisions cannot be ignored.'),
  e('active-approach', 'root-barrier', 'depends_on', 'Needs a classification of degenerate sites.'),
  e(
    'active-approach',
    'failed-approach',
    'supersedes',
    'Replaces disjoint-neighborhood counting with explicit collision constraints.',
  ),
  e('next-experiment', 'active-approach', 'motivated_by', 'Tests the proposed stratification.'),
  e('draft-proof', 'rank-hypothesis', 'depends_on', 'The draft assumes this unverified claim.'),
  e('draft-proof', 'agent-run', 'derived_from', 'AI origin retained.'),
  e('main-conjecture', 'source', 'derived_from', 'Uses the jet-graph definition.'),
  e(
    'research-note',
    'numerical-experiment',
    'related_to',
    'Explains limitations of finite evidence.',
  ),
];
