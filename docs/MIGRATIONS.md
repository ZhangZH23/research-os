# Storage, migration and compatibility

The supported full application is the Worker/D1 preview on port 4312. The legacy Express server remains a compatibility API, not a second implementation of the engine. Existing local files and the live hosted workspace are separate stores; they do not synchronize implicitly.

## Two schema layers

`server/research-engine.ts` adds a versioned `engine_records` domain table, indexed by project and record kind. `cloud/sqlite.ts` registers the collection and reconstructs it alongside the existing domain tables. These tables exist inside each request-local SQLite instance.

Persistent D1 already uses `research_records(collection,id,position,payload)`, guarded by `workspace_revision`. Consequently this upgrade needs a new registered collection but no additional persistent D1 table or production schema DDL in a request handler. Sources, revisions, routes, reviews, checks, proposals, commits and runs are individual records, not one ever-growing project blob.

## Before migration

Stop editing the selected project. Download **Research State → Download private backup**. The export includes the selected project's engine records and original legacy research/notebook records, excluding connection credentials. Preserve a deployment-level database backup separately when changing a hosted version.

Read the migration report. New projects start empty/private and are already initialized. Existing legacy projects require an explicit apply action; merely visiting the app does not backfill history. Old editing routes are blocked until the selected project's migration is complete.

For local maintenance:

```sh
pnpm engine:migrate --project PROJECT_ID
pnpm engine:migrate --project PROJECT_ID --apply --backup /absolute/path/backup.json
```

The first command reports without applying a migration. The second requires a previously nonexistent backup path, writes the backup first, and then applies bounded chunks. The client refuses hosted URLs. It does not deploy or modify production secrets.

## Resumption and meaning

Each chunk maps at most 100 legacy items. Original IDs remain in `legacyNodeId`, `legacyGoalId`, and `legacyEdgeId`; each current legacy statement receives an initial immutable revision and an exact source artifact. Existing assertions such as a historical verified label remain attributed assertions. Missing proofs, original intermediate versions and absent source passages are not invented.

The migration marks the project ready only when nodes, goals and relationships have all been mapped. Original conversations, candidates, judgments, events and drafts remain in their original scoped tables. They are not reinterpreted as new proof endorsements. Already public material is preserved in individual frozen public records and an explicit legacy-publication marker. During a partial migration, the original public projection remains available while writes are blocked. Later private edits cannot mutate the completed public snapshot.

Every chunk is a database transaction and an atomic D1 save. A failed chunk is rolled back; successful earlier chunks remain. Refresh the report and resume. Rerunning after completion is idempotent. Do not reset migration records or delete legacy data to force a retry.

## Export and import trust

Private export is project-scoped and authenticated. Public export contains only active, selected publication text and frozen publication metadata. An unpublished project's metadata is unavailable through public export.

Import creates a new private identity and remaps internal references; it never overwrites an existing project. Imported reviews/checks and execution reports are historical external assertions, not trusted local human actions or checker executions. Imported publications remain inactive. Fresh local checks/reviews are needed before stronger actions. Exact source text is preserved; reference-dependent revision hashes are recomputed after remapping.

Private imports are limited to 900,000 UTF-8 bytes and 700 combined engine and legacy records per transaction, below the storage save limit. The UI/API enforce these explicit payload and record bounds. Oversized imports fail instead of silently truncating. For larger archives retain the original backup and use a separately reviewed resumable import; there is no automatic bulk import service in this release. An export preserves research records but is not a replacement for a full storage backup when recovering server configuration or transaction metadata.

## Conflicts and recovery

Storage revision guards reject stale writers atomically. Independently, proposals bind exact revision/hash reads and a base project commit; a changed base requires a new proposal and renewed review. This is deliberately conservative: even an unrelated intervening semantic commit can require refresh. Stable idempotency keys prevent a committed action from being applied twice.

Long model calls persist the prompt/run first, then reload before appending a reply. Visible text survives invalid structured output. Interrupted or ambiguous execution is recorded without silently issuing another paid request. Imported checkpoint IDs cannot replace different source text.

The full workspace still loads into request-local SQLite. Benchmarks describe its measured cost at the reported size; this architecture does not claim 100,000-claim support. Do not raise save limits to force a large migration into one transaction.
