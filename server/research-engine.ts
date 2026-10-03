import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './domain-store';
import { ProgramStore } from './program-store';
import type { ChatStore } from './chat';
import type { Candidate } from '../shared/workbench';
import {
  nodeInputSchema,
  edgeInputSchema,
  proposalSchema,
  type ResearchNode,
  type Project,
} from '../shared/types';
import { goalInputSchema, contributionInputSchema } from '../shared/program';
import { candidateDraftSchema } from '../shared/workbench';
import { project as legacyProject } from './seed';
import { publicResearch, publicProgram } from '../cloud/access';
import {
  changeSetInputSchema,
  contractSchema,
  sourceSpanSchema,
  stableSerialize,
  emptyEngineData,
  type EngineProject,
  type EngineData,
  type ResearchObject,
  type ResearchRevision,
  type SourceArtifact,
  type SourceSpan,
  type ResearchOperation,
  type ResearchChangeSet,
  type ResearchCommit,
  type ResearchDiffEntry,
  type ReviewRecord,
  type CheckRun,
  type PublicationSnapshot,
  type ContextManifest,
  type ResearchRun,
  type ProofRoute,
  type EvidenceArtifact,
} from '../shared/engine';
import {
  checkContractCompatibility,
  validateSourceSpan,
  normalizeExactStatement,
  checkPrimeFieldRank,
} from '../shared/engine-checks';
import { evaluateSupport, activeHumanReviews } from '../shared/engine-support';

export const engineHash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : stableSerialize(value))
    .digest('hex');
