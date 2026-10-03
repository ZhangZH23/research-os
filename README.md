# Research OS

A working local-first research instrument for scientists and theoretical researchers. **Research is a continuously evolving structured state, not a sequence of chat messages.** Research OS preserves claims, evidence, assumptions, failed approaches, and their relationships, so you can inspect what a project currently believes and why.

The app opens directly into a seeded mathematics workspace. There is no account, cloud database, or required API key.

## Open the workspace

On this Mac, double-click **Start Research OS.command** in the project folder. It starts a detached local server, reuses an existing instance, and opens the workspace. The server keeps running when the launcher or this chat closes. **Stop Research OS.command** stops that instance without deleting research data. After a restart, run the start launcher again.

From a terminal with no Node on PATH, use `bash scripts/workspace-service.sh start`. The bundled-runtime fallback is supported. `status`, `stop`, and `url` are also available. With Node configured, `npm run launch`, `npm run status`, and `npm run stop` are equivalent. Server output is saved in `data/research-os.log`. If the site is unavailable, run the launcher and inspect that log. This remains a local website: `127.0.0.1` is reachable only on this computer.

## Research program: goals, attacks, and real progress

The default **Research Program** page adds a layer above the research graph:

- **Ultimate goals and milestones:** exact target statements, quantifiers, success criteria, the strongest existing baseline, and the next decisive step. Connect lemmas, approaches, experiments, and evidence to each goal. Parent links form a validated hierarchy.
- **Routes and obligations:** see competing and failed attacks and the unresolved prerequisites on the selected goal’s path. Each attack shows which lemmas it requires and which earlier approach it replaces. **Explore dependencies** focuses the graph on that goal, its milestones, prerequisite lemmas, and attack history.
- **Contribution audit:** record the mathematical **before**, **after**, **mechanism**, and **verification task**. Distinguish a restatement, a useful routine consequence, a candidate new reduction/technique, and a barrier or counterexample. “New” here is a provisional researcher/model classification, not a literature novelty certificate or a numerical difficulty score.
- **Separate judgments:** proof status, contribution assessment, and goal achievement are distinct. Accepting an assessment does not prove the result. Goal achievement requires an explicit researcher decision, precise criteria, and linked reviewed proof evidence; the system checks recorded dependency integrity, not whether the argument semantically proves the target.
- **Revision awareness:** an edited lemma flags its earlier contribution assessment for re-review. Invalidated or removed goal evidence raises warnings while retaining the earlier recorded judgment and audit history.

The demo’s elementary repeated-root lemma is labeled a routine consequence. The vague rank hypothesis and overconfident draft are explicitly identified as restatements/open obligations. The seeded ultimate target improves a particular illustrative cubic expansion threshold beyond the elementary union bound; it is editable, unproved, and not a claim of literature novelty. Existing research nodes and statuses are preserved when this program layer is initialized.

## Research chat with GPT

Open **Research Chat → Connect OpenAI**. Enter an API key and a model available to your OpenAI API project, then choose **Save & test**. This checks key and model access without making a generation request. An existing `OPENAI_API_KEY` / `OPENAI_MODEL` environment configuration is also supported. No key is included in this repository or preconfigured by the app.

The connection uses the OpenAI API. It is not a login to an existing ChatGPT conversation. The key is held by the local server for its lifetime by default; **Remember on this computer** explicitly saves it in ignored `data/openai-connection.json` with owner-only permissions. It is never saved in browser localStorage, chat messages, or the research database. Local persistence is not encryption. Disconnect removes that saved file and disables the active connection.

Choose a goal and up to 12 focused research items, then use **Explore**, **Attack**, or **Audit**. The app includes selected material, nearby graph relationships, relevant program goals/assessments, and a bounded recent chat history. The actual included item IDs and truncation indicator are recorded with each turn. Use **Work on this goal** or the inspector’s research-chat button to carry a specific question into the composer without sending it automatically.

