# Research OS — public research workspace

A mathematics and TCS research workspace with public browsing and owner-only editing with LaTeX rendering, a research graph, ultimate goals and subgoals, contribution assessments, and a private research notebook. AI proposals require review before application and never certify a proof.

## Try the platform

**[Open Research OS](https://research-os-zhangzh23.zzh19980830.chatgpt.site)** to browse the public research project. The owner's research notebook, GPT connection, and editing tools require owner sign-in.

To explore the complete notebook yourself, run an isolated local copy with Node.js 22.13+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev
```

Open **http://localhost:4312**. This uses a separate local database and illustrative seed data; it does not connect to the owner's live research storage. Import a conversation to try manual review, or configure a local connection secret and your own API key to use GPT. The connection secret is described below.

## Online use

Anyone can open the published Site to read the current research graph, goals, and contribution assessments. The owner signs in with ChatGPT to edit and use research chat. Drafts, conversation history, audit events, source transcripts, local file links, and connection credentials are excluded from public responses. Research edits and conversations persist in the cloud database. The original desktop workspace is a separate copy; it does not automatically synchronize with the online workspace.

Select **Connect GPT** in the Research Notebook to add an OpenAI API key. The key is encrypted server-side into a Secure, HttpOnly, user-bound browser cookie. It is never stored in the research database or source repository. Remembered connections expire after 30 days; session connections expire within 24 hours. Without a key, the graph, program, review flows, and clearly labeled planning worksheets remain available.

## Research Notebook

The owner starts in the notebook: choose a goal, state what progress would mean, and send a prompt to GPT. Paste labeled ChatGPT conversations through **Import conversation** to use the same review flow. Complete visible replies, prompt drafts, private notes, and result reviews persist independently of the public research graph.

Each candidate records an exact source quote, statement and assumptions, baseline, proposed gain, mechanism, evidence, unresolved gap, and next decisive check. GPT only suggests candidates. The researcher classifies them as an advance, useful partial result, reformulation, or rejection, with a recorded reason and independent check. **Session review** compares prompts and their actual project effects.

Reviewing stays private. Adding a reviewed result to the public project requires an explicit checkbox; the new graph item remains mathematically unverified. Restatements and routine consequences cannot count as nontrivial advances. Exact repeated statements cannot be integrated twice. These are conservative checks, not a semantic equivalence, proof, or literature novelty oracle. Goal, premise, and integrated-result edits invalidate current progress counts until re-examined. Historical source text and reviews are retained.

Without a configured API key, import and manual review work; the notebook never presents a local worksheet as a GPT reply. Model context includes selected research, recent exchanges, and bounded recorded reviews; it is not unlimited memory. Local preview enables an owner test mode only on localhost with an explicit environment flag, never on public hosts.

## Development

Use Node.js 22.13 or newer and pnpm. Install dependencies with `pnpm install`, initialize the local cloud database with `pnpm db:local`, and run `pnpm dev`. The preview runs on port 4312. `pnpm check` checks types; `pnpm test` runs the regression suite; `pnpm build` produces the client and Worker bundle.

Local preview uses a separate database under `.wrangler/`. Production uses the Sites-managed D1 binding named `DB`. Generate schema migrations with `pnpm db:generate`; production applies the generated migrations during deployment. Do not alter production schemas in request handlers.

## Deployment

This checkout is registered to the Site in `.openai/hosting.json`. The Sites workflow builds the app, pushes the exact source commit, packages the Worker and assets, and deploys a version to the existing Site. The Site audience is public; server authorization separately restricts private features and all writes. Runtime configuration is managed through Sites, never committed to the manifest.

For local GPT connections, create an ignored `.dev.vars` file containing `CONNECTION_SECRET="<32-byte base64 value>"`. Generate a value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, save it locally, and restart the preview. Then choose **Connect GPT** in the app. Do not commit `.dev.vars` or API keys.

`CONNECTION_SECRET` is a secret 32-byte base64 encryption key. Preserve it across deployments to retain existing browser connections. `WORKSPACE_OWNER_EMAIL` is configured from the verified owner entry in the Sites access policy. Server authorization requires both a dispatch-authenticated user ID and the exact owner email. These headers are trusted only behind Sites dispatch. Missing owner configuration denies editing to everyone. The one-time import endpoint was removed after the workspace transfer.

## Persistence and concurrency

The existing domain rules run in a request-local SQLite WASM engine with real foreign keys, uniqueness constraints, transactions, and savepoints. D1 stores individual research records. Each write uses an atomic revision comparison and guards every changed row, rejecting conflicting tabs without overwriting their changes. Long model calls save the prompt first and reload current research before appending the reply. Distributed leases prevent concurrent sends within one conversation; reply recovery handles committed writes whose network acknowledgement was lost.

This is a personal research workspace, with a public shared graph and server-enforced owner authorization for editing. Multi-user workspaces would require a separate authorization design. Individual saves are bounded to 850 changed records and individual records to 1.8 MB. Live model behavior requires a configured API key; automated tests use controlled model responses.
