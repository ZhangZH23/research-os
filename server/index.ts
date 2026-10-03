import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Store } from './store';
import { createApp } from './app';
const store = new Store(process.env.DATABASE_PATH || './data/research-os.sqlite');
const app = createApp(store);
const production = process.argv.includes('--production');
if (production) {
  if (!existsSync('dist/index.html')) throw new Error('Run pnpm build before pnpm start');
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4310);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `Research OS is running at http://127.0.0.1:${port}\nSQLite: ${resolve(process.env.DATABASE_PATH || './data/research-os.sqlite')}`,
  ),
);
server.on('error', (e) => {
  console.error(e);
  store.close();
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