Replies support LaTeX. GPT is instructed to expose quantifier changes, circularity, routine consequences, missing proof obligations, and what a lemma actually buys. The model can return a concrete proposal containing new nodes, relationships, goal changes, and contribution assessments. Review the proposed fields, then **Apply** or **Discard**. Apply updates the program and graph atomically, rejects stale proposals/cycles/invalid references, and cannot label claims Proved, goals Achieved, or assessments Accepted. Applied content remains unverified with conversation provenance. Existing research nodes and accepted human assessments cannot be overwritten through chat proposals.

Chat history is saved locally. Failed/refused/incomplete provider responses show an error and leave the research program unchanged. Without a key, the chat produces a clearly labeled **local worksheet**: a fixed planning scaffold that saves the prompt, calls no model, and claims no mathematical discovery. Connect a key for actual GPT responses. Chat currently has no browsing, code execution, formal prover, or autonomous experiment runner.

The integration follows the official [Responses conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). It uses strict JSON schemas and `store: false`; provider data policies still apply to context deliberately sent to the API.

## Run locally

Requirements: **Node.js 22.13 or newer** (Node 24 recommended). Node's built-in SQLite is used, avoiding native database dependencies. Some Node versions emit an experimental SQLite warning; this does not prevent use.

```bash
cd research-os
npm install
npm run dev
```

Open **http://127.0.0.1:4310**. Keep the terminal running. Stop with Ctrl+C.

On the computer where this prototype was built, a launcher also finds Codex's bundled Node runtime if Node is missing from your shell:

```bash
bash scripts/run-local.sh
```

The repository includes a pnpm lockfile. For a reproducible install, use pnpm 11:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Production mode, tests, and the reproducible finite-field demo:

```bash
npm run build
npm start
npm test
npm run demo:rank
```

`npm start` requires a prior build; stop the development server first if both use port 4310. The launcher also supports `bash scripts/run-local.sh --production` after building.

## First five minutes

1. Open **Overview**. The seeded project has 17 items, all 12 node types, and 18 typed relationships.
2. Open **Research Graph**. Pan, zoom, drag nodes, click any node, or connect the handles to create a relationship. Use **Add relationship** for a keyboard-friendly form.
3. Inspect **Draft: generic-rank argument closes the gap**, then click **Why do we believe this?**. It is intentionally marked Proved while depending on an unverified hypothesis, demonstrating the integrity warning.
4. Create a claim with **New item**. Add a dependency, evidence, a contradiction, or a note. Change its status and provide a reason. **History** shows the previous and new state.
5. Open **Research Frontier** for ranked blockers, active approaches, planned experiments, stale items, and failed directions.
6. Open **Ingest Session**, choose **Use an example** or paste your own transcript, then **Extract for review**. Edit, merge, or discard items; add/correct relationships; commit only the reviewed items.
7. Close and restart the app. The graph, transcripts, drafts, and activity log remain in SQLite.

Search matches all words against titles, summaries, full content, and tags. It searches the whole project regardless of the selected page. Filters cover type, epistemic status, origin, tag, and direct dependency. To find disproved approaches or AI-produced items, use the corresponding graph filters. **More filters → Depending on** finds direct dependents of a chosen lemma. Cmd/Ctrl+K focuses search; N opens a new item; Escape closes a dialog/inspector.

## Mathematics and LaTeX

Research items, graph titles, summaries, arguments, provenance, relationship explanations, frontier briefings, and history support Markdown with LaTeX mathematics. Formulas use locally bundled KaTeX fonts and do not need an external rendering service.

- Inline: `$f(x)$` or `\(f(x)\)`.
- Display: `$$...$$` or `\[...\]`.
- Equations and derivations: `equation`, `align`, `align*`, `gather`, `aligned`, matrices, and `cases` environments.
- Mathematical prose: `\begin{theorem}[Optional title]...\end{theorem}`, and lemma, proposition, corollary, definition, remark, conjecture, proof, example, and assumption environments. These become document blocks; proofs end with a square.
- Markdown headings, lists, tables, and code blocks work alongside mathematics. Fenced code remains literal source.

