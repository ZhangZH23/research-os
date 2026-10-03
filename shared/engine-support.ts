import type {
  EngineData,
  EvidenceArtifact,
  ProofRoute,
  ResearchRevision,
  ReviewRecord,
} from './engine';

export interface RevisionSupport {
  revisionId: string;
  status:
    | 'reviewed_support'
    | 'conditional'
    | 'open'
    | 'conflict'
    | 'challenged'
    | 'historical'
    | 'stale';
  current: boolean;
  supported: boolean;
  historicallySupported: boolean;
  supportingRouteIds: string[];
  reviewIds: string[];
  explanations: string[];
}
export interface RouteSupport {
  routeId: string;
  status:
    | 'usable'
    | 'conditional'
    | 'unreviewed'
    | 'retracted'
    | 'conflict'
    | 'stale'
    | 'invalid_reference';
  openPremiseRevisionIds: string[];
  explanations: string[];
}
export interface SupportEvaluation {
  revisions: Record<string, RevisionSupport>;
  routes: Record<string, RouteSupport>;
  conflicts: string[];
  openObligationIds: string[];
  limitations: string[];
}
type SupportData = Pick<EngineData, 'objects' | 'revisions' | 'routes' | 'reviews' | 'evidence'> &
  Partial<Pick<EngineData, 'obligations' | 'checks'>>;
const order = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Only explicit supersession by the same human and for the same target/scope retires a judgment.
 * Different reviewers never overwrite one another merely because one timestamp is newer. */
export function activeHumanReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  const humans = reviews.filter((r) => r.trust === 'human');
  const byId = new Map(humans.map((r) => [r.id, r]));
  const superseded = new Set<string>();
  for (const r of humans) {
    const old = r.supersedes ? byId.get(r.supersedes) : undefined;
    if (
      old &&
      old.actor === r.actor &&
      old.targetId === r.targetId &&
      old.scope === r.scope &&
      old.projectId === r.projectId &&
      old.id !== r.id &&
      old.createdAt <= r.createdAt
    )
      superseded.add(old.id);
  }
  return humans.filter((r) => !superseded.has(r.id)).sort(order);
}

