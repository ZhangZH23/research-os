import { Router } from 'express';
import { z } from 'zod';
import type { Store } from './store';
import type { ProgramStore } from './program-store';
import { ChatStore } from './chat';
import { connectionManager, type ConnectionManager } from './connection';

export function createChatRouter(
  store: Store,
  program: ProgramStore,
  options: { connection?: ConnectionManager; request?: typeof fetch } = {},
) {
  const router = Router();
  const connection = options.connection ?? connectionManager();
  const chat = new ChatStore(store, program, connection, options.request);
  router.get('/state', (_req, res) => res.json(chat.state()));
  router.post('/sessions', (req, res) => {
    const input = z.object({ title: z.string().max(150).optional() }).parse(req.body);
    res.status(201).json(chat.createSession(input.title));
  });
  router.get('/sessions/:id', (req, res) =>
    res.json({ session: chat.session(req.params.id), messages: chat.messages(req.params.id) }),
  );
  router.post('/sessions/:id/messages', async (req, res) =>
    res.json(await chat.send(req.params.id, req.body)),
  );
  router.post('/messages/:id/apply', (req, res) => res.json(chat.apply(req.params.id)));
  router.post('/messages/:id/discard', (req, res) => res.json(chat.discard(req.params.id)));
  router.get('/connection', (_req, res) => res.json(connection.status()));
  router.put('/connection', (req, res) => res.json(connection.update(req.body)));
  router.post('/connection/test', async (_req, res) =>
    res.json(await connection.test(options.request)),
  );
  return router;
}