Use **Source / Split / Preview** in the editor or ingestion review. The toolbar inserts an inline expression, display equation, aligned derivation, matrix, or proof. Titles have a rendered preview. Open an item and select **Expand reading view** for a wider argument, or **View LaTeX source** to inspect the saved text. Search also matches a plain-text projection of mathematical notation; native dropdowns use readable math labels.

The original LaTeX source is stored without conversion. Local extraction keeps equations, multi-line environments, and fenced code intact. Existing unchanged demo fields are formatted once with before/after `node_formatted` events; custom edits, statuses, confidence, human verification, timestamps, and earlier event snapshots are preserved.

This supports KaTeX mathematics and the listed prose environments, not a complete TeX document compiler. Packages, bibliographies, cross-document references, and TikZ diagrams are not compiled. Unsupported/malformed expressions remain visible. Raw HTML and trusted TeX extensions are disabled; mathematical rendering does not verify a proof.

## Epistemic integrity

- **Status, origin, confidence, and human verification are separate fields.** Confidence is a subjective estimate, not a proof certificate.
- Marking a node Proved does not automatically verify it or change any other node's status.
- Dependency audits traverse the complete `depends_on` chain, deduplicate shared prerequisites, and detect cycles. An unresolved or unreviewed prerequisite produces a warning on a proved result.
- “Verified dependencies” means recorded prerequisites are Proved and human-verified and the chain has no cycle. This is graph metadata, not a formal proof checker.
- Numerical supporting evidence, recorded contradictions, unreviewed AI material, and retired supporting items receive separate warnings.
- An experiment linked by `tested_by` is a related test. It is not automatically favorable evidence. Use a `supports` edge when the outcome supports a claim.
- Imported proposals are **always Unverified and AI-extracted**, even when the source calls something a proof. Human approval of extraction is distinct from human verification of truth.
- Merging appends clearly labeled unverified material and its provenance, preserves existing content and status, and clears the target's human-verification flag. The complete transcript is kept in an Agent Run node.
- Status changes require a reason. Events retain full before/after snapshots, including removed nodes and relationships. Graph mutation and event logging occur in one transaction.

### Relationship directions

| Type                       | Direction                                         |
| -------------------------- | ------------------------------------------------- |
| `depends_on`               | Dependent claim → prerequisite                    |
| `supports`, `proves`       | Evidence/argument → affected claim                |
| `contradicts`, `disproves` | Counterevidence → affected claim                  |
| `tested_by`                | Claim → Experiment                                |
| `derived_from`             | Result → source material                          |
| `motivated_by`             | Idea or experiment → motivation                   |
| `supersedes`               | Replacement → previous item                       |
| `related_to`               | General directed association, no proof obligation |

Only `depends_on` propagates proof obligations. Edges themselves are researcher-recorded assertions; they never automatically promote or disprove a node.

## Frontier scoring

The ranking is deterministic for a fixed graph and time. Each result shows its exact score contributions. Retired nodes (Disproved, Abandoned, Superseded) stay searchable and appear separately from active priorities.

| Signal                                                                 | Score             |
| ---------------------------------------------------------------------- | ----------------- |
| Each downstream active item relying on an unresolved/unreviewed result | +15, capped at 75 |
| Open Question                                                          | +30               |
| Recorded contradictory evidence                                        | +25               |
| Circular dependency                                                    | +30               |
| Each unresolved prerequisite in the full chain                         | +5, capped at 20  |
| Proved label with unresolved dependencies or missing human review      | +25               |
| Active Approach                                                        | +12               |
| Unverified Experiment                                                  | +15               |
| Unresolved claim with low confidence or no recorded support            | +10               |
| Unresolved item not revisited for at least 14 days                     | +8                |
| Unresolved item created within the last 7 days                         | +5                |

Ties sort by stable node ID. Ranking is a triage aid; it does not estimate scientific truth or guarantee that the next experiment is useful. Weekly change counts and the complete timestamped Activity view show what changed.

