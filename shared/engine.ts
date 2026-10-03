import { z } from 'zod';

/** Format 1 uses JavaScript UTF-16 code-unit offsets into the immutable original source. */
export const ENGINE_FORMAT_VERSION = 1 as const;
const id = z.string().min(1).max(200);
const text = z.string().max(100000);
export const sourceSpanSchema = z
  .object({
    sourceId: id,
    sourceHash: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    quote: text,
  })
  .strict();
export type SourceSpan = z.infer<typeof sourceSpanSchema>;
export const objectKinds = [
  'claim',
  'definition',
  'goal',
  'obligation',
  'failed_attempt',
  'barrier',
  'method',
  'note',
] as const;
export type ObjectKind = (typeof objectKinds)[number];
export type Expression =
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'sum' | 'product'; terms: Expression[] }
  | { kind: 'power'; base: Expression; exponent: Expression }
  | { kind: 'log'; argument: Expression; base?: number };
function expressionAtDepth(depth: number): z.ZodType<Expression> {
  if (depth >= 32) return z.never();
  return z.lazy(() => {
    const child = expressionAtDepth(depth + 1);
    return z.union([
      z.object({ kind: z.literal('constant'), value: z.number().finite() }).strict(),
      z.object({ kind: z.literal('variable'), name: id }).strict(),
      z.object({ kind: z.enum(['sum', 'product']), terms: z.array(child).min(1).max(30) }).strict(),
      z.object({ kind: z.literal('power'), base: child, exponent: child }).strict(),
      z
        .object({ kind: z.literal('log'), argument: child, base: z.number().positive().optional() })
        .strict(),
    ]);
  });
}
export const expressionSchema: z.ZodType<Expression> = expressionAtDepth(0);
const variableSchema = z
  .object({
    name: id,
    meaning: z.string().max(2000).optional(),
    domain: z.string().max(2000).optional(),
    dependsOn: z.array(id).max(50).optional(),
    definition: expressionSchema.optional(),
  })
  .strict();
