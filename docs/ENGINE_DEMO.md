# Local research-state acceptance walkthrough

All examples in this walkthrough are **synthetic engineering examples**, not claims about the owner's research or an evaluation of research quality. Use a fresh local preview database. Never put test material into a production workspace.

Validation status (2026-10-02): the core browser workflow below was exercised in the actual local Worker preview through CUA. The full twelve-step advanced walkthrough was not clicked end-to-end in the browser; the separate HTTP acceptance script covers broader server workflows and records its own results. Live-model evaluation was not run.

### Browser actions actually executed

- Created the independent empty private projects `Synthetic browser parity` and `Synthetic browser geometry` through the project UI in separate tabs.
- Captured a human source containing LaTeX and a distinctive private marker. Created an exact-span-grounded even-square claim proposal through the real form.
- Ran deterministic checks, observed the honest `unknown` partial-contract result, recorded a separate admission review, and committed privately.
- Inspected the resulting immutable revision: one research object, mathematical support still `open`, source provenance retained, no inference routes or invented proof certification.
- Previewed the selected public statement and verified that the source's private marker and admission review did not appear in the exact publication preview. Confirmed the explicit checkbox and saved the snapshot in the **local test database only**.
- Switched the second tab to geometry and verified its empty state; the first tab remained on parity. Exercised the in-app switch guard's **Stay in this project** and **Switch project** paths. The native-confirm implementation was replaced after browser testing; the in-app guard kept the displayed project and active data aligned.
- Visually inspected the publication layout and the revised record renderer, including typeset statement and contract assumptions. Saved screenshots as local test artifacts `research-state-publication.jpg` and `research-state-record.jpg`.
- Reloaded a browser tab and recovered the saved parity record. This reload is **not** the application-process restart test; restart verification belongs to the separate acceptance script.

Not executed through browser clicks in this pass: the entire two-route/evidence/retraction sequence, claim revision with historical review, all context/external-import controls, archive/restore, private import, and a real delayed paid-provider response. These remain covered only to the extent documented by the corresponding executed domain, HTTP, persistence, and controlled-provider tests. An independent controlled-fetch check of the actual client API factory verified project A → project B → late project-A continuation retained request scopes A/B/A.

## Start and safety

Use the README's supported local Worker launch path. Open the local address and select **Research State**. An existing project may first require **Download private backup** and **Migrate this project locally**. This preserves historical assertions without inventing proofs. A fresh project needs no legacy migration.

Each browser tab keeps its own selected project. When switching after editing fields, confirm the unsaved-field warning only after saving the intended work. Saved records and any late running request stay in their original project.

## Twelve connected steps

1. **Create two unrelated projects.** In the sidebar choose **New project**. Create `Synthetic parity study` and `Synthetic triangle geometry`. Switch between them using **Research project** and confirm that each starts empty. Return to parity. The geometry project should remain empty throughout the parity steps.

2. **Capture the exact target and proposed proof ingredients.** Choose **Capture source**, keep **human note**, and enter the following synthetic source, attributed `Synthetic acceptance example`:

   ```text
   Goal: For every binary input x of length n, compute its parity with at most n XOR operations.
   General claim G: Scanning the n bits and maintaining their XOR computes parity for every input.
   Lemma L1: After k scanning steps, the accumulator equals the XOR of the first k bits. The base case k=0 uses accumulator 0; the update XORs bit k+1.
   Lemma L2: Associativity of XOR allows a reduction tree to compute the XOR of all n bits with n-1 binary XOR operations when n>0, and output 0 when n=0.
   Route A: L1 with k=n establishes the parity claim by the definition of parity.
   Route B: L2 computes the same XOR and meets the operation bound. This is an alternative algorithm and argument, not a second copy of Route A.
   ```

   Save the private source. In the proposal composer choose **Add a statement, definition, or goal**. Choose kind `goal`; enter the exact goal statement, input guarantee `arbitrary`, input domain `binary strings of length n, n a nonnegative integer`, and construction `explicit`. Save the proposal, run **Run deterministic checks**, explain the admission scope in **Review reason and unresolved limitations**, click **Approve private admission**, then **Commit selected changes privately**. Unknown contract fields remain unknown. Repeat this loop for claim G and claims L1/L2. Every admission remains separate from proof review.

3. **Import a scope-restricted conversation.** In **Research Notebook**, click **Import conversation** and paste:

   ```text
   User: Establish the parity guarantee for every binary input.
   Assistant: This attempt establishes the guarantee only for a uniformly random binary input. It does not establish the requested guarantee for every input.
   ```

   Import privately. On the assistant reply choose **Propose research change**. The exact visible reply becomes an immutable source. Propose the restricted statement with input guarantee `random`, retaining the same declared input domain. Do not invent a proof in the evidence field.

