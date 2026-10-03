import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
/** Scores explicitly supplied visible outcomes. It does not invent model trials. */
const arms = ['A_notes', 'B_retrieval', 'C_engine'] as const;
const outcome = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    budget: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        cost: z.number().nonnegative().optional(),
        currency: z.string().optional(),
      })
      .strict(),
    promoted: z.boolean(),
    recordedMeaningfulUpdate: z.boolean(),
    staleDetected: z.boolean(),
    sourceGrounded: z.boolean(),
    reviewerSeconds: z.number().nonnegative().optional(),
    artifactReference: z.string().min(1),
  })
  .strict();
const inputSchema = z
  .object({
    formatVersion: z.literal(1),
    provenance: z.enum(['synthetic', 'permissioned_real']),
    annotationAttribution: z.string().min(1),
    projects: z
      .array(
        z
          .object({
            id: z.string().min(1),
            split: z.enum(['development', 'held_out']),
            examples: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    expected: z
                      .object({
                        mayPromote: z.boolean(),
                        meaningfulUpdate: z.boolean(),
                        stale: z.boolean(),
                        requiresSource: z.boolean(),
                      })
                      .strict(),
                    arms: z
                      .object({
                        A_notes: outcome.optional(),
                        B_retrieval: outcome.optional(),
                        C_engine: outcome.optional(),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const args = process.argv.slice(2);
const input = args.find((a) => a.startsWith('--input='))?.slice(8);
const output = args.find((a) => a.startsWith('--out='))?.slice(6);
let report: unknown;
if (!input)
  report = {
    formatVersion: 1,
    status: 'not_run',
    arms: arms.map((id) => ({ id, status: 'not_run' })),
    protocol: {
      A_notes: 'Same model with project notes/context',
      B_retrieval: 'Same model with retrieval and summaries',
      C_engine: 'Same model with structured state and deterministic checks',
      budgetPolicy:
        'Use equal limits or explicitly report per-arm input/output token usage and measured cost.',
      splitPolicy: 'Hold out complete projects, not adjacent turns from the same project.',
    },
    liveEvaluation: {
      status: 'not_run',
      reason:
        'No automatic paid calls. Run a separately authorized, credentialed model experiment with an explicit budget, save visible artifacts, then import the measured outputs into this scoring harness.',
    },
    limitations: [
      'Synthetic expected answers and mocked outputs are engineering tests, not evidence of product superiority.',
      'This CLI does not implement additional model providers or automate consumer ChatGPT access.',
    ],
  };
else {
  const raw = readFileSync(input, 'utf8');
  if (Buffer.byteLength(raw) > 2_000_000)
    throw new Error('Evaluation input is limited to 2 MB. Keep each report scoped.');
  const data = inputSchema.parse(JSON.parse(raw));
  if (new Set(data.projects.map((p) => p.id)).size !== data.projects.length)
    throw new Error('A project may appear in only one split; duplicate project IDs are rejected.');
  for (const project of data.projects) {
    if (new Set(project.examples.map((e) => e.id)).size !== project.examples.length)
      throw new Error('Example IDs must be unique within a project.');
    for (const example of project.examples) {
      const models = new Set(Object.values(example.arms).map((v) => `${v.provider}:${v.model}`));
      if (models.size > 1)
        throw new Error(
          `Comparison ${project.id}/${example.id} must use the same provider and model across arms.`,
        );
    }
  }
  const score = (split: 'development' | 'held_out') =>
    arms.map((arm) => {
      const examples = data.projects
        .filter((p) => p.split === split)
        .flatMap((p) => p.examples.map((e) => ({ expected: e.expected, outcome: e.arms[arm] })))
        .filter(
          (e): e is { expected: typeof e.expected; outcome: z.infer<typeof outcome> } =>
            !!e.outcome,
        );
      if (!examples.length) return { arm, status: 'not_run', examples: 0 };
      const count = (fn: (e: (typeof examples)[number]) => boolean) => examples.filter(fn).length;
      const workload = examples.filter((e) => e.outcome.reviewerSeconds !== undefined);
      return {
        arm,
        status: 'scored_supplied_artifacts',
        examples: examples.length,
        falseClaimPromotions: count((e) => e.outcome.promoted && !e.expected.mayPromote),
        missedMeaningfulUpdates: count(
          (e) => e.expected.meaningfulUpdate && !e.outcome.recordedMeaningfulUpdate,
        ),
        staleSupport: {
          required: count((e) => e.expected.stale),
          detected: count((e) => e.expected.stale && e.outcome.staleDetected),
          falseAlarms: count((e) => !e.expected.stale && e.outcome.staleDetected),
        },
        sourceGrounding: {
          required: count((e) => e.expected.requiresSource),
          grounded: count((e) => e.expected.requiresSource && e.outcome.sourceGrounded),
        },
        reviewerWorkload: workload.length
          ? {
              measuredExamples: workload.length,
              totalSeconds: workload.reduce((sum, e) => sum + e.outcome.reviewerSeconds!, 0),
            }
          : { status: 'not_measured' },
        budget: {
          inputTokens: examples.reduce((sum, e) => sum + e.outcome.budget.inputTokens, 0),
          outputTokens: examples.reduce((sum, e) => sum + e.outcome.budget.outputTokens, 0),
          reportedPerExample: examples.map((e) => e.outcome.budget),
        },
      };
    });
  report = {
    formatVersion: 1,
    status: 'scored_supplied_artifacts',
    provenance: data.provenance,
    annotationAttribution: data.annotationAttribution,
    projectCount: data.projects.length,
    development: score('development'),
    heldOut: score('held_out'),
    limitations: [
      'Scores depend on the supplied annotations and visible artifact records; the harness does not authenticate external model execution.',
      'SourceGrounded and reviewer workload are supplied assessments, not automatically inferred researcher preferences.',
      'Any unequal budgets are reported, not silently normalized. A causal superiority claim needs a controlled research study.',
    ],
  };
}
const json = JSON.stringify(report, null, 2) + '\n';
if (output) writeFileSync(output, json);
process.stdout.write(json);
