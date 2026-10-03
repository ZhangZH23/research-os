import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';

const options = process.argv.slice(2);
const option = (name: string) => {
  const i = options.indexOf(name);
  return i < 0 ? undefined : options[i + 1];
};
const base = new URL(option('--url') ?? 'http://localhost:4312');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('Synthetic acceptance only runs against the local preview.');
async function api(
  path: string,
  project?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await fetch(new URL('/api' + path, base), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(project ? { 'x-research-project': project } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${result.error}`);
  return result;
}
const fingerprint = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');
const snapshot = async (project: string) => {
  const data = await api('/engine/state', project);
  return {
    head: data.project.headCommitId,
    records: fingerprint({
      objects: data.objects,
      revisions: data.revisions,
      sources: data.sources,
      evidence: data.evidence,
      routes: data.routes,
      reviews: data.reviews,
      checks: data.checks,
      obligations: data.obligations,
      relationships: data.relationships,
      commits: data.commits,
      publications: data.publications,
      runs: data.runs,
    }),
    public: await api('/public/export', project),
  };
};
if (option('--verify')) {
  const saved = JSON.parse(await readFile(resolve(option('--verify')!), 'utf8'));
  assert.deepEqual(await snapshot(saved.projectA), saved.snapshot);
  assert.equal((await api('/engine/state', saved.projectB)).objects.length, 0);
  console.log(
    'PASS: persisted records, exact hashes, checks, history and public snapshot reproduced after restart.',
  );
  process.exit(0);
}
const A = (
  await api('/projects', undefined, {
    title: 'Synthetic HTTP parity acceptance ' + new Date().toISOString(),
    description: 'Synthetic engineering fixture, not a research result.',
  })
).id;
const B = (await api('/projects', A, { title: 'Synthetic unrelated geometry acceptance' })).id;
assert.equal((await api('/engine/state', B)).sources.length, 0);
assert.equal((await api('/engine/state', B)).objects.length, 0);
const source = async (text: string, kind = 'human_note') => {
  const s = await api('/engine/sources', A, {
    kind,
    text,
    attribution: 'Synthetic acceptance fixture',
  });
  return [{ sourceId: s.id, sourceHash: s.hash, start: 0, end: s.text.length, quote: s.text }];
};
const commit = async (operations: any[], sources: any[], title: string) => {
  const p = await api('/engine/proposals', A, {
    title,
    baseCommitId: (await api('/engine/state', A)).project.headCommitId,
    operations,
    sources,
  });
  const check = await api(`/engine/proposals/${p.id}/check`, A, {});
  await api(`/engine/proposals/${p.id}/review`, A, {
    decision: 'approve',
    revision: p.revision,
    reason:
      'Synthetic human admission only; open and restricted statements are retained without certification.',
  });
  const input = { revision: p.revision, idempotencyKey: randomUUID() };
  const committed = await api(`/engine/proposals/${p.id}/commit`, A, input);
  assert.equal((await api(`/engine/proposals/${p.id}/commit`, A, input)).alreadyApplied, true);
  return { commit: committed, check };
};
const text =
  '😀 Synthetic parity study.\r\nGoal: compute parity for every binary string.\r\nL1: after k scan steps, the accumulator is the XOR of the first k bits.\r\nL2: an XOR tree computes the XOR of all bits.\r\nG: parity can be computed with at most n XOR operations.\r\nThe first-bit shortcut fails on 01; the first bit is 0 and parity is 1.';
const spans = await source(text);
const baseContract = {
  inputGuarantee: 'arbitrary',
  inputDomain: 'binary strings of length n',
  construction: 'explicit',
  assumptions: [],
  quantifiers: [{ kind: 'forall', variable: 'x', domain: 'binary strings' }],
};
const initial = await commit(
  [
    {
      type: 'add_claim',
      tempId: 'goal',
      kind: 'goal',
      title: 'Exact synthetic parity goal',
      statement: 'For every binary string of length n, compute its parity using at most n XORs.',
      contract: baseContract,
      sources: spans,
    },
    {
      type: 'add_claim',
      tempId: 'l1',
      title: 'Scan invariant',
      statement: 'After k scan steps, the accumulator equals the XOR of the first k bits.',
      sources: spans,
    },
    {
      type: 'add_claim',
      tempId: 'l2',
      title: 'Tree computation',
      statement: 'An XOR tree computes the XOR of all bits.',
      sources: spans,
    },
    {
      type: 'add_claim',
      tempId: 'g',
      title: 'Synthetic parity result',
      statement: 'Parity can be computed using at most n XOR operations.',
      contract: baseContract,
      sources: spans,
    },
    {
      type: 'record_failed_attempt',
      tempId: 'failure',
      title: 'First-bit shortcut failure',
      statement: 'The first-bit parity shortcut fails on 01.',
      methodScope: 'Binary strings of length two',
      failureReason: 'First bit is zero while parity is one.',
      sources: spans,
    },
    {
      type: 'add_obligation',
      tempId: 'obligation',
      title: 'General goal scope mapping remains open',
      statement: 'Explain how the algorithm result establishes the exact general goal.',
      targetRevisionId: '$goal',
      premiseRevisionIds: ['$g'],
      sources: spans,
    },
  ],
  spans,
  'Synthetic exact goal and research ingredients',
);
const ids = initial.commit.temporaryIds;
console.log(
  'PASS: two empty private projects, immutable Unicode source, goal and ingredients; idempotent commits.',
);
const transcript =
  'User: Establish the arbitrary-input guarantee.\r\nAssistant: This result only covers a uniformly random input. It does not establish arbitrary inputs.';
await api('/notebook/import', A, {
  title: 'Synthetic scope drift',
  source: 'Synthetic conversation',
  goalId: null,
  originalTranscript: transcript,
  turns: [
    { role: 'user', content: 'Establish the arbitrary-input guarantee.' },
    {
      role: 'assistant',
      content:
        'This result only covers a uniformly random input. It does not establish arbitrary inputs.',
    },
  ],
});
const restrictedSource = await source(transcript, 'conversation');
const restricted = await commit(
  [
    {
      type: 'add_claim',
      tempId: 'restricted',
      title: 'Restricted synthetic result',
      statement: 'This supplied attempt only covers a uniformly random binary input.',
      contract: { ...baseContract, inputGuarantee: 'random' },
      sources: restrictedSource,
    },
  ],
  restrictedSource,
  'Inspect and retain restricted result',
);
assert.ok(
  restricted.check.findings.some(
    (f: any) => f.outcome === 'fail' && /random|guarantee|arbitrary/i.test(f.explanation),
  ),
);
assert.equal(
  (await api('/engine/state', A)).goalSatisfaction.find((s: any) => s.revisionId === ids.goal)
    .status,
  'open',
);
console.log(
  'PASS: imported conversation, explicit scope warning, restricted private admission leaves general goal open.',
);
const evidenceSource = await source(
  'Synthetic visible argument: XOR accumulator induction starts at zero and appends one bit. XOR associativity justifies a reduction tree. Each inference is a supplied human judgment.',
);
const count = (await api('/engine/state', A)).objects.length;
const evidence = await commit(
  ['l1', 'l2', 'g'].map((key) => ({
    type: 'add_evidence',
    tempId: 'e_' + key,
    targetRevisionId: ids[key],
    kind: 'human_argument',
    content:
      key === 'l1'
        ? 'Base accumulator is 0. Each step XORs the next bit, preserving the prefix invariant.'
        : key === 'l2'
          ? 'Associativity of XOR permits the reduction tree, with n-1 XORs for n>0 and 0 for empty input.'
          : 'Use the scan invariant at k=n, or the associative XOR tree. Both compute parity within the bound.',
    scope: 'Synthetic binary parity example; attributed human argument',
    sources: evidenceSource,
  })),
  evidenceSource,
  'Attach arguments to existing revisions',
);
assert.equal((await api('/engine/state', A)).objects.length, count);
for (const key of ['l1', 'l2'])
  await api('/engine/reviews', A, {
    targetId: ids[key],
    decision: 'endorse',
    scope: 'mathematical',
    reason: 'Synthetic human review of the explicitly supplied parity argument.',
    evidenceIds: [evidence.commit.temporaryIds['e_' + key]],
  });
const routes = await commit(
  ['l1', 'l2'].map((key) => ({
    type: 'add_argument_or_route',
    tempId: 'route_' + key,
    title: key === 'l1' ? 'Scan route' : 'Tree route',
    conclusionRevisionId: ids.g,
    premiseRevisionIds: [ids[key]],
    localAssumptions: [],
    evidenceId: evidence.commit.temporaryIds.e_g,
    sources: evidenceSource,
  })),
  evidenceSource,
  'Two independent proof routes',
);
for (const key of ['l1', 'l2'])
  await api('/engine/reviews', A, {
    targetId: routes.commit.temporaryIds['route_' + key],
    decision: 'endorse',
    scope: 'inference',
    reason: 'Synthetic human endorsement of this exact premise to conclusion inference.',
    evidenceIds: [evidence.commit.temporaryIds.e_g],
  });
assert.equal((await api('/engine/state', A)).support.revisions[ids.g].supported, true);
await api('/engine/reviews', A, {
  targetId: routes.commit.temporaryIds.route_l1,
  decision: 'retract',
  scope: 'inference',
  reason: 'Withdraw the scan inference to exercise independent route survival.',
});
const support = (await api('/engine/state', A)).support;
assert.equal(support.revisions[ids.g].supported, true);
assert.equal(support.routes[routes.commit.temporaryIds.route_l2].status, 'usable');
console.log(
  'PASS: additional evidence creates no duplicate claim; independent route survives retraction.',
);
const before = await api('/engine/state', A),
  object = before.objects.find((o: any) => o.currentRevisionId === ids.l1);
const revisedSource = await source('Revised scan invariant restricted to nonempty binary strings.');
const revision = await commit(
  [
    {
      type: 'propose_claim_revision',
      tempId: 'new_l1',
      objectId: object.id,
      parentRevisionId: ids.l1,
      statement:
        'For nonempty binary strings, after k scan steps the accumulator is the XOR of the first k bits.',
      sources: revisedSource,
    },
  ],
  revisedSource,
  'Revise exact statement without inheriting support',
);
const after = await api('/engine/state', A);
assert.equal(after.support.revisions[revision.commit.temporaryIds.new_l1].supported, false);
assert.ok(after.reviews.some((r: any) => r.targetId === ids.l1 && r.scope === 'mathematical'));
assert.ok(
  (await api('/engine/diff', A)).entries.some(
    (entry: any) => entry.beforeRevisionId === ids.l1 && entry.sources.length,
  ),
);
const context = await api('/engine/context', A, {
  query: 'Avoid the first-bit parity shortcut failure',
  goalRevisionId: ids.goal,
});
assert.ok(context.manifest.selectedRevisionIds.includes(ids.failure));
assert.ok(context.text.includes('General goal scope mapping remains open'));
const session = await api('/research-chat/sessions', A, {
  title: 'Synthetic resumed parity session',
});
assert.ok(session.id);
console.log(
  'PASS: immutable historical review, deterministic source-linked diff, relevant failure and open obligation in resume context.',
);
const selected = { revisionIds: [ids.g], title: 'Synthetic public parity snapshot' };
const preview = await api('/engine/publications/preview', A, selected);
await api('/engine/publications', A, {
  ...selected,
  previewHash: preview.previewHash,
  confirm: true,
});
const publicBefore = await api('/public/export', A);
await source('PRIVATE_ACCEPTANCE_MARKER_KEEP_OUT_OF_PUBLIC_SNAPSHOT');
await api('/projects/' + A, A, { title: 'PRIVATE_METADATA_MARKER' }, 'PATCH');
const g = after.objects.find((o: any) => o.currentRevisionId === ids.g);
const privateRevisionSource = await source('PRIVATE_REVISION_MARKER restricted parity statement.');
await commit(
  [
    {
      type: 'propose_claim_revision',
      tempId: 'private_g',
      objectId: g.id,
      parentRevisionId: ids.g,
      statement: 'PRIVATE_REVISION_MARKER restricted parity statement.',
      sources: privateRevisionSource,
    },
  ],
  privateRevisionSource,
  'Private later revision',
);
assert.deepEqual(await api('/public/export', A), publicBefore);
assert.ok(!JSON.stringify(publicBefore).includes('PRIVATE_'));
assert.equal((await api('/engine/state', B)).objects.length, 0);
assert.equal((await api('/engine/state', B)).sources.length, 0);
console.log(
  'PASS: exact snapshot stays fixed across private source, metadata and statement edits; project B stays empty.',
);
// A non-loopback Host exercises production-style anonymous authorization locally.
const anonymous = (path: string, project: string) =>
  new Promise<{ status: number; data: any }>((resolve, reject) => {
    http
      .get(
        new URL('/api' + path, base),
        { headers: { host: 'public.example', 'x-research-project': project } },
        (response) => {
          let text = '';
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () => {
            try {
              resolve({ status: response.statusCode!, data: JSON.parse(text) });
            } catch (error) {
              reject(error);
            }
          });
        },
      )
      .on('error', reject);
  });
assert.equal((await anonymous('/engine/export', A)).status, 401);
assert.equal((await anonymous('/public/export', B)).status, 404);
assert.equal((await anonymous('/state', B)).status, 404);
const listing = await anonymous('/projects', A);
assert.equal(listing.status, 200);
assert.ok(!listing.data.projects.some((p: any) => p.id === B));
assert.equal(
  listing.data.projects.find((p: any) => p.id === A).title,
  'Synthetic public parity snapshot',
);
assert.deepEqual((await anonymous('/public/export', A)).data, publicBefore);
assert.ok(!JSON.stringify((await anonymous('/state', A)).data).includes('PRIVATE_'));
console.log('PASS: anonymous HTTP privacy boundaries and frozen publication metadata.');
const destination = resolve(option('--out') ?? 'test-results/engine-acceptance.json');
await mkdir(resolve(destination, '..'), { recursive: true });
await writeFile(
  destination,
  JSON.stringify(
    {
      provenance: 'synthetic HTTP acceptance',
      projectA: A,
      projectB: B,
      snapshot: await snapshot(A),
      limitations: [
        'Controlled human reviews; no live model call or product evaluation.',
        'HTTP workflows are not a substitute for browser interaction checks.',
      ],
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`Recorded ${destination}. Restart the preview, then run with --verify ${destination}.`);
