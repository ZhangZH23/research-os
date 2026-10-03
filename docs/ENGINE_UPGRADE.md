# Research State Engine implementation record

This upgrade extends the existing notebook, provenance checks, cloud CAS, and mathematical rendering. It does not replace those foundations or certify arbitrary mathematics. Work was performed in an isolated local worktree from GitHub commit `572ee6d`. The live website, production research data, connection secrets and hosting settings were not changed.

## Baseline and architecture

Before implementation: typecheck passed; 95 tests passed; production build passed; the six cloud regression tests passed. Locked dependencies were retained. Two old workbench test expectations changed intentionally: a reviewed reformulation may be privately retained, and private admission no longer requires publication consent. Their atomicity and privacy checks remain.

- The Worker/D1 preview on port 4312 is the supported complete application. The older Express regression API remains available separately; it does not implement the new interface.
- Project identity is injected into every domain store and captured by per-tab API clients. New projects are empty/private. Owner authorization remains independent of project scoping.
- Sources, claim/definition/goal revisions, routes, evidence, reviews, checks, proposals, commits and runs persist as individual records in the existing D1 per-record repository. Object pointers and project heads are mutable projections; semantic history is retained.
- The source-grounded proposal loop is connected to checks, human admission review, atomic idempotent commits, diffs and revision inspection. Admission, mathematical endorsement, goal satisfaction and publication are separate actions.
- Legacy writes preserve original tables and create revision history. Explicit resumable migration captures initial revisions and the already public snapshot without inventing missing proof artifacts. New private revisions cannot mutate a publication.
- Pure support evaluation distinguishes independent OR routes and AND premises, unsupported cycles, conditional deductions, disagreement, current applicability and historical support.

## Requirements and evidence

| Area                | Implemented evidence                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project isolation   | `tests/project-scope.test.ts`; immutable scoped client closures; actual anonymous HTTP allowlist and project-list checks                                   |
| Exact provenance    | UTF-16/surrogate/CRLF fixtures; nested contract provenance validation; immutable source hashes; private import tamper rejection                            |
| Revision history    | Domain tests for statement/definition changes and exact historical reviews; actual HTTP revision and diff workflow                                         |
| Support             | 48 labeled synthetic semantic fixtures and generated invariants; alternative routes, cycles, retractions, conflicting reviews, obligation reopening        |
| Checked changes     | Domain tests for read sets, base commits, subset dependencies, trusted check binding, repeated commit idempotency and atomic rollback                      |
| Publication privacy | Frozen snapshot tests; actual HTTP anonymous access test; browser preview with a distinct private source marker                                            |
| Persistence         | Fresh SQLite/D1 reconstruction; CAS and late-save rollback; resumable 205-node and 900-edge migrations                                                     |
| Continuity          | Older relevant failures; bounded engine context reaches actual provider request in controlled tests; durable prompt/run/output linkage and restart         |
| Export/import       | Fresh private identity, reference remapping, exact source preservation, imported trust downgrade, inactive imported publications, rejection/rollback tests |
| Interface           | Actual browser capture → propose → check → admission review → commit → revision inspector → publication preview/save; math visually inspected              |
| Evaluation          | 48 synthetic fixtures plus seven integration mappings; measured 1,200-claim/6,000-record benchmark; A/B/C live evaluation `not_run`                        |

See [the walkthrough](ENGINE_DEMO.md) for exact reproduction and the distinction between browser, HTTP, controlled-provider and storage tests. A fixture catalog or implemented control alone is not evidence that an entire UI walkthrough was executed.

## Actual validation

Final post-hardening validation: `pnpm check` passed; `pnpm test` passed **216/216 tests** with zero skips or failures; `pnpm build` passed for the client and Worker; `pnpm test:cloud` passed **6/6** existing cloud regressions (also included in the full suite). The new engine domain suite passed **33/33**, and four additional engine cloud tests passed. The client emitted a non-fatal warning about a bundle larger than 500 kB. Locked dependency installation also passed.

