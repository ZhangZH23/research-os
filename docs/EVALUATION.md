# Engineering evaluation and product validation

No live comparative model evaluation has been run for this upgrade. `engine-evaluation-status.json` records `not_run` for all three arms. No researcher time savings, model accuracy gain, novelty detection accuracy, or product superiority is inferred from synthetic tests.

## Reproduce checks and measured scale

```sh
node --import tsx --test tests/engine-semantics.test.ts
node --import tsx scripts/engine-scale.ts --size=1200 --out=docs/engine-scale-results.json
node --import tsx scripts/engine-evaluate.ts --out=docs/engine-evaluation-status.json
```

The committed synthetic benchmark was measured on **October 2, 2026, Pacific time** (the JSON stores the UTC timestamp), Node **v24.19.0**, Darwin **25.6.0**, ARM64 **Apple M2**, 8 logical CPUs. It generated 1,200 objects, 1,200 revisions, 1,200 evidence records, 1,199 routes, and 1,200 reviews. The serialized dataset was 1,851,414 bytes.

After one warmup, five measured support evaluations had a median **46.783 ms**, minimum **40.212 ms**, and maximum **49.460 ms**. JSON reconstruction in those trials took **2.889–3.489 ms**. Every trial checked that the independently seeded synthetic implication chain supported exactly 1,200 current revisions. Raw samples and the environment are in `engine-scale-results.json`.

The same script also reconstructed **6,000 normalized records (3,553,351 serialized bytes)** through the actual SQL.js `SQLiteDatabase` bridge used by the Worker. Across five trials after a warmup, median SQLite reconstruction was **44.211 ms**, full snapshot **31.332 ms**, scoped record read/JSON decoding **13.858 ms**, and support evaluation after loading **49.183 ms**. SQL.js runtime initialization was **9.011 ms** and is reported separately. Each restored graph was checked to retain all records and exactly 1,200 supported revision references.

This measures the pure evaluator, JSON reconstruction, and the actual request-local SQLite bridge. It does **not** measure D1/network load, HTTP requests, browser rendering, model latency, or researcher productivity. Whole-workspace loading remains a persistence cost. Some evidence/review and route scans remain quadratic. One sparse chain at 1,200 claims is not evidence for 100,000-claim support.

## Three-arm protocol and scoring harness

`scripts/engine-evaluate.ts` compares supplied visible artifact outcomes for:

- `A_notes`: the same model with project notes/context.
- `B_retrieval`: the same model with retrieval/summaries.
- `C_engine`: the same model with structured research state and checks.

The harness checks that all arms for an example use the same provider/model. It requires input/output token usage per observation and reports any supplied costs per example, without disguising unequal budgets. Split at the **project** level; duplicate project IDs across development and held-out data are rejected. Adjacent turns from one research project must not appear on both sides.

It reports counts of false claim promotion, missed meaningful updates, detected stale support and false alarms, grounded required sources, and reviewer seconds **only when actually supplied**. It does not infer reviewer preference or time savings. Imported visible artifacts are not authenticated model execution. Source-grounding judgments and expected outcomes need attribution.

A versioned input looks like this (illustrative schema, not a completed trial):

```json
{
  "formatVersion": 1,
  "provenance": "synthetic",
  "annotationAttribution": "Identify the annotator and retain disagreements",
  "projects": [
    {
      "id": "held-out-project-example",
      "split": "held_out",
      "examples": [
        {
          "id": "scope-drift-example",
          "expected": {
            "mayPromote": false,
            "meaningfulUpdate": true,
            "stale": false,
            "requiresSource": true
          },
          "arms": {}
        }
      ]
    }
  ]
}
```

For each completed arm, add its object under `arms.A_notes`, `arms.B_retrieval`, or `arms.C_engine`:

```json
{
  "provider": "provider used",
  "model": "same model in all three arms",
  "budget": { "inputTokens": 100, "outputTokens": 100 },
  "promoted": false,
  "recordedMeaningfulUpdate": true,
  "staleDetected": false,
  "sourceGrounded": true,
  "artifactReference": "permissioned-visible-output-record"
}
```

The token counts above are schema examples, not measurements. Optional `reviewerSeconds`, `cost`, and `currency` must only contain measured values. Score a completed dataset with:

```sh
node --import tsx scripts/engine-evaluate.ts --input=/path/to/permissioned-results.json --out=/path/to/report.json
```

The CLI makes no paid requests. A live experiment needs an explicitly authorized budget, API credentials handled outside the dataset, saved visible outputs, and reported provider configuration. It can be run through the existing model connection, then scored here. Do not put credentials in inputs, outputs, prompts, fixtures, or source artifacts. Real-data examples also require permission and project-level holdout separation. The present status remains **not_run** until actual trials are supplied; expected fixture labels and controlled responses are not empirical product evidence.
