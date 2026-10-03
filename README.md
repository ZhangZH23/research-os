# Research OS — revision-aware mathematics research

Research OS is a local-first workbench for mathematics and TCS projects: chat with GPT or import visible conversations, capture exact source passages, review proposed research changes, and inspect what changed. It maintains attributed, revision-aware research records and checks explicit invariants. It does not certify arbitrary mathematics, literature novelty, or publishability.

**Research State Engine 0.4 is now online:** [open Research OS](https://research-os-zhangzh23.zzh19980830.chatgpt.site). Hosted version 4 was published successfully on October 2, 2026 (Pacific time), after all 216 tests passed. Sign in with the owner's ChatGPT account to use the private Research State workbench and GPT notebook. Kai and other visitors can use the same link to read published research; public access does not grant private notebook access or editing.

Existing projects use the explicit backup and migration flow below before editing their research state. Deployment and migration are separate steps; pushing this repository alone does neither.

## Run the complete application locally

Use Node.js 22.13+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev
```

Open **http://localhost:4312**. The supported full application is the Worker preview, with a separate persistent local database under `.wrangler/`. `pnpm start` starts an already built preview. `pnpm launch` builds and starts it in the foreground; stop it with Ctrl+C. The older Express server remains available as `pnpm start:legacy` for compatibility testing; it does not provide the new Research State interface.

No API key is needed to create projects, capture human observations, import conversations, propose/check/review/commit changes, inspect sources and routes, or export records. The illustrative legacy project has an explicit migration screen; a new private project starts empty and needs no legacy migration.

To chat with GPT, create an ignored `.dev.vars` containing `CONNECTION_SECRET="<32-byte base64 value>"`, restart, and choose **Connect GPT** in the notebook. Generate the secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Supply your own OpenAI API key through the connection dialog. Keys are encrypted into a user-bound HttpOnly cookie and excluded from research storage, exports, and this repository. Model usage may incur API charges. Without a configured key, local planning worksheets are explicitly labeled and are never presented as GPT output.

## The research workflow

1. Create a private project and specify its goal. Each tab retains its own selected project.
2. Capture a human note, import a conversation, or select **Propose research change** on a notebook reply. Source text stays exact, including LaTeX, Unicode, and line endings.
3. In **Research State**, propose a statement, revision, evidence attachment, route, obligation, failed attempt, or methodological assessment. Ordinary contract fields have form controls; advanced expressions have a structured editor.
4. Inspect the original passage beside the proposed effect. Run deterministic checks, record a reasoned admission review, then commit. A warning can accompany a useful restricted result; admission does not establish the general goal.
5. Inspect immutable revisions, evidence, attributed reviews, AND/OR routes, current support explanations, and the committed **Research diff**. New statements do not inherit old proof reviews.
6. Resume research with bounded context containing exact revisions, constraints, relevant earlier failures, and an included/omitted manifest. Notebook requests retain separate run records and visible outputs; imported runs retain unverified execution attribution.
7. Publish only an explicitly previewed selection. Publication is separate from private admission and proof endorsement. Later private changes leave the public snapshot fixed.

The existing notebook, graph, LaTeX renderer, contribution reviews, and session history remain available. Descriptive relationships are distinct from actual inference premises. Goal satisfaction requires an attributed criterion-to-result mapping, rather than counting admitted candidates.

## Preserve existing work

Download a private backup before migrating. **Research State → Download private backup → Migrate this project** performs additive, resumable chunks. Original records remain; unavailable history is not invented. Existing public material is frozen once as a legacy snapshot, while later revisions and new projects remain private.

The maintenance command accepts only a local preview address:

```sh
pnpm engine:migrate                             # dry-run report
pnpm engine:migrate --apply --backup /absolute/path/research-backup.json
```

Add `--project PROJECT_ID` for a selected project. A backup file is created with exclusive creation before applying any chunk. Keep private backups outside the public repository. Private project import creates a separate private project with remapped identities and downgraded imported review/check trust. It does not overwrite existing research or authenticate imported execution. See [migration and compatibility details](docs/MIGRATIONS.md) for size limits and recovery.

## Validation and limitations

```sh
pnpm check
pnpm test
pnpm build
pnpm test:cloud
pnpm engine:scale --size=1200 --out=/tmp/research-scale.json
pnpm engine:evaluate --out=/tmp/research-evaluation.json
```

With the local preview running, `node --import tsx scripts/engine-acceptance.ts` runs the synthetic HTTP acceptance workflow and records a restart fingerprint. Restart the preview and run `node --import tsx scripts/engine-acceptance.ts --verify test-results/engine-acceptance.json` to verify durability. These scripts create clearly labeled synthetic private projects locally.

See the [implementation record and actual validation](docs/ENGINE_UPGRADE.md), [twelve-step UI walkthrough](docs/ENGINE_DEMO.md), [semantics and trust boundaries](docs/ENGINE_SEMANTICS.md), [supported checkers](docs/CHECKERS.md), and [evaluation protocol](docs/EVALUATION.md).

The checks cover declared scope changes, quantifier/construction differences, a bounded runtime-expression fragment, exact textual repetition, source spans, and an allowlisted finite prime-field matrix-rank computation. Missing information remains unknown. Human endorsements remain human judgments. There is no arbitrary-code runner, autonomous multi-day agent, universal proof checker, or literature-novelty oracle. Live A/B/C model evaluation is **not_run**; synthetic fixtures and mocked responses do not demonstrate researcher productivity or model superiority.

## Storage and hosting

The Worker reconstructs the domain in request-local SQLite, then saves individual records to D1 with atomic revision comparison. Semantic proposal read sets and storage CAS are independent safeguards. Saves remain bounded to 850 changed records and 1.8 MB per record; migration uses smaller resumable batches. Requests are limited to 1 MB. Whole-workspace loading remains a scaling cost, documented in the measured benchmark.

The public read API uses frozen publication DTOs; notebook conversations, drafts, source artifacts, private reviews, and credentials require owner access. Project scoping is separate from authorization. The local owner preview flag is effective only on loopback addresses. Hosted editing requires Sites dispatch authentication and the configured owner identity. This remains a personal research workspace; sharing a public snapshot is not multi-user editing.

The existing Sites hosting configuration, public audience and owner access settings are retained. The current deployment is hosted version 4; its deployment record is in [ENGINE_UPGRADE.md](docs/ENGINE_UPGRADE.md). For future deployments, review the source, back up the target workspace, preserve its connection secret and owner configuration, deploy through the existing hosting workflow, then explicitly migrate the target project. No hosted deployment or production migration is performed by these local commands.
