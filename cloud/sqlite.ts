import type { Database, SqlJsStatic, BindParams } from 'sql.js';
export interface DatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: any[]): any;
    get(...args: any[]): any;
    all(...args: any[]): any[];
  };
  close(): void;
}
export const columns: Record<string, string[]> = {
  projects: ['id', 'data'],
  nodes: ['id', 'project_id', 'data'],
  edges: ['id', 'project_id', 'source_id', 'target_id', 'edge_type', 'data'],
  events: ['id', 'project_id', 'node_id', 'data'],
  drafts: ['id', 'data'],
  schema_migrations: ['id', 'applied_at'],
  research_goals: ['id', 'project_id', 'data'],
  contribution_assessments: ['node_id', 'data'],
  program_metadata: ['key', 'value'],
  chat_sessions: ['id', 'data'],
  chat_messages: ['id', 'session_id', 'data'],
  workbench_candidates: ['id', 'session_id', 'message_id', 'data'],
};
export type StoredRecord = { collection: string; id: string; position: number; payload: string };
const schema = `PRAGMA foreign_keys=ON;
CREATE TABLE projects(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE nodes(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
CREATE TABLE edges(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, edge_type TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(source_id,target_id,edge_type));
CREATE TABLE events(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, node_id TEXT, data TEXT NOT NULL);
CREATE TABLE drafts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE research_goals(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
CREATE TABLE contribution_assessments(node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE program_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE chat_sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE chat_messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id), data TEXT NOT NULL);
CREATE TABLE workbench_candidates(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id), message_id TEXT NOT NULL REFERENCES chat_messages(id), data TEXT NOT NULL);`;
/** A real, request-local SQLite engine preserves the existing SQL constraints and nested transactions. */
export class SQLiteDatabase implements DatabaseLike {
  private db: Database;
  constructor(
    private SQL: SqlJsStatic,
    records: StoredRecord[] = [],
  ) {
    this.db = new SQL.Database();
    this.replace(records);
  }
  replace(records: StoredRecord[]) {
    this.db.close();
    this.db = new this.SQL.Database();
    this.db.exec(schema);
    this.db.exec('PRAGMA foreign_keys=OFF; BEGIN');
    try {
      for (const item of records) {
        const names = columns[item.collection];
        if (!names) throw new Error('Unknown research record collection');
        const row = JSON.parse(item.payload);
        this.db.run(
          `INSERT INTO ${item.collection}(rowid,${names.join(',')}) VALUES(${names.map(() => '?').join(',')},?)`,
          [item.position, ...names.map((n) => row[n])],
        );
      }
      if (this.db.exec('PRAGMA foreign_key_check').length)
        throw new Error('Research data contains broken references');
      this.db.exec('COMMIT; PRAGMA foreign_keys=ON');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  exec(sql: string) {
    return this.db.exec(sql);
  }
  prepare(sql: string) {
    const query = (params: any[], first = false) => {
      const statement = this.db.prepare(sql);
      try {
        statement.bind(params as BindParams);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) {
          rows.push(statement.getAsObject());
          if (first) break;
        }
        return rows;
      } finally {
        statement.free();
      }
    };
    return {
      all: (...params: any[]) => query(params),
      get: (...params: any[]) => query(params, true)[0],
      run: (...params: any[]) => {
        this.db.run(sql, params as BindParams);
        return { changes: this.db.getRowsModified() };
      },
    };
  }
  snapshot(): StoredRecord[] {
    return Object.entries(columns).flatMap(([collection, names]) =>
      this.prepare(`SELECT rowid AS _position, * FROM ${collection} ORDER BY rowid`)
        .all()
        .map((row) => ({
          collection,
          id: String(row[names[0]]),
          position: Number(row._position),
          payload: JSON.stringify(Object.fromEntries(names.map((n) => [n, row[n]]))),
        })),
    );
  }
  close() {
    this.db.close();
  }
}
