import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { SQLiteDatabase } from '../cloud/sqlite';
import { Repository, ConflictError } from '../cloud/repository';
import { Store } from '../server/domain-store';
import { ProgramStore } from '../server/program-store';
import { ChatStore } from '../server/chat';
import { ConnectionManager } from '../server/connection';
import { ResearchEngine } from '../server/research-engine';
const SQL = await initSqlJs();

/** An actual SQLite-backed D1 test binding; every batch commits or rolls back together. */
class EngineTestD1 {
  database = new DatabaseSync(':memory:');
  failAt = -1;
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
      const statement = this.database.prepare(sql),
        rows = statement.columns().length ? statement.all(...values) : [];
      let changes = 0;
      if (!/^SELECT/i.test(sql))
        changes = statement.columns().length
          ? Number((this.database.prepare('SELECT changes() AS n').get() as any).n)
          : Number(statement.run(...values).changes);
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
      const result = statements.map((s, i) => {
        if (i === this.failAt) throw new Error('Injected D1 engine persistence failure');
        return s.execute();
      });
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
const connection = () =>
  new ConnectionManager({ environment: {}, filePath: '/private/tmp/engine-cloud-no-key.json' });
function services(db: SQLiteDatabase, projectId?: string) {
  const store = new Store(db, false, projectId),
    program = new ProgramStore(store),
    chat = new ChatStore(store, program, connection()),
    engine = new ResearchEngine(store, program);
  return { store, program, chat, engine };
}
async function load(binding: EngineTestD1, projectId?: string) {
  const repo = new Repository(SQL, binding as any);
  await repo.reload();
  return { repo, ...services(repo.db, projectId) };
}
function add(engine: ResearchEngine, statement: string) {
  const s = engine.source({ kind: 'human_note', text: statement }),
    sources = [{ sourceId: s.id, sourceHash: s.hash, start: 0, end: s.text.length, quote: s.text }];
  const p = engine.propose({
    title: 'Synthetic cloud admission',
    baseCommitId: engine.project().headCommitId,
    operations: [
      { type: 'add_claim', tempId: 'claim', title: 'Synthetic finite claim', statement, sources },
    ],
    sources,
  });
  engine.check(p.id);
  engine.reviewProposal(p.id, {
    revision: p.revision,
    decision: 'approve',
    reason: 'Admit this synthetic finite observation without proof endorsement.',
  });
  return engine.commit(p.id, { revision: p.revision, idempotencyKey: randomUUID() });
}

test('engine records, exact sources, revisions, notebook and commit references survive a fresh SQLite reconstruction', () => {
  let db = new SQLiteDatabase(SQL);
  try {
    const root = services(db),
      p = root.engine.createProject({ title: 'Synthetic restart project' });
    const local = services(db, p.id),
      c = add(local.engine, '😀 A source with Unicode mathematics: ∀x, x=x.\r\n');
    const session = local.chat.importSession({
      title: 'Preserved transcript',
      source: 'Synthetic import',
      goalId: null,
      originalTranscript: 'User: A private note\r\nAssistant: A visible answer\r\n',
      turns: [
        { role: 'user', content: 'A private note' },
        { role: 'assistant', content: 'A visible answer' },
      ],
    });
    const preview = local.engine.publicationPreview({ revisionIds: [c.temporaryIds.claim] });
    local.engine.publish({
      revisionIds: [c.temporaryIds.claim],
      previewHash: preview.previewHash,
      confirm: true,
    });
    const before = local.engine.data(),
      graph = local.store.state(),
      messages = local.chat.messages(session.id),
      publicBefore = local.engine.publicExport();
    const records = db.snapshot();
    assert.ok(records.some((r) => r.collection === 'engine_records'));
    db.close();
    db = new SQLiteDatabase(SQL, records);
    const fresh = services(db, p.id);
    assert.deepEqual(fresh.engine.data(), before);
    assert.deepEqual(fresh.store.state(), graph);
    assert.deepEqual(fresh.chat.messages(session.id), messages);
    assert.deepEqual(fresh.engine.publicExport(), publicBefore);
    assert.equal(
      fresh.engine.data().revisions[0].sources[0].quote,
      '😀 A source with Unicode mathematics: ∀x, x=x.\r\n',
    );
  } finally {
    db.close();
  }
});

test('a persisted D1 engine commit survives request restart and conflicts cannot partially overwrite its journal', async () => {
  const binding = new EngineTestD1(),
    initial = await load(binding);
  const p = initial.engine.createProject({ title: 'Synthetic D1 project' });
  await initial.repo.save();
  initial.repo.close();
  const a = await load(binding, p.id),
    b = await load(binding, p.id);
  try {
    const first = add(a.engine, 'Winning independently reviewed record.');
    await a.repo.save();
    add(b.engine, 'Stale concurrent record must not appear.');
    await assert.rejects(() => b.repo.save(), ConflictError);
    const fresh = await load(binding, p.id);
    assert.equal(fresh.engine.data().commits.length, 1);
    assert.equal(fresh.engine.project().headCommitId, first.id);
    assert.ok(!JSON.stringify(fresh.engine.data()).includes('Stale concurrent record'));
    add(fresh.engine, 'A late persistent batch failure must roll back all records.');
    binding.failAt = 4;
    await assert.rejects(() => fresh.repo.save(), /Injected D1/);
    binding.failAt = -1;
    const afterFailure = await load(binding, p.id);
    assert.equal(afterFailure.engine.data().objects.length, 1);
    assert.equal(afterFailure.engine.data().commits.length, 1);
    assert.equal(afterFailure.engine.project().headCommitId, first.id);
    afterFailure.repo.close();
    fresh.repo.close();
  } finally {
    a.repo.close();
    b.repo.close();
    binding.database.close();
  }
});

test('legacy migration is explicit, resumable across requests, and preserves historical assertions without inventing proofs', async () => {
  const binding = new EngineTestD1();
  let current = await load(binding);
  try {
    for (let i = 0; i < 205; i++)
      current.store.createNode({
        title: `Synthetic legacy item ${i}`,
        type: 'Claim',
        content: `Legacy exact statement ${i}.`,
        epistemicStatus: i === 0 ? 'Proved' : 'Unverified',
        humanVerified: i === 0,
        originName: 'Historical synthetic reviewer',
      });
    const first = current.store.state().nodes[0],
      second = current.store.state().nodes[1];
    current.store.createEdge({
      sourceNodeId: second.id,
      targetNodeId: first.id,
      edgeType: 'depends_on',
      explanation: 'A preserved legacy assertion; inference validity unknown.',
    });
    await current.repo.save();
    assert.equal(current.engine.migrationReport().ready, false);
    assert.throws(
      () => current.engine.source({ kind: 'human_note', text: 'Not before migration.' }),
      /migration/,
    );
    const backup = current.engine.export();
    assert.equal(backup.legacy.state.nodes.length, 205);
    let chunks = 0;
    while (!current.engine.migrationReport().ready) {
      const report = current.engine.migrate({ confirm: true });
      chunks++;
      await current.repo.save();
      assert.ok(chunks < 10);
      current.repo.close();
      current = await load(binding);
      assert.equal(current.engine.migrationReport().ready, report.ready);
    }
    assert.ok(chunks >= 3);
    const data = current.engine.data(),
      object = data.objects.find((o) => o.legacyNodeId === first.id)!;
    const revision = data.revisions.find((r) => r.id === object.currentRevisionId)!;
    assert.deepEqual(revision.legacyAssertion, {
      status: 'Proved',
      humanVerified: true,
      attribution: 'Historical synthetic reviewer',
    });
    assert.equal(data.evidence.length, 0);
    assert.equal(data.reviews.length, 0);
    assert.equal(current.engine.state().support.revisions[revision.id].supported, false);
    assert.equal(data.relationships[0].kind, 'legacy_dependency');
    assert.equal(data.routes.length, 0);
    assert.deepEqual(current.store.state().nodes, backup.legacy.state.nodes);
    const before = current.engine.data();
    current.engine.migrate({ confirm: true });
    assert.deepEqual(current.engine.data(), before);
  } finally {
    current.repo.close();
    binding.database.close();
  }
});

test('dense legacy relationship migration stays below storage transaction limits and is complete only after every edge persists', async () => {
  const binding = new EngineTestD1();
  let current = await load(binding);
  try {
    const nodes = Array.from({ length: 35 }, (_, i) =>
      current.store.createNode({
        title: `Synthetic dense item ${i}`,
        type: 'Claim',
        content: `Dense legacy statement ${i}.`,
      }),
    );
    await current.repo.save();
    let created = 0;
    outer: for (let i = 0; i < nodes.length; i++)
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        current.store.createEdge({
          sourceNodeId: nodes[i].id,
          targetNodeId: nodes[j].id,
          edgeType: 'related_to',
        });
        if (++created % 100 === 0) await current.repo.save();
        if (created === 900) break outer;
      }
    await current.repo.save();
    let chunks = 0;
    while (!current.engine.migrationReport().ready) {
      current.engine.migrate({ confirm: true });
      await current.repo.save();
      assert.ok(++chunks <= 20, 'Dense migration must terminate');
      current.repo.close();
      current = await load(binding);
    }
    assert.equal(current.engine.data().relationships.length, 900);
    assert.ok(chunks > 1, 'All 900 edges must not be pushed into one oversized finalization');
  } finally {
    current.repo.close();
    binding.database.close();
  }
});