## Optional OpenAI integration

```bash
cp .env.example .env
```

Edit `.env` locally:

```dotenv
PORT=4310
DATABASE_PATH=./data/research-os.sqlite
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

Restart the server after changing environment variables. Never commit `.env`.

Three explicit actions use the API: **Research Chat** sends the selected bounded context and recent conversation; **OpenAI extraction** sends the pasted transcript; **AI briefing** sends the structured project. All ordinary browsing, graph editing, deterministic ranking, and local extraction remain local. API keys are read only by the server. The Responses API uses `store: false`; provider data policies still apply to data you choose to send.

Extraction uses strict JSON Schema output and a second Zod validation pass, including endpoint integrity. There is no automatic graph commit. Refusals, malformed/incomplete output, network errors, and timeouts leave the graph unchanged and show an error; local extraction remains available. The model is configurable and must support structured outputs. See [OpenAI's official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Without a key, paragraph-based heuristics suggest types and retain source wording. They do not invent dependencies. You can edit all proposed content, add nodes and relationships manually, and save a draft before committing.

## Architecture and repository

```text
src/
  App.tsx             Navigation, overview, search, lists, frontier, activity
  Program.tsx         Goal hierarchy, target contracts, attacks and contribution audit
  ContributionEditor.tsx  Baseline/gain/mechanism/verification assessments
  ResearchChat.tsx    Persistent GPT workbench and proposal review
  Graph.tsx           React Flow graph with handles, zoom/pan, and minimap
  Inspector.tsx       Belief audit, relationships, provenance, status history
  NodeEditor.tsx      Node and relationship forms
  Ingest.tsx          Extraction, saved review, create/merge/discard
  ResearchText.tsx     Shared Markdown and safe KaTeX rendering
  MathEditor.tsx       Source/split/preview editing and LaTeX snippets
  math.css            Mathematical typography and reading layout
  ui.tsx              Accessible dialogs, badges, type icons
  api.ts              Same-origin API client
  styles.css          Responsive research workspace
server/
  index.ts            Loopback server; Vite development or static production
  app.ts              Validated HTTP routes and local request boundaries
  store.ts            SQLite transactions, snapshots, reviewed ingestion
  ingestion.ts        Offline extraction and optional OpenAI Responses calls
  program-store.ts    Audited goals, milestones, contribution reviews and revision checks
  chat.ts             Context assembly, saved chat and atomic proposal application
  connection.ts       Server-held credentials and connection testing
  seed.ts             Explicitly illustrative finite-field research program
  math-seed-migration.ts  Audited, non-destructive demo formatting upgrade
shared/
  types.ts            Shared types and runtime validation schemas
  epistemics.ts       Dependency audits and transparent frontier scoring
  math.ts             Rendering-only TeX normalization and readable labels
tests/
  core.test.ts        Persistence, integrity, ranking, ingestion, API mocks
  api.test.ts         End-to-end HTTP mutations and request validation
scripts/
  run-local.sh        Foreground development/production launcher
  service.mjs         Detached start/stop/status and health checks
  workspace-service.sh  Service launcher with bundled-runtime fallback
  rank-demo.ts        Reproducible exact finite-field calculation
