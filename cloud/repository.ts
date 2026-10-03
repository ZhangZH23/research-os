import type { D1Database, D1DatabaseSession } from '@cloudflare/workers-types';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteDatabase, type StoredRecord } from './sqlite';
export class ConflictError extends Error {
  status = 409;
  constructor() {
    super(
      'Your online workspace changed in another tab. Refresh and try again; no changes were overwritten.',
    );
  }
}
const recordKey = (r: StoredRecord) => `${r.collection}:${r.id}`;
export class Repository {
  db: SQLiteDatabase;
  private baseline = new Map<string, StoredRecord>();
  private revision = 0;
  private connection: D1DatabaseSession;
  constructor(
    SQL: SqlJsStatic,
    private binding: D1Database,
  ) {
    this.db = new SQLiteDatabase(SQL);
    this.connection = binding.withSession('first-primary');
  }
  async reload() {
    await this.connection
      .prepare("INSERT OR IGNORE INTO workspace_revision(id,revision,token) VALUES('main',0,'')")
      .run();
    const [version, records] = await this.connection.batch([
      this.connection.prepare("SELECT revision FROM workspace_revision WHERE id='main'"),
      this.connection.prepare(
        'SELECT collection,id,position,payload FROM research_records ORDER BY collection,position',
      ),
    ]);
    this.revision = Number((version.results[0] as any).revision);
    const rows = records.results as StoredRecord[];
    this.db.replace(rows);
    this.baseline = new Map(rows.map((r) => [recordKey(r), r]));
  }
  async save() {
    const current = new Map(this.db.snapshot().map((r) => [recordKey(r), r]));
    const changed = [...current]
      .filter(([key, row]) => JSON.stringify(row) !== JSON.stringify(this.baseline.get(key)))
      .map(([, row]) => row);
    const deleted = [...this.baseline].filter(([key]) => !current.has(key)).map(([, row]) => row);
    if (!changed.length && !deleted.length) return;
    if (changed.length + deleted.length > 850)
      throw new Error(
        'This change is too large to save atomically. Split it into smaller changes.',
      );
    if (changed.some((row) => new TextEncoder().encode(row.payload).length > 1_800_000))
      throw new Error(
        'One research record is too large to save. Split long material into separate items.',
      );
    const token = crypto.randomUUID();
    const guard = "EXISTS(SELECT 1 FROM workspace_revision WHERE id='main' AND token=?)";
    const statements = [
      this.connection
        .prepare(
          "UPDATE workspace_revision SET revision=revision+1, token=? WHERE id='main' AND revision=?",
        )
        .bind(token, this.revision),
    ];
    for (const row of deleted)
      statements.push(
        this.connection
          .prepare(`DELETE FROM research_records WHERE collection=? AND id=? AND ${guard}`)
          .bind(row.collection, row.id, token),
      );
    for (const row of changed)
      statements.push(
        this.connection
          .prepare(
            `INSERT INTO research_records(collection,id,position,payload) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(collection,id) DO UPDATE SET position=excluded.position,payload=excluded.payload`,
          )
          .bind(row.collection, row.id, row.position, row.payload, token),
      );
    const results = await this.connection.batch(statements);
    if (results[0].meta.changes !== 1) throw new ConflictError();
    this.revision++;
    this.baseline = current;
  }
  async acquireChat(sessionId: string) {
    const token = crypto.randomUUID();
    const now = Date.now();
    const row = await this.connection
      .prepare(
        'INSERT INTO chat_leases(session_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE chat_leases.expires_at < ? RETURNING token',
      )
      .bind(sessionId, token, now + 180_000, now)
      .first<{ token: string }>();
    if (row?.token !== token)
      throw new Error(
        'A reply is already in progress in this conversation. Please wait for it to finish.',
      );
    return async () => {
      await this.connection
        .prepare('DELETE FROM chat_leases WHERE session_id=? AND token=?')
        .bind(sessionId, token)
        .run();
    };
  }
  close() {
    this.db.close();
  }
}
