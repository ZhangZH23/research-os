# Research-state checks and their limits

The deterministic kernel is in `shared/engine-checks.ts` and `shared/engine-support.ts`. Structured declarations are data, not proof certificates. Every finding records its rule/version, declared scope, outcome (`pass`, `fail`, `unknown`, or `not_applicable`), explanation, references, and limitations. A failed compatibility check does not prevent admitting an open or restricted result. It prevents interpreting that result as satisfying a stronger target.

## Supported contract fragment

`ResearchContract` is partial. Omitted fields remain unknown, and an omitted assumptions array is different from an explicitly empty array. Per-field states distinguish extracted, researcher-confirmed, and unknown material; extraction does not authenticate the declaration.

- Input guarantees distinguish arbitrary inputs, random inputs, flat sources, linear subspaces, and finite enumeration. The implemented narrowing checks flag arbitrary→random and flat-source→subspace changes. Other category changes return unknown unless identical.
- Ordered quantifier records preserve their binding variable, domain, and scope. The checker reports changed positions; it does not decide logical implication between quantified formulas.
- Explicit construction requirements are not satisfied by a declared existential result.
- Exact assumption additions/removals are shown separately. Added assumptions make the recorded result restricted; no arbitrary prose entailment is attempted.
- Variable names require declared meanings and domains before runtime comparison. Different meanings or absent domains produce unknown.
- Runtime expressions are a JSON AST: constants, variables, ordered sums/products, powers, and logarithms, bounded to 32 levels. Variables may declare dependencies and substitution definitions. The dependency walk is bounded and reports cycles as unknown. No `eval`, arbitrary code, algebraic simplification, or general asymptotic dominance checker is present.
- An exponent dependent on epsilon cannot establish a target requiring an epsilon-independent exponent. This is a failure of the supplied upper bound to establish the target, never a runtime lower bound or proof that no better algorithm exists. `r = ceil(1/epsilon)` is represented by `r`'s declared epsilon dependency; the AST does not implement `ceil`.
- Textual repetition normalizes Unicode NFC and whitespace while preserving case, grouping, braces, and operator order. It is not an equivalence or literature-novelty oracle. Additional evidence for the same statement is an independent update.

## Provenance

Source spans use **UTF-16 code-unit offsets into the original immutable text**. Quotes, artifact IDs, artifact hashes, bounds, and surrogate-pair boundaries are checked. Source text is not normalized before slicing. Emoji, Unicode mathematical symbols, and CRLF are covered by fixtures. The source artifact hash is produced and retained by the server; a span checker compares against that stored hash. Imported speaker names and original timestamps are supplied metadata, not authenticated authorship.

Matching a source span means that the quote comes from that source. It does not establish mathematical correctness.

## AND/OR support and currentness

A route has conjunctive exact premise revisions and one exact conclusion revision. Separate reviewed routes are alternatives. Least-fixed-point propagation starts only from exact, attributed human mathematical reviews citing an argument artifact, or a reviewed zero-premise argument. Each inference itself also needs an exact human review and an argument artifact. Imported/model reviews, admission decisions, descriptive links, and finite experiments cannot seed unrestricted proof support.

Open premises and undischarged local assumptions remain conditional. Cycles without an independent entry contribute no support. An independent entry remains supported despite additional cycles. A retracted or challenged argument removes the affected route; another usable route can survive. None of these transitions infers that the goal is false. Contradictory mathematical reviews of a statement are retained and block an unsupported established summary.

New claim revisions do not inherit old reviews. Definition revision changes and old premise bindings produce currentness warnings while historical artifacts remain attached to their original proposition. Same-reviewer explicit supersession can retire that review; it cannot retire another researcher's judgment. Goal achievement is a separate server calculation requiring reviewed criterion-to-result mappings. The support projection alone is not goal completion.

This is attributed argument support, not arbitrary formal verification. A human can make a mistaken judgment; the system preserves that attribution and scope rather than pretending to remove this possibility.

## Experiments and counterexamples

Experiment checks compare explicit domain, exhaustive status, arithmetic model, execution success, and enumeration count. A matching finite scope is only a scope-consistency pass; harness correctness still needs checking. A failed harness is unknown, never refutation. A proposed counterexample violating a premise is inapplicable. A list of asserted satisfied premises is only declaration consistency until independently verified.

The allowlisted exact rank checker accepts rectangular, nonempty matrices up to **32×32** over a **prime modulus from 2 through 1,000,000**, with safe-integer entries. It validates primality, uses modular Gaussian elimination, and returns the original input, reduced matrix, rank, pivot columns, version, and scope. Intermediate products stay below 10^12, within exact integer arithmetic for JavaScript numbers. Composite rings, extension fields, arbitrary generated code, and oversized inputs are rejected. A rank output alone is not a theorem-specific counterexample.

## Engineering fixtures

`tests/fixtures/research-engine/synthetic-semantics.json` contains 48 focused, explicitly synthetic examples. Each includes an ID, provenance, before-state, new source/change, expected checks/effects, expected unknowns, and review explanation. `tests/engine-semantics.test.ts` executes every example and additional generated invariants. These fixtures exercise kernel semantics; they do not pretend to test HTTP authorization, transactional persistence, or model behavior.

The required ingestion idempotency, concurrency, rollback, tab/project binding, publication, retrieval, migration, and restart cases belong to the separate integration suites. `tests/fixtures/research-engine/synthetic-integration-catalog.json` maps these requirements to concrete test names. Consult the implementation checklist and actual test output for run results; a mapping alone is not evidence of execution.

To add a permissioned real example, keep the original source outside public fixtures until its owner grants publication permission. Record project-level split, consent scope, exact redaction/mapping, annotation attribution, and independent reviewer disagreements. Add a sanitized fixture using this catalog's fields, mark provenance `permissioned real`, and preserve alternative annotations rather than forcing a single consensus label. Hold out whole projects when evaluating; do not split adjacent chat turns across train/development and held-out sets.
