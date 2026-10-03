import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAccess, isPublicRead, publicResearch, publicProgram } from '../cloud/access';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';

test('public access permits only exact research reads; owner credentials are required for every other route', () => {
  const env = { WORKSPACE_OWNER_EMAIL: 'owner@example.test' };
  const request = (path: string, method = 'GET', headers = {}) =>
    new Request(`https://research.test${path}`, { method, headers });
  for (const path of ['/api/state', '/api/program', '/api/health']) {
    assert.equal(isPublicRead(request(path)), true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal(isPublicRead(request(path, method)), false);
  }
  for (const path of [
    '/api/state/',
    '/api/program/goals',
    '/api/drafts',
    '/api/notebook/state',
    '/api/notebook/import',
    '/api/notebook/candidates/example/integrate',
    '/api/research-chat/state',
    '/api/research-chat/connection',
    '/api/workspace/import',
    '/api/nodes',
  ])
    assert.equal(isPublicRead(request(path)), false);
  assert.equal(workspaceAccess(request('/api/state'), env).canEdit, false);
  assert.equal(
    workspaceAccess(
      request('/api/state', 'GET', { 'oai-authenticated-user-email': 'owner@example.test' }),
      env,
    ).canEdit,
    false,
  );
  assert.equal(
    workspaceAccess(
      request('/api/state', 'GET', {
        'oai-authenticated-user-id': 'visitor',
        'oai-authenticated-user-email': 'visitor@example.test',
      }),
      env,
    ).canEdit,
    false,
  );
  const owner = request('/api/state', 'GET', {
    'oai-authenticated-user-id': 'site-owner',
    'oai-authenticated-user-email': 'owner@example.test',
  });
  assert.equal(workspaceAccess(owner, env).canEdit, true);
  assert.equal(workspaceAccess(owner, {}).canEdit, false);
  assert.equal(workspaceAccess(new Request('http://localhost/api/state'), env).canEdit, false);
});

test('public research preserves mathematics while excluding source transcripts, history, local files and identity metadata', () => {
  const store = new Store(':memory:');
  try {
    const program = new ProgramStore(store);
    const state = store.state();
    state.nodes[0].provenanceText = 'PRIVATE transcript';
    state.nodes[0].originName = 'PRIVATE identity';
    state.nodes[0].links = [
      '/PRIVATE/local-path',
      'file:///PRIVATE/file',
      'https://example.test/paper',
    ];
    state.events[0].reason = 'PRIVATE history';
    (state as any).drafts = [{ transcript: 'PRIVATE draft' }];
    (state.nodes[0] as any).futurePrivateField = 'PRIVATE field';
    const result = publicResearch(state);
    assert.equal(result.nodes.length, state.nodes.length);
    assert.equal(result.nodes[0].content, state.nodes[0].content);
    assert.deepEqual(result.nodes[0].links, ['https://example.test/paper']);
    assert.equal(result.events.length, 0);
    assert.equal(result.canEdit, false);
    assert.equal(result.llmEnabled, false);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    const data = program.state();
    data.assessments[0].reviewer = 'PRIVATE reviewer';
    data.assessments[0].basisFingerprint = 'PRIVATE fingerprint';
    const publicData = publicProgram(data);
    assert.equal(publicData.goals.length, data.goals.length);
    assert.equal(publicData.assessments[0].mechanism, data.assessments[0].mechanism);
    assert.ok(!JSON.stringify(publicData).includes('PRIVATE'));
  } finally {
    store.db.close();
  }
});

test('preview owner mode requires both an explicit flag and a loopback hostname', () => {
  assert.equal(
    workspaceAccess(new Request('http://localhost/api/state'), { LOCAL_PREVIEW_OWNER: 'true' })
      .canEdit,
    true,
  );
  assert.equal(
    workspaceAccess(new Request('https://research.test/api/state'), { LOCAL_PREVIEW_OWNER: 'true' })
      .canEdit,
    false,
  );
});
