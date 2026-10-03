import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const dir = resolve('data');
mkdirSync(dir, { recursive: true });
const pidFile = resolve(dir, 'research-os.pid');
const logFile = resolve(dir, 'research-os.log');
const url = `http://127.0.0.1:${Number(process.env.PORT || 4310)}`;
async function health() {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const value = await r.json();
    return r.ok && value.service === 'research-os' ? value : null;
  } catch {
    return null;
  }
}
const action = process.argv[2] || 'start';
if (action === 'url') {
  console.log(`${url}/#program`);
  process.exit(0);
}
const current = await health();
if (action === 'status') {
  console.log(
    current
      ? `Research OS is running at ${url} (PID ${current.pid}).`
      : `Research OS is stopped. Run the Start Research OS launcher.`,
  );
  process.exit(current ? 0 : 1);
}
if (action === 'stop') {
  const remembered = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : null;
  if (!current) {
    console.log(
      'Research OS is already stopped or not responding; no unrelated process was stopped.',
    );
    process.exit(0);
  }
  if (remembered !== current.pid) {
    console.error('The running server was started elsewhere. Stop it from its original terminal.');
    process.exit(1);
  }
  process.kill(current.pid, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    const remaining = await health();
    if (!remaining || remaining.pid !== current.pid) break;
    if (i === 29) {
      console.error('The server is still finishing a request. Try stopping it again shortly.');
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  rmSync(pidFile, { force: true });
  console.log('Research OS stopped. Your data is saved.');
  process.exit(0);
}
if (action !== 'start') {
  console.error('Usage: service.mjs start|stop|status|url');
  process.exit(1);
}
if (current) {
  console.log(`Research OS is already running at ${url}`);
  process.exit(0);
}
if (!existsSync('dist/index.html')) {
  console.log('Preparing the local application…');
  for (const args of [
    ['node_modules/typescript/bin/tsc', '--noEmit'],
    ['node_modules/vite/bin/vite.js', 'build'],
  ]) {
    const build = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) process.exit(1);
  }
}
const log = openSync(logFile, 'a', 0o600);
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: ['ignore', log, log],
});
closeSync(log);
child.on('error', (error) => {
  console.error(`Could not start Research OS: ${error.message}`);
  process.exitCode = 1;
});
child.unref();
for (let i = 0; i < 30; i++) {
  const result = await health();
  if (result) {
    writeFileSync(pidFile, String(result.pid), { mode: 0o600 });
    console.log(
      `Research OS is running at ${url}\nIt stays running when this launcher closes.\nLocal log: ${logFile}`,
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.error(
  `The server did not start. See ${logFile}. If port ${Number(process.env.PORT || 4310)} is occupied, stop that process or change PORT in .env.`,
);
process.exit(1);