4. **Inspect the scope drift.** Save the proposal and run deterministic checks. Inspect the warning comparing arbitrary-input and random-input guarantees. Source text and proposed effect appear beside each other. A warning is not a theorem refutation or a runtime lower bound.

5. **Admit the restriction honestly.** In the admission review explain that the statement is useful to retain as a restricted, unproved result, while the original arbitrary-input target remains unresolved. Approve and commit privately. Inspect **Research record** and the goal's **Goal satisfaction** section. No goal-completion mapping was supplied, so the general goal must remain open.

6. **Attach evidence instead of duplicating a claim.** Capture a human note containing the L1 induction argument, including its base and induction steps. In **Research record**, select L1 and choose **Attach new evidence**. Use `human argument`, identify the exact scope, and preserve limitations. Review and commit the evidence operation. Confirm the claim count did not increase. Under **Attributed review of this revision**, cite that evidence and record an attributed mathematical endorsement with a precise reason. Repeat for L2. These are human judgments, not machine certificates.

7. **Build alternative routes, then withdraw one.** Select G and choose **Add alternative route**. Create Route A with L1 as its explicit AND premise; attach a source-grounded argument artifact for the L1→G inference before endorsing the route. Review/admit the route, then expand **Review or retract this inference**, cite its evidence and record an inference endorsement. Repeat for Route B with L2. The inspector must show two separate routes. Record a `retract` review on Route A with a reason. Inspect Route B and the conclusion's current support explanations: the independent route must remain usable. Withdrawal of Route A must not label G false.

8. **Revise without transferring old proof reviews.** Select L1 and click **Propose revision**. Change its precise statement (for example, explicitly change the input domain), capture a supporting source for that edit, and go through checks/review/commit again. Use **Revision history** to inspect the old revision and its attributed proof review. The new revision must not silently inherit that review. Inspect the affected route's staleness explanation. Route B should remain independently inspectable.

9. **Read a deterministic research diff.** Open **Research diff**. Select an **After commit** and **Through commit** range. Inspect source spans and **Read set, checks, and review records**. Follow **Inspect before** and **Inspect after** to the immutable revisions. The entries come from committed operations; unanswered prompts or rejected proposals do not become invented progress.

10. **Resume with relevant failures and constraints.** Capture a source describing a synthetic failed attempt: “Assume the first bit equals the parity of the entire string; this fails on 01.” Propose **Retain a failed attempt or barrier**, describe the attempted method and its actual failure scope, then admit it. Open **Resume & runs**, enter a question about avoiding the first-bit parity shortcut, choose the exact goal revision, and click **Build bounded context**. Inspect the typeset statements, relevant failure, remaining obligations, and the included/omitted manifest. External outputs can separately be recorded with **Import external run**; reuse its run ID with a new checkpoint ID for later outputs. Imported reports are not verified local executions.

11. **Publish only reviewed visible text.** In **Publication**, select exactly one intended revision and click **Preview exact public content**. Inspect both the typeset text and exact public JSON. Confirm the explicit publication checkbox and publish that snapshot. Use **Public-safe export** to inspect what was selected. Capture a private note containing a distinctive test marker and revise the private statement again; the earlier public snapshot must remain fixed and contain no private note, review text, or later revision. Retraction is a separate reasoned action. Do not treat this local action as deployment of the site.

12. **Restart and inspect durability.** Download a private project export, stop the preview and restart it with the same persistent local database. Reopen the project; compare object/revision counts, source hashes, review records, routes, commit history and the fixed publication snapshot. Switch to geometry and confirm it is still isolated. Private import validates a backup and creates a new private project with remapped IDs and downgraded imported trust; it does not overwrite another project's identity.

## Additional interface checks

- Keep two tabs on different projects and verify changing one selector leaves the other tab unchanged.
- Start a notebook request in project A, switch to B, then allow it to finish. Its saved messages and follow-up API calls must remain scoped to A. A configured API key is needed for a real model request; use the controlled-provider regression for an offline test and label it accordingly.
- Capturing a source, composing/reviewing/committing changes, building context, importing runs, and inspecting/exporting records require no model key.
- Publication preview allows sentence-by-sentence human inspection. It does not promise automatic detection of every sensitive sentence copied into an otherwise publishable statement.
- Supported core contract fields have ordinary form controls; advanced variable bindings, runtime expressions, and extensible goal criteria use the documented strict structured-contract JSON editor. There is no universal natural-language implication checker.
