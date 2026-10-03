import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contractSchema,
  emptyEngineData,
  operationSchema,
  stableSerialize,
  type EngineData,
  type ResearchRevision,
  type ReviewRecord,
  type SourceArtifact,
} from '../shared/engine';
import {
  checkContractCompatibility,
  checkCounterexample,
  checkExperimentalScope,
  checkPrimeFieldRank,
  checkTextualRepetition,
  expressionDependencies,
  validateSourceSpan,
} from '../shared/engine-checks';
import { activeHumanReviews, evaluateSupport } from '../shared/engine-support';
const hash = (x: unknown) =>
  createHash('sha256')
    .update(typeof x === 'string' ? x : stableSerialize(x))
    .digest('hex');
const timestamp = '2026-01-01T00:00:00.000Z';
const fixtures = JSON.parse(
  readFileSync(
    new URL('./fixtures/research-engine/synthetic-semantics.json', import.meta.url),
    'utf8',
  ),
) as any[];
function graph(before: any, material: any): EngineData {
  const data = emptyEngineData({
    id: 'synthetic',
    title: 'Synthetic unrelated finite mathematics',
    description: 'Engineering fixture, not actual user research',
    visibility: 'private',
    archived: false,
    createdAt: timestamp,
    headCommitId: null,
  });
  for (const c of before.claims ?? []) {
    const projectId = c.projectId ?? data.project.id;
    const revision: ResearchRevision = {
      id: c.revision ?? `${c.id}@1`,
      objectId: c.id,
      projectId,
      parentRevisionId: null,
      statement: c.statement ?? `Synthetic statement ${c.id}`,
      contract: c.contract ?? {},
      sources: [],
      definitionRevisionIds: c.definitions ?? [],
      actor: 'Synthetic researcher',
      createdAt: timestamp,
      hash: hash(c),
      formatVersion: 1,
    };
    data.objects.push({
      id: c.id,
      projectId,
      kind: c.kind ?? 'claim',
      title: c.title ?? c.id,
      currentRevisionId: revision.id,
      archived: false,
      createdAt: timestamp,
    });
    data.revisions.push(revision);
  }
  for (const e of before.evidence ?? [])
    data.evidence.push({
      id: e.id,
      projectId: data.revisions.find((r) => r.id === e.target)!.projectId,
      targetRevisionId: e.target,
      kind: e.kind,
      content: e.content,
      sources: [],
      scope: 'Synthetic exact target revision',
      createdAt: timestamp,
      actor: 'Synthetic researcher',
      executionTrust: 'imported',
    });
  for (const route of before.routes ?? []) {
    const evidenceId = `argument:${route.id}`;
    data.evidence.push({
      id: evidenceId,
      projectId: data.project.id,
      targetRevisionId: route.conclusion,
      kind: 'human_argument',
      content: 'Synthetic reviewed inference artifact. No claim of actual research correctness.',
      sources: [],
      scope: 'This exact implication',
      createdAt: timestamp,
      actor: 'Synthetic researcher',
    });
    data.routes.push({
      id: route.id,
      projectId: data.project.id,
      title: route.id,
      conclusionRevisionId: route.conclusion,
      premiseRevisionIds: route.premises,
      localAssumptions: route.localAssumptions ?? [],
      evidenceId,
      sources: [],
      createdAt: timestamp,
      actor: 'Synthetic researcher',
    });
    if (route.reviewed)
      data.reviews.push({
        id: `review:${route.id}`,
        projectId: data.project.id,
        targetId: route.id,
        targetRevisionIds: [route.conclusion, ...route.premises],
        decision: 'endorse',
        scope: 'inference',
        reason: 'Synthetic attributed argument review',
        actor: 'Synthetic researcher',
        createdAt: timestamp,
        evidenceIds: [evidenceId],
        checkIds: [],
        trust: 'human',
      });
  }
  const addReviews = (list: any[]) => {
    for (const review of list) {
      const r = data.revisions.find((r) => r.id === review.target);
      const decision = review.decision ?? 'endorse';
      const evidenceIds = review.evidenceIds ?? [];
      if (decision === 'endorse' && r && !review.evidenceIds) {
        const eid = `evidence:${review.target}:${data.evidence.length}`;
        data.evidence.push({
          id: eid,
          projectId: r.projectId,
          targetRevisionId: r.id,
          kind: 'human_argument',
          content: 'Synthetic human argument; fixture does not certify actual mathematics.',
          sources: [],
          scope: 'This exact revision',
          createdAt: timestamp,
          actor: review.actor ?? 'Synthetic researcher',
        });
        evidenceIds.push(eid);
      }
      data.reviews.push({
        id: review.id ?? `review:${data.reviews.length}`,
        projectId: r?.projectId ?? data.project.id,
        targetId: review.target,
        targetRevisionIds: review.targetRevisions ?? [review.target],
        decision,
        scope: review.scope ?? 'mathematical',
        reason: 'Synthetic explicit review judgment',
        actor: review.actor ?? 'Synthetic researcher',
        createdAt: timestamp,
        evidenceIds,
        checkIds: [],
        trust: review.trust ?? 'human',
        supersedes: review.supersedes,
      });
    }
  };
  addReviews(before.reviews ?? []);
  addReviews(material.reviews ?? []);
  for (const o of before.obligations ?? [])
    data.obligations.push({
      id: o.id,
      projectId: data.project.id,
      title: 'Open obligation',
      statement: 'Synthetic unresolved implication',
      targetRevisionId: o.target,
      premiseRevisionIds: [],
      createdAt: timestamp,
      sources: [],
    });
  for (const rel of before.relationships ?? [])
    data.relationships.push({
      id: `rel:${data.relationships.length}`,
      projectId: data.project.id,
      fromRevisionId: rel.from,
      toRevisionId: rel.to,
      kind: rel.kind,
      explanation: 'Descriptive fixture relationship',
      sources: [],
      createdAt: timestamp,
    });
  if (material.rename)
    data.objects.find((o) => o.id === material.rename.objectId)!.title = material.rename.title;
  if (material.replaceCurrent) {
    const edit = material.replaceCurrent;
    const o = data.objects.find((o) => o.id === edit.objectId)!;
    const old = data.revisions.find((r) => r.id === o.currentRevisionId)!;
    data.revisions.push({
      ...old,
      id: edit.revision,
      parentRevisionId: old.id,
      statement: edit.statement,
      hash: hash(edit),
    });
    o.currentRevisionId = edit.revision;
  }
  return data;
}
for (const f of fixtures)
  test(`${f.id} — ${f.reviewExplanation}`, () => {
    assert.match(f.provenance, /Synthetic/);
    assert.ok(Array.isArray(f.expectedUnknowns) && f.expectedUnknowns.length > 0);
    const before = f.beforeState,
      material = f.newMaterial,
      expected = f.expected;
    let result: any;
    switch (f.checker) {
      case 'text':
        result = checkTextualRepetition(
          material.statement,
          before.statement,
          material.hasNewEvidence,
        );
        break;
      case 'contract':
        result = checkContractCompatibility(
          contractSchema.parse(before),
          contractSchema.parse(material),
        ).find((x) => x.rule === expected.rule);
        assert.ok(result);
        break;
      case 'counterexample':
        result = checkCounterexample(contractSchema.parse(before), material);
        break;
      case 'experiment':
        result = checkExperimentalScope(contractSchema.parse(before), material);
        break;
      case 'source': {
        const source: SourceArtifact = {
          id: 'source',
          projectId: 'synthetic',
          kind: 'human_note',
          text: before.text,
          hash: hash(before.text),
          createdAt: timestamp,
          attribution: 'Synthetic researcher',
        };
        const start = material.start ?? source.text.indexOf(material.quote);
        const end = material.end ?? start + material.quote.length;
        result = validateSourceSpan(
          source,
          {
            sourceId: source.id,
            sourceHash: material.wrongHash ? 'wrong' : source.hash,
            start,
            end,
            quote: material.quote,
          },
          source.projectId,
        );
        break;
      }
      case 'rank': {
        if (expected.error) {
          assert.throws(() => checkPrimeFieldRank(material), new RegExp(expected.error));
          return;
        }
        const first = checkPrimeFieldRank(material);
        assert.deepEqual(first, checkPrimeFieldRank(material));
        assert.equal(first.rank, expected.rank);
        assert.deepEqual(first.pivotColumns, expected.pivots);
        assert.deepEqual(first.input, material.matrix);
        return;
      }
      case 'schema':
        assert.equal(operationSchema.safeParse(material).success, expected.accepted);
        return;
      case 'support': {
        const data = graph(before, material);
        const original = stableSerialize(data);
        const support = evaluateSupport(data);
        assert.equal(stableSerialize(data), original, 'Pure evaluator does not mutate inputs');
        assert.deepEqual(support, evaluateSupport(data), 'Support projection is deterministic');
        for (const [id, status] of Object.entries(expected.revisions ?? {}))
          assert.equal(support.revisions[id]?.status, status, id);
        for (const [id, status] of Object.entries(expected.routes ?? {}))
          assert.equal(support.routes[id]?.status, status, id);
        for (const [id, ids] of Object.entries(expected.supports ?? {}))
          assert.deepEqual(support.revisions[id].supportingRouteIds, ids, id);
        if (expected.supported)
          assert.deepEqual(
            Object.values(support.revisions)
              .filter((r) => r.supported)
              .map((r) => r.revisionId)
              .sort(),
            expected.supported,
          );
        if (expected.openObligations)
          assert.deepEqual(support.openObligationIds, expected.openObligations);
        for (const id of expected.historicallySupported ?? [])
          assert.equal(support.revisions[id].historicallySupported, true, id);
        if (expected.conflicts) assert.deepEqual(support.conflicts, expected.conflicts);
        return;
      }
      default:
        assert.fail(`Fixture checker ${f.checker} is not implemented`);
    }
    assert.equal(result.outcome, expected.outcome);
    if (expected.contains)
      assert.ok(result.explanation.includes(expected.contains), result.explanation);
    assert.ok(result.rule && result.version && result.scope && result.limitations.length);
  });
