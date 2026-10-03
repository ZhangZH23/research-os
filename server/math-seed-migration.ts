import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ActivityEvent, ResearchNode } from '../shared/types';
import { legacySeedNodes, mathSeedText, project } from './seed';

export const MATH_SEED_MIGRATION = 'demo-mathematics-latex-v1';

/**
 * Convert only unchanged fields from the original demo to math markup.
 * The caller must run this in its startup transaction, after initial seeding.
 * No research assertions, verification flags, timestamps, or old events change.
 */
export function migrateSeedMathematics(db: DatabaseSync): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  if (db.prepare('SELECT id FROM schema_migrations WHERE id=?').get(MATH_SEED_MIGRATION)) return 0;

  const readNode = db.prepare('SELECT data FROM nodes WHERE id=? AND project_id=?');
  const writeNode = db.prepare('UPDATE nodes SET data=? WHERE id=? AND project_id=?');
  const writeEvent = db.prepare('INSERT INTO events(id,project_id,node_id,data) VALUES(?,?,?,?)');
  const createdAt = new Date().toISOString();
  let changedCount = 0;

  for (const original of legacySeedNodes) {
    const replacements = mathSeedText[original.id];
    if (!replacements) continue;
    const row = readNode.get(original.id, project.id) as { data: string } | undefined;
    if (!row) continue;
    const previous = JSON.parse(row.data) as ResearchNode;
    const next = { ...previous };
    const changedFields: string[] = [];
    for (const field of Object.keys(replacements) as (keyof typeof replacements)[]) {
      const replacement = replacements[field];
      if (
        replacement !== undefined &&
        previous[field] === original[field] &&
        previous[field] !== replacement
      ) {
        next[field] = replacement;
        changedFields.push(field);
      }
    }
    if (!changedFields.length) continue;

    // Do not use Store.updateNode: presentation changes do not invalidate a proof
    // or alter the date of the researcher's last substantive update.
    writeNode.run(JSON.stringify(next), next.id, project.id);
    const event: ActivityEvent = {
      id: randomUUID(),
      projectId: project.id,
      nodeId: next.id,
      nodeTitle: next.title,
      eventType: 'node_formatted',
      previousValue: JSON.stringify(previous),
      newValue: JSON.stringify(next),
      reason: `Original demo ${changedFields.join(', ')} formatted with Markdown and LaTeX. Mathematical meaning, research status, confidence, and human verification are unchanged.`,
      createdAt,
    };
    writeEvent.run(event.id, event.projectId, event.nodeId, JSON.stringify(event));
    changedCount++;
  }

  db.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)').run(
    MATH_SEED_MIGRATION,
    createdAt,
  );
  return changedCount;
}