data/                 Ignored local SQLite database, WAL, and SHM files
```

React + Vite and Express replace Next.js to keep a single local process and a direct API/database boundary. TypeScript and Zod share validation between layers. React Flow handles the interactive graph. Node's built-in SQLite replaces an ORM/native addon for a compact prototype with explicit SQL, foreign keys, uniqueness constraints, WAL, and transactions. Styling uses ordinary CSS without a component framework.

### Data model

SQLite tables include `projects`, `nodes`, `edges`, `events`, `drafts`, `research_goals`, `contribution_assessments`, `chat_sessions`, `chat_messages`, and migration metadata. Nodes contain JSON records with type, title, summary, full content, status, confidence, origin, author, provenance, verification, timestamps, tags, and links. Edges keep relational source/target foreign keys, project, type, explanation, and timestamp. Evidence and Agent Run are first-class node types rather than additional normalized tables. Events preserve node titles even after deletion and store before/after snapshots plus the reason. Drafts retain the original transcript and review proposals; a committed timestamp prevents replay.

The server binds to `127.0.0.1` and rejects foreign Host headers and cross-origin writes. It has no authentication and is intended for a single local researcher. Do not expose it to the public internet.

### Back up your research

Stop the server, then copy `data/research-os.sqlite` to a safe location. While the server is running, SQLite may also use `-wal` and `-shm` files; use SQLite's backup facility for a consistent live backup rather than copying just the main file. Deleting or moving the database creates a fresh demo on the next launch; do this only when you intend to start over.

## Validation

`npm test` also covers goal hierarchy/cycles, audited completion and contribution reviews, stale assessment/evidence handling, persistent chat, bounded context, atomic proposals, stale updates, provider failures, credential handling, and LaTeX delimiters/environments, literal code, unsafe markup/TeX, malformed formulas, seed rendering, extraction without split equations, and formatting migrations that preserve user edits and metadata. `npm test` exercises node creation/editing, required status reasons, atomic audit writes, database reopen persistence, transitive dependency diamonds and cycles, numerical-vs-experiment semantics, edge validation/deletion, deterministic ranking, malformed ingestion, transactional create/merge/discard, replay prevention, chronological seed history, HTTP workflows, and mocked OpenAI failure modes. The tests use temporary or in-memory databases and never touch your project database.

`npm run build` performs strict TypeScript checking and produces the production client. There are 72 automated tests. Browser checks cover goal-to-chat context, dependency navigation, contribution review, connection settings, desktop and mobile mathematics, and applying/discarding simulated chat proposals in an isolated database. Earlier checks also cover claim creation, relationship creation, status updates, warnings, history, and reviewed ingestion. Live OpenAI generation was not run because no API key was configured; the request format and failure paths are covered by mocked tests.

## Current MVP limitations

- One seeded project, single-user local operation; no authentication, collaboration, or sync.
- No formal proof checking. Human-verification flags are recorded judgments, and the demo includes deliberately inconsistent metadata to show warnings.
- The seed is an illustrative research program, not a claim of a published expansion improvement. Only the elementary arguments and bundled finite calculation are directly reproducible here.
- Graph layout is automatic by type; dragging positions is temporary. All research content and relationships persist.
- No notebook execution, full TeX compilation, PDF parsing, or attachment upload. External URLs and local file references can be recorded.
- Offline extraction is intentionally simple and capped at 40 paragraphs; use manual review to add/correct items. Individual transcripts are limited to 100,000 characters. OpenAI results allow at most 50 nodes and 150 edges.
- Draft edits persist when **Save review** is clicked. Unsaved review edits can be lost on navigation; the original extraction is automatically saved.
- The activity log is append-only through application operations but is not a cryptographically tamper-proof ledger; anyone with filesystem access can edit the database. Deletion snapshots can be inspected; there is no restore/undo UI yet.
- Frontier computation scans the in-memory graph; appropriate for small research projects, not very large graphs. All project data is currently loaded by the client.
- Briefings are optional, AI-labeled summaries and are not automatically saved. They must be checked against the graph.

## Five highest-value next features

1. **Proof-obligation records and scoped review:** reviewer identity, assumption-level approvals, proof artifacts, and verification invalidation on revisions.
2. **Reproducible experiments:** attach code, inputs, environments, exact outputs, and hashes; connect each observation to the claims it tests.
3. **Versioned research branches and recovery:** named snapshots, graph diffs, undo/restore, and competing argument branches.
4. **Source-grounded ingestion:** passage-level provenance, duplicate detection, suggested merges, and reviewable links to existing claims.
5. **Project lifecycle and portable export:** multiple projects, JSON/Markdown/LaTeX exports, import, and local backup/restore.
