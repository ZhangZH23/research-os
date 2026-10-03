# Research State Engine: guarantees and boundaries

The engine maintains attributed, revision-aware research records and checks explicit invariants. It helps inspect changes and avoid certain classes of mistakes. It does not certify arbitrary mathematics, literature novelty, or publishability.

## Separate decisions

Admission, mathematical argument review, empirical support, project-relative novelty, methodological usefulness, relevance to a goal, review currentness, and publication are separate records/actions. An admitted conjecture remains open. An equivalent or repeated statement may gain a useful method or additional evidence without becoming another theorem. A failed proof attempt does not falsify a conjecture, and failure of one route does not make a goal impossible. There is no universal research-progress or truth-probability score.

Stable research objects point to immutable exact revisions. Definitions and goals are versioned too. Sources retain original text, attribution metadata, and immutable hashes; extracted spans use original UTF-16 offsets. Each semantic revision retains its parent, structured partial contract, exact source references, and content fingerprint. Missing structure remains unknown. Historical Proved/humanVerified labels are preserved as legacy assertions, without invented proof artifacts.

Arguments bind exact premise and conclusion revisions. Evidence, server-executed checks, human reviews, and external execution reports remain distinct. A human review is an attributed judgment, not a formal certificate. Imported/model records cannot impersonate the owner or create trusted checker execution.

## Support and goals

Proof routes have AND premises and OR alternatives. The pure evaluator computes a terminating least fixed point. All premises and the inference itself need current, bound support. Open premises and local assumptions keep a route conditional. Unseeded cycles cannot manufacture support; a legitimate independent entry is retained. Argument retraction/challenge affects that route; another independent route may survive. Conflicting statement reviews remain visible and withhold an unsupported established summary.

A review for an old statement does not support a changed revision. Changed definitions and premise revisions invalidate current applicability while historical arguments remain inspectable. Goal completion requires a separate human-reviewed mapping from each goal criterion to exact currently supported results. Linking a lemma or accepting a notebook candidate is not goal completion.

See `CHECKERS.md` for the supported quantifier, scope, assumption, runtime-dependency, repetition, witness, and bounded prime-field rank fragments. A compatibility pass is never a proof pass. Unknown variable meanings/domains, missing structure, unsupported expression comparisons, and unverified witness declarations retain explicit limitations.

## Atomic changes and persistence

Source capture precedes typed proposed changes. Deterministic checks bind to the exact proposal version. Human admission review precedes a semantic commit. Commit validation repeats scoped references, source integrity, exact read-set/current revision checks, selected-operation dependencies, and review/check binding. Repeated idempotency keys recover the same reviewed commit. Validation, storage, and concurrency failures cannot legitimately leave half a semantic transaction.

The existing SQLite/D1 architecture is retained. Semantic records use normalized `engine_records` rows, not one growing whole-project JSON document. Request-local SQLite reconstruction and snapshots register these records. Storage CAS and semantic read-set checks solve different problems. The current adapter still loads a whole workspace; this cost is measured rather than hidden.

Migration is explicit and additive, with backup/export and a resumable report. Legacy dependencies remain attributed dependency assertions with unestablished inference validity. No absent historical revisions or proofs are fabricated. Revisions are immutable; archival/retraction is recorded separately. Legitimate privacy redaction still requires an intentional owner procedure rather than a false claim that append-only records can never be removed.

## Private admission and public snapshots

New projects are private and isolated. Project selection is carried on each request; it is not a global mutable session setting. Cross-project references are rejected. Human notes, notebook messages, sources, runs, reviewer notes, and private revisions do not become public through graph links.

Publication uses an exact selected-revision preview and a separate explicit action. Later private revisions do not update that public snapshot. Public response allowlists use frozen publication data and omit private linked research. Previewing text is the researcher's disclosure decision; the system does not claim to detect every sensitive sentence automatically. Site authentication and model API credentials are separate. The existing owner-only authorization and localhost-only preview mode remain in force.

## GPT continuity and run boundaries

`ChatStore` accepts provider-neutral research hooks without importing the engine service. The Worker supplies the actual engine hooks. Before a configured model request, the chat workflow captures a bounded engine context packet, exact manifest, base commit, read set, question, progress criterion, session/message linkage, and provider/model configuration. The visible prompt and run intent are persisted together before the paid request.

The model receives the immutable engine packet in addition to the bounded existing notebook context. Selected contracts stay intact; omitted revisions are explicit. Old relevant failures, constraints, route dependencies, and open obligations can be carried into the next turn. These are research data, not instructions or proof certificates. Context is bounded and retrieval is lexical/dependency based; it is not unlimited memory or mathematical equivalence search.

Visible replies and run checkpoints finish in the same transaction. Controlled provider tests verify prompt-before-call persistence, stable run IDs, actual model input, ambiguous and incomplete outcomes, no-key behavior, and answer preservation if a first completion write fails. A model timeout/network loss is marked ambiguous and is **not automatically resubmitted** as a paid request. An incomplete visible answer remains available without admitting changes. A local no-key worksheet is explicitly labeled as local and is not a GPT execution. Finishing generation does not complete the research goal.

A browser request is not a durable multi-hour scheduler. Only visible output/checkpoints are recorded; hidden chain of thought is unavailable and is not claimed. External-run imports remain attributed untrusted execution reports. No arbitrary model-generated shell code is executed by the Worker.

## What was measured

The synthetic kernel catalog contains 48 focused structured cases, with additional property and integration tests. The integration catalog separately maps persistence, project binding, idempotency, rollback, publication isolation, retrieval, and restart cases to real test names. Synthetic fixtures are engineering tests, not expert-annotated real research or empirical product superiority.

`engine-scale-results.json` measures 1,200 revisions in a sparse synthetic chain and 6,000 normalized SQLite records on Node v24.19.0 / Apple M2. The real request-local SQL.js bridge was measured: median reconstruction 44.211 ms, snapshot 31.332 ms, read/decoding 13.858 ms, and subsequent support evaluation 49.183 ms. D1/network, browser performance, and 100,000-claim scale were not measured. Some scans remain quadratic.

All live A/B/C model-comparison arms remain **not_run**. `scripts/engine-evaluate.ts` can score supplied, attributed visible artifacts while checking model comparability and reporting budgets, false promotions, missed updates, stale-support detection, grounding, and measured reviewer workload. It does not invent model trials or researcher preferences. See `EVALUATION.md` for the reproducible protocol and permissioned-data contribution process.
