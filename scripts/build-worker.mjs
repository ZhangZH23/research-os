import { build } from 'esbuild';
import path from 'node:path';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await build({
  entryPoints: ['cloud/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/server/index.js',
  external: ['node:*', './sql-wasm.wasm'],
  conditions: ['worker', 'browser'],
  define: { 'globalThis.WorkerGlobalScope': 'undefined', 'globalThis.process': 'undefined' },
  plugins: [
    {
      name: 'cloud-connection',
      setup(build) {
        build.onResolve({ filter: /^\.\/connection$/ }, (args) =>
          args.importer.includes('/server/')
            ? { path: path.resolve('cloud/connection.ts') }
            : undefined,
        );
      },
    },
  ],
});
await copyFile('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/server/sql-wasm.wasm');
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Built private research Worker and bundled SQLite engine.');