/** Terminating AND/OR least fixed point. It reports attributed support, never formal truth. */
export function evaluateSupport(data: SupportData): SupportEvaluation {
  const objects = new Map(data.objects.map((o) => [o.id, o]));
  const revisions = new Map(data.revisions.map((r) => [r.id, r]));
  const evidence = new Map(data.evidence.map((e) => [e.id, e]));
  const reviews = activeHumanReviews(data.reviews);
  const reviewsByTarget = new Map<string, ReviewRecord[]>();
  for (const r of reviews)
    reviewsByTarget.set(r.targetId, [...(reviewsByTarget.get(r.targetId) ?? []), r]);
  const targetReviews = (id: string, projectId: string, scope: ReviewRecord['scope']) =>
    (reviewsByTarget.get(id) ?? []).filter((r) => r.projectId === projectId && r.scope === scope);
  const ownCurrent = (r: ResearchRevision) => {
    const o = objects.get(r.objectId);
    return !!o && o.projectId === r.projectId && !o.archived && o.currentRevisionId === r.id;
  };
  const validRevision = (
    r: ResearchRevision | undefined,
    projectId: string,
  ): r is ResearchRevision =>
    !!r && r.projectId === projectId && objects.get(r.objectId)?.projectId === projectId;
  const definitionErrors = new Map<string, string[]>();
  const definitionReady = new Set<string>();
  const definitionWaiting = new Map<string, string[]>();
  const definitionRemaining = new Map<string, Set<string>>();
  const definitionQueue: string[] = [];
  for (const r of data.revisions) {
    const errors: string[] = [];
    for (const id of r.definitionRevisionIds) {
      const d = revisions.get(id);
      if (!validRevision(d, r.projectId) || objects.get(d.objectId)?.kind !== 'definition')
        errors.push(`Missing or cross-project definition revision ${id}.`);
      else if (!ownCurrent(d))
        errors.push(`Definition ${id} is no longer the current definition revision.`);
    }
    definitionErrors.set(r.id, errors);
    definitionRemaining.set(r.id, new Set(r.definitionRevisionIds));
    if (!errors.length && !r.definitionRevisionIds.length) {
      definitionReady.add(r.id);
      definitionQueue.push(r.id);
    }
    for (const id of r.definitionRevisionIds)
      definitionWaiting.set(id, [...(definitionWaiting.get(id) ?? []), r.id]);
  }
  for (let i = 0; i < definitionQueue.length; i++)
    for (const id of definitionWaiting.get(definitionQueue[i]) ?? []) {
      const remaining = definitionRemaining.get(id)!;
      remaining.delete(definitionQueue[i]);
      if (!remaining.size && !definitionErrors.get(id)!.length && !definitionReady.has(id)) {
        definitionReady.add(id);
        definitionQueue.push(id);
      }
    }
  for (const r of data.revisions)
    if (!definitionReady.has(r.id) && !definitionErrors.get(r.id)!.length)
      definitionErrors
        .get(r.id)!
        .push(
          `Definitions are circular or depend on changed/unresolved revisions: ${[...definitionRemaining.get(r.id)!].join(', ')}.`,
        );
  const currentlyApplicable = (r: ResearchRevision) =>
    ownCurrent(r) && !definitionErrors.get(r.id)?.length;
  const bound = (review: ReviewRecord, rid: string) => review.targetRevisionIds.includes(rid);
  const evidenceActive = (e: EvidenceArtifact) =>
    !targetReviews(e.id, e.projectId, 'mathematical').some(
      (r) =>
        (r.decision === 'retract' || r.decision === 'challenge') && bound(r, e.targetRevisionId),
    );
  const positiveEvidence = (e: EvidenceArtifact | undefined, r: ResearchRevision): boolean =>
    !!e &&
    e.projectId === r.projectId &&
    e.targetRevisionId === r.id &&
    evidenceActive(e) &&
    e.content.trim().length > 0 &&
    ['proof_attempt', 'paper_passage', 'formal_artifact', 'human_argument'].includes(e.kind);
  const direct = new Map<string, ReviewRecord[]>();
  const challenged = new Set<string>();
  const retracted = new Set<string>();
  for (const r of data.revisions) {
    const rr = targetReviews(r.id, r.projectId, 'mathematical').filter((x) => bound(x, r.id));
    const validEndorsements = rr.filter(
      (x) =>
        x.decision === 'endorse' &&
        x.evidenceIds.some((eid) => positiveEvidence(evidence.get(eid), r)),
    );
    // Reviewing an argument artifact can support only its exact targeted revision.
    for (const e of data.evidence.filter(
      (e) => e.targetRevisionId === r.id && e.projectId === r.projectId,
    )) {
      const er = targetReviews(e.id, r.projectId, 'mathematical').filter((x) => bound(x, r.id));
      if (
        e.kind === 'counterexample_witness' &&
        evidenceActive(e) &&
        er.some((x) => x.decision === 'endorse')
      )
        challenged.add(r.id);
      if (positiveEvidence(e, r))
        validEndorsements.push(...er.filter((x) => x.decision === 'endorse'));
    }
    if (rr.some((x) => x.decision === 'challenge')) challenged.add(r.id);
    if (rr.some((x) => x.decision === 'retract')) retracted.add(r.id);
    direct.set(r.id, validEndorsements);
  }
  const routeMetadata = new Map<
    string,
    {
      route: ProofRoute;
      reviewed: boolean;
      conflict: boolean;
      retracted: boolean;
      invalid: string[];
      stale: string[];
      reviewIds: string[];
    }
  >();
  for (const route of [...data.routes].sort(order)) {
    const conclusion = revisions.get(route.conclusionRevisionId);
    const premises = route.premiseRevisionIds.map((id) => revisions.get(id));
    const invalid: string[] = [];
    if (!validRevision(conclusion, route.projectId))
      invalid.push('The conclusion revision is missing or outside this project.');
    route.premiseRevisionIds.forEach((id, i) => {
      if (!validRevision(premises[i], route.projectId))
        invalid.push(`Premise ${id} is missing or outside this project.`);
    });
    const argument = route.evidenceId ? evidence.get(route.evidenceId) : undefined;
    if (
      route.evidenceId &&
      (!argument ||
        argument.projectId !== route.projectId ||
        argument.targetRevisionId !== route.conclusionRevisionId)
    )
      invalid.push('The argument evidence does not bind to this conclusion in this project.');
    const rr = targetReviews(route.id, route.projectId, 'inference').filter(
      (r) =>
        bound(r, route.conclusionRevisionId) &&
        route.premiseRevisionIds.every((id) => bound(r, id)),
    );
    const endorsed = rr.some(
      (r) =>
        r.decision === 'endorse' && !!route.evidenceId && r.evidenceIds.includes(route.evidenceId),
    );
    const challenge =
      rr.some((r) => r.decision === 'challenge') ||
      (!!argument &&
        targetReviews(argument.id, route.projectId, 'mathematical').some(
          (r) => r.decision === 'challenge' && bound(r, route.conclusionRevisionId),
        ));
    const retract =
      rr.some((r) => r.decision === 'retract') ||
      (!!argument &&
        targetReviews(argument.id, route.projectId, 'mathematical').some(
          (r) => r.decision === 'retract' && bound(r, route.conclusionRevisionId),
        ));
    const stale = [
      ...(conclusion && !currentlyApplicable(conclusion)
        ? [`Conclusion ${conclusion.id} or its definitions are no longer current.`]
        : []),
      ...premises.flatMap((p) =>
        p && !currentlyApplicable(p)
          ? [`Premise ${p.id} or its definitions are no longer current.`]
          : [],
      ),
    ];
    routeMetadata.set(route.id, {
      route,
      reviewed: endorsed && !!argument && !!conclusion && positiveEvidence(argument, conclusion),
      conflict: challenge,
      retracted: retract,
      invalid,
      stale,
      reviewIds: rr.map((r) => r.id),
    });
  }
  // A conflict anywhere on a premise blocks routes using that premise, without falsifying conclusions.
  const blocked = (id: string) => challenged.has(id) || retracted.has(id);
  const historical = new Set<string>();
  const current = new Set<string>();
  for (const r of data.revisions)
    if (!blocked(r.id) && (direct.get(r.id)?.length ?? 0) > 0) {
      historical.add(r.id);
      if (currentlyApplicable(r)) current.add(r.id);
    }
  const runFixedPoint = (supported: Set<string>, currentOnly: boolean) => {
    const usable = [...routeMetadata.values()].filter(
      (m) =>
        m.reviewed &&
        !m.conflict &&
        !m.retracted &&
        !m.invalid.length &&
        !m.route.localAssumptions.length &&
        !blocked(m.route.conclusionRevisionId) &&
        (!currentOnly || !m.stale.length),
    );
    const waiting = new Map<string, typeof usable>();
    const remaining = new Map<string, Set<string>>();
    const queue: string[] = [];
    const add = (id: string) => {
      if (!supported.has(id)) {
        supported.add(id);
        queue.push(id);
      }
    };
    for (const m of usable) {
      const open = new Set(m.route.premiseRevisionIds.filter((id) => !supported.has(id)));
      remaining.set(m.route.id, open);
      if (!open.size) add(m.route.conclusionRevisionId);
      for (const id of open) waiting.set(id, [...(waiting.get(id) ?? []), m]);
    }
    for (let i = 0; i < queue.length; i++)
      for (const m of waiting.get(queue[i]) ?? []) {
        const open = remaining.get(m.route.id)!;
        open.delete(queue[i]);
        if (!open.size) add(m.route.conclusionRevisionId);
      }
  };
  runFixedPoint(historical, false);
  runFixedPoint(current, true);
  const result: SupportEvaluation = {
    revisions: {},
    routes: {},
    conflicts: [],
    openObligationIds: [],
    limitations: [
      'Support means attributed human argument review with exact revision binding, not machine certification of arbitrary mathematics.',
      'Finite experiments and imported execution reports do not seed unrestricted proof support.',
      'A nonempty local-assumption list remains conditional; this engine does not prove or discharge arbitrary assumptions.',
    ],
  };
  for (const m of routeMetadata.values()) {
    const open = m.route.premiseRevisionIds.filter((id) => !current.has(id));
    const explanations = [...m.invalid, ...m.stale];
    let status: RouteSupport['status'];
    if (m.invalid.length) status = 'invalid_reference';
    else if (m.retracted) {
      status = 'retracted';
      explanations.push(
        'An attributed retraction removes this route’s support; it does not refute the conclusion.',
      );
    } else if (m.conflict) {
      status = 'conflict';
      explanations.push(
        'A reviewer challenges the inference; separate endorsements remain visible.',
      );
      result.conflicts.push(m.route.id);
    } else if (m.stale.length) status = 'stale';
    else if (!m.reviewed) {
      status = 'unreviewed';
      explanations.push(
        'The inference lacks an exact, human-reviewed argument artifact. Premise edges alone are not a proof.',
      );
    } else if (open.length || m.route.localAssumptions.length) {
      status = 'conditional';
      if (open.length)
        explanations.push(
          `Open or unsupported premises: ${open.join(', ')}. A cycle cannot provide its own initial support.`,
        );
      if (m.route.localAssumptions.length)
        explanations.push(
          `Undischarged local assumptions: ${m.route.localAssumptions.join('; ')}.`,
        );
    } else {
      status = 'usable';
      explanations.push(
        'Every conjunctive premise has current reviewed support and this inference has a version-bound human review.',
      );
    }
    result.routes[m.route.id] = {
      routeId: m.route.id,
      status,
      openPremiseRevisionIds: open,
      explanations,
    };
  }
  for (const r of [...data.revisions].sort(order)) {
    const options = [...routeMetadata.values()].filter(
      (m) => m.route.conclusionRevisionId === r.id,
    );
    const positive =
      (direct.get(r.id)?.length ?? 0) > 0 || options.some((m) => m.reviewed && !m.retracted);
    const conflict = challenged.has(r.id) && positive;
    let status: RevisionSupport['status'] = 'open';
    const explanations = [...(definitionErrors.get(r.id) ?? [])];
    if (conflict) {
      status = 'conflict';
      result.conflicts.push(r.id);
      explanations.push(
        'Positive support and a challenge coexist. Neither is overwritten; the conclusion is withheld from current support.',
      );
    } else if (challenged.has(r.id)) {
      status = 'challenged';
      explanations.push(
        'An attributed challenge or reviewed counterexample needs scope review. This is not automatic falsity.',
      );
    } else if (!ownCurrent(r)) {
      status = 'historical';
      explanations.push(
        'This is a historical revision; its argument and reviews remain attached to this exact statement.',
      );
    } else if (definitionErrors.get(r.id)?.length) {
      status = 'stale';
    } else if (current.has(r.id)) {
      status = 'reviewed_support';
      explanations.push(
        'Current support is based on attributed human review, not an automatic proof certificate.',
      );
    } else if (
      options.some((m) => m.reviewed && !m.retracted && !m.conflict && !m.invalid.length)
    ) {
      status = 'conditional';
      explanations.push(
        'At least one reviewed route still has open premises, local assumptions, or changed applicability.',
      );
    } else explanations.push('Admission and source grounding do not establish this statement.');
    if (retracted.has(r.id))
      explanations.push(
        'An attributed retraction removes present support without erasing historical records or asserting the statement is false.',
      );
    result.revisions[r.id] = {
      revisionId: r.id,
      status,
      current: currentlyApplicable(r),
      supported: current.has(r.id),
      historicallySupported: historical.has(r.id),
      supportingRouteIds: options
        .filter((m) => result.routes[m.route.id]?.status === 'usable')
        .map((m) => m.route.id),
      reviewIds: [
        ...new Set([
          ...(direct.get(r.id) ?? []).map((x) => x.id),
          ...targetReviews(r.id, r.projectId, 'mathematical').map((x) => x.id),
        ]),
      ].sort(),
      explanations,
    };
  }
  result.openObligationIds = (data.obligations ?? [])
    .filter((o) => {
      const rr = o.resolutionReviewId
        ? reviews.find((r) => r.id === o.resolutionReviewId)
        : undefined;
      const judgments = targetReviews(o.id, o.projectId, 'goal_satisfaction').filter((r) =>
        bound(r, o.targetRevisionId),
      );
      const disputed = judgments.some((r) => r.decision === 'challenge');
      if (disputed && judgments.some((r) => r.decision === 'endorse')) result.conflicts.push(o.id);
      return (
        disputed ||
        judgments.some((r) => r.decision === 'retract') ||
        !o.resolutionRevisionId ||
        !current.has(o.resolutionRevisionId) ||
        !rr ||
        rr.decision !== 'endorse' ||
        rr.scope !== 'goal_satisfaction' ||
        rr.projectId !== o.projectId ||
        rr.targetId !== o.id ||
        !rr.targetRevisionIds.includes(o.targetRevisionId) ||
        !rr.targetRevisionIds.includes(o.resolutionRevisionId) ||
        !revisions.has(o.targetRevisionId) ||
        !currentlyApplicable(revisions.get(o.targetRevisionId)!)
      );
    })
    .map((o) => o.id)
    .sort();
  result.conflicts = [...new Set(result.conflicts)].sort();
  return result;
}