export const contractSchema = z
  .object({
    variables: z.array(variableSchema).max(100).optional(),
    quantifiers: z
      .array(
        z
          .object({
            kind: z.enum(['forall', 'exists', 'almost_surely', 'with_probability']),
            variable: id,
            domain: z.string().max(2000).optional(),
            scope: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    inputDomain: z.string().max(4000).optional(),
    inputGuarantee: z
      .enum([
        'arbitrary',
        'random',
        'flat_sources',
        'linear_subspaces',
        'finite_enumeration',
        'unknown',
      ])
      .optional(),
    construction: z.enum(['existential', 'explicit', 'unknown']).optional(),
    assumptions: z.array(z.string().max(4000)).max(100).optional(),
    conclusion: z.string().max(12000).optional(),
    runtime: z
      .object({
        expression: expressionSchema.optional(),
        exponent: expressionSchema.optional(),
        exponentIndependentOf: z.array(id).max(50).optional(),
        arithmeticModel: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
    finiteDomain: z
      .object({
        description: z.string().min(1).max(4000),
        cardinality: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    fields: z
      .record(
        z.string().max(200),
        z
          .object({
            value: z.string().max(8000),
            state: z.enum(['extracted', 'confirmed', 'unknown']),
            sources: z.array(sourceSpanSchema).max(30).default([]),
          })
          .strict(),
      )
      .optional(),
    fieldStates: z
      .record(z.string().max(200), z.enum(['extracted', 'confirmed', 'unknown']))
      .optional(),
  })
  .strict();
export type ResearchContract = z.infer<typeof contractSchema>;
export interface EngineProject {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  archived: boolean;
  visibility: 'private' | 'public';
  headCommitId: string | null;
  legacyProjectId?: string;
}
export interface ResearchObject {
  id: string;
  projectId: string;
  kind: ObjectKind;
  title: string;
  currentRevisionId: string;
  archived: boolean;
  createdAt: string;
  legacyNodeId?: string;
  legacyNodeFingerprint?: string;
  legacyGoalId?: string;
}
export interface ResearchRevision {
  id: string;
  projectId: string;
  objectId: string;
  parentRevisionId: string | null;
  statement: string;
  contract: ResearchContract;
  sources: SourceSpan[];
  definitionRevisionIds: string[];
  actor: string;
  createdAt: string;
  hash: string;
  formatVersion: 1;
  legacyAssertion?: { status: string; humanVerified: boolean; attribution: string };
}
export interface SourceArtifact {
  id: string;
  projectId: string;
  kind:
    | 'human_note'
    | 'conversation'
    | 'model_response'
    | 'code'
    | 'external_run'
    | 'experiment'
    | 'legacy';
  text: string;
  hash: string;
  createdAt: string;
  attribution: string;
  originalTimestamp?: string;
  attributionTrust?: 'owner' | 'supplied' | 'model';
  parentSourceId?: string;
}
export const evidenceKinds = [
  'proof_attempt',
  'paper_passage',
  'counterexample_witness',
  'finite_experiment',
  'calculation',
  'formal_artifact',
  'human_argument',
] as const;
export interface EvidenceArtifact {
  id: string;
  projectId: string;
  targetRevisionId: string;
  kind: (typeof evidenceKinds)[number];
  content: string;
  sources: SourceSpan[];
  scope: string;
  createdAt: string;
  actor: string;
  limitations?: string;
  executionTrust?: 'imported' | 'server';
  input?: unknown;
}
export interface ProofRoute {
  id: string;
  projectId: string;
  conclusionRevisionId: string;
  premiseRevisionIds: string[];
  localAssumptions: string[];
  evidenceId?: string;
  sources: SourceSpan[];
  title: string;
  createdAt: string;
  actor: string;
  legacy?: boolean;
}
export interface ReviewRecord {
  id: string;
  projectId: string;
  targetId: string;
  targetRevisionIds: string[];
  decision: 'endorse' | 'challenge' | 'retract';
  reason: string;
  actor: string;
  createdAt: string;
  evidenceIds: string[];
  checkIds: string[];
  trust: 'human' | 'external' | 'model';
  scope: 'mathematical' | 'inference' | 'goal_satisfaction' | 'methodological' | 'admission';
  supersedes?: string;
  criterionMappings?: { criterion: string; resultRevisionId: string; explanation: string }[];
}
export type CheckOutcome = 'pass' | 'fail' | 'unknown' | 'not_applicable';
export interface CheckFinding {
  rule: string;
  version: string;
  outcome: CheckOutcome;
  severity: 'info' | 'warning' | 'error';
  explanation: string;
  scope: string;
  targetRevisionIds: string[];
  references: string[];
  limitations: string[];
}
export interface CheckRun {
  id: string;
  projectId: string;
  checkerId: string;
  checkerVersion: string;
  targetRevisionIds: string[];
  inputHashes: Record<string, string>;
  environment: string;
  scope: string;
  outcome: CheckOutcome;
  findings: CheckFinding[];
  output: unknown;
  limitations: string[];
  createdAt: string;
  trust: 'server' | 'external';
  changeSetId?: string;
  changeSetRevision?: number;
}
export interface Obligation {
  id: string;
  projectId: string;
  title: string;
  statement: string;
  targetRevisionId: string;
  premiseRevisionIds: string[];
  createdAt: string;
  resolutionRevisionId?: string;
  resolutionReviewId?: string;
  sources: SourceSpan[];
}
export interface ResearchRelationship {
  id: string;
  projectId: string;
  fromRevisionId: string;
  toRevisionId: string;
  kind: 'related_to' | 'motivated_by' | 'tested_by' | 'claimed_equivalent' | 'legacy_dependency';
  explanation: string;
  sources: SourceSpan[];
  createdAt: string;
}
export interface ContributionAssessment {
  id: string;
  projectId: string;
  targetRevisionId: string;
  projectNovelty: 'repetition' | 'additional_evidence' | 'possible_new_statement' | 'unknown';
  methodologicalValue: string;
  justification: string;
  unresolvedGaps: string;
  literatureComparison?: {
    query: string;
    searchedAt: string;
    sources: SourceSpan[];
    limitation: string;
  };
  createdAt: string;
  actor: string;
}
const spanList = z.array(sourceSpanSchema).max(100).default([]);
const revisionInput = {
  statement: z.string().min(1).max(100000),
  contract: contractSchema.default({}),
  sources: spanList,
  definitionRevisionIds: z.array(id).max(100).default([]),
};
export const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('add_claim'),
      tempId: id,
      kind: z.enum(objectKinds).default('claim'),
      title: z.string().min(1).max(250),
      ...revisionInput,
    })
    .strict(),
  z
    .object({
      type: z.literal('propose_claim_revision'),
      tempId: id,
      objectId: id,
      parentRevisionId: id,
      ...revisionInput,
    })
    .strict(),
  z
    .object({
      type: z.literal('add_evidence'),
      tempId: id,
      targetRevisionId: id,
      kind: z.enum(evidenceKinds),
      content: text,
      scope: z.string().min(1).max(10000),
      sources: spanList,
      limitations: z.string().max(10000).default(''),
    })
    .strict(),
  z
    .object({
      type: z.literal('add_argument_or_route'),
      tempId: id,
      title: z.string().min(1).max(250),
      conclusionRevisionId: id,
      premiseRevisionIds: z.array(id).max(100),
      localAssumptions: z.array(z.string().max(4000)).max(100).default([]),
      evidenceId: id.optional(),
      sources: spanList,
    })
    .strict(),
  z
    .object({
      type: z.literal('add_obligation'),
      tempId: id,
      title: z.string().min(1).max(250),
      statement: text,
      targetRevisionId: id,
      premiseRevisionIds: z.array(id).max(100).default([]),
      sources: spanList,
    })
    .strict(),
  z
    .object({
      type: z.literal('propose_obligation_resolution'),
      tempId: id,
      obligationId: id,
      resolutionRevisionId: id,
      reason: z.string().min(1).max(10000),
      sources: spanList,
    })
    .strict(),
  z
    .object({
      type: z.literal('record_failed_attempt'),
      tempId: id,
      kind: z.enum(['failed_attempt', 'barrier']).default('failed_attempt'),
      title: z.string().min(1).max(250),
      ...revisionInput,
      methodScope: z.string().min(1).max(10000),
      failureReason: z.string().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal('propose_counterexample_link'),
      tempId: id,
      targetRevisionId: id,
      evidenceId: id,
      premiseChecks: z
        .array(
          z.object({ premise: z.string(), satisfied: z.enum(['yes', 'no', 'unknown']) }).strict(),
        )
        .max(100),
      conclusionViolated: z.enum(['yes', 'no', 'unknown']),
      sources: spanList,
    })
    .strict(),
  z
    .object({
      type: z.literal('propose_relationship'),
      tempId: id,
      fromRevisionId: id,
      toRevisionId: id,
      kind: z.enum([
        'related_to',
        'motivated_by',
        'tested_by',
        'claimed_equivalent',
        'legacy_dependency',
      ]),
      explanation: z.string().max(10000),
      sources: spanList,
    })
    .strict(),
  z
    .object({
      type: z.literal('propose_contribution_assessment'),
      tempId: id,
      targetRevisionId: id,
      projectNovelty: z.enum([
        'repetition',
        'additional_evidence',
        'possible_new_statement',
        'unknown',
      ]),
      methodologicalValue: z.string().max(10000),
      justification: z.string().max(10000),
      unresolvedGaps: z.string().max(10000),
      sources: spanList,
    })
    .strict(),
  z
    .object({
      type: z.enum(['flag_possible_duplicate', 'flag_possible_conflict']),
      tempId: id,
      leftRevisionId: id,
      rightRevisionId: id,
      reason: z.string().min(1).max(10000),
      sources: spanList,
    })
    .strict(),
]);
export type ResearchOperation = z.infer<typeof operationSchema>;
export const readSetSchema = z
  .array(z.object({ objectId: id, revisionId: id, hash: id }).strict())
  .max(500);
export const changeSetInputSchema = z
  .object({
    title: z.string().min(1).max(250),
    baseCommitId: id.nullable(),
    readSet: readSetSchema.default([]),
    sources: spanList,
    operations: z.array(operationSchema).min(1).max(100),
    runId: id.optional(),
  })
  .strict();
export type ChangeSetInput = z.infer<typeof changeSetInputSchema>;
export interface ResearchChangeSet extends ChangeSetInput {
  id: string;
  projectId: string;
  revision: number;
  parentChangeSetId?: string;
  state: 'pending' | 'committed' | 'rejected' | 'superseded';
  actor: string;
  createdAt: string;
  checkIds: string[];
}
export interface ResearchDiffEntry {
  operationId: string;
  category:
    | 'statement'
    | 'revision'
    | 'evidence'
    | 'route'
    | 'obligation'
    | 'failed_attempt'
    | 'counterexample'
    | 'relationship'
    | 'methodology'
    | 'flag';
  description: string;
  objectId?: string;
  beforeRevisionId?: string;
  afterRevisionId?: string;
  targetIds: string[];
  sources: SourceSpan[];
}
export interface ResearchCommit {
  id: string;
  projectId: string;
  parentCommitId: string | null;
  changeSetId: string;
  changeSetRevision: number;
  actor: string;
  createdAt: string;
  acceptedOperationIds: string[];
  readSet: ChangeSetInput['readSet'];
  idempotencyKey: string;
  reviewIds: string[];
  checkIds: string[];
  diff: ResearchDiffEntry[];
  temporaryIds: Record<string, string>;
}
export interface PublicationSnapshot {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  actor: string;
  revisions: { id: string; objectId: string; kind: ObjectKind; title: string; statement: string }[];
  active: boolean;
  retractedAt?: string;
  retractionReason?: string;
}
export interface ContextManifest {
  projectId: string;
  selectedRevisionIds: string[];
  sourceIds: string[];
  omittedIds: string[];
  reasons: Record<string, string>;
  tokenEstimate: number;
  generatedAt: string;
  limitations: string[];
}
export interface ResearchRun {
  id: string;
  projectId: string;
  question: string;
  progressCriterion: string;
  state:
    | 'pending'
    | 'running'
    | 'awaiting_review'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'budget_exhausted';
  baseCommitId: string | null;
  readSet: ChangeSetInput['readSet'];
  contextManifest: ContextManifest | null;
  provider: string;
  model: string;
  sourceIds: string[];
  changeSetIds: string[];
  commitIds: string[];
  errors: string[];
  createdAt: string;
  updatedAt: string;
  executionTrust: 'local_request' | 'external_import';
  budget?: { tokens?: number; cost?: number; currency?: string };
  checkpointIds?: string[];
}
export interface EngineData {
  project: EngineProject;
  objects: ResearchObject[];
  revisions: ResearchRevision[];
  sources: SourceArtifact[];
  evidence: EvidenceArtifact[];
  routes: ProofRoute[];
  reviews: ReviewRecord[];
  checks: CheckRun[];
  obligations: Obligation[];
  relationships: ResearchRelationship[];
  assessments: ContributionAssessment[];
  changeSets: ResearchChangeSet[];
  commits: ResearchCommit[];
  publications: PublicationSnapshot[];
  runs: ResearchRun[];
}
export const emptyEngineData = (project: EngineProject): EngineData => ({
  project,
  objects: [],
  revisions: [],
  sources: [],
  evidence: [],
  routes: [],
  reviews: [],
  checks: [],
  obligations: [],
  relationships: [],
  assessments: [],
  changeSets: [],
  commits: [],
  publications: [],
  runs: [],
});
/** Stable object-key ordering; arrays retain mathematical binding and operand order. */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`)
    .join(',')}}`;
}
