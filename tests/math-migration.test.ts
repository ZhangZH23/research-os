import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MATH_SEED_MIGRATION, migrateSeedMathematics } from '../server/math-seed-migration';
import { legacySeedNodes, mathSeedText, project, seedEdges, seedNodes } from '../server/seed';
import { nodeInputSchema, type ActivityEvent, type ResearchNode } from '../shared/types';

function fixture(seeds = legacySeedNodes) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE nodes(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE events(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, node_id TEXT, data TEXT NOT NULL);
  `);
  for (const seed of seeds) {
    const node: ResearchNode = {
      ...nodeInputSchema.parse(seed),
      id: seed.id,
      projectId: project.id,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    db.prepare('INSERT INTO nodes VALUES(?,?,?)').run(
      node.id,
      node.projectId,
      JSON.stringify(node),
    );
  }
  const get = (id: string): ResearchNode =>
    JSON.parse((db.prepare('SELECT data FROM nodes WHERE id=?').get(id) as { data: string }).data);
  const save = (node: ResearchNode) =>
    db.prepare('UPDATE nodes SET data=? WHERE id=?').run(JSON.stringify(node), node.id);
  const events = (): ActivityEvent[] =>
    (db.prepare('SELECT data FROM events ORDER BY rowid').all() as { data: string }[]).map((r) =>
      JSON.parse(r.data),
    );
  const migrate = () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const count = migrateSeedMathematics(db);
      db.exec('COMMIT');
      return count;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return { db, get, save, events, migrate };
}

test('original demo gains LaTeX with full audits while its research metadata remains identical', () => {
  const { db, get, events, migrate } = fixture();
  try {
    const before = legacySeedNodes.map((n) => get(n.id));
    assert.equal(migrate(), Object.keys(mathSeedText).length);
    const audit = events();
    assert.equal(audit.length, Object.keys(mathSeedText).length);
    for (const previous of before) {
      const next = get(previous.id);
      const replacement = mathSeedText[previous.id];
      assert.deepEqual(next, { ...previous, ...replacement });
      if (!replacement) continue;
      const event = audit.find((e) => e.nodeId === next.id)!;
      assert.equal(event.eventType, 'node_formatted');
      assert.equal(event.nodeTitle, next.title);
      assert.deepEqual(JSON.parse(event.previousValue!), previous);
      assert.deepEqual(JSON.parse(event.newValue!), next);
      assert.match(event.reason, /Mathematical meaning.*unchanged/);
    }
    assert.match(get('interpolation').content, /\$\$[\s\S]*\\mid[\s\S]*\$\$/);
    assert.equal(get('interpolation').humanVerified, true);
    assert.equal(get('draft-proof').epistemicStatus, 'Proved');
    assert.equal(get('draft-proof').humanVerified, false);
  } finally {
    db.close();
  }
});

test('each user-edited field survives independently, including statuses and custom provenance', () => {
  const { db, get, save, events, migrate } = fixture();
  try {
    const edited = {
      ...get('numerical-experiment'),
      title: 'My exact computation',
      content: 'Additional research: $q=7$; still under review.',
      provenanceText: 'My notebook, version 4.',
      epistemicStatus: 'Unverified' as const,
      confidence: 0.23,
      humanVerified: true,
      tags: ['my-work'],
      links: ['https://example.com/notebook'],
      updatedAt: '2026-09-30T12:34:56.000Z',
    };
    save(edited);
    const whitespaceEdit = {
      ...get('pairwise-bound'),
      content: `${get('pairwise-bound').content}\n`,
    };
    save(whitespaceEdit);
    const allEdited = { ...get('main-conjecture'), content: 'User replacement.' };
    save(allEdited);
    migrate();
    assert.deepEqual(get(edited.id), {
      ...edited,
      summary: mathSeedText[edited.id].summary,
    });
    assert.equal(get(whitespaceEdit.id).content, whitespaceEdit.content);
    assert.deepEqual(get(allEdited.id), allEdited);
    assert.ok(!events().some((e) => e.nodeId === allEdited.id));
    const audit = events().find((e) => e.nodeId === edited.id)!;
    assert.match(audit.reason, /demo summary formatted/);
    assert.deepEqual(JSON.parse(audit.previousValue!), edited);
  } finally {
    db.close();
  }
});

test('formatting runs once, keeps historical audit records, and skips unrelated project rows', () => {
  const { db, get, save, events, migrate } = fixture();
  try {
    const other = { ...get('counterexample'), projectId: 'other-project' };
    save(other);
    db.prepare('UPDATE nodes SET project_id=? WHERE id=?').run(other.projectId, other.id);
    const historical = {
      id: 'historical-event',
      projectId: project.id,
      nodeId: 'interpolation',
      nodeTitle: 'Old title',
      eventType: 'status_changed',
      previousValue: '{"epistemicStatus":"Unverified"}',
      newValue: '{"epistemicStatus":"Proved"}',
      reason: 'Original proof review',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(
      historical.id,
      historical.projectId,
      historical.nodeId,
      JSON.stringify(historical),
    );
    assert.equal(migrate(), Object.keys(mathSeedText).length - 1);
    assert.deepEqual(get(other.id), other);
    assert.deepEqual(events()[0], historical);
    const count = events().length;
    // A later deliberate edit back to the original prose must not be overwritten.
    const reverted = {
      ...get('interpolation'),
      content: legacySeedNodes.find((n) => n.id === 'interpolation')!.content!,
    };
    save(reverted);
    assert.equal(migrate(), 0);
    assert.deepEqual(get(reverted.id), reverted);
    assert.equal(events().length, count);
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE id=?')
        .get(MATH_SEED_MIGRATION)?.count,
      1,
    );
  } finally {
    db.close();
  }
});

test('fresh seeds preserve the graph and need no formatting audit', () => {
  const { db, migrate, events } = fixture(seedNodes);
  try {
    assert.equal(seedNodes.length, 17);
    assert.equal(seedEdges.length, 18);
    assert.deepEqual(
      seedNodes.map((n) => n.id),
      legacySeedNodes.map((n) => n.id),
    );
    assert.equal(migrate(), 0);
    assert.deepEqual(events(), []);
  } finally {
    db.close();
  }
});

test('failed auditing rolls formatting and its migration marker back together', () => {
  const { db, get, events, migrate } = fixture();
  try {
    const previous = get('main-conjecture');
    db.exec(
      "CREATE TRIGGER reject_format_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    assert.throws(migrate, /audit unavailable/);
    assert.deepEqual(get(previous.id), previous);
    assert.deepEqual(events(), []);
    db.exec('DROP TRIGGER reject_format_event');
    assert.equal(migrate(), Object.keys(mathSeedText).length);
  } finally {
    db.close();
  }
});
