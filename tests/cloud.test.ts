import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { Repository, ConflictError } from '../cloud/repository';
import { Store } from '../server/domain-store';
import { ProgramStore } from '../server/program-store';
import { ChatStore } from '../server/chat';
import { ConnectionManager as LocalConnection } from '../server/connection';
import { ConnectionManager } from '../cloud/connection';
const SQL = await initSqlJs();
class TestD1 {
  database = new DatabaseSync(':memory:');
  failAt = -1;
  ambiguous = false;
  constructor() {
    this.database.exec(
      readFileSync(new URL('../drizzle/0000_fat_jane_foster.sql', import.meta.url), 'utf8'),
    );
  }
  withSession() {
    return this;
  }
  prepare(sql: string) {
    let values: any[] = [];
    const execute = () => {
      const statement = this.database.prepare(sql);
      const rows = statement.columns().length ? statement.all(...values) : [];
      let changes = 0;
      if (!/^SELECT/i.test(sql)) {
        if (!statement.columns().length) changes = Number(statement.run(...values).changes);
        else changes = Number((this.database.prepare('SELECT changes() AS n').get() as any).n);
      }
      return { success: true, results: rows, meta: { changes } };
    };
    const api = {
      sql,
      bind(...params: any[]) {
        values = params;
        return api;
      },
      run: async () => execute(),
      first: async () => execute().results[0] ?? null,
      execute,
    };
    return api;
  }
  async batch(statements: any[]) {
    this.database.exec('BEGIN');
    try {
      const results = statements.map((statement, index) => {
        if (index === this.failAt) throw new Error('Injected D1 failure');
        return statement.execute();
      });
      this.database.exec('COMMIT');
      if (this.ambiguous) {
        this.ambiguous = false;
        throw new Error('Injected ambiguous network outcome');
      }
      return results;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
async function load(binding: TestD1) {
  const repo = new Repository(SQL, binding as any);
  await repo.reload();
  const store = new Store(repo.db);
  const program = new ProgramStore(store);
  await repo.save();
  return { repo, store, program };
}
test('real SQLite bridge preserves schema constraints, history and persistent program across request reloads', async () => {
  const binding = new TestD1();
  const first = await load(binding);
  const before = first.store.state();
  first.repo.close();
  const next = await load(binding);
  assert.deepEqual(next.store.state(), before);
  assert.equal(next.program.state().goals.length, 4);
  const node = next.store.state().nodes[0];
  assert.throws(
    () =>
      next.store.transaction(() => {
        next.store.createNode({ title: 'Rolled back', type: 'Claim' });
        throw new Error('audit failed');
      }),
    /audit failed/,
  );
  await next.repo.save();
  next.repo.close();
  const end = await load(binding);
  assert.equal(end.store.state().nodes.length, 17);
  assert.equal(end.store.getNode(node.id).title, node.title);
  end.repo.close();
  binding.database.close();
});
test('a stale writer cannot change any row, and a late batch failure rolls back revision and all records', async () => {
  const binding = new TestD1();
  const a = await load(binding);
  const b = await load(binding);
  const kept = a.store.createNode({ title: 'Winning edit', type: 'Claim' });
  await a.repo.save();
  b.store.createNode({ title: 'Losing edit', type: 'Claim' });
  await assert.rejects(() => b.repo.save(), ConflictError);
  const c = await load(binding);
  assert.ok(c.store.getNode(kept.id));
  assert.ok(!c.store.state().nodes.some((n) => n.title === 'Losing edit'));
  c.store.createNode({ title: 'Failing batch', type: 'Claim' });
  binding.failAt = 2;
  await assert.rejects(() => c.repo.save(), /Injected/);
  binding.failAt = -1;
  const d = await load(binding);
  assert.ok(!d.store.state().nodes.some((n) => n.title === 'Failing batch'));
  for (const value of [a, b, c, d]) value.repo.close();
  binding.database.close();
});
test('distributed chat leases exclude concurrent sends and an old release cannot remove a new lease', async () => {
  const binding = new TestD1();
  const a = await load(binding);
  const b = await load(binding);
  const oldRelease = await a.repo.acquireChat('session');
  await assert.rejects(() => b.repo.acquireChat('session'), /already in progress/);
  binding.database.prepare('UPDATE chat_leases SET expires_at=0').run();
  const newRelease = await b.repo.acquireChat('session');
  await oldRelease();
  await assert.rejects(() => a.repo.acquireChat('session'), /already in progress/);
  await newRelease();
  const last = await a.repo.acquireChat('session');
  await last();
  a.repo.close();
  b.repo.close();
  binding.database.close();
});
test('a long model response preserves a concurrent human edit and its proposal remains stale', async () => {
  const binding = new TestD1();
  const a = await load(binding);
  const connection = new LocalConnection({
    filePath: '/private/tmp/research-cloud-test-missing.json',
    environment: {},
  });
  connection.update({ apiKey: 'mock-key' });
  let started!: () => void, finish!: () => void;
  const observed = new Promise<void>((r) => (started = r));
  const gate = new Promise<void>((r) => (finish = r));
  let calls = 0;
  const request = (async () => {
    calls++;
    started();
    await gate;
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  content: 'A candidate to review.',
                  proposal: {
                    summary: 'Candidate',
                    nodes: [
                      {
                        tempId: 'new:test',
                        title: 'Candidate lemma',
                        summary: 'Unproved.',
                        content: '$x>0$',
                        type: 'Lemma',
                        tags: [],
                      },
                    ],
                    edges: [],
                    goals: [],
                    assessments: [],
                  },
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const chat = new ChatStore(a.store, a.program, connection, request, {
    save: () => a.repo.save(),
    reload: () => a.repo.reload(),
  });
  const session = chat.createSession();
  await a.repo.save();
  const sending = chat.send(session.id, { content: 'Find an intermediate lemma', mode: 'explore' });
  await observed;
  const b = await load(binding);
  const node = b.store.state().nodes[0];
  b.store.updateNode(
    node.id,
    { summary: 'A concurrent human revision.' },
    'Updated during generation',
  );
  await b.repo.save();
  finish();
  const result = await sending;
  assert.equal(calls, 1);
  assert.equal(a.store.getNode(node.id).summary, 'A concurrent human revision.');
  assert.equal(chat.messages(session.id).length, 2);
  assert.throws(() => chat.apply(result.assistantMessage.id), /changed after this proposal/);
  a.repo.close();
  b.repo.close();
  binding.database.close();
});
test('a reply committed before a network failure is recovered without another model call or duplicate message', async () => {
  const binding = new TestD1();
  const a = await load(binding);
  const connection = new LocalConnection({
    filePath: '/private/tmp/research-cloud-test-missing.json',
    environment: {},
  });
  connection.update({ apiKey: 'mock-key' });
  let calls = 0,
    saves = 0;
  const request = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ content: 'The completed reply.', proposal: null }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const chat = new ChatStore(a.store, a.program, connection, request, {
    reload: () => a.repo.reload(),
    save: async () => {
      if (++saves === 2) binding.ambiguous = true;
      await a.repo.save();
    },
  });
  const session = chat.createSession();
  await a.repo.save();
  const result = await chat.send(session.id, { content: 'Analyze this goal', mode: 'explore' });
  assert.equal(calls, 1);
  assert.equal(result.assistantMessage.content, 'The completed reply.');
  assert.equal(result.assistantMessage.error, undefined);
  await a.repo.reload();
  assert.equal(chat.messages(session.id).length, 2);
  a.repo.close();
  binding.database.close();
});
test('OpenAI connection is encrypted, user-bound, HttpOnly, and never restored from a tampered cookie', async () => {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const first = new ConnectionManager(secret, 'owner');
  await first.update({ apiKey: 'test-private-key', model: 'test-model', persist: true });
  assert.ok(first.cookie?.includes('HttpOnly'));
  assert.ok(first.cookie?.includes('Secure'));
  assert.ok(!first.cookie?.includes('test-private-key'));
  const request = new Request('https://example.test', { headers: { cookie: first.cookie! } });
  const next = new ConnectionManager(secret, 'owner');
  await next.restore(request);
  assert.equal(next.get().apiKey, 'test-private-key');
  const other = new ConnectionManager(secret, 'other');
  await other.restore(request);
  assert.equal(other.status().configured, false);
  const broken = new ConnectionManager(secret, 'owner');
  await broken.restore(
    new Request('https://example.test', { headers: { cookie: '__Host-research-openai=broken' } }),
  );
  assert.equal(broken.status().configured, false);
  await next.update({ disconnect: true });
  assert.equal(next.status().configured, false);
  assert.match(next.cookie!, /Max-Age=0/);
});
