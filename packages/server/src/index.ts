import type { ClientToServer, ServerToClient } from '@tcd/shared';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomHub } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
// Built layout: packages/server/dist/index.js → packages/client/dist
const CLIENT_DIST = process.env.CLIENT_DIST ?? resolve(here, '../../client/dist');

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ ok: true }));

if (existsSync(CLIENT_DIST)) {
  app.use('/art', express.static(resolve(CLIENT_DIST, 'art'), { maxAge: '30d', immutable: true }));
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  // SPA fallback (room links like /r/ABCD).
  app.get('*', (_req, res) => res.sendFile(resolve(CLIENT_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. In dev, open the Vite server (npm run dev).'));
}

const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
  pingInterval: 10_000,
  pingTimeout: 20_000,
});
const hub = new RoomHub(io);
io.on('connection', (sock) => hub.attach(sock));

http.listen(PORT, () => console.log(`逐梦东方圈 server listening on http://localhost:${PORT}`));
