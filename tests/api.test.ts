import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app';
import { Store } from '../server/store';

test('HTTP workflow: validation, CRUD, status history, draft review, and local request boundaries', async () => {
  const store = new Store(':memory:', false);
  const server = createServer(createApp(store));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal((await request('/nodes', 'POST', { title: '', type: 'Claim' })).status, 400);
    assert.equal(
      (
        await request('/nodes-with-relationship', 'POST', {
          node: { title: 'Orphan must roll back', type: 'Evidence' },
          link: { targetNodeId: 'missing', edgeType: 'supports' },
        })
      ).status,
      404,
    );
    assert.equal(store.state().nodes.length, 0);
    let response = await request('/nodes', 'POST', { title: 'HTTP claim', type: 'Claim' });
    assert.equal(response.status, 201);
    const node = await response.json();
    response = await request(`/nodes/${node.id}`, 'PATCH', {
      title: 'Edited HTTP claim',
      epistemicStatus: 'Proved',
      reason: 'Proof reviewed',
    });
    assert.equal(response.status, 200);
    assert.equal(
      (
        await request(
          '/nodes',
          'POST',
          { title: 'Blocked write', type: 'Claim' },
          { Origin: 'https://malicious.example' },
        )
      ).status,
      403,
    );
    response = await request('/ingest/extract', 'POST', {
      transcript: 'Claim: First.\n\nLemma: Second.',
      sourceName: 'API session',
      mode: 'manual',
    });
    assert.equal(response.status, 200);
    const draft = await response.json();
    const items = draft.items.map((i: object) => ({ ...i, decision: 'create' }));
    response = await request(`/drafts/${draft.id}`, 'PUT', {
      items: [items[0], items[0]],
      edges: [],
    });
    assert.equal(response.status, 400);
    response = await request(`/drafts/${draft.id}`, 'PUT', { items, edges: [] });
    assert.equal(response.status, 200);
    response = await request(`/ingest/${draft.id}/commit`, 'POST', { items, edges: [] });
    assert.equal(response.status, 200);
    response = await request('/state');
    const state = await response.json();
    assert.equal(state.nodes.length, 4);
    assert.ok(state.events.some((e: { eventType: string }) => e.eventType === 'status_changed'));
    assert.equal((await request(`/nodes/${node.id}`, 'DELETE', {})).status, 200);
    assert.equal((await request(`/nodes/${node.id}`, 'PATCH', { title: 'Missing' })).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