The synthetic HTTP acceptance script exercised two separate projects, an exact goal, arbitrary→random scope warning, restricted admission without goal closure, evidence attachment without another claim, two independently reviewed routes, retraction with the alternative surviving, revision history, a source-linked diff, relevant failed-attempt retrieval, a new session, and fixed publication privacy. Direct anonymous requests also rejected private engine/notebook access, hid the other project, and returned frozen public title/content. After stopping the preview process completely and starting the final build, `scripts/engine-acceptance.ts --verify test-results/engine-acceptance.json` reproduced the same record fingerprints, checks, history, project isolation and public snapshot. The complete HTTP acceptance workflow was then rerun successfully on the final build, including anonymous access assertions.

The local migration maintenance command was actually run in dry-run mode, then with a private backup path, against the illustrative local project: 17 nodes, four goals and 18 relationships were preserved and migration reached zero remaining items. No production migration ran.

The measured benchmark used the real SQL.js bridge for 6,000 normalized records at 1,200 claims. Median reconstruction was 44.211 ms, snapshot 31.332 ms, JSON decoding 13.858 ms and pure support evaluation 49.183 ms on the reported Apple M2 environment. These are synthetic local timings, not network/D1 or researcher productivity measurements. See [raw results and protocol](EVALUATION.md).

## Capability inventory

**Implemented:** the private project-scoped capture/review/commit loop; source-preserving human notes and conversation import; immutable revisions; typed evidence and routes; revision-bound attributed review; AND/OR support and conflict explanations; explicit goal mappings; conservative scope/runtime/repetition checks; exact bounded prime-field rank; deterministic diffs; frozen public selection; local backup/dry-run/migration; bounded project import/export; GPT context manifests, durable visible-output runs and imported checkpoints.

**Deliberately limited or partial:** advanced contracts and multi-operation proposals use structured editors; old graph actions remain compatibility captures rather than reconstructing missing proof arguments; exact-text duplicate detection cannot detect arbitrary equivalent mathematics; a changed base commit conservatively requires renewed proposal review; checking fragments do not cover all mathematical expressions; local GPT runs are individual visible requests, while multi-hour external work is represented through supplied checkpoints. There is no autonomous run scheduler, multi-provider execution adapter beyond the existing OpenAI transport, or bulk import beyond 900,000 UTF-8 bytes/700 combined records. Large private exports remain valid backups even when they exceed this bounded copy-import interface. The full twelve-step workflow has HTTP/storage coverage; browser execution covers the recorded interface steps, not every advanced mathematical review combination.

**Unsupported:** universal theorem verification, autonomous Lean formalization, arbitrary-code execution, literature-novelty certification, enterprise multi-user editing, and claimed researcher productivity gains. No live model comparison or real researcher annotation study has been run. All bundled mathematical acceptance examples are explicitly synthetic.

## Upload and deployment boundary

The user authorized uploading this source to `ZhangZH23/research-os`; its visibility is public. Only source, documentation and synthetic fixtures belong in that upload. Local databases, backups, credentials, dependencies and generated browser artifacts stay ignored. GitHub upload does not publish the upgraded website. Hosted deployment and production migration remain separate work.

## Hosted deployment update — October 2, 2026 (Pacific)

Following the implementation and upload recorded above, the user authorized deploying the newest platform. [Research OS](https://research-os-zhangzh23.zzh19980830.chatgpt.site) is now running the Research State Engine 0.4 upgrade. The Sites deployment of hosted version **4** succeeded on October 3, 2026 UTC (October 2 in Pacific time), using Site source commit `8be2206a07e1922d13a32bbf17ecea2b4bfcf87a`. The publication workflow passed the locked dependency installation, typecheck, all **216/216 tests**, and the client/Worker build before publishing. The existing non-fatal client bundle-size warning remains.

The existing public audience, configured owner identity and connection secret were preserved. The owner signs in to use private Research State, notebook conversations and GPT. Kai and other visitors may open the same public link to read published research; that link does not grant editing or access to the owner's private workbench.

After publication, the owner-authenticated **Download private backup → Migrate this project** flow completed for the existing hosted project. A complete export and a storage snapshot of all 110 original records were saved locally outside Git; their data parsed successfully and passed the SQLite foreign-key check. Migration preserved the legacy graph, goals, assessments, conversations and events, and added 21 research objects (17 legacy nodes and 4 goals), 18 descriptive relations, and the first commit. Existing public material remains a frozen legacy snapshot; new revisions stay private until explicitly published. The hosted UI confirmed migration completion and enabled source capture and proposed changes. The earlier statements that production was unchanged and no production migration ran describe the implementation phase, before this deployment.