const now = () => new Date().toISOString();
const kinds = {
  objects: 'object',
  revisions: 'revision',
  sources: 'source',
  evidence: 'evidence',
  routes: 'route',
  reviews: 'review',
  checks: 'check',
  obligations: 'obligation',
  relationships: 'relationship',
  assessments: 'assessment',
  changeSets: 'proposal',
  commits: 'commit',
  publications: 'publication',
  runs: 'run',
} as const;
const id = z.string().min(1).max(200);
const reason = z.string().trim().min(10).max(12000);
export class EngineConflict extends Error {
  status = 409;
}
export class ResearchEngine {
  constructor(
    readonly store: Store,
    readonly program: ProgramStore,
    readonly actor = 'Workspace owner',
  ) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS engine_records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS engine_project_kind ON engine_records(project_id,kind);',
    );
  }
  get projectId() {
    return this.store.projectId;
  }
  private rows<T>(kind: string): T[] {
    return this.store.db
      .prepare('SELECT data FROM engine_records WHERE project_id=? AND kind=? ORDER BY rowid')
      .all(this.projectId, kind)
      .map((r) => JSON.parse(r.data));
  }
  private record<T>(kind: string, recordId: string): T {
    const r = this.store.db
      .prepare('SELECT data FROM engine_records WHERE id=? AND project_id=? AND kind=?')
      .get(recordId, this.projectId, kind);
    if (!r) throw new Error(`${kind} not found in this project`);
    return JSON.parse(r.data);
  }
  private put<T extends { id: string; projectId: string }>(
    kind: string,
    data: T,
    mutable = false,
  ): T {
    if (data.projectId !== this.projectId) throw new Error('Cross-project write rejected');
    const old = this.store.db
      .prepare('SELECT project_id,kind,data FROM engine_records WHERE id=?')
      .get(data.id);
    if (old) {
      if (old.project_id !== this.projectId || old.kind !== kind)
        throw new Error('Record identity belongs to another scope');
      if (!mutable && old.data !== JSON.stringify(data))
        throw new Error('Immutable research record cannot be rewritten');
    }
    this.store.db
      .prepare(
        'INSERT INTO engine_records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(data.id, this.projectId, kind, JSON.stringify(data));
    return data;
  }
  project(): EngineProject {
    const row = this.store.db.prepare('SELECT data FROM projects WHERE id=?').get(this.projectId);
    if (!row) throw new Error('Project not found');
    const p = JSON.parse(row.data);
    return {
      ...p,
      archived: !!p.archived,
      visibility: p.visibility ?? (p.id === legacyProject.id ? 'public' : 'private'),
      headCommitId: p.headCommitId ?? null,
    };
  }
  private setProject(p: EngineProject) {
    this.store.db
      .prepare('UPDATE projects SET data=? WHERE id=?')
      .run(JSON.stringify(p), this.projectId);
  }
  listProjects() {
    return this.store.db
      .prepare('SELECT data FROM projects ORDER BY rowid')
      .all()
      .map((r) => {
        const p = JSON.parse(r.data);
        return {
          ...p,
          archived: !!p.archived,
          visibility: p.visibility ?? (p.id === legacyProject.id ? 'public' : 'private'),
          headCommitId: p.headCommitId ?? null,
        };
      }) as EngineProject[];
  }
  createProject(raw: unknown) {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(10000).default(''),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const p: EngineProject = {
        ...input,
        id: randomUUID(),
        createdAt: now(),
        archived: false,
        visibility: 'private',
        headCommitId: null,
      };
      this.store.db.prepare('INSERT INTO projects VALUES(?,?)').run(p.id, JSON.stringify(p));
      this.store.db.prepare('INSERT INTO engine_records VALUES(?,?,?,?)').run(
        `migration:${p.id}`,
        p.id,
        'migration',
        JSON.stringify({
          id: `migration:${p.id}`,
          projectId: p.id,
          ready: true,
          version: 1,
          createdAt: now(),
        }),
      );
      return p;
    });
  }
  updateProject(raw: unknown) {
    const patch = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(10000).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const p = { ...this.project(), ...patch };
      this.setProject(p);
      this.put('project_event', {
        id: randomUUID(),
        projectId: this.projectId,
        actor: this.actor,
        at: now(),
        change: patch,
      });
      return p;
    });
  }
  data(): EngineData {
    const data = emptyEngineData(this.project());
    for (const [key, kind] of Object.entries(kinds)) (data as any)[key] = this.rows(kind);
    return data;
  }
  state() {
    const data = this.data();
    return {
      ...data,
      support: evaluateSupport(data),
      migration: this.migrationReport(),
      goalSatisfaction: this.goalSatisfaction(data),
      flags: this.rows('flag'),
      counterexampleClaims: this.rows('counterexample_claim'),
    };
  }
  private ready() {
    if (!this.migrationReport().ready)
      throw new EngineConflict(
        'Complete the explicit project migration before editing research. Download a backup first.',
      );
    if (this.project().archived) throw new Error('Restore this archived project before editing.');
  }
  private revision(revisionId: string) {
    return this.record<ResearchRevision>('revision', revisionId);
  }
  private object(objectId: string) {
    return this.record<ResearchObject>('object', objectId);
  }
  private spans(spans: SourceSpan[]) {
    for (const raw of spans) {
      const span = sourceSpanSchema.parse(raw);
      const source = this.record<SourceArtifact>('source', span.sourceId);
      if (validateSourceSpan(source, span, this.projectId).outcome !== 'pass')
        throw new Error('Source span does not match immutable UTF-16 source text');
    }
  }
  private contractSpans(contract: ResearchRevision['contract']) {
    const parsed = contractSchema.parse(contract);
    for (const field of Object.values(parsed.fields ?? {})) this.spans(field.sources);
  }
  source(raw: unknown) {
    this.ready();
    const input = z
      .object({
        kind: z.enum([
          'human_note',
          'conversation',
          'model_response',
          'code',
          'external_run',
          'experiment',
          'legacy',
        ]),
        text: z.string().min(1).max(400000),
        attribution: z.string().max(500).default('Researcher supplied material'),
        originalTimestamp: z.string().datetime().optional(),
        parentSourceId: id.optional(),
        title: z.string().max(250).optional(),
      })
      .strict()
      .parse(raw);
    if (input.parentSourceId) this.record('source', input.parentSourceId);
    const { title: _, ...fields } = input;
    return this.put<SourceArtifact>('source', {
      ...fields,
      id: randomUUID(),
      projectId: this.projectId,
      hash: engineHash(input.text),
      createdAt: now(),
      attributionTrust: input.kind === 'human_note' ? 'owner' : 'supplied',
    });
  }
  private wholeSource(source: SourceArtifact): SourceSpan {
    return {
      sourceId: source.id,
      sourceHash: source.hash,
      start: 0,
      end: source.text.length,
      quote: source.text,
    };
  }
  private sourceInternal(kind: SourceArtifact['kind'], text: string, attribution: string) {
    return this.put<SourceArtifact>('source', {
      id: randomUUID(),
      projectId: this.projectId,
      kind,
      text,
      hash: engineHash(text),
      attribution,
      attributionTrust: 'supplied',
      createdAt: now(),
    });
  }
  private newRevision(
    objectId: string,
    parentRevisionId: string | null,
    statement: string,
    contract: ResearchRevision['contract'],
    sources: SourceSpan[],
    definitionRevisionIds: string[],
    revisionId: string = randomUUID(),
    legacyAssertion?: ResearchRevision['legacyAssertion'],
  ) {
    this.spans(sources);
    this.contractSpans(contract);
    for (const definition of definitionRevisionIds) {
      const r = this.revision(definition);
      if (this.object(r.objectId).kind !== 'definition')
        throw new Error('Definition reference must identify a definition revision');
    }
    const fields = {
      objectId,
      parentRevisionId,
      statement,
      contract: contractSchema.parse(contract),
      sources,
      definitionRevisionIds,
    };
    return this.put<ResearchRevision>('revision', {
      ...fields,
      id: revisionId,
      projectId: this.projectId,
      actor: this.actor,
      createdAt: now(),
      formatVersion: 1,
      hash: engineHash(fields),
      ...(legacyAssertion ? { legacyAssertion } : {}),
    });
  }
  private currentRead(revisionId: string) {
    const r = this.revision(revisionId),
      o = this.object(r.objectId);
    if (o.currentRevisionId !== r.id || o.archived)
      throw new EngineConflict(
        'A referenced revision is historical or archived. Revise the proposal against the current statement.',
      );
    return { objectId: o.id, revisionId: r.id, hash: r.hash };
  }
  private validateReads(p: ResearchChangeSet) {
    if (p.baseCommitId !== this.project().headCommitId)
      throw new EngineConflict(
        'The project commit changed. Compare the changes and create a revised proposal for renewed review.',
      );
    for (const read of p.readSet) {
      const current = this.currentRead(read.revisionId);
      if (stableSerialize(current) !== stableSerialize(read))
        throw new EngineConflict('The proposal read set changed; renewed review is required.');
    }
  }
  propose(raw: unknown) {
    return this.store.transaction(() => {
      this.ready();
      const input = changeSetInputSchema.parse(raw);
      if (input.baseCommitId !== this.project().headCommitId)
        throw new EngineConflict('Refresh the project before proposing changes.');
      if (input.runId) this.record('run', input.runId);
      this.spans(input.sources);
      const temporary = new Set(input.operations.map((o) => o.tempId));
      if (temporary.size !== input.operations.length)
        throw new Error('Temporary operation IDs must be unique');
      const readSet = [...input.readSet];
      const addRead = (revisionId: string) => {
        if (temporary.has(revisionId.replace(/^\$/, ''))) return;
        const read = this.currentRead(revisionId);
        if (!readSet.some((r) => r.objectId === read.objectId)) readSet.push(read);
      };
      for (const op of input.operations) {
        this.spans(op.sources);
        if ('contract' in op) this.contractSpans(op.contract);
        if (
          ['add_claim', 'propose_claim_revision', 'add_evidence', 'record_failed_attempt'].includes(
            op.type,
          ) &&
          !op.sources.length
        )
          throw new Error(
            'Capture an immutable source passage before proposing this research change',
          );
        for (const [key, value] of Object.entries(op)) {
          if (key.endsWith('RevisionId') && typeof value === 'string') addRead(value);
          if (key.endsWith('RevisionIds') && Array.isArray(value))
            for (const rid of value) addRead(rid);
        }
        if (
          op.type === 'propose_claim_revision' &&
          this.object(op.objectId).currentRevisionId !== op.parentRevisionId
        )
          throw new EngineConflict('Revision parent is no longer current');
        if (op.type === 'propose_obligation_resolution') this.record('obligation', op.obligationId);
        if ('evidenceId' in op && op.evidenceId && !temporary.has(op.evidenceId.replace(/^\$/, '')))
          this.record('evidence', op.evidenceId);
      }
      const p: ResearchChangeSet = {
        ...input,
        readSet,
        id: randomUUID(),
        projectId: this.projectId,
        revision: 1,
        state: 'pending',
        actor: this.actor,
        createdAt: now(),
        checkIds: [],
      };
      this.validateReads(p);
      this.put('proposal', p);
      if (p.runId) {
        const run = this.record<ResearchRun>('run', p.runId);
        this.put(
          'run',
          { ...run, changeSetIds: [...new Set([...run.changeSetIds, p.id])], updatedAt: now() },
          true,
        );
      }
      return p;
    });
  }
  reviseProposal(proposalId: string, raw: unknown, expectedRevision?: number) {
    return this.store.transaction(() => {
      const old = this.record<ResearchChangeSet>('proposal', proposalId);
      if (expectedRevision !== undefined && old.revision !== expectedRevision)
        throw new EngineConflict('The proposal changed; reload before editing');
      if (old.state !== 'pending') throw new Error('Only pending proposals can be revised');
      const input = changeSetInputSchema.parse(raw);
      const next = this.propose({ ...input, runId: input.runId ?? old.runId });
      const revised = { ...next, parentChangeSetId: old.id, revision: old.revision + 1 };
      this.put('proposal', revised, true);
      this.put('proposal', { ...old, state: 'superseded' as const }, true);
      return revised;
    });
  }
  check(proposalId: string) {
    this.ready();
    const p = this.record<ResearchChangeSet>('proposal', proposalId);
    this.validateReads(p);
    const data = this.data();
    const findings: any[] = [];
    const targets: string[] = [];
    for (const op of p.operations) {
      this.spans(op.sources);
      if (
        op.type === 'add_claim' ||
        op.type === 'propose_claim_revision' ||
        op.type === 'record_failed_attempt'
      ) {
        const comparison =
          op.type === 'propose_claim_revision'
            ? this.revision(op.parentRevisionId)
            : data.revisions.find((r) =>
                data.objects.some((o) => o.kind === 'goal' && o.currentRevisionId === r.id),
              );
        if (comparison) {
          targets.push(comparison.id);
          findings.push(
            ...checkContractCompatibility(comparison.contract, op.contract).map((f) => ({
              ...f,
              targetRevisionIds: [comparison.id],
            })),
          );
        }
        const duplicate = data.revisions.find(
          (r) =>
            data.objects.some((o) => o.currentRevisionId === r.id) &&
            normalizeExactStatement(r.statement) === normalizeExactStatement(op.statement),
        );
        if (duplicate)
          findings.push({
            rule: 'exact-repetition',
            version: '1',
            outcome: 'fail',
            severity: 'warning',
            explanation:
              'The same text already exists. Attach new evidence or record methodological value; this is not an additional theorem.',
            scope: 'Exact text only; no semantic equivalence claim.',
            targetRevisionIds: [duplicate.id],
            references: [op.tempId],
            limitations: ['Mathematical equivalence is not decided.'],
          });
        if (!op.contract.assumptions || !op.contract.quantifiers)
          findings.push({
            rule: 'partial-contract',
            version: '1',
            outcome: 'unknown',
            severity: 'info',
            explanation:
              'The recorded contract is partial. Unknown assumptions or quantifiers remain unknown.',
            scope: 'Recorded contract fields only.',
            targetRevisionIds: [],
            references: [op.tempId],
            limitations: ['Provenance is not mathematical validity.'],
          });
      }
      if (op.type === 'propose_counterexample_link') {
        const applicable =
          op.premiseChecks.length > 0 &&
          op.premiseChecks.every((p) => p.satisfied === 'yes') &&
          op.conclusionViolated === 'yes';
        findings.push({
          rule: 'counterexample-applicability',
          version: '1',
          outcome: op.premiseChecks.some((p) => p.satisfied === 'no')
            ? 'fail'
            : applicable
              ? 'unknown'
              : 'unknown',
          severity: 'warning',
          explanation: applicable
            ? 'Premise and conclusion assertions require a scoped independent check; imported assertions are not a trusted counterexample.'
            : 'A witness with violated or unknown premises does not refute this claim.',
          scope: 'Declared witness applicability only.',
          targetRevisionIds: [op.targetRevisionId],
          references: [op.evidenceId],
          limitations: ['No theorem-specific witness checker was executed.'],
        });
      }
    }
    const result: CheckRun = {
      id: randomUUID(),
      projectId: this.projectId,
      checkerId: 'research-invariants',
      checkerVersion: '1',
      targetRevisionIds: [...new Set(targets)],
      inputHashes: Object.fromEntries(p.readSet.map((r) => [r.revisionId, r.hash])),
      environment: 'Deterministic TypeScript; no model call',
      scope: 'Source spans and declared contract consistency; not a proof checker',
      outcome: findings.some((f) => f.outcome === 'fail')
        ? 'fail'
        : findings.some((f) => f.outcome === 'unknown')
          ? 'unknown'
          : 'pass',
      findings,
      output: { operationCount: p.operations.length },
      limitations: [
        'Admission may retain an open or restricted result despite a warning. No theorem is certified.',
      ],
      createdAt: now(),
      trust: 'server',
      changeSetId: p.id,
      changeSetRevision: p.revision,
    };
    this.put('check', result);
    this.put('proposal', { ...p, checkIds: [...p.checkIds, result.id] }, true);
    return result;
  }
  reviewProposal(proposalId: string, raw: unknown) {
    const input = z
      .object({
        decision: z.enum(['approve', 'reject']),
        reason,
        revision: z.number().int().positive(),
      })
      .strict()
      .parse(raw);
    this.ready();
    const p = this.record<ResearchChangeSet>('proposal', proposalId);
    if (p.state !== 'pending' || p.revision !== input.revision)
      throw new EngineConflict('Proposal version changed');
    this.validateReads(p);
    if (!p.checkIds.length)
      throw new Error('Run the available checks before reviewing this proposal');
    const lastCheck = this.record<CheckRun>('check', p.checkIds.at(-1)!);
    if (
      lastCheck.trust !== 'server' ||
      lastCheck.changeSetId !== p.id ||
      lastCheck.changeSetRevision !== p.revision
    )
      throw new Error(
        'Execute fresh trusted server checks on this exact proposal version before review',
      );
    const review = this.put<ReviewRecord>('review', {
      id: randomUUID(),
      projectId: this.projectId,
      targetId: p.id,
      targetRevisionIds: p.readSet.map((r) => r.revisionId),
      decision: input.decision === 'approve' ? 'endorse' : 'challenge',
      reason: input.reason,
      actor: this.actor,
      createdAt: now(),
      evidenceIds: [],
      checkIds: [p.checkIds.at(-1)!],
      trust: 'human',
      scope: 'admission',
    });
    if (input.decision === 'reject')
      this.put('proposal', { ...p, state: 'rejected' as const }, true);
    return review;
  }
  commit(proposalId: string, raw: unknown) {
    const input = z
      .object({
        revision: z.number().int().positive(),
        idempotencyKey: z.string().min(8).max(200),
        operationIds: z.array(id).min(1).max(100).optional(),
      })
      .strict()
      .parse(raw);
    this.ready();
    const previous = this.rows<ResearchCommit>('commit').find(
      (c) => c.idempotencyKey === input.idempotencyKey,
    );
    if (previous) {
      if (
        previous.changeSetId !== proposalId ||
        previous.changeSetRevision !== input.revision ||
        (input.operationIds &&
          stableSerialize([...previous.acceptedOperationIds].sort()) !==
            stableSerialize([...input.operationIds].sort()))
      )
        throw new EngineConflict('Idempotency key belongs to a different reviewed action');
      return { ...previous, alreadyApplied: true };
    }
    return this.store.transaction(() => {
      const p = this.record<ResearchChangeSet>('proposal', proposalId);
      if (p.state !== 'pending' || p.revision !== input.revision)
        throw new EngineConflict('This proposal is no longer pending at the reviewed version');
      this.validateReads(p);
      const review = this.rows<ReviewRecord>('review')
        .filter((r) => r.targetId === p.id && r.scope === 'admission' && r.trust === 'human')
        .at(-1);
      if (review?.decision !== 'endorse') throw new Error('A human admission review is required');
      const lastCheck = this.record<CheckRun>('check', p.checkIds.at(-1) ?? '');
      if (
        lastCheck.trust !== 'server' ||
        lastCheck.changeSetId !== p.id ||
        lastCheck.changeSetRevision !== p.revision ||
        !review.checkIds.includes(lastCheck.id)
      )
        throw new EngineConflict('Checks changed after review; review the current checks again');
      const operations = input.operationIds
        ? p.operations.filter((o) => input.operationIds!.includes(o.tempId))
        : p.operations;
      if (input.operationIds && operations.length !== input.operationIds.length)
        throw new Error('Selected operation is absent');
      const temporaryIds: Record<string, string> = {};
      for (const op of operations) temporaryIds[op.tempId] = randomUUID();
      const allTemps = new Set(p.operations.map((o) => o.tempId));
      const resolve = (ref: string) => {
        const key = ref.replace(/^\$/, '');
        if (allTemps.has(key)) {
          if (!temporaryIds[key])
            throw new Error('A selected operation depends on an omitted operation');
          return temporaryIds[key];
        }
        return ref;
      };
      const diff: ResearchDiffEntry[] = [];
      const pending = [...operations];
      let limit = pending.length + 1;
      while (pending.length && limit--) {
        let progressed = false;
        for (const op of [...pending]) {
          const refs = Object.entries(op).flatMap(([k, v]) =>
            k.endsWith('RevisionId') || k === 'evidenceId'
              ? typeof v === 'string'
                ? [v]
                : []
              : k.endsWith('RevisionIds') && Array.isArray(v)
                ? v
                : [],
          );
          let wait = false;
          for (const ref of refs) {
            const key = String(ref).replace(/^\$/, '');
            if (allTemps.has(key)) {
              resolve(String(ref));
              if (pending.some((o) => o.tempId === key)) wait = true;
            }
          }
          if (wait) continue;
          this.applyOperation(op, temporaryIds[op.tempId], resolve, diff);
          pending.splice(pending.indexOf(op), 1);
          progressed = true;
        }
        if (!progressed)
          throw new Error(
            'Temporary reference cycle or unresolved dependency in selected operations',
          );
      }
      const commit: ResearchCommit = {
        id: randomUUID(),
        projectId: this.projectId,
        parentCommitId: this.project().headCommitId,
        changeSetId: p.id,
        changeSetRevision: p.revision,
        actor: this.actor,
        createdAt: now(),
        acceptedOperationIds: operations.map((o) => o.tempId),
        readSet: p.readSet,
        idempotencyKey: input.idempotencyKey,
        reviewIds: [review.id],
        checkIds: [lastCheck.id],
        diff,
        temporaryIds,
      };
      this.put('commit', commit);
      this.put('proposal', { ...p, state: 'committed' as const }, true);
      this.setProject({ ...this.project(), headCommitId: commit.id });
      if (p.runId) {
        const run = this.record<ResearchRun>('run', p.runId);
        this.put(
          'run',
          { ...run, commitIds: [...run.commitIds, commit.id], updatedAt: now() },
          true,
        );
      }
      return { ...commit, alreadyApplied: false };
    });
  }
  private applyOperation(
    op: ResearchOperation,
    resultId: string,
    resolve: (id: string) => string,
    diff: ResearchDiffEntry[],
  ) {
    this.spans(op.sources);
    const base = { id: resultId, projectId: this.projectId, createdAt: now(), actor: this.actor };
    const add = (
      category: ResearchDiffEntry['category'],
      description: string,
      targetIds: string[],
      extra: Partial<ResearchDiffEntry> = {},
    ) =>
      diff.push({
        operationId: op.tempId,
        category,
        description,
        targetIds,
        sources: op.sources,
        ...extra,
      });
    if (op.type === 'add_claim' || op.type === 'record_failed_attempt') {
      const duplicate = this.data().revisions.find(
        (r) =>
          this.data().objects.some((o) => o.currentRevisionId === r.id) &&
          normalizeExactStatement(r.statement) === normalizeExactStatement(op.statement),
      );
      if (duplicate)
        throw new Error(
          'Exact statement already admitted. Attach evidence or a methodological assessment to its existing revision.',
        );
      const objectId = randomUUID();
      const contract =
        op.type === 'record_failed_attempt'
          ? {
              ...op.contract,
              fields: {
                ...op.contract.fields,
                methodScope: {
                  value: op.methodScope,
                  state: 'confirmed' as const,
                  sources: op.sources,
                },
                failureReason: {
                  value: op.failureReason,
                  state: 'confirmed' as const,
                  sources: op.sources,
                },
              },
            }
          : op.contract;
      const revision = this.newRevision(
        objectId,
        null,
        op.statement,
        contract,
        op.sources,
        op.definitionRevisionIds.map(resolve),
        resultId,
      );
      const object: ResearchObject = {
        id: objectId,
        projectId: this.projectId,
        kind: op.kind,
        title: op.title,
        currentRevisionId: revision.id,
        archived: false,
        createdAt: now(),
      };
      this.put('object', object);
      this.mirrorObject(object, revision);
      add(
        op.type === 'record_failed_attempt' ? 'failed_attempt' : 'statement',
        `Admitted ${op.kind}; mathematical validity remains open`,
        [revision.id],
        { objectId, afterRevisionId: revision.id },
      );
      return;
    }
    if (op.type === 'propose_claim_revision') {
      const object = this.object(op.objectId);
      if (object.currentRevisionId !== op.parentRevisionId)
        throw new EngineConflict('Claim changed before commit');
      const revision = this.newRevision(
        object.id,
        op.parentRevisionId,
        op.statement,
        op.contract,
        op.sources,
        op.definitionRevisionIds.map(resolve),
        resultId,
      );
      const updated = { ...object, currentRevisionId: revision.id };
      this.put('object', updated, true);
      this.mirrorObject(updated, revision);
      add(
        'revision',
        'New immutable statement revision; old reviews remain attached to the old statement',
        [revision.id],
        {
          objectId: object.id,
          beforeRevisionId: op.parentRevisionId,
          afterRevisionId: revision.id,
        },
      );
      return;
    }
    if (op.type === 'add_evidence') {
      const targetRevisionId = resolve(op.targetRevisionId);
      this.revision(targetRevisionId);
      this.put<EvidenceArtifact>('evidence', {
        ...base,
        targetRevisionId,
        kind: op.kind,
        content: op.content,
        scope: op.scope,
        sources: op.sources,
        limitations: op.limitations,
        executionTrust: 'imported',
      });
      add('evidence', 'Added evidence; no automatic proof endorsement', [
        targetRevisionId,
        resultId,
      ]);
      return;
    }
    if (op.type === 'add_argument_or_route') {
      const conclusionRevisionId = resolve(op.conclusionRevisionId);
      this.revision(conclusionRevisionId);
      const premises = op.premiseRevisionIds.map(resolve);
      for (const ref of premises) this.revision(ref);
      const evidenceId = op.evidenceId ? resolve(op.evidenceId) : undefined;
      if (evidenceId) this.record('evidence', evidenceId);
      this.put<ProofRoute>('route', {
        ...base,
        title: op.title,
        conclusionRevisionId,
        premiseRevisionIds: premises,
        localAssumptions: op.localAssumptions,
        sources: op.sources,
        evidenceId,
      });
      add('route', 'Proposed AND-premise route; inference requires separate human review', [
        resultId,
        conclusionRevisionId,
        ...premises,
      ]);
      return;
    }
    if (op.type === 'add_obligation') {
      const targetRevisionId = resolve(op.targetRevisionId),
        premiseRevisionIds = op.premiseRevisionIds.map(resolve);
      this.revision(targetRevisionId);
      premiseRevisionIds.forEach((r) => this.revision(r));
      this.put('obligation', {
        ...base,
        title: op.title,
        statement: op.statement,
        targetRevisionId,
        premiseRevisionIds,
        sources: op.sources,
      });
      add('obligation', 'Opened a proof obligation', [resultId, targetRevisionId]);
      return;
    }
    if (op.type === 'propose_obligation_resolution') {
      const obligation = this.record<any>('obligation', op.obligationId),
        resolutionRevisionId = resolve(op.resolutionRevisionId);
      const support = evaluateSupport(this.data()).revisions[resolutionRevisionId];
      if (!support?.supported)
        throw new Error(
          'Obligation resolution requires currently supported evidence and a separate scoped human review',
        );
      const activeResolutionReviews = activeHumanReviews(this.rows<ReviewRecord>('review')).filter(
        (r) => r.targetId === obligation.id && r.scope === 'goal_satisfaction',
      );
      if (
        activeResolutionReviews.some((r) => r.decision === 'challenge' || r.decision === 'retract')
      )
        throw new Error(
          'Obligation resolution is disputed or withdrawn; preserve the open obligation until the scoped disagreement is resolved.',
        );
      const mapping = activeResolutionReviews
        .filter(
          (r) =>
            r.targetId === obligation.id &&
            r.scope === 'goal_satisfaction' &&
            r.trust === 'human' &&
            r.decision === 'endorse' &&
            r.targetRevisionIds.includes(obligation.targetRevisionId) &&
            r.targetRevisionIds.includes(resolutionRevisionId),
        )
        .at(-1);
      if (!mapping) throw new Error('Review why this exact result resolves the obligation first');
      this.put(
        'obligation',
        { ...obligation, resolutionRevisionId, resolutionReviewId: mapping.id },
        true,
      );
      add('obligation', 'Recorded human-reviewed obligation resolution', [
        obligation.id,
        resolutionRevisionId,
      ]);
      return;
    }
    if (op.type === 'propose_relationship') {
      const fromRevisionId = resolve(op.fromRevisionId),
        toRevisionId = resolve(op.toRevisionId);
      this.revision(fromRevisionId);
      this.revision(toRevisionId);
      this.put('relationship', {
        ...base,
        fromRevisionId,
        toRevisionId,
        kind: op.kind,
        explanation: op.explanation,
        sources: op.sources,
      });
      add('relationship', 'Descriptive relationship; does not establish logical support', [
        fromRevisionId,
        toRevisionId,
      ]);
      return;
    }
    if (op.type === 'propose_contribution_assessment') {
      const targetRevisionId = resolve(op.targetRevisionId);
      this.revision(targetRevisionId);
      this.put('assessment', {
        ...base,
        targetRevisionId,
        projectNovelty: op.projectNovelty,
        methodologicalValue: op.methodologicalValue,
        justification: op.justification,
        unresolvedGaps: op.unresolvedGaps,
      });
      add('methodology', 'Recorded scoped methodological judgment, independent of proof status', [
        targetRevisionId,
      ]);
      return;
    }
    if (op.type === 'propose_counterexample_link') {
      const targetRevisionId = resolve(op.targetRevisionId),
        evidenceId = resolve(op.evidenceId);
      this.revision(targetRevisionId);
      this.record('evidence', evidenceId);
      this.put('counterexample_claim', {
        ...base,
        ...op,
        targetRevisionId,
        evidenceId,
        id: resultId,
        status: 'needs_review',
        trustedCheck: false,
      });
      add('counterexample', 'Retained attempted witness; no automatic refutation', [
        targetRevisionId,
        evidenceId,
      ]);
      return;
    }
    const leftRevisionId = resolve(op.leftRevisionId),
      rightRevisionId = resolve(op.rightRevisionId);
    this.revision(leftRevisionId);
    this.revision(rightRevisionId);
    this.put('flag', {
      ...base,
      type: op.type,
      leftRevisionId,
      rightRevisionId,
      reason: op.reason,
      sources: op.sources,
    });
    add('flag', 'Possible duplicate or conflict for review', [leftRevisionId, rightRevisionId]);
  }
  private mirrorObject(object: ResearchObject, revision: ResearchRevision) {
    if (object.kind === 'goal') {
      const previous = object.legacyGoalId
        ? this.program.state().goals.find((g) => g.id === object.legacyGoalId)
        : undefined;
      const input = {
        title: object.title,
        statement: revision.statement,
        successCriteria:
          revision.contract.fields?.successCriteria?.value ?? revision.contract.conclusion ?? '',
        baseline: '',
        kind: 'Ultimate',
        status: 'Active',
      };
      const goal = previous
        ? this.program.updateGoal(previous.id, input)
        : this.program.createGoal(input);
      this.put(
        'object',
        {
          ...object,
          legacyGoalId: goal.id,
          legacyNodeFingerprint: engineHash({
            statement: goal.statement,
            successCriteria: goal.successCriteria,
            baseline: goal.baseline,
          }),
        },
        true,
      );
      return;
    }
    const type =
      object.kind === 'definition'
        ? 'Note'
        : object.kind === 'obligation'
          ? 'Open Question'
          : object.kind === 'failed_attempt'
            ? 'Approach'
            : object.kind === 'barrier'
              ? 'Note'
              : object.kind === 'method'
                ? 'Approach'
                : object.kind === 'note'
                  ? 'Note'
                  : 'Claim';
    const input = {
      title: object.title,
      type,
      content: revision.statement,
      summary:
        'Revision-aware research record; inspect Research State for evidence and currentness.',
      epistemicStatus: 'Unverified',
      humanVerified: false,
      originType: revision.sources.some(
        (s) => this.record<SourceArtifact>('source', s.sourceId).kind === 'model_response',
      )
        ? 'AI agent'
        : 'Human',
      originName: 'Research State Engine',
      provenanceText: `Immutable revision ${revision.id}`,
      tags: ['research-engine'],
    };
    if (object.legacyNodeId)
      this.store.updateNode(object.legacyNodeId, input, 'New immutable research revision');
    else if (this.store.state().nodes.some((n) => n.id === object.id))
      this.store.updateNode(object.id, input, 'New immutable research revision');
    else this.store.createNode(input, 'Admitted privately; not a proof certificate', object.id);
    this.put(
      'object',
      {
        ...object,
        legacyNodeFingerprint: engineHash({ title: input.title, content: input.content }),
      },
      true,
    );
  }
  review(raw: unknown) {
    this.ready();
    const input = z
      .object({
        targetId: id,
        targetRevisionIds: z.array(id).max(100).default([]),
        decision: z.enum(['endorse', 'challenge', 'retract']),
        scope: z.enum([
          'mathematical',
          'inference',
          'goal_satisfaction',
          'methodological',
          'admission',
        ]),
        reason,
        evidenceIds: z.array(id).max(100).default([]),
        checkIds: z.array(id).max(100).default([]),
        supersedes: id.optional(),
        criterionMappings: z
          .array(
            z.object({ criterion: z.string(), resultRevisionId: id, explanation: reason }).strict(),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .parse(raw);
    const data = this.data();
    const target =
      data.revisions.find((r) => r.id === input.targetId) ??
      data.routes.find((r) => r.id === input.targetId) ??
      data.obligations.find((r) => r.id === input.targetId) ??
      data.evidence.find((r) => r.id === input.targetId) ??
      data.reviews.find((r) => r.id === input.targetId);
    if (!target) throw new Error('Review target does not exist in this project');
    if (!input.targetRevisionIds.length) {
      if ('objectId' in target) input.targetRevisionIds = [target.id];
      else if ('conclusionRevisionId' in target)
        input.targetRevisionIds = [target.conclusionRevisionId, ...target.premiseRevisionIds];
      else if ('targetRevisionId' in target) input.targetRevisionIds = [target.targetRevisionId];
    }
    input.targetRevisionIds.forEach((r) => this.revision(r));
    input.evidenceIds.forEach((r) => this.record('evidence', r));
    input.checkIds.forEach((r) => this.record('check', r));
    if (input.supersedes) {
      const prior = this.record<ReviewRecord>('review', input.supersedes);
      if (
        prior.actor !== this.actor ||
        prior.targetId !== input.targetId ||
        prior.scope !== input.scope ||
        prior.trust !== 'human'
      )
        throw new Error(
          'A review can supersede only the same reviewer’s judgment on the same target and scope',
        );
    }
    const requiredBindings =
      'objectId' in target
        ? [target.id]
        : 'conclusionRevisionId' in target
          ? [target.conclusionRevisionId, ...target.premiseRevisionIds]
          : 'targetRevisionId' in target
            ? [target.targetRevisionId]
            : target.targetRevisionIds;
    if (requiredBindings.some((r: string) => !input.targetRevisionIds.includes(r)))
      throw new Error('Review must bind all exact target and premise revisions');
    if (input.scope === 'inference' && !('conclusionRevisionId' in target))
      throw new Error('Inference review requires an exact proof route');
    if (['mathematical', 'inference'].includes(input.scope)) {
      const expected =
        'objectId' in target
          ? target.id
          : 'conclusionRevisionId' in target
            ? target.conclusionRevisionId
            : 'targetRevisionId' in target
              ? target.targetRevisionId
              : undefined;
      for (const eid of input.evidenceIds)
        if (this.record<EvidenceArtifact>('evidence', eid).targetRevisionId !== expected)
          throw new Error('Review evidence belongs to a different target revision');
    }
    if (
      input.decision === 'endorse' &&
      ['mathematical', 'inference'].includes(input.scope) &&
      !input.evidenceIds.length
    )
      throw new Error(
        'Cite the exact argument evidence for a mathematical or inference endorsement',
      );
    if (
      input.scope === 'mathematical' &&
      'objectId' in target &&
      this.object(target.objectId).kind === 'goal'
    )
      throw new Error('Goal achievement requires a separate goal-satisfaction mapping');
    if (input.scope === 'goal_satisfaction' && 'objectId' in target) {
      if (!('objectId' in target) || this.object(target.objectId).kind !== 'goal')
        throw new Error('Choose an exact goal revision');
      const mappings = input.criterionMappings ?? [];
      const criteria = ['statement', ...Object.keys(target.contract.fields ?? {})];
      if (
        input.decision === 'endorse' &&
        criteria.some((key) => !mappings.some((m) => m.criterion === key))
      )
        throw new Error(
          'Map every goal criterion, including the statement, to reviewed result revisions',
        );
      for (const m of mappings) {
        this.currentRead(m.resultRevisionId);
        if (!evaluateSupport(data).revisions[m.resultRevisionId]?.supported)
          throw new Error('Goal mapping requires currently supported results');
        if (
          checkContractCompatibility(
            target.contract,
            this.revision(m.resultRevisionId).contract,
          ).some((f) => f.outcome === 'fail')
        )
          throw new Error('The reported result does not establish the goal scope');
      }
    }
    const review: ReviewRecord = {
      ...input,
      id: randomUUID(),
      projectId: this.projectId,
      actor: this.actor,
      createdAt: now(),
      trust: 'human',
    };
    return this.store.transaction(() => {
      this.put('review', review);
      this.recordAction(
        'Human review recorded',
        review.id,
        [input.targetId, ...input.targetRevisionIds],
        input.reason,
      );
      return review;
    });
  }
  private recordAction(title: string, recordId: string, targetIds: string[], description: string) {
    const commit: ResearchCommit = {
      id: randomUUID(),
      projectId: this.projectId,
      parentCommitId: this.project().headCommitId,
      changeSetId: recordId,
      changeSetRevision: 1,
      actor: this.actor,
      createdAt: now(),
      acceptedOperationIds: [recordId],
      readSet: [],
      idempotencyKey: `record:${recordId}`,
      reviewIds: [],
      checkIds: [],
      diff: [
        {
          operationId: recordId,
          category: 'evidence',
          description: `${title}: ${description}`,
          targetIds,
          sources: [],
        },
      ],
      temporaryIds: {},
    };
    this.put('commit', commit);
    this.setProject({ ...this.project(), headCommitId: commit.id });
    return commit;
  }
  goalSatisfaction(data = this.data()) {
    const support = evaluateSupport(data);
    return data.objects
      .filter((o) => o.kind === 'goal' && !o.archived)
      .map((o) => {
        const reviews = activeHumanReviews(data.reviews).filter(
          (r) =>
            r.targetId === o.currentRevisionId &&
            r.scope === 'goal_satisfaction' &&
            r.trust === 'human',
        );
        const endorsed = reviews.filter(
          (r) =>
            r.decision === 'endorse' &&
            !reviews.some((v) => v.decision === 'retract') &&
            ((r as any).criterionMappings ?? []).every(
              (m: any) => support.revisions[m.resultRevisionId]?.supported,
            ),
        );
        return {
          objectId: o.id,
          revisionId: o.currentRevisionId,
          status: !support.revisions[o.currentRevisionId]?.current
            ? 'needs_review'
            : reviews.some((r) => r.decision === 'challenge')
              ? 'conflict'
              : endorsed.length
                ? 'human_reviewed_satisfaction'
                : 'open',
          reviewIds: reviews.map((r) => r.id),
          limitation: 'Attributed scope judgment, not a machine-checked implication.',
        };
      });
  }
  publicationPreview(raw: unknown) {
    const input = z
      .object({
        revisionIds: z.array(id).min(1).max(200),
        title: z.string().min(1).max(250).optional(),
      })
      .strict()
      .parse(raw);
    this.ready();
    const preview = {
      title: input.title ?? this.project().title,
      revisions: [...new Set(input.revisionIds)].map((rid) => {
        const r = this.revision(rid),
          o = this.object(r.objectId);
        return { id: r.id, objectId: o.id, kind: o.kind, title: o.title, statement: r.statement };
      }),
    };
    return { preview, previewHash: engineHash(preview) };
  }
  publish(raw: unknown) {
    const input = z
      .object({
        revisionIds: z.array(id).min(1).max(200),
        title: z.string().min(1).max(250).optional(),
        previewHash: id,
        confirm: z.literal(true),
      })
      .strict()
      .parse(raw);
    const { preview, previewHash } = this.publicationPreview({
      revisionIds: input.revisionIds,
      title: input.title,
    });
    if (previewHash !== input.previewHash)
      throw new EngineConflict('The publication preview changed. Review the exact snapshot again.');
    return this.store.transaction(() => {
      const p = this.put<PublicationSnapshot>('publication', {
        ...preview,
        id: randomUUID(),
        projectId: this.projectId,
        actor: this.actor,
        createdAt: now(),
        active: true,
      });
      this.setProject({ ...this.project(), visibility: 'public' });
      this.recordAction(
        'Publication snapshot',
        p.id,
        [],
        `${p.revisions.length} explicitly selected statements`,
      );
      return p;
    });
  }
  retractPublication(publicationId: string, raw: unknown) {
    const input = z.object({ reason }).strict().parse(raw);
    return this.store.transaction(() => {
      const p = this.record<PublicationSnapshot>('publication', publicationId);
      if (!p.active) return p;
      const next = { ...p, active: false, retractedAt: now(), retractionReason: input.reason };
      this.put('publication', next, true);
      this.put('publication_event', {
        id: randomUUID(),
        projectId: this.projectId,
        publicationId,
        actor: this.actor,
        at: now(),
        reason: input.reason,
      });
      this.recordAction('Publication retracted', randomUUID(), [], input.reason);
      return next;
    });
  }
  publicExport() {
    const snapshots = this.rows<PublicationSnapshot>('publication').filter((p) => p.active);
    if (!snapshots.length) throw new Error('Public project not found: no active publication');
    return {
      formatVersion: 1,
      project: { title: snapshots.at(-1)!.title },
      publications: snapshots.map((p) => ({
        id: engineHash(p.id).slice(0, 24),
        title: p.title,
        createdAt: p.createdAt,
        statements: p.revisions.map((r, index) => ({
          id: engineHash(`${p.id}:${index}`).slice(0, 24),
          kind: r.kind,
          title: r.title,
          statement: r.statement,
        })),
      })),
    };
  }
  diff(from?: string, to?: string, runId?: string) {
    let commits = this.rows<ResearchCommit>('commit');
    if (from && !commits.some((c) => c.id === from)) throw new Error('Start commit not found');
    if (to && !commits.some((c) => c.id === to)) throw new Error('End commit not found');
    if (runId) {
      const run = this.record<ResearchRun>('run', runId);
      commits = commits.filter((c) => run.commitIds.includes(c.id));
    }
    const start = from ? commits.findIndex((c) => c.id === from) + 1 : 0,
      end = to ? commits.findIndex((c) => c.id === to) + 1 : commits.length;
    if (end < start) throw new Error('Invalid commit range');
    return {
      commits: commits.slice(start, end),
      entries: commits
        .slice(start, end)
        .flatMap((c) => c.diff.map((entry) => ({ ...entry, commitId: c.id }))),
      support: evaluateSupport(this.data()),
      limitation:
        'Deterministic committed changes and current support; no model-generated progress score.',
    };
  }
  context(raw: unknown) {
    const input = z
      .object({
        query: z.string().max(12000).default(''),
        goalRevisionId: id.optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict()
      .parse(raw);
    const data = this.data();
    if (input.goalRevisionId) this.revision(input.goalRevisionId);
    const terms = input.query
        .toLowerCase()
        .split(/\W+/)
        .filter((s) => s.length > 2),
      support = evaluateSupport(data);
    const current = data.revisions.filter((r) =>
      data.objects.some((o) => !o.archived && o.currentRevisionId === r.id),
    );
    const ranked = current
      .map((r) => {
        const o = data.objects.find((o) => o.id === r.objectId)!;
        let score = terms.reduce(
          (n, t) => n + ((r.statement + ' ' + o.title).toLowerCase().includes(t) ? 1 : 0),
          0,
        );
        if (r.id === input.goalRevisionId) score += 100;
        if (o.kind === 'goal') score += 5;
        if (o.kind === 'obligation') score += 3;
        if (
          ['failed_attempt', 'barrier'].includes(o.kind) &&
          terms.some((t) => (r.statement + ' ' + o.title).toLowerCase().includes(t))
        )
          score += 20;
        if (support.revisions[r.id]?.status === 'conflict') score += 10;
        return { r, o, score };
      })
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
    const chosen = ranked.slice(0, input.limit),
      ids = new Set(chosen.map((c) => c.r.id));
    const relevantRoutes = data.routes.filter((r) => ids.has(r.conclusionRevisionId));
    for (const route of relevantRoutes)
      for (const rid of route.premiseRevisionIds) {
        const item = ranked.find((x) => x.r.id === rid);
        if (item && !ids.has(rid)) {
          chosen.push(item);
          ids.add(rid);
        }
      }
    // Preserve exact definition bindings, including historical revisions, in model context.
    for (const item of chosen)
      for (const rid of item.r.definitionRevisionIds) {
        if (ids.has(rid)) continue;
        const r = data.revisions.find((r) => r.id === rid),
          o = r && data.objects.find((o) => o.id === r.objectId);
        if (r && o) {
          chosen.push({ r, o, score: 0 });
          ids.add(rid);
        }
      }
    const packet = {
      project: data.project.title,
      research: chosen.map((i) => ({
        kind: i.o.kind,
        title: i.o.title,
        revision: i.r,
        support: support.revisions[i.r.id],
      })),
      routes: relevantRoutes.slice(0, 30).map((r) => ({ ...r, support: support.routes[r.id] })),
      evidence: data.evidence
        .filter((e) => ids.has(e.targetRevisionId))
        .slice(0, 20)
        .map((e) => ({
          id: e.id,
          targetRevisionId: e.targetRevisionId,
          kind: e.kind,
          scope: e.scope,
          limitations: e.limitations,
          sourceIds: e.sources.map((s) => s.sourceId),
          content: e.content.slice(0, 8000),
          excerpt: e.content.length > 8000,
          excerptNotice:
            e.content.length > 8000
              ? 'Argument excerpt only. Retrieve the full evidence before relying on omitted steps.'
              : undefined,
        })),
      recentCommits: data.commits.slice(-5).map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        actor: c.actor,
        entries: c.diff.slice(0, 25).map((d) => ({
          category: d.category,
          targetIds: d.targetIds.slice(0, 20),
          description: d.description.slice(0, 400),
          summary: true,
        })),
        omittedEntryCount: Math.max(0, c.diff.length - 25),
      })),
      openObligations: data.obligations
        .filter(
          (o) =>
            support.openObligationIds.includes(o.id) &&
            (ids.has(o.targetRevisionId) ||
              terms.some((t) => (o.statement + ' ' + o.title).toLowerCase().includes(t))),
        )
        .slice(0, 30),
      manifest: null as
        | (ContextManifest & {
            omittedRevisionCount: number;
            omittedRecordIds: string[];
            omittedRecordCount: number;
            omittedDefinitionRevisionIds: string[];
          })
        | null,
    };
    const updateManifest = () => {
      const selected = new Set(packet.research.map((i) => i.revision.id)),
        includedOther = new Set([
          ...packet.routes.map((r) => r.id),
          ...packet.evidence.map((e) => e.id),
          ...packet.openObligations.map((o) => o.id),
          ...packet.recentCommits.map((c) => c.id),
        ]);
      const omitted = current.filter((r) => !selected.has(r.id)),
        omittedRecords = [
          ...data.routes,
          ...data.evidence,
          ...data.obligations,
          ...data.commits,
        ].filter((r) => !includedOther.has(r.id));
      packet.manifest = {
        projectId: this.projectId,
        selectedRevisionIds: [...selected],
        sourceIds: [
          ...new Set(packet.research.flatMap((i) => i.revision.sources.map((s) => s.sourceId))),
        ],
        omittedIds: omitted.slice(0, 200).map((r) => r.id),
        omittedRevisionCount: omitted.length,
        omittedRecordIds: omittedRecords.slice(0, 200).map((r) => r.id),
        omittedRecordCount: omittedRecords.length,
        omittedDefinitionRevisionIds: [
          ...new Set(
            packet.research
              .flatMap((i) => i.revision.definitionRevisionIds)
              .filter((rid) => !selected.has(rid)),
          ),
        ],
        reasons: Object.fromEntries(
          packet.research.map((i) => [
            i.revision.id,
            i.revision.id === input.goalRevisionId
              ? 'selected target'
              : ['failed_attempt', 'barrier'].includes(i.kind)
                ? 'relevant recorded failure or barrier'
                : i.kind === 'definition'
                  ? 'exact referenced definition or relevant definition'
                  : 'query relevance, goal, obligation, or route premise',
          ]),
        ),
        tokenEstimate: 0,
        generatedAt: now(),
        limitations: [
          'Whole packet budget: 90,000 UTF-16 characters. Token count is an estimate.',
          'Included revision contracts and source spans are complete. Evidence excerpts and lightweight commit summaries are explicitly labeled.',
          'Omission IDs are listed up to 200 per category, with full omitted counts. Retrieval is lexical and dependency based, not semantic equivalence. No hidden chain of thought is stored.',
        ],
      };
    };
    updateManifest();
    while (JSON.stringify(packet).length > 89500) {
      if (packet.recentCommits.length) packet.recentCommits.shift();
      else if (packet.evidence.length) packet.evidence.pop();
      else if (packet.openObligations.length) packet.openObligations.pop();
      else if (packet.routes.length) packet.routes.pop();
      else {
        let index = packet.research.length - 1;
        while (index >= 0 && packet.research[index].revision.id === input.goalRevisionId) index--;
        if (index < 0)
          throw new Error(
            'The complete selected goal cannot fit the research context budget. No assumptions or source spans were truncated.',
          );
        packet.research.splice(index, 1);
      }
      updateManifest();
    }
    const manifest = packet.manifest!;
    manifest.tokenEstimate = Math.ceil(JSON.stringify(packet).length / 4);
    return { manifest, text: JSON.stringify(packet) };
  }
  importRun(raw: unknown) {
    this.ready();
    const input = z
      .object({
        formatVersion: z.literal(1),
        externalId: id,
        question: z.string().min(1).max(30000),
        progressCriterion: z.string().max(10000).default(''),
        provider: z.string().max(200).default('external'),
        model: z.string().max(200).default('unspecified'),
        checkpoints: z
          .array(
            z
              .object({
                id,
                text: z.string().min(1).max(100000),
                timestamp: z.string().datetime().optional(),
              })
              .strict(),
          )
          .max(50),
        state: z
          .enum(['awaiting_review', 'completed', 'failed', 'cancelled', 'budget_exhausted'])
          .default('awaiting_review'),
        budget: z
          .object({
            tokens: z.number().nonnegative().optional(),
            cost: z.number().nonnegative().optional(),
            currency: z.string().max(10).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const existing = this.rows<ResearchRun>('run').find(
        (r) => (r as any).externalId === input.externalId,
      );
      const run: ResearchRun = existing ?? {
        id: randomUUID(),
        projectId: this.projectId,
        question: input.question,
        progressCriterion: input.progressCriterion,
        state: 'awaiting_review',
        baseCommitId: this.project().headCommitId,
        readSet: [],
        contextManifest: this.context({ query: input.question }).manifest,
        provider: input.provider,
        model: input.model,
        sourceIds: [],
        changeSetIds: [],
        commitIds: [],
        errors: [],
        createdAt: now(),
        updatedAt: now(),
        executionTrust: 'external_import',
        checkpointIds: [],
        budget: input.budget,
      };
      for (const checkpoint of input.checkpoints) {
        if (run.checkpointIds?.includes(checkpoint.id)) {
          const index = run.checkpointIds.indexOf(checkpoint.id),
            previous = this.record<SourceArtifact>('source', run.sourceIds[index]);
          if (
            previous.text !== checkpoint.text ||
            previous.originalTimestamp !== checkpoint.timestamp
          )
            throw new EngineConflict(
              'Checkpoint ID was already imported with different text or timestamp; use a new checkpoint ID.',
            );
          continue;
        }
        const source = this.sourceInternal(
          'external_run',
          checkpoint.text,
          `${input.provider}; supplied checkpoint ${checkpoint.id}; execution unverified`,
        );
        if (checkpoint.timestamp)
          this.put('source', { ...source, originalTimestamp: checkpoint.timestamp }, true);
        run.sourceIds.push(source.id);
        run.checkpointIds!.push(checkpoint.id);
      }
      return this.put(
        'run',
        { ...run, externalId: input.externalId, state: input.state, updatedAt: now() },
        true,
      );
    });
  }
  rankCheck(raw: unknown) {
    this.ready();
    const input = z
      .object({
        modulus: z.number().int(),
        matrix: z.array(z.array(z.number().int())),
        targetRevisionId: id.optional(),
      })
      .strict()
      .parse(raw);
    if (input.targetRevisionId) this.revision(input.targetRevisionId);
    const output = checkPrimeFieldRank({ modulus: input.modulus, matrix: input.matrix });
    const result: CheckRun = {
      id: randomUUID(),
      projectId: this.projectId,
      checkerId: 'prime-field-rank',
      checkerVersion: '1',
      targetRevisionIds: input.targetRevisionId ? [input.targetRevisionId] : [],
      inputHashes: { matrix: engineHash(input) },
      environment: 'Exact bounded prime-field arithmetic in TypeScript',
      scope: 'Rank of this supplied finite matrix only',
      outcome: 'pass',
      findings: [],
      output: { request: input, ...output },
      limitations: ['This matrix rank is not a theorem-specific counterexample or proof.'],
      createdAt: now(),
      trust: 'server',
    };
    return this.put('check', result);
  }
  migrationReport() {
    const meta = this.rows<any>('migration')[0];
    const nodes = this.store.state().nodes,
      edges = this.store.state().edges,
      goals = this.program.state().goals,
      objects = this.rows<ResearchObject>('object'),
      relations = this.rows<any>('relationship');
    const pendingNodes = nodes.filter(
      (n) => !objects.some((o) => o.legacyNodeId === n.id || o.id === n.id),
    );
    const pendingGoals = goals.filter((g) => !objects.some((o) => o.legacyGoalId === g.id));
    const pendingEdges = edges.filter((e) => !relations.some((r) => r.legacyEdgeId === e.id));
    return {
      ready: !!meta?.ready,
      version: 1,
      total: nodes.length + goals.length + edges.length,
      remaining: pendingNodes.length + pendingGoals.length + pendingEdges.length,
      remainingNodes: pendingNodes.length,
      remainingGoals: pendingGoals.length,
      remainingRelationships: pendingEdges.length,
      policy:
        'Preserve legacy records and historical assertions. Existing public material is captured once in bounded records; later revisions and new projects remain private.',
      requiresBackup: !meta?.ready,
    };
  }
  migrate(raw: unknown) {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(raw);
    if (this.migrationReport().ready) return this.migrationReport();
    return this.store.transaction(() => {
      const meta = this.rows<any>('migration')[0];
      const wasPublic = this.projectId === legacyProject.id;
      if (!meta) {
        if (wasPublic)
          this.put('legacy_public_snapshot', {
            id: `legacy-public:${this.projectId}`,
            projectId: this.projectId,
            project: publicResearch(this.store.state()).project,
            createdAt: now(),
          });
        this.put('migration', {
          id: `migration:${this.projectId}`,
          projectId: this.projectId,
          version: 1,
          ready: false,
          createdAt: now(),
        });
      }
      let count = 0;
      const publicState = wasPublic ? publicResearch(this.store.state()) : undefined,
        publicGoals = wasPublic ? publicProgram(this.program.state()) : undefined;
      for (const node of this.store.state().nodes) {
        if (count >= 100) break;
        if (
          this.rows<ResearchObject>('object').some(
            (o) => o.legacyNodeId === node.id || o.id === node.id,
          )
        )
          continue;
        this.migrateNode(node);
        if (wasPublic)
          this.put('legacy_public_node', {
            id: `public-node:${node.id}`,
            projectId: this.projectId,
            value: publicState!.nodes.find((n) => n.id === node.id),
          });
        const assessment = publicGoals?.assessments.find((a) => a.nodeId === node.id);
        if (wasPublic && assessment)
          this.put('legacy_public_assessment', {
            id: `public-assessment:${node.id}`,
            projectId: this.projectId,
            value: assessment,
          });
        count++;
      }
      for (const goal of this.program.state().goals) {
        if (count >= 100) break;
        if (this.rows<ResearchObject>('object').some((o) => o.legacyGoalId === goal.id)) continue;
        const source = this.sourceInternal(
          'legacy',
          goal.statement,
          'Historical goal; original source and intermediate revisions unavailable',
        );
        const objectId = randomUUID(),
          revision = this.newRevision(
            objectId,
            null,
            goal.statement,
            {
              fields: {
                successCriteria: { value: goal.successCriteria, state: 'extracted', sources: [] },
              },
            },
            [this.wholeSource(source)],
            [],
          );
        this.put('object', {
          id: objectId,
          projectId: this.projectId,
          kind: 'goal',
          title: goal.title,
          currentRevisionId: revision.id,
          archived: false,
          createdAt: now(),
          legacyGoalId: goal.id,
          legacyNodeFingerprint: engineHash({
            statement: goal.statement,
            successCriteria: goal.successCriteria,
            baseline: goal.baseline,
          }),
        });
        if (wasPublic)
          this.put('legacy_public_goal', {
            id: `public-goal:${goal.id}`,
            projectId: this.projectId,
            value: publicGoals!.goals.find((g) => g.id === goal.id),
          });
        count++;
      }
      const objects = this.rows<ResearchObject>('object');
      for (const edge of this.store.state().edges) {
        if (count >= 100) break;
        if (this.rows<any>('relationship').some((r) => r.legacyEdgeId === edge.id)) continue;
        const a = objects.find((o) => o.legacyNodeId === edge.sourceNodeId),
          b = objects.find((o) => o.legacyNodeId === edge.targetNodeId);
        if (!a || !b) continue;
        this.put('relationship', {
          id: randomUUID(),
          projectId: this.projectId,
          fromRevisionId: a.currentRevisionId,
          toRevisionId: b.currentRevisionId,
          kind: edge.edgeType === 'depends_on' ? 'legacy_dependency' : 'related_to',
          explanation: `Legacy ${edge.edgeType}: ${edge.explanation}. Inference validity unestablished.`,
          sources: [],
          createdAt: now(),
          legacyEdgeId: edge.id,
        });
        if (wasPublic)
          this.put('legacy_public_edge', {
            id: `public-edge:${edge.id}`,
            projectId: this.projectId,
            value: publicState!.edges.find((e) => e.id === edge.id),
          });
        count++;
      }
      const report = this.migrationReport();
      if (report.remaining === 0) {
        if (wasPublic) {
          this.put<PublicationSnapshot>('publication', {
            id: `legacy-publication:${this.projectId}`,
            projectId: this.projectId,
            title: 'Previously public research snapshot',
            createdAt: now(),
            actor: 'Previously authorized publication',
            active: true,
            revisions: [],
          });
        }
        this.put(
          'migration',
          {
            id: `migration:${this.projectId}`,
            projectId: this.projectId,
            version: 1,
            ready: true,
            createdAt: now(),
          },
          true,
        );
        this.recordAction(
          'Legacy migration',
          randomUUID(),
          [],
          'Preserved legacy records and historical assertions; no proof artifacts invented',
        );
      }
      return this.migrationReport();
    });
  }
  private migrateNode(node: ResearchNode) {
    const source = this.sourceInternal(
      'legacy',
      node.content || node.summary || node.title,
      `Legacy node ${node.id}; original timestamp ${node.createdAt}; no missing history fabricated`,
    );
    const objectId = randomUUID();
    const kind =
      node.type === 'Open Question'
        ? 'obligation'
        : node.type === 'Approach' && node.epistemicStatus === 'Abandoned'
          ? 'failed_attempt'
          : ['Note', 'Source / Paper', 'Agent Run', 'Experiment', 'Evidence'].includes(node.type)
            ? 'note'
            : 'claim';
    const revision = this.newRevision(
      objectId,
      null,
      node.content || node.summary || node.title,
      {},
      [this.wholeSource(source)],
      [],
      randomUUID(),
      {
        status: node.epistemicStatus,
        humanVerified: node.humanVerified,
        attribution: node.originName,
      },
    );
    return this.put<ResearchObject>('object', {
      id: objectId,
      projectId: this.projectId,
      kind,
      title: node.title,
      currentRevisionId: revision.id,
      archived: false,
      createdAt: now(),
      legacyNodeId: node.id,
      legacyNodeFingerprint: engineHash({ title: node.title, content: node.content }),
    });
  }
  syncLegacy() {
    if (!this.migrationReport().ready) return;
    const nodes = this.store.state().nodes;
    for (const object of this.rows<ResearchObject>('object')) {
      if (object.kind === 'goal') {
        const goal = this.program.state().goals.find((g) => g.id === object.legacyGoalId);
        if (!goal && object.legacyGoalId && !object.archived) {
          this.put('object', { ...object, archived: true }, true);
          this.recordAction(
            'Goal archived',
            object.id,
            [object.currentRevisionId],
            'The legacy goal was removed; its old contract is retained.',
          );
        }
        if (
          goal &&
          object.legacyNodeFingerprint !==
            engineHash({
              statement: goal.statement,
              successCriteria: goal.successCriteria,
              baseline: goal.baseline,
            })
        ) {
          const old = this.revision(object.currentRevisionId),
            source = this.sourceInternal(
              'human_note',
              goal.statement,
              'Edited legacy goal contract',
            );
          const next = this.newRevision(
            object.id,
            old.id,
            goal.statement,
            {
              fields: {
                successCriteria: { value: goal.successCriteria, state: 'confirmed', sources: [] },
              },
            },
            [this.wholeSource(source)],
            [],
          );
          this.put(
            'object',
            {
              ...object,
              title: goal.title,
              currentRevisionId: next.id,
              legacyNodeFingerprint: engineHash({
                statement: goal.statement,
                successCriteria: goal.successCriteria,
                baseline: goal.baseline,
              }),
            },
            true,
          );
          this.recordAction(
            'Goal contract revised',
            next.id,
            [old.id, next.id],
            'Old goal mappings require renewed review',
          );
        }
        continue;
      }
      const legacyId = object.legacyNodeId ?? object.id;
      const node = nodes.find((n) => n.id === legacyId);
      if (!node) {
        if (!object.archived) {
          this.put('object', { ...object, archived: true }, true);
          this.recordAction(
            'Research object archived',
            object.id,
            [object.currentRevisionId],
            'The linked graph item was removed; history is retained.',
          );
        }
        continue;
      }
      const revision = this.revision(object.currentRevisionId);
      if (
        object.legacyNodeFingerprint !== engineHash({ title: node.title, content: node.content }) &&
        node.content
      ) {
        const source = this.sourceInternal(
          'human_note',
          node.content,
          'Researcher edit in the existing graph inspector',
        );
        const next = this.newRevision(
          object.id,
          revision.id,
          node.content,
          {},
          [this.wholeSource(source)],
          [],
        );
        this.put(
          'object',
          {
            ...object,
            title: node.title,
            currentRevisionId: next.id,
            legacyNodeFingerprint: engineHash({ title: node.title, content: node.content }),
          },
          true,
        );
        this.recordAction(
          'Legacy editor revision',
          next.id,
          [revision.id, next.id],
          'Previous reviews remain bound to the old statement',
        );
      }
    }
    for (const node of nodes)
      if (
        !this.rows<ResearchObject>('object').some(
          (o) => o.legacyNodeId === node.id || o.id === node.id,
        )
      ) {
        const object = this.migrateNode(node);
        this.recordAction(
          'Research item admitted privately',
          object.id,
          [object.currentRevisionId],
          'Legacy graph capture; mathematical status remains an attributed assertion',
        );
      }
    for (const goal of this.program.state().goals)
      if (!this.rows<ResearchObject>('object').some((o) => o.legacyGoalId === goal.id)) {
        const source = this.sourceInternal(
          'human_note',
          goal.statement,
          'Researcher-created goal in the existing program',
        );
        const objectId = randomUUID(),
          revision = this.newRevision(
            objectId,
            null,
            goal.statement,
            {
              fields: {
                successCriteria: { value: goal.successCriteria, state: 'confirmed', sources: [] },
                baseline: { value: goal.baseline, state: 'confirmed', sources: [] },
              },
            },
            [this.wholeSource(source)],
            [],
          );
        this.put('object', {
          id: objectId,
          projectId: this.projectId,
          kind: 'goal',
          title: goal.title,
          currentRevisionId: revision.id,
          archived: false,
          createdAt: now(),
          legacyGoalId: goal.id,
          legacyNodeFingerprint: engineHash({
            statement: goal.statement,
            successCriteria: goal.successCriteria,
            baseline: goal.baseline,
          }),
        });
        this.recordAction(
          'Goal admitted privately',
          objectId,
          [revision.id],
          'Exact goal contract captured; no completion inferred.',
        );
      }
  }
  admitLegacyCandidate(candidate: Candidate, node: ResearchNode) {
    this.ready();
    const existing = this.rows<ResearchObject>('object').find(
      (o) => o.legacyNodeId === node.id || o.id === node.id,
    );
    if (existing) return existing;
    const source = this.sourceInternal(
      node.originType === 'Human' ? 'human_note' : 'model_response',
      candidate.sourceQuote,
      `Notebook capture from ${candidate.messageId}; supplied origin ${candidate.origin}`,
    );
    const objectId = randomUUID();
    const revision = this.newRevision(
      objectId,
      null,
      candidate.statement,
      {},
      [this.wholeSource(source)],
      [],
    );
    const object = this.put<ResearchObject>('object', {
      id: objectId,
      projectId: this.projectId,
      kind:
        candidate.kind === 'Barrier'
          ? 'barrier'
          : candidate.kind === 'Proof obligation'
            ? 'obligation'
            : 'claim',
      title: candidate.title,
      currentRevisionId: revision.id,
      archived: false,
      createdAt: now(),
      legacyNodeId: node.id,
      legacyNodeFingerprint: engineHash({ title: node.title, content: node.content }),
    });
    this.recordAction(
      'Notebook admission',
      candidate.id,
      [revision.id],
      'Privately admitted as an open result; source quote checked, proof not certified',
    );
    return object;
  }
  legacyPublic() {
    const p = this.rows<any>('legacy_public_snapshot')[0];
    if (!p) return null;
    return {
      state: {
        project: p.project,
        nodes: this.rows<any>('legacy_public_node').map((r) => r.value),
        edges: this.rows<any>('legacy_public_edge').map((r) => r.value),
        events: [],
        llmEnabled: false,
        canEdit: false,
      },
      program: {
        goals: this.rows<any>('legacy_public_goal').map((r) => r.value),
        assessments: this.rows<any>('legacy_public_assessment').map((r) => r.value),
      },
    };
  }
  chatHooks(): import('./chat').ChatResearchHooks {
    return {
      context: ({ projectId, question, goalId, contextNodeIds }) => {
        this.ready();
        if (projectId !== this.projectId) throw new Error('Chat context project mismatch');
        const data = this.data(),
          goal = goalId
            ? data.objects.find((o) => o.id === goalId || o.legacyGoalId === goalId)
            : undefined;
        const questionWithFocus = [
          question,
          ...contextNodeIds.flatMap((id) =>
            data.objects.filter((o) => o.id === id || o.legacyNodeId === id).map((o) => o.title),
          ),
        ].join('\n');
        const result = this.context({
          query: questionWithFocus,
          goalRevisionId: goal?.currentRevisionId,
          limit: 20,
        });
        return {
          text: result.text,
          manifest: result.manifest,
          baseCommitId: this.project().headCommitId,
          readSet: result.manifest.selectedRevisionIds.map((id) => {
            const revision = this.revision(id);
            return { objectId: revision.objectId, revisionId: revision.id, hash: revision.hash };
          }),
        };
      },
      beginRun: (input) => {
        this.ready();
        if (input.projectId !== this.projectId) throw new Error('Research run project mismatch');
        const existing = this.rows<ResearchRun>('run').find((r) => r.id === input.id);
        if (existing) return;
        const run: ResearchRun = {
          id: input.id,
          projectId: this.projectId,
          question: input.question,
          progressCriterion: input.progressCriterion,
          state: 'running',
          baseCommitId: input.context.baseCommitId,
          readSet: input.context.readSet,
          contextManifest: input.context.manifest,
          provider: input.provider,
          model: input.model ?? 'No model called',
          sourceIds: [],
          changeSetIds: [],
          commitIds: [],
          errors: [],
          createdAt: now(),
          updatedAt: now(),
          executionTrust: 'local_request',
          checkpointIds: [],
        };
        this.put('run', {
          ...run,
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          requestOutcome: 'pending',
        });
      },
      completeRun: (input) => {
        if (input.projectId !== this.projectId) throw new Error('Research run project mismatch');
        const run = this.record<ResearchRun>('run', input.id),
          sourceId = `chat-output:${input.message.id}`;
        if (run.checkpointIds?.includes(input.message.id)) return;
        const text = input.message.content;
        this.put<SourceArtifact>('source', {
          id: sourceId,
          projectId: this.projectId,
          kind: 'model_response',
          text,
          hash: engineHash(text),
          attribution:
            input.message.provider === 'local'
              ? 'Fixed no-key planning worksheet; no model was called'
              : `${input.message.provider}; model ${input.message.model ?? 'unspecified'}; visible output only`,
          attributionTrust: 'model',
          createdAt: input.message.createdAt,
        });
        this.put(
          'run',
          {
            ...run,
            state: input.message.error
              ? 'failed'
              : input.message.provider === 'local'
                ? 'completed'
                : 'awaiting_review',
            sourceIds: [...run.sourceIds, sourceId],
            checkpointIds: [...(run.checkpointIds ?? []), input.message.id],
            errors: input.message.error ? [...run.errors, input.message.error] : run.errors,
            requestOutcome:
              input.message.requestOutcome ?? (input.message.error ? 'known-failed' : 'completed'),
            updatedAt: now(),
          },
          true,
        );
      },
    };
  }
  /** Private backups contain research records, never connection cookies or API configuration. */
  export() {
    const rows = (table: string) =>
      this.store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
        ? this.store.db
            .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
            .all()
            .map((r) => JSON.parse(r.data))
            .filter((r) => (r.projectId ?? legacyProject.id) === this.projectId)
        : [];
    const sessions = rows('chat_sessions'),
      sessionIds = new Set(sessions.map((s) => s.id));
    return {
      format: 'research-os-engine' as const,
      formatVersion: 1 as const,
      exportedAt: now(),
      project: this.project(),
      records: this.store.db
        .prepare('SELECT kind,data FROM engine_records WHERE project_id=? ORDER BY rowid')
        .all(this.projectId)
        .map((r) => ({ kind: r.kind, data: JSON.parse(r.data) })),
      legacy: {
        state: this.store.state(),
        program: this.program.state(),
        drafts: this.store.rows('drafts'),
        sessions,
        messages: rows('chat_messages').filter((m) => sessionIds.has(m.sessionId)),
        candidates: rows('workbench_candidates').filter((c) => sessionIds.has(c.sessionId)),
      },
    };
  }
  /** Bounded, atomic copy. Imports cannot impersonate this installation's checkers or reviewer. */
  importProject(raw: unknown) {
    if (new TextEncoder().encode(JSON.stringify(raw)).length > 900_000)
      throw new Error(
        'Import limit: 900,000 UTF-8 bytes. Larger backups require a separately reviewed batched restore; nothing was imported.',
      );
    const array = z.array(z.record(z.unknown())).max(700);
    const input = z
      .object({
        format: z.literal('research-os-engine'),
        formatVersion: z.literal(1),
        exportedAt: z.string(),
        project: z
          .object({
            id,
            title: z.string().min(1).max(200),
            description: z.string().max(10000),
            headCommitId: id.nullable(),
          })
          .passthrough(),
        records: z
          .array(z.object({ kind: z.string(), data: z.record(z.unknown()) }).strict())
          .max(700),
        legacy: z
          .object({
            state: z
              .object({ project: z.record(z.unknown()), nodes: array, edges: array, events: array })
              .strict(),
            program: z.object({ goals: array, assessments: array }).strict(),
            drafts: array.default([]),
            sessions: array.default([]),
            messages: array.default([]),
            candidates: array.default([]),
          })
          .strict(),
      })
      .strict()
      .parse(raw);
    const legacy = input.legacy;
    const collections: Record<string, any[]> = {
      nodes: legacy.state.nodes,
      edges: legacy.state.edges,
      events: legacy.state.events,
      drafts: legacy.drafts,
      research_goals: legacy.program.goals,
      contribution_assessments: legacy.program.assessments,
      chat_sessions: legacy.sessions,
      chat_messages: legacy.messages,
      workbench_candidates: legacy.candidates,
    };
    const recordCount =
      input.records.length + Object.values(collections).reduce((n, a) => n + a.length, 0);
    if (recordCount > 700)
      throw new Error(
        'Import limit: 700 combined records per atomic import. Larger backups require a separately reviewed batched restore.',
      );
    const forbidden =
      /^(api[_-]?key|authorization|connection[_-]?secret|access[_-]?token|refresh[_-]?token|password|credentials)$/i;
    const inspect = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value && typeof value === 'object')
        for (const [key, v] of Object.entries(value)) {
          if (forbidden.test(key))
            throw new Error('Credential/configuration fields are forbidden in research imports');
          inspect(v);
        }
    };
    inspect(raw);
    const allowedKinds = new Set([
      ...Object.values(kinds),
      'migration',
      'project_event',
      'publication_event',
      'counterexample_claim',
      'flag',
      'legacy_public_snapshot',
      'legacy_public_node',
      'legacy_public_edge',
      'legacy_public_goal',
      'legacy_public_assessment',
      'import_map',
    ]);
    const records = new Map<string, { kind: string; data: any }>(),
      legacyIds = new Set<string>();
    for (const record of input.records) {
      if (!allowedKinds.has(record.kind)) throw new Error('Unsupported research record kind');
      id.parse(record.data.id);
      if (record.data.projectId !== input.project.id)
        throw new Error('Cross-project record in import');
      if (records.has(String(record.data.id))) throw new Error('Duplicate research record ID');
      records.set(String(record.data.id), record as any);
    }
    for (const [table, rows] of Object.entries(collections))
      for (const row of rows) {
        if (row.projectId !== undefined && row.projectId !== input.project.id)
          throw new Error('Cross-project legacy record in import');
        const key = table === 'contribution_assessments' ? row.nodeId : row.id;
        id.parse(key);
        if (table !== 'contribution_assessments') {
          if (legacyIds.has(key)) throw new Error('Duplicate legacy record ID');
          legacyIds.add(key);
        }
      }
    const get = (ref: unknown, kind?: string) => {
      id.parse(ref);
      const r = records.get(String(ref));
      if (!r || (kind && r.kind !== kind))
        throw new Error(`Invalid imported ${kind ?? 'record'} reference`);
      return r.data;
    };
    const legacyHas = (table: string, ref: unknown) => {
      if (!collections[table].some((r) => r.id === ref))
        throw new Error(`Invalid imported ${table} reference`);
    };
    const validateSpans = (spans: unknown) => {
      for (const item of z.array(sourceSpanSchema).max(100).parse(spans)) {
        const artifact = get(item.sourceId, 'source') as SourceArtifact;
        if (validateSourceSpan(artifact, item, input.project.id).outcome !== 'pass')
          throw new Error('Invalid imported source span');
      }
    };
    const scanSpans = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(scanSpans);
      else if (value && typeof value === 'object') {
        if ('sourceId' in value && 'sourceHash' in value && 'quote' in value) {
          validateSpans([value]);
          return;
        }
        Object.values(value).forEach(scanSpans);
      }
    };
    const checkRefs = (values: unknown, kind: string) =>
      z
        .array(id)
        .max(500)
        .parse(values)
        .forEach((r) => get(r, kind));
    const strings = z.array(z.string());
    const readSet = z.array(z.object({ objectId: id, revisionId: id, hash: id }).strict());
    const manifestShape = z
      .object({
        projectId: id,
        selectedRevisionIds: z.array(id),
        sourceIds: z.array(id),
        omittedIds: z.array(id),
        reasons: z.record(z.string()),
        tokenEstimate: z.number().finite().nonnegative(),
        generatedAt: z.string(),
        limitations: strings,
      })
      .passthrough();
    const diffShape = z
      .object({
        operationId: id,
        category: z.enum([
          'statement',
          'revision',
          'evidence',
          'route',
          'obligation',
          'failed_attempt',
          'counterexample',
          'relationship',
          'methodology',
          'flag',
        ]),
        description: z.string(),
        targetIds: z.array(id),
        sources: z.array(sourceSpanSchema),
        objectId: id.optional(),
        beforeRevisionId: id.optional(),
        afterRevisionId: id.optional(),
      })
      .passthrough();
    const shapes: Record<string, z.ZodTypeAny> = {
      object: z
        .object({
          id,
          projectId: id,
          kind: z.enum([
            'claim',
            'definition',
            'goal',
            'obligation',
            'failed_attempt',
            'barrier',
            'method',
            'note',
          ]),
          title: z.string(),
          currentRevisionId: id,
          archived: z.boolean(),
          createdAt: z.string(),
        })
        .passthrough(),
      evidence: z
        .object({
          id,
          projectId: id,
          targetRevisionId: id,
          kind: z.enum([
            'proof_attempt',
            'paper_passage',
            'counterexample_witness',
            'finite_experiment',
            'calculation',
            'formal_artifact',
            'human_argument',
          ]),
          content: z.string(),
          sources: z.array(sourceSpanSchema),
          scope: z.string(),
          createdAt: z.string(),
          actor: z.string(),
        })
        .passthrough(),
      route: z
        .object({
          id,
          projectId: id,
          conclusionRevisionId: id,
          premiseRevisionIds: z.array(id),
          localAssumptions: strings,
          title: z.string(),
          sources: z.array(sourceSpanSchema),
          createdAt: z.string(),
          actor: z.string(),
          evidenceId: id.optional(),
        })
        .passthrough(),
      review: z
        .object({
          id,
          projectId: id,
          targetId: id,
          targetRevisionIds: z.array(id),
          decision: z.enum(['endorse', 'challenge', 'retract']),
          scope: z.enum([
            'mathematical',
            'inference',
            'goal_satisfaction',
            'methodological',
            'admission',
          ]),
          reason: z.string(),
          actor: z.string(),
          createdAt: z.string(),
          evidenceIds: z.array(id),
          checkIds: z.array(id),
          trust: z.enum(['human', 'external', 'model']),
          criterionMappings: z
            .array(
              z
                .object({ criterion: z.string(), resultRevisionId: id, explanation: z.string() })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
      check: z
        .object({
          id,
          projectId: id,
          checkerId: z.string(),
          checkerVersion: z.string(),
          targetRevisionIds: z.array(id),
          inputHashes: z.record(z.string()),
          environment: z.string(),
          scope: z.string(),
          outcome: z.enum(['pass', 'fail', 'unknown', 'not_applicable']),
          findings: z.array(
            z
              .object({
                rule: z.string(),
                version: z.string(),
                outcome: z.enum(['pass', 'fail', 'unknown', 'not_applicable']),
                severity: z.enum(['info', 'warning', 'error']),
                explanation: z.string(),
                scope: z.string(),
                targetRevisionIds: z.array(id),
                references: strings,
                limitations: strings,
              })
              .passthrough(),
          ),
          output: z.unknown(),
          limitations: strings,
          createdAt: z.string(),
          trust: z.enum(['server', 'external']),
          changeSetId: id.optional(),
          changeSetRevision: z.number().int().positive().optional(),
        })
        .passthrough(),
      obligation: z
        .object({
          id,
          projectId: id,
          title: z.string(),
          statement: z.string(),
          targetRevisionId: id,
          premiseRevisionIds: z.array(id),
          sources: z.array(sourceSpanSchema),
          createdAt: z.string(),
          resolutionRevisionId: id.optional(),
          resolutionReviewId: id.optional(),
        })
        .passthrough(),
      relationship: z
        .object({
          id,
          projectId: id,
          fromRevisionId: id,
          toRevisionId: id,
          kind: z.enum([
            'related_to',
            'motivated_by',
            'tested_by',
            'claimed_equivalent',
            'legacy_dependency',
          ]),
          explanation: z.string(),
          sources: z.array(sourceSpanSchema),
          createdAt: z.string(),
        })
        .passthrough(),
      assessment: z
        .object({
          id,
          projectId: id,
          targetRevisionId: id,
          projectNovelty: z.enum([
            'repetition',
            'additional_evidence',
            'possible_new_statement',
            'unknown',
          ]),
          methodologicalValue: z.string(),
          justification: z.string(),
          unresolvedGaps: z.string(),
          actor: z.string(),
          createdAt: z.string(),
        })
        .passthrough(),
      proposal: z
        .object({
          id,
          projectId: id,
          revision: z.number().int().positive(),
          state: z.enum(['pending', 'committed', 'rejected', 'superseded']),
          actor: z.string(),
          createdAt: z.string(),
          checkIds: z.array(id),
        })
        .passthrough(),
      commit: z
        .object({
          id,
          projectId: id,
          parentCommitId: id.nullable(),
          changeSetId: id,
          changeSetRevision: z.number().int().positive(),
          actor: z.string(),
          createdAt: z.string(),
          acceptedOperationIds: z.array(id),
          readSet,
          idempotencyKey: z.string(),
          reviewIds: z.array(id),
          checkIds: z.array(id),
          diff: z.array(diffShape),
          temporaryIds: z.record(id),
        })
        .passthrough(),
      publication: z
        .object({
          id,
          projectId: id,
          title: z.string(),
          createdAt: z.string(),
          actor: z.string(),
          active: z.boolean(),
          revisions: z.array(
            z
              .object({
                id,
                objectId: id,
                kind: z.enum([
                  'claim',
                  'definition',
                  'goal',
                  'obligation',
                  'failed_attempt',
                  'barrier',
                  'method',
                  'note',
                ]),
                title: z.string(),
                statement: z.string(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
      run: z
        .object({
          id,
          projectId: id,
          question: z.string(),
          progressCriterion: z.string(),
          state: z.enum([
            'pending',
            'running',
            'awaiting_review',
            'completed',
            'failed',
            'cancelled',
            'budget_exhausted',
          ]),
          baseCommitId: id.nullable(),
          readSet,
          contextManifest: manifestShape.nullable(),
          provider: z.string(),
          model: z.string(),
          sourceIds: z.array(id),
          changeSetIds: z.array(id),
          commitIds: z.array(id),
          errors: strings,
          createdAt: z.string(),
          updatedAt: z.string(),
          executionTrust: z.enum(['local_request', 'external_import']),
          checkpointIds: strings.optional(),
          budget: z
            .object({
              tokens: z.number().finite().nonnegative().optional(),
              cost: z.number().finite().nonnegative().optional(),
              currency: z.string().max(10).optional(),
            })
            .strict()
            .optional(),
        })
        .passthrough(),
      flag: z
        .object({
          id,
          projectId: id,
          type: z.enum(['flag_possible_duplicate', 'flag_possible_conflict']),
          leftRevisionId: id,
          rightRevisionId: id,
          reason: z.string(),
          sources: z.array(sourceSpanSchema),
        })
        .passthrough(),
      counterexample_claim: z
        .object({
          id,
          projectId: id,
          targetRevisionId: id,
          evidenceId: id,
          status: z.literal('needs_review'),
          trustedCheck: z.literal(false),
          premiseChecks: z.array(
            z.object({ premise: z.string(), satisfied: z.enum(['yes', 'no', 'unknown']) }).strict(),
          ),
          conclusionViolated: z.enum(['yes', 'no', 'unknown']),
          sources: z.array(sourceSpanSchema),
        })
        .passthrough(),
    };
    for (const { kind, data: r } of records.values()) {
      shapes[kind]?.parse(r);
      if (kind === 'source') {
        z.object({
          id,
          projectId: id,
          kind: z.enum([
            'human_note',
            'conversation',
            'model_response',
            'code',
            'external_run',
            'experiment',
            'legacy',
          ]),
          text: z.string().min(1).max(400000),
          hash: id,
          createdAt: z.string(),
          attribution: z.string(),
        })
          .passthrough()
          .parse(r);
        if (engineHash(r.text) !== r.hash) throw new Error('Imported source hash mismatch');
        if (r.parentSourceId) get(r.parentSourceId, 'source');
      }
      if (kind === 'revision') {
        z.object({
          id,
          projectId: id,
          objectId: id,
          parentRevisionId: id.nullable(),
          statement: z.string().min(1).max(100000),
          contract: contractSchema,
          sources: z.array(sourceSpanSchema),
          definitionRevisionIds: z.array(id),
          actor: z.string(),
          createdAt: z.string(),
          hash: id,
          formatVersion: z.literal(1),
        })
          .passthrough()
          .parse(r);
        get(r.objectId, 'object');
        if (r.parentRevisionId && get(r.parentRevisionId, 'revision').objectId !== r.objectId)
          throw new Error('Revision parent belongs to another object');
        for (const d of r.definitionRevisionIds)
          if (get(get(d, 'revision').objectId, 'object').kind !== 'definition')
            throw new Error('Imported definition reference is not a definition');
        const fields = {
          objectId: r.objectId,
          parentRevisionId: r.parentRevisionId,
          statement: r.statement,
          contract: contractSchema.parse(r.contract),
          sources: r.sources,
          definitionRevisionIds: r.definitionRevisionIds,
        };
        if (engineHash(fields) !== r.hash)
          throw new Error('Imported revision fingerprint mismatch');
      }
      if (kind === 'object') {
        z.object({
          kind: z.enum([
            'claim',
            'definition',
            'goal',
            'obligation',
            'failed_attempt',
            'barrier',
            'method',
            'note',
          ]),
          title: z.string().max(250),
          currentRevisionId: id,
          archived: z.boolean(),
        })
          .passthrough()
          .parse(r);
        if (get(r.currentRevisionId, 'revision').objectId !== r.id)
          throw new Error('Imported current revision belongs to another object');
        if (r.legacyNodeId) legacyHas('nodes', r.legacyNodeId);
        if (r.legacyGoalId) legacyHas('research_goals', r.legacyGoalId);
      }
      if (kind === 'evidence') {
        get(r.targetRevisionId, 'revision');
        z.enum([
          'proof_attempt',
          'paper_passage',
          'counterexample_witness',
          'finite_experiment',
          'calculation',
          'formal_artifact',
          'human_argument',
        ]).parse(r.kind);
        z.string().max(100000).parse(r.content);
        z.string().parse(r.scope);
        validateSpans(r.sources);
      }
      if (kind === 'route') {
        get(r.conclusionRevisionId, 'revision');
        checkRefs(r.premiseRevisionIds, 'revision');
        z.array(z.string()).parse(r.localAssumptions);
        z.string().parse(r.title);
        if (
          r.evidenceId &&
          get(r.evidenceId, 'evidence').targetRevisionId !== r.conclusionRevisionId
        )
          throw new Error('Imported argument evidence binds to another conclusion');
        validateSpans(r.sources);
      }
      if (kind === 'review') {
        get(r.targetId);
        checkRefs(r.targetRevisionIds, 'revision');
        checkRefs(r.evidenceIds, 'evidence');
        checkRefs(r.checkIds, 'check');
        z.enum(['endorse', 'challenge', 'retract']).parse(r.decision);
        z.enum([
          'mathematical',
          'inference',
          'goal_satisfaction',
          'methodological',
          'admission',
        ]).parse(r.scope);
        z.string().parse(r.reason);
        if (r.supersedes) get(r.supersedes, 'review');
      }
      if (kind === 'check') {
        checkRefs(r.targetRevisionIds, 'revision');
        z.enum(['pass', 'fail', 'unknown', 'not_applicable']).parse(r.outcome);
        z.array(z.record(z.unknown())).parse(r.findings);
        if (r.changeSetId) get(r.changeSetId, 'proposal');
      }
      if (kind === 'obligation') {
        get(r.targetRevisionId, 'revision');
        checkRefs(r.premiseRevisionIds, 'revision');
        if (r.resolutionRevisionId) get(r.resolutionRevisionId, 'revision');
        if (r.resolutionReviewId) get(r.resolutionReviewId, 'review');
        validateSpans(r.sources);
      }
      if (kind === 'relationship') {
        get(r.fromRevisionId, 'revision');
        get(r.toRevisionId, 'revision');
        z.enum([
          'related_to',
          'motivated_by',
          'tested_by',
          'claimed_equivalent',
          'legacy_dependency',
        ]).parse(r.kind);
        validateSpans(r.sources);
      }
      if (kind === 'assessment') get(r.targetRevisionId, 'revision');
      if (kind === 'proposal') {
        Object.assign(
          r,
          changeSetInputSchema.parse({
            title: r.title,
            baseCommitId: r.baseCommitId,
            readSet: r.readSet,
            sources: r.sources,
            operations: r.operations,
            runId: r.runId,
          }),
        );
        if (r.baseCommitId) get(r.baseCommitId, 'commit');
        if (r.runId) get(r.runId, 'run');
        checkRefs(r.checkIds, 'check');
        for (const read of r.readSet) {
          if (
            get(read.revisionId, 'revision').hash !== read.hash ||
            get(read.revisionId, 'revision').objectId !== read.objectId
          )
            throw new Error('Imported read-set mismatch');
        }
        const temp = new Set(r.operations.map((o: any) => o.tempId));
        for (const op of r.operations) {
          for (const [key, value] of Object.entries(op)) {
            const refs = key.endsWith('RevisionIds')
              ? value
              : key.endsWith('RevisionId')
                ? [value]
                : [];
            for (const ref of refs as string[])
              if (!temp.has(ref.replace(/^\$/, ''))) get(ref, 'revision');
          }
          if (op.objectId) get(op.objectId, 'object');
          if (op.evidenceId && !temp.has(op.evidenceId.replace(/^\$/, '')))
            get(op.evidenceId, 'evidence');
          if (op.obligationId) get(op.obligationId, 'obligation');
        }
      }
      if (kind === 'commit') {
        if (r.parentCommitId) get(r.parentCommitId, 'commit');
        checkRefs(r.reviewIds, 'review');
        checkRefs(r.checkIds, 'check');
        z.array(z.record(z.unknown())).parse(r.diff);
        for (const read of r.readSet ?? [])
          if (get(read.revisionId, 'revision').hash !== read.hash)
            throw new Error('Imported journal read-set mismatch');
      }
      if (kind === 'publication') {
        for (const item of r.revisions) {
          const revision = get(item.id, 'revision');
          if (revision.objectId !== item.objectId || revision.statement !== item.statement)
            throw new Error('Publication snapshot differs from its stated revision');
        }
        z.boolean().parse(r.active);
      }
      if (kind === 'run') {
        for (const read of r.readSet)
          if (
            get(read.revisionId, 'revision').hash !== read.hash ||
            get(read.revisionId, 'revision').objectId !== read.objectId
          )
            throw new Error('Imported run read-set mismatch');
        if (r.contextManifest) {
          if (r.contextManifest.projectId !== input.project.id)
            throw new Error('Cross-project run context');
          checkRefs(r.contextManifest.selectedRevisionIds, 'revision');
          checkRefs(r.contextManifest.sourceIds, 'source');
        }
        checkRefs(r.sourceIds, 'source');
        checkRefs(r.changeSetIds, 'proposal');
        checkRefs(r.commitIds, 'commit');
        if (r.baseCommitId) get(r.baseCommitId, 'commit');
      }
      if (kind === 'flag') {
        get(r.leftRevisionId, 'revision');
        get(r.rightRevisionId, 'revision');
      }
      if (kind === 'counterexample_claim') {
        get(r.targetRevisionId, 'revision');
        get(r.evidenceId, 'evidence');
      }
      scanSpans(r);
    }
    if (input.project.headCommitId) get(input.project.headCommitId, 'commit');
    for (const n of collections.nodes) {
      Object.assign(n, nodeInputSchema.parse(n));
      z.object({ id, createdAt: z.string(), updatedAt: z.string() }).passthrough().parse(n);
    }
    for (const e of collections.edges) {
      Object.assign(e, edgeInputSchema.parse(e));
      z.string().parse(e.createdAt);
      legacyHas('nodes', e.sourceNodeId);
      legacyHas('nodes', e.targetNodeId);
    }
    for (const g of collections.research_goals) {
      Object.assign(g, goalInputSchema.parse(g));
      z.object({ createdAt: z.string(), updatedAt: z.string() }).passthrough().parse(g);
      g.linkedNodeIds.forEach((n: string) => legacyHas('nodes', n));
      if (g.parentGoalId) legacyHas('research_goals', g.parentGoalId);
    }
    for (const a of collections.contribution_assessments) {
      Object.assign(a, contributionInputSchema.parse(a));
      z.string().parse(a.updatedAt);
      legacyHas('nodes', a.nodeId);
    }
    for (const event of collections.events)
      z.object({
        nodeId: id.nullable(),
        nodeTitle: z.string(),
        eventType: z.string(),
        previousValue: z.string().nullable(),
        newValue: z.string().nullable(),
        reason: z.string(),
        createdAt: z.string(),
      })
        .passthrough()
        .parse(event);
    for (const d of collections.drafts) {
      Object.assign(d, proposalSchema.parse({ items: d.items, edges: d.edges }));
      z.object({
        transcript: z.string(),
        sourceName: z.string(),
        mode: z.enum(['manual', 'openai']),
        createdAt: z.string(),
        committedAt: z.string().nullable(),
      })
        .passthrough()
        .parse(d);
    }
    for (const s of collections.chat_sessions) {
      z.object({ title: z.string().max(150), createdAt: z.string(), updatedAt: z.string() })
        .passthrough()
        .parse(s);
      if (s.goalId) legacyHas('research_goals', s.goalId);
    }
    for (const m of collections.chat_messages) {
      legacyHas('chat_sessions', m.sessionId);
      z.object({
        role: z.enum(['user', 'assistant']),
        mode: z.enum(['explore', 'attack', 'audit']),
        provider: z.enum(['openai', 'local', 'user', 'imported']),
        model: z.string().nullable(),
        proposalStatus: z.enum(['none', 'pending', 'applied', 'discarded']),
        context: z
          .object({
            nodeIds: z.array(id),
            goalIds: z.array(id),
            truncated: z.boolean(),
            characters: z.number(),
          })
          .passthrough(),
        createdAt: z.string(),
      })
        .passthrough()
        .parse(m);
      z.string().max(60000).parse(m.content);
    }
    for (const c of collections.workbench_candidates) {
      legacyHas('chat_sessions', c.sessionId);
      legacyHas('chat_messages', c.messageId);
      z.object({
        revision: z.number().int().positive(),
        basis: z
          .object({
            goalId: id.nullable(),
            goalHash: z.string(),
            nodes: z.array(z.object({ id, hash: z.string() })),
          })
          .passthrough(),
        decision: z.enum([
          'Unreviewed',
          'Advance',
          'Useful partial result',
          'Reformulation',
          'Rejected',
        ]),
        reason: z.string(),
        verification: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        history: z.array(
          z
            .object({
              at: z.string(),
              action: z.string(),
              reason: z.string(),
              revision: z.number(),
            })
            .passthrough(),
        ),
      })
        .passthrough()
        .parse(c);
      candidateDraftSchema.parse(
        Object.fromEntries(Object.keys(candidateDraftSchema.shape).map((k) => [k, c[k]])),
      );
      if (
        !collections.chat_messages.find((m) => m.id === c.messageId).content.includes(c.sourceQuote)
      )
        throw new Error('Imported candidate source quote mismatch');
    }
    return this.store.transaction(() => {
      const p = this.createProject({
        title: `${input.project.title.slice(0, 180)} (imported)`,
        description: input.project.description,
      });
      const mapping = new Map<string, string>([[input.project.id, p.id]]);
      const remapId = (value: string) => {
        if (value.startsWith('$')) return value;
        let mapped = mapping.get(value);
        if (!mapped) {
          mapped = randomUUID();
          mapping.set(value, mapped);
        }
        return mapped;
      };
      for (const key of records.keys()) remapId(key);
      for (const key of legacyIds) remapId(key);
      const map = (value: any, key = ''): any => {
        if (typeof value === 'string')
          return ['tempId', 'operationId', 'externalId', 'checkerId', 'originalProjectId'].includes(
            key,
          )
            ? value
            : key === 'id' || key.endsWith('Id')
              ? remapId(value)
              : value;
        if (Array.isArray(value))
          return value.map((v) =>
            typeof v === 'string' &&
            key.endsWith('Ids') &&
            !['acceptedOperationIds', 'checkpointIds'].includes(key)
              ? remapId(v)
              : map(v),
          );
        if (value && typeof value === 'object') {
          if (key === 'temporaryIds' || key === 'inputHashes' || key === 'reasons')
            return Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                key === 'temporaryIds' ? k : remapId(k),
                key === 'temporaryIds' && typeof v === 'string' ? remapId(v) : map(v),
              ]),
            );
          return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, map(v, k)]));
        }
        return value;
      };
      const mapped = new Map<string, { kind: string; data: any }>();
      for (const [old, r] of records) {
        if (r.kind === 'migration' || r.kind === 'import_map') continue;
        const data = map(r.data);
        data.projectId = p.id;
        if (r.kind === 'review') {
          data.importedTrust = data.trust;
          data.trust = 'external';
          data.actor = `Imported attribution: ${data.actor ?? 'unknown'}`;
        }
        if (r.kind === 'check') {
          data.importedTrust = data.trust;
          data.trust = 'external';
        }
        if (r.kind === 'source') data.attributionTrust = 'supplied';
        if (r.kind === 'evidence') data.executionTrust = 'imported';
        if (r.kind === 'run') data.executionTrust = 'external_import';
        if (r.kind === 'publication') {
          data.importedActive = data.active;
          data.active = false;
        }
        if (r.kind === 'proposal') {
          data.importedState = data.state;
          data.state = 'superseded';
        }
        mapped.set(old, { kind: r.kind, data });
      }
      for (const r of mapped.values())
        if (r.kind === 'revision') {
          const v = r.data;
          v.importedOriginalHash = v.hash;
          v.hash = engineHash({
            objectId: v.objectId,
            parentRevisionId: v.parentRevisionId,
            statement: v.statement,
            contract: contractSchema.parse(v.contract),
            sources: v.sources,
            definitionRevisionIds: v.definitionRevisionIds,
          });
        }
      const refreshHashes = (value: any): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(refreshHashes);
          return;
        }
        if (value.revisionId && value.hash) {
          const revision = [...mapped.values()].find(
            (r) => r.kind === 'revision' && r.data.id === value.revisionId,
          );
          if (revision) value.hash = revision.data.hash;
        }
        if (value.inputHashes)
          for (const [rid] of Object.entries(value.inputHashes)) {
            const revision = [...mapped.values()].find(
              (r) => r.kind === 'revision' && r.data.id === rid,
            );
            if (revision) value.inputHashes[rid] = revision.data.hash;
          }
        Object.values(value).forEach(refreshHashes);
      };
      const write = this.store.db.prepare('INSERT INTO engine_records VALUES(?,?,?,?)');
      for (const r of mapped.values()) {
        refreshHashes(r.data);
        write.run(r.data.id, p.id, r.kind, JSON.stringify(r.data));
      }
      // These are the same additive domain tables used by the supported request path.
      this.store.db.exec(
        'CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES chat_sessions(id),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workbench_candidates(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES chat_sessions(id),message_id TEXT NOT NULL REFERENCES chat_messages(id),data TEXT NOT NULL);',
      );
      for (const [table, rows] of Object.entries(collections))
        for (const original of rows) {
          const r = map(original);
          r.projectId = p.id;
          if (table === 'nodes') {
            r.importedLegacyAssertion = {
              epistemicStatus: r.epistemicStatus,
              humanVerified: r.humanVerified,
            };
            r.epistemicStatus = 'Unverified';
            r.humanVerified = false;
          }
          if (table === 'research_goals' && r.status === 'Achieved') {
            r.importedStatus = r.status;
            r.status = 'Active';
          }
          if (table === 'contribution_assessments') {
            r.importedVerdict = r.verdict;
            r.verdict = 'Unreviewed';
          }
          if (table === 'chat_messages') {
            r.importedProvider = r.provider;
            r.provider = 'imported';
            r.proposalStatus = r.proposal ? 'discarded' : 'none';
          }
          if (table === 'workbench_candidates') {
            r.importedDecision = r.decision;
            r.decision = 'Unreviewed';
            r.legacyPremiseSelection = r.premiseNodeIds === undefined || r.legacyPremiseSelection;
            r.premiseNodeIds ??= [...r.relatedNodeIds];
          }
          const columns =
            table === 'nodes' || table === 'research_goals'
              ? ['id', 'project_id', 'data']
              : table === 'edges'
                ? ['id', 'project_id', 'source_id', 'target_id', 'edge_type', 'data']
                : table === 'events'
                  ? ['id', 'project_id', 'node_id', 'data']
                  : table === 'contribution_assessments'
                    ? ['node_id', 'data']
                    : table === 'chat_messages'
                      ? ['id', 'session_id', 'data']
                      : table === 'workbench_candidates'
                        ? ['id', 'session_id', 'message_id', 'data']
                        : ['id', 'data'];
          const values: any = {
            id: r.id,
            project_id: p.id,
            source_id: r.sourceNodeId,
            target_id: r.targetNodeId,
            edge_type: r.edgeType,
            node_id: r.nodeId,
            session_id: r.sessionId,
            message_id: r.messageId,
            data: JSON.stringify(r),
          };
          this.store.db
            .prepare(
              `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
            )
            .run(...columns.map((c) => values[c] ?? null));
        }
      const project = {
        ...p,
        headCommitId: input.project.headCommitId ? remapId(input.project.headCommitId) : null,
      };
      this.store.db
        .prepare('UPDATE projects SET data=? WHERE id=?')
        .run(JSON.stringify(project), p.id);
      const mapId = randomUUID();
      write.run(
        mapId,
        p.id,
        'import_map',
        JSON.stringify({
          id: mapId,
          projectId: p.id,
          originalProjectId: input.project.id,
          mapping: Object.fromEntries(mapping),
          createdAt: now(),
          policy:
            'All identities remapped. Imported judgments and executions are untrusted; publication inactive. Original source text is unchanged. Historical serialized event text retains original identifiers.',
        }),
      );
      return {
        project,
        recordsImported: recordCount,
        warnings: [
          'Imported reviews/checks retain external attribution and do not establish current support.',
          'All publication snapshots are inactive; publish again only after preview.',
          'Legacy proof flags, accepted assessments, and notebook decisions require renewed review.',
          'Pending proposals are historical imports; create a new proposal and execute fresh checks.',
        ],
      };
    });
  }
}
