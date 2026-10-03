import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// This maintenance client intentionally cannot target a hosted workspace.
const args = process.argv.slice(2);
function value(flag: string) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
const origin = new URL(value('--url') ?? 'http://localhost:4312');
if (
  origin.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
  origin.username ||
  origin.password
)
  throw new Error('Migration tooling is restricted to the local HTTP preview.');
const project = value('--project');
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (project) headers['x-research-project'] = project;
async function request(path: string, body?: unknown) {
  const response = await fetch(new URL(path, origin), {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? `Migration request failed (${response.status})`);
  return result;
}
let report = await request('/api/engine/migration');
console.log(
  JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry_run', ...report }, null, 2),
);
if (!args.includes('--apply')) process.exit(0);
const destination = value('--backup');
if (!destination)
  throw new Error(
    '--apply requires --backup PATH; the backup is created before any migration write.',
  );
const backup = await request('/api/engine/export');
await writeFile(resolve(destination), JSON.stringify(backup, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log(`Backup saved: ${resolve(destination)}`);
let chunks = 0;
while (!report.ready) {
  if (++chunks > 10000)
    throw new Error('Stopped at the maintenance chunk limit. Saved chunks remain resumable.');
  const previous = report.remaining;
  report = await request('/api/engine/migration', { confirm: true });
  console.log(JSON.stringify({ chunk: chunks, remaining: report.remaining, ready: report.ready }));
  if (!report.ready && report.remaining >= previous)
    throw new Error(
      'Migration made no progress; retain the backup and inspect the remaining references.',
    );
}
console.log('Local migration complete. Historical assertions remain attributed, not proved.');
