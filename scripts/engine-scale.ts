import { performance } from 'node:perf_hooks';
import { arch, cpus, platform, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import { emptyEngineData, type EngineData } from '../shared/engine';
import { evaluateSupport } from '../shared/engine-support';
import initSqlJs from 'sql.js';
import { SQLiteDatabase, type StoredRecord } from '../cloud/sqlite';
/** Synthetic pure-kernel and real request-local SQLite benchmark; no network/D1 timing. */
function dataset(size: number): EngineData {
  const time = '2026-01-01T00:00:00.000Z';
  const data = emptyEngineData({
    id: 'scale-synthetic',
    title: 'Synthetic scale test',
    description: 'Generated engineering workload',
    createdAt: time,
    archived: false,
    visibility: 'private',
    headCommitId: null,
  });
  for (let i = 0; i < size; i++) {
    const id = `claim-${String(i).padStart(6, '0')}`,
      rid = `${id}@1`,
      eid = `argument-${i}`;
    data.objects.push({
      id,
      projectId: data.project.id,
      title: `Synthetic claim ${i}`,
      kind: 'claim',
      currentRevisionId: rid,
      archived: false,
      createdAt: time,
    });
    data.revisions.push({
      id: rid,
      projectId: data.project.id,
      objectId: id,
      parentRevisionId: null,
      statement: `Synthetic proposition P_${i}; this is not an actual mathematical theorem.`,
      contract: { assumptions: [] },
      sources: [],
      definitionRevisionIds: [],
      actor: 'Synthetic fixture',
      createdAt: time,
      hash: `synthetic-hash-${i}`,
      formatVersion: 1,
    });
    data.evidence.push({
      id: eid,
      projectId: data.project.id,
      targetRevisionId: rid,
      kind: 'human_argument',
      content: 'Synthetic argument placeholder used only for engineering load generation.',
      sources: [],
      scope: 'This generated proposition',
      actor: 'Synthetic fixture',
      createdAt: time,
    });
    if (i > 0)
      data.routes.push({
        id: `route-${i}`,
        projectId: data.project.id,
        title: `Synthetic implication ${i}`,
        conclusionRevisionId: rid,
        premiseRevisionIds: [data.revisions[i - 1].id],
        localAssumptions: [],
        evidenceId: eid,
        sources: [],
        actor: 'Synthetic fixture',
        createdAt: time,
      });
    data.reviews.push({
      id: `review-${i}`,
      projectId: data.project.id,
      targetId: i ? `route-${i}` : rid,
      targetRevisionIds: i ? [rid, data.revisions[i - 1].id] : [rid],
      decision: 'endorse',
      reason: 'Synthetic engineering annotation; not expert proof review.',
      actor: 'Synthetic fixture',
      createdAt: time,
      evidenceIds: [eid],
      checkIds: [],
      scope: i ? 'inference' : 'mathematical',
      trust: 'human',
    });
  }
  return data;
}
const args = process.argv.slice(2);
const count = Number(args.find((a) => a.startsWith('--size='))?.split('=')[1] ?? 1200);
if (!Number.isSafeInteger(count) || count < 10 || count > 5000)
  throw new Error('Benchmark size must be an integer from 10 to 5000.');
const trials = 5;
const buildStart = performance.now();
const data = dataset(count);
const buildMs = performance.now() - buildStart;
const serialized = JSON.stringify(data);
const samples: { jsonReconstructionMs: number; supportEvaluationMs: number }[] = [];
evaluateSupport(data); // one warmup, excluded
for (let i = 0; i < trials; i++) {
  const start = performance.now();
  const fresh = JSON.parse(serialized) as EngineData;
  const reconstructed = performance.now();
  const projection = evaluateSupport(fresh);
  const finish = performance.now();
  const supported = Object.values(projection.revisions).filter((r) => r.supported).length;
  if (supported !== count)
    throw new Error(`Benchmark correctness invariant failed: ${supported}/${count}`);
  samples.push({
    jsonReconstructionMs: reconstructed - start,
    supportEvaluationMs: finish - reconstructed,
  });
}
const sqlInitStart = performance.now();
const SQL = await initSqlJs();
const sqlRuntimeInitMs = performance.now() - sqlInitStart;
const collections = {
  objects: 'object',
  revisions: 'revision',
  evidence: 'evidence',
  routes: 'route',
  reviews: 'review',
} as const;
const records: StoredRecord[] = [
  {
    collection: 'projects',
    id: data.project.id,
    position: 1,
    payload: JSON.stringify({ id: data.project.id, data: JSON.stringify(data.project) }),
  },
];
let position = 0;
for (const [key, kind] of Object.entries(collections))
  for (const value of data[key as keyof typeof collections])
    records.push({
      collection: 'engine_records',
      id: value.id,
      position: ++position,
      payload: JSON.stringify({
        id: value.id,
        project_id: data.project.id,
        kind,
        data: JSON.stringify(value),
      }),
    });
const sqlSamples: {
  reconstructionMs: number;
  snapshotMs: number;
  readAndDecodeMs: number;
  supportEvaluationMs: number;
}[] = [];
const sqlWarmup = new SQLiteDatabase(SQL, records);
sqlWarmup.snapshot();
sqlWarmup.close();
for (let i = 0; i < trials; i++) {
  const begin = performance.now();
  const db = new SQLiteDatabase(SQL, records);
  const restored = performance.now();
  const snapshot = db.snapshot();
  const snapshotEnd = performance.now();
  if (snapshot.length !== records.length) throw new Error('SQLite reconstruction lost records');
  const fresh = emptyEngineData(
    JSON.parse(
      String(db.prepare('SELECT data FROM projects WHERE id=?').get(data.project.id)!.data),
    ),
  );
  for (const [key, kind] of Object.entries(collections))
    (fresh as any)[key] = db
      .prepare('SELECT data FROM engine_records WHERE project_id=? AND kind=? ORDER BY rowid')
      .all(data.project.id, kind)
      .map((row) => JSON.parse(String(row.data)));
  const decoded = performance.now();
  const projection = evaluateSupport(fresh);
  const evaluated = performance.now();
  db.close();
  if (Object.values(projection.revisions).filter((r) => r.supported).length !== count)
    throw new Error('Restored SQLite graph lost support references');
  sqlSamples.push({
    reconstructionMs: restored - begin,
    snapshotMs: snapshotEnd - restored,
    readAndDecodeMs: decoded - snapshotEnd,
    supportEvaluationMs: evaluated - decoded,
  });
}
const round = (n: number) => Number(n.toFixed(3));
const values = samples.map((s) => s.supportEvaluationMs).sort((a, b) => a - b);
const median = (key: keyof (typeof sqlSamples)[number]) =>
  round(sqlSamples.map((s) => s[key]).sort((a, b) => a - b)[Math.floor(trials / 2)]);
const report = {
  provenance: 'Synthetic engineering benchmark, not product validation',
  measuredAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
  },
  dataset: {
    objects: count,
    revisions: count,
    evidence: count,
    routes: count - 1,
    reviews: count,
    serializedBytes: Buffer.byteLength(serialized),
  },
  trials,
  warmupTrials: 1,
  buildMs: round(buildMs),
  sqlite: {
    implementation: 'Real sql.js SQLiteDatabase bridge used by the Worker',
    records: records.length,
    serializedRecordBytes: Buffer.byteLength(JSON.stringify(records)),
    runtimeInitializationMs: round(sqlRuntimeInitMs),
    warmupTrials: 1,
    samples: sqlSamples.map((sample) =>
      Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, round(v)])),
    ),
    medianMs: {
      reconstruction: median('reconstructionMs'),
      snapshot: median('snapshotMs'),
      readAndDecode: median('readAndDecodeMs'),
      supportEvaluation: median('supportEvaluationMs'),
    },
  },
  samples: samples.map((s) => ({
    jsonReconstructionMs: round(s.jsonReconstructionMs),
    supportEvaluationMs: round(s.supportEvaluationMs),
  })),
  summary: {
    supportMedianMs: round(values[Math.floor(trials / 2)]),
    supportMinMs: round(values[0]),
    supportMaxMs: round(values.at(-1)!),
    processRssMiB: round(process.memoryUsage().rss / 1024 / 1024),
  },
  limitations: [
    'Measures JSON and actual request-local SQL.js SQLite reconstruction/snapshot/read plus pure support; D1/network, HTTP, and browser throughput were not measured.',
    'The current application still loads the whole workspace; no claim of 100,000-claim scale follows from this experiment.',
    'Some review/evidence and conclusion scans remain quadratic. The benchmark measures one sparse synthetic chain, not all possible graphs.',
    'No model was called; no human time savings or mathematical research superiority was measured.',
  ],
};
const output = args.find((a) => a.startsWith('--out='))?.slice(6);
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
