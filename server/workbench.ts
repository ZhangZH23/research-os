import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LEGACY_PROJECT_ID, type Store } from './domain-store';
import type { ResearchNode } from '../shared/types';
import type { ProgramStore } from './program-store';
import type { ChatStore } from './chat';
import {
  candidateDraftSchema,
  REVIEW_DECISIONS,
  type Candidate,
  type CandidateDraft,
  type ReviewBasis,
} from '../shared/workbench';
import {
  candidateStale,
  claimKey,
  digest,
  integratedFingerprint,
  reviewBasis,
} from './workbench-basis';

export class WorkbenchStore {
  constructor(
    readonly store: Store,
    readonly program: ProgramStore,
    readonly chat: ChatStore,
    readonly onAdmit?: (candidate: Candidate, node: ResearchNode) => void,
  ) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS workbench_candidates(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES chat_sessions(id),message_id TEXT NOT NULL REFERENCES chat_messages(id),data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS workbench_by_session ON workbench_candidates(session_id);',
    );
  }
  private rows(): Candidate[] {
    const sessions = new Set(this.chat.sessions().map((s) => s.id));
    return this.store.db
      .prepare(
        "SELECT data FROM workbench_candidates WHERE COALESCE(json_extract(data,'$.projectId'),?)=? ORDER BY rowid",
      )
      .all(LEGACY_PROJECT_ID, this.store.projectId)
      .map((r) => this.normalize(JSON.parse(r.data)))
      .filter((c) => sessions.has(c.sessionId));
  }
  private normalize(c: Candidate): Candidate {
    // The old review UI explicitly called its selections premises. Preserve that assertion,
    // with attribution, instead of guessing that old selections were merely context.
    return c.premiseNodeIds === undefined
      ? {
          ...c,
          projectId: c.projectId ?? LEGACY_PROJECT_ID,
          premiseNodeIds: [...c.relatedNodeIds],
          legacyPremiseSelection: true,
        }
      : { ...c, projectId: c.projectId ?? LEGACY_PROJECT_ID };
  }
  private save(c: Candidate) {
    if (!this.store.owns(c)) throw new Error('Candidate project mismatch');
    this.chat.session(c.sessionId);
    const source = this.chat.messages(c.sessionId).find((m) => m.id === c.messageId);
    if (!source) throw new Error('Candidate source not found');
    const existing = this.store.db
      .prepare('SELECT data FROM workbench_candidates WHERE id=?')
      .get(c.id);
    if (existing && !this.store.owns(JSON.parse(existing.data)))
      throw new Error('Candidate not found');
    this.store.db
      .prepare(
        'INSERT INTO workbench_candidates VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(c.id, c.sessionId, c.messageId, JSON.stringify(c));
    return c;
  }
  get(id: string) {
    const candidate = this.rows().find((c) => c.id === id);
    if (!candidate) throw new Error('Candidate not found');
    return candidate;
  }
  message(id: string) {
    const message = this.chat.messages().find((m) => m.id === id);
    if (!message || message.error || message.provider === 'local')
      throw new Error('Choose a human observation or a successful GPT/imported message.');
    return message;
  }
  stale(c: Candidate) {
    return candidateStale(c, this.store, this.program);
  }
  duplicate(c: Candidate) {
    return (
      this.rows().find(
        (other) =>
          other.id !== c.id &&
          other.integratedNodeId &&
          claimKey(other.statement) === claimKey(c.statement) &&
          this.store.state().nodes.some((n) => n.id === other.integratedNodeId),
      )?.integratedNodeId ?? null
    );
  }
  state(sessionId?: string) {
    return {
      candidates: this.rows()
        .filter((c) => !sessionId || c.sessionId === sessionId)
        .map((c) => ({ ...c, stale: this.stale(c), duplicateOf: this.duplicate(c) })),
    };
  }
  capture(messageId: string, drafts?: CandidateDraft[], basis?: ReviewBasis) {
    const message = this.message(messageId);
    const result: Candidate[] = [];
    for (const [index, raw] of (drafts ?? message.candidates ?? []).entries()) {
      if (index >= 4) break;
      const id = `candidate-${digest({ messageId, quote: raw.sourceQuote, statement: raw.statement }).slice(0, 32)}`;
      if (this.store.db.prepare('SELECT id FROM workbench_candidates WHERE id=?').get(id)) continue;
      try {
        result.push(this.create(messageId, raw, 'model', id, basis));
      } catch {
        /* Invalid model extracts do not discard the original reply. */
      }
    }
    return result;
  }
  create(
    messageId: string,
    raw: unknown,
    origin: 'model' | 'researcher' = 'researcher',
    id: string = randomUUID(),
    basis?: ReviewBasis,
  ) {
    const message = this.message(messageId);
    const parsed = candidateDraftSchema.parse(raw);
    const draft = { ...parsed, premiseNodeIds: parsed.premiseNodeIds ?? [] };
    if (!message.content.includes(draft.sourceQuote))
      throw new Error('The source quote must be an exact passage from this reply.');
    for (const nodeId of [...draft.relatedNodeIds, ...draft.premiseNodeIds])
      this.store.getNode(nodeId);
    const goalId =
      message.goalId !== undefined ? message.goalId : (message.context.goalIds[0] ?? null);
    const date = new Date().toISOString();
    const captured =
      basis ??
      message.reviewBasis ??
      reviewBasis(this.store, this.program, goalId, message.context.nodeIds);
    const extra = [...draft.relatedNodeIds, ...draft.premiseNodeIds].filter(
      (id) => !captured.nodes.some((n) => n.id === id),
    );
    const completeBasis = {
      ...captured,
      nodes: [...captured.nodes, ...reviewBasis(this.store, this.program, goalId, extra).nodes]
        .filter((n, i, all) => all.findIndex((v) => v.id === n.id) === i)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
    return this.save({
      ...draft,
      projectId: this.store.projectId,
      id,
      sessionId: message.sessionId,
      messageId,
      promptMessageId: message.replyToId ?? null,
      goalId,
      basis: completeBasis,
      revision: 1,
      origin,
      original: draft,
      decision: 'Unreviewed',
      reason: '',
      verification: '',
      integratedNodeId: null,
      createdAt: date,
      updatedAt: date,
      history: [
        {
          at: date,
          action: origin === 'model' ? 'Model suggestion' : 'Researcher capture',
          reason: 'Not a verified result or an accepted advance.',
          revision: 1,
        },
      ],
    });
  }
  update(id: string, raw: unknown) {
    const input = z
      .object({
        revision: z.number().int(),
        draft: candidateDraftSchema,
        decision: z.enum(REVIEW_DECISIONS),
        reason: z.string().max(8000),
        verification: z.string().max(12000),
        refreshBasis: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    const c = this.get(id);
    if (input.revision !== c.revision)
      throw new Error('This candidate changed. Reload before reviewing it.');
    if (c.integratedNodeId)
      throw new Error(
        'This result is already integrated. Its original review is retained; update the project item or capture a new candidate.',
      );
    if (!this.message(c.messageId).content.includes(input.draft.sourceQuote))
      throw new Error('The source quote must be copied exactly from the reply.');
    for (const nodeId of [...input.draft.relatedNodeIds, ...(input.draft.premiseNodeIds ?? [])])
      this.store.getNode(nodeId);
    if (input.decision !== 'Unreviewed' && input.reason.trim().length < 15)
      throw new Error('Record a specific reason for this decision (at least 15 characters).');
    const next = {
      ...c,
      ...input.draft,
      premiseNodeIds:
        input.draft.premiseNodeIds ?? (c.legacyPremiseSelection ? (c.premiseNodeIds ?? []) : []),
      decision: input.decision,
      reason: input.reason,
      verification: input.verification,
      revision: c.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!input.refreshBasis) {
      const extra = [...input.draft.relatedNodeIds, ...(input.draft.premiseNodeIds ?? [])].filter(
        (id) => !c.basis.nodes.some((n) => n.id === id),
      );
      next.basis = {
        ...c.basis,
        nodes: [...c.basis.nodes, ...reviewBasis(this.store, this.program, c.goalId, extra).nodes]
          .filter((n, i, all) => all.findIndex((v) => v.id === n.id) === i)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      };
    }
    if (input.refreshBasis)
      next.basis = reviewBasis(this.store, this.program, c.goalId, [
        ...c.basis.nodes.map((n) => n.id),
        ...input.draft.relatedNodeIds,
        ...(input.draft.premiseNodeIds ?? []),
      ]);
    if (input.decision === 'Advance') this.validateAdvance(next);
    next.history = [
      ...c.history,
      {
        at: next.updatedAt,
        action: input.refreshBasis
          ? 'Review against current project'
          : `Researcher: ${input.decision}`,
        reason: input.reason,
        revision: next.revision,
      },
    ];
    return this.store.transaction(() => {
      if (
        this.message(c.messageId).role === 'assistant' &&
        ['Advance', 'Useful partial result'].includes(next.decision) &&
        this.message(c.messageId).turnReview?.decision !== 'Open'
      )
        this.chat.reviewTurn(c.messageId, {
          decision: 'Open',
          reason: 'A candidate was accepted; the per-result reviews now describe this reply.',
        });
      return this.save(next);
    });
  }
  private validateAdvance(c: Candidate) {
    if (['Unassessed', 'Restatement', 'Routine consequence'].includes(c.classification))
      throw new Error(
        'A restatement or routine consequence cannot be recorded as a nontrivial advance. Choose useful partial result or reformulation.',
      );
    if (claimKey(c.baseline) === claimKey(c.gain))
      throw new Error(
        'The before and after statements are equivalent as written. State the actual gain or classify it as a reformulation.',
      );
    for (const key of ['baseline', 'gain', 'mechanism', 'verification', 'reason'] as const)
      if (c[key].trim().length < 20)
        throw new Error(`An advance needs a concrete ${key} (at least 20 characters).`);
    if (this.stale(c))
      throw new Error(
        'The target or source context changed. Review against the current project before accepting an advance.',
      );
    if (this.duplicate(c))
      throw new Error(
        'This statement is already integrated. Repetition does not add another advance.',
      );
  }
  integrate(id: string, raw: unknown) {
    const input = z
      .union([
        z.object({ revision: z.number().int(), admitToProject: z.literal(true) }).strict(),
        // Compatibility for old clients: this is PRIVATE admission, never publication.
        z.object({ revision: z.number().int(), publishToProject: z.literal(true) }).strict(),
      ])
      .parse(raw);
    const c = this.get(id);
    if (c.revision !== input.revision)
      throw new Error('The reviewed version changed. Reload before adding it.');
    if (c.integratedNodeId)
      return { candidate: c, node: this.store.getNode(c.integratedNodeId), alreadyApplied: true };
    if (!['Advance', 'Useful partial result', 'Reformulation'].includes(c.decision))
      throw new Error(
        'Review this candidate as an advance, useful partial result, or reformulation first.',
      );
    if (this.stale(c))
      throw new Error('The source context changed. Review the current project first.');
    if (this.duplicate(c))
      throw new Error('This statement is already integrated; link to the existing result.');
    if (c.decision === 'Advance') this.validateAdvance(c);
    return this.store.transaction(() => {
      const source = this.message(c.messageId);
      const type =
        c.kind === 'Lemma'
          ? 'Lemma'
          : c.kind === 'Counterexample'
            ? 'Counterexample'
            : c.kind === 'Proof obligation'
              ? 'Open Question'
              : c.kind === 'Barrier'
                ? 'Note'
                : 'Claim';
      const node = this.store.createNode(
        {
          title: c.title,
          type,
          summary: c.gain.slice(0, 2000),
          content: `${c.statement}\n\n**Baseline**\n${c.baseline}\n\n**Proposed mechanism**\n${c.mechanism}\n\n**Recorded evidence**\n${c.evidence}\n\n**Researcher check**\n${c.verification}\n\n**Still unresolved**\n${c.gap}\n\n**Next check**\n${c.nextCheck}`,
          epistemicStatus: 'Unverified',
          humanVerified: false,
          originType:
            source.role === 'user'
              ? 'Human'
              : source.provider === 'openai'
                ? 'AI agent'
                : 'AI-extracted',
          originName:
            source.role === 'user'
              ? source.provider === 'user'
                ? 'Researcher observation'
                : 'Supplied human observation; authorship unverified'
              : source.provider === 'openai'
                ? 'GPT reply reviewed in notebook'
                : 'Supplied assistant transcript; authorship unverified',
          provenanceText: `Session ${c.sessionId}; reply ${c.messageId}; candidate ${c.id}; review revision ${c.revision}; capture method ${c.origin}; source provider ${source.provider}.\nExact source: ${c.sourceQuote}\nResearcher decision: ${c.decision}. ${c.reason}`,
          tags: ['notebook-result', c.kind],
        },
        'Researcher added a reviewed notebook result; mathematical validity remains unverified.',
      );
      for (const targetNodeId of c.premiseNodeIds ?? [])
        this.store.createEdge({
          sourceNodeId: node.id,
          targetNodeId,
          edgeType: 'depends_on',
          explanation:
            'Explicit premise selected in the notebook review; requires independent checking.',
        });
      for (const targetNodeId of c.relatedNodeIds.filter(
        (id) => !(c.premiseNodeIds ?? []).includes(id),
      ))
        this.store.createEdge({
          sourceNodeId: node.id,
          targetNodeId,
          edgeType: 'related_to',
          explanation: 'Related notebook context; no logical premise or support is asserted.',
        });
      if (c.goalId) {
        const goal = this.program.getGoal(c.goalId);
        this.program.updateGoal(goal.id, {
          ...goal,
          linkedNodeIds: [...new Set([...goal.linkedNodeIds, node.id])],
        });
      }
      this.program.saveAssessment(node.id, {
        classification: c.classification,
        before: c.baseline,
        after: c.gain,
        mechanism: c.mechanism,
        check: c.verification || c.nextCheck,
        verdict: 'Unreviewed',
        reviewer: 'Notebook review; proof verification remains outstanding',
      });
      this.onAdmit?.(c, node);
      const date = new Date().toISOString();
      const integrated = {
        ...c,
        integratedNodeId: node.id,
        integratedHash: integratedFingerprint(this.store, node.id),
        updatedAt: date,
        history: [
          ...c.history,
          {
            at: date,
            action: 'Admitted to private research record',
            reason: c.reason,
            revision: c.revision,
          },
        ],
      };
      this.save(integrated);
      return { candidate: integrated, node, alreadyApplied: false };
    });
  }
}