test('Fixture catalog is discoverable, distinct, and exceeds the minimum without claiming domain tests', () => {
  assert.ok(fixtures.length >= 36);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length);
  assert.ok(
    fixtures.every((f) => f.beforeState && f.newMaterial && f.expected && f.reviewExplanation),
  );
});
test('Same-reviewer supersession preserves other researchers’ disagreement', () => {
  const data = graph(
    {
      claims: [{ id: 'A' }],
      reviews: [
        { id: 'first', target: 'A@1', actor: 'one' },
        { id: 'second', target: 'A@1', actor: 'two', decision: 'challenge' },
      ],
    },
    {
      reviews: [
        { id: 'third', target: 'A@1', actor: 'one', decision: 'retract', supersedes: 'first' },
      ],
    },
  );
  assert.deepEqual(
    activeHumanReviews(data.reviews).map((r) => r.id),
    ['second', 'third'],
  );
  assert.equal(evaluateSupport(data).revisions['A@1'].supported, false);
});
test('Another reviewer cannot supersede a judgment by forging its ID', () => {
  const data = graph(
    { claims: [{ id: 'A' }], reviews: [{ id: 'first', target: 'A@1', actor: 'one' }] },
    {
      reviews: [
        { id: 'second', target: 'A@1', actor: 'two', decision: 'challenge', supersedes: 'first' },
      ],
    },
  );
  assert.equal(activeHumanReviews(data.reviews).length, 2);
  assert.equal(evaluateSupport(data).revisions['A@1'].status, 'conflict');
});
test('Unicode source spans cannot split an emoji surrogate pair', () => {
  const source: SourceArtifact = {
    id: 's',
    projectId: 'p',
    kind: 'human_note',
    text: 'a😀z',
    hash: 'h',
    createdAt: timestamp,
    attribution: 'Synthetic',
  };
  assert.equal(
    validateSourceSpan(source, {
      sourceId: 's',
      sourceHash: 'h',
      start: 1,
      end: 2,
      quote: source.text.slice(1, 2),
    }).outcome,
    'fail',
  );
});
test('Safe prime-field checker rejects executable or oversized inputs', () => {
  assert.throws(() => checkPrimeFieldRank({ modulus: 5, matrix: [[1]], script: 'print(secret)' }));
  assert.throws(() =>
    checkPrimeFieldRank({ modulus: 5, matrix: Array.from({ length: 33 }, () => [1]) }),
  );
  assert.throws(() => checkPrimeFieldRank({ modulus: 1000003, matrix: [[1]] }));
  assert.throws(() => checkPrimeFieldRank({ modulus: 5, matrix: [[Number.MAX_SAFE_INTEGER + 1]] }));
});
test('Rank checker matches elementary row operations over several small prime fields', () => {
  for (const p of [2, 3, 5, 7, 11, 97])
    for (let n = 1; n <= 8; n++) {
      const matrix: number[][] = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
      );
      for (let i = 1; i < n; i++)
        for (let j = 0; j < n; j++) matrix[i][j] = (matrix[i][j] + 3 * matrix[i - 1][j]) % p;
      assert.equal(checkPrimeFieldRank({ modulus: p, matrix }).rank, n);
    }
});
test('Expression dependency analysis is bounded and reports cycles as unknown', () => {
  const contract = contractSchema.parse({
    variables: [
      { name: 'C', dependsOn: ['r'] },
      { name: 'r', dependsOn: ['C'] },
    ],
  });
  assert.equal(expressionDependencies({ kind: 'variable', name: 'C' }, contract).known, false);
});
test('AND/OR evaluator reaches seeded chains independent of route ordering', () => {
  for (let count = 2; count <= 25; count++) {
    const claims = Array.from({ length: count }, (_, i) => ({ id: `C${i}` }));
    const routes = Array.from({ length: count - 1 }, (_, i) => ({
      id: `route${count - i}`,
      premises: [`C${i}@1`],
      conclusion: `C${i + 1}@1`,
      reviewed: true,
    }));
    const data = graph({ claims, reviews: [{ target: 'C0@1' }], routes }, {});
    const first = evaluateSupport(data);
    data.routes.reverse();
    assert.deepEqual(first, evaluateSupport(data));
    assert.equal(Object.values(first.revisions).filter((r) => r.supported).length, count);
  }
});
test('Direct occurrence of a parameter in the exponent violates independence', () => {
  const variables = [
    { name: 'epsilon', meaning: 'error', domain: 'positive reals', dependsOn: [] },
  ];
  const result = checkContractCompatibility(
    { variables, runtime: { exponentIndependentOf: ['epsilon'] } },
    { variables, runtime: { exponent: { kind: 'variable', name: 'epsilon' } } },
  );
  assert.equal(result.find((x) => x.rule === 'runtime-exponent')?.outcome, 'fail');
});
test('Challenging one argument artifact leaves an independent route available', () => {
  const data = graph(
    {
      claims: [{ id: 'A' }, { id: 'B' }, { id: 'G' }],
      reviews: [{ target: 'A@1' }, { target: 'B@1' }],
      routes: [
        { id: 'rA', premises: ['A@1'], conclusion: 'G@1', reviewed: true },
        { id: 'rB', premises: ['B@1'], conclusion: 'G@1', reviewed: true },
      ],
    },
    { reviews: [{ target: 'argument:rA', targetRevisions: ['G@1'], decision: 'challenge' }] },
  );
  const support = evaluateSupport(data);
  assert.equal(support.routes.rA.status, 'conflict');
  assert.equal(support.routes.rB.status, 'usable');
  assert.equal(support.revisions['G@1'].supported, true);
});
test('Definition cycles terminate and do not provide current applicability', () => {
  const data = graph(
    {
      claims: [
        { id: 'D1', kind: 'definition', definitions: ['D2@1'] },
        { id: 'D2', kind: 'definition', definitions: ['D1@1'] },
        { id: 'A', definitions: ['D1@1'] },
      ],
      reviews: [{ target: 'A@1' }],
    },
    {},
  );
  assert.equal(evaluateSupport(data).revisions['A@1'].status, 'stale');
});
test('An inference review must cite the actual bound argument artifact', () => {
  const data = graph(
    {
      claims: [{ id: 'A' }, { id: 'G' }],
      reviews: [{ target: 'A@1' }],
      routes: [{ id: 'route', premises: ['A@1'], conclusion: 'G@1', reviewed: true }],
    },
    {},
  );
  data.reviews.find((r) => r.targetId === 'route')!.evidenceIds = ['unrelated'];
  assert.equal(evaluateSupport(data).routes.route.status, 'unreviewed');
});
test('Evaluation harness records unrun arms without invented results', () => {
  const report = JSON.parse(
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/engine-evaluate.ts'], {
      encoding: 'utf8',
    }),
  );
  assert.equal(report.status, 'not_run');
  assert.ok(report.arms.every((arm: any) => arm.status === 'not_run'));
});
test('Evaluation harness scores supplied artifacts, preserves budgets, and rejects model mixing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-engine-eval-'));
  try {
    const file = join(dir, 'synthetic-controlled.json');
    const artifact = {
      provider: 'controlled fixture',
      model: 'synthetic-not-a-model-call',
      budget: { inputTokens: 0, outputTokens: 0 },
      promoted: true,
      recordedMeaningfulUpdate: false,
      staleDetected: false,
      sourceGrounded: false,
      artifactReference: 'synthetic-controlled-visible-output',
    };
    const data = {
      formatVersion: 1,
      provenance: 'synthetic',
      annotationAttribution: 'Synthetic engineering test; no real model execution',
      projects: [
        {
          id: 'synthetic-heldout',
          split: 'held_out',
          examples: [
            {
              id: 'scope',
              expected: {
                mayPromote: false,
                meaningfulUpdate: true,
                stale: true,
                requiresSource: true,
              },
              arms: { A_notes: artifact, B_retrieval: { ...artifact, promoted: false } },
            },
          ],
        },
      ],
    };
    writeFileSync(file, JSON.stringify(data));
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/engine-evaluate.ts', `--input=${file}`],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(result.heldOut[0].falseClaimPromotions, 1);
    assert.equal(result.heldOut[0].missedMeaningfulUpdates, 1);
    assert.equal(result.heldOut[0].reviewerWorkload.status, 'not_measured');
    assert.equal(result.heldOut[2].status, 'not_run');
    data.projects[0].examples[0].arms.B_retrieval.model = 'different-model';
    writeFileSync(file, JSON.stringify(data));
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/engine-evaluate.ts', `--input=${file}`],
          { stdio: 'pipe' },
        ),
      /Command failed/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('Integration fixture catalog points to real tests instead of pretending pure kernels cover storage', () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL('./fixtures/research-engine/synthetic-integration-catalog.json', import.meta.url),
      'utf8',
    ),
  ) as any[];
  for (const fixture of catalog) {
    assert.ok(
      fixture.beforeState &&
        fixture.newMaterial &&
        fixture.expected &&
        fixture.expectedUnknowns.length,
    );
    assert.ok(
      readFileSync(new URL(`../${fixture.testFile}`, import.meta.url), 'utf8').includes(
        fixture.testName,
      ),
      fixture.id,
    );
  }
  assert.deepEqual(
    catalog.flatMap((f) => f.requirements),
    [25, 26, 27, 28, 30, 33, 34],
  );
});
test('An additional scoped challenge or retraction reopens a previously resolved obligation', () => {
  for (const decision of ['challenge', 'retract'] as const) {
    const data = graph(
      {
        claims: [{ id: 'A' }, { id: 'G' }],
        reviews: [
          { target: 'A@1' },
          {
            id: 'resolution',
            target: 'ob',
            scope: 'goal_satisfaction',
            targetRevisions: ['A@1', 'G@1'],
            actor: 'reviewer one',
          },
        ],
        obligations: [{ id: 'ob', target: 'G@1' }],
      },
      {},
    );
    data.obligations[0].resolutionRevisionId = 'A@1';
    data.obligations[0].resolutionReviewId = 'resolution';
    assert.deepEqual(evaluateSupport(data).openObligationIds, []);
    data.reviews.push({
      id: 'disagreement',
      projectId: data.project.id,
      targetId: 'ob',
      targetRevisionIds: ['G@1', 'A@1'],
      decision,
      scope: 'goal_satisfaction',
      reason: 'The exact resolution has an unresolved gap.',
      actor: 'reviewer two',
      createdAt: timestamp,
      evidenceIds: [],
      checkIds: [],
      trust: 'human',
    });
    const projection = evaluateSupport(data);
    assert.deepEqual(projection.openObligationIds, ['ob']);
    if (decision === 'challenge') assert.ok(projection.conflicts.includes('ob'));
    assert.equal(
      data.obligations[0].resolutionReviewId,
      'resolution',
      'Historical mapping is retained',
    );
    data.reviews.push({
      ...data.reviews.at(-1)!,
      id: 'withdraw-disagreement',
      decision: 'endorse',
      supersedes: 'disagreement',
      reason: 'I explicitly withdraw my prior objection after reviewing the missing step.',
    });
    assert.deepEqual(
      evaluateSupport(data).openObligationIds,
      [],
      'Only explicit valid supersession removes the objection',
    );
  }
});
