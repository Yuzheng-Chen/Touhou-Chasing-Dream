import type { ClientToServer, ServerToClient } from '@tcd/shared';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
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
  // The client build leaves `.br` / `.gz` copies of every text file next to it (scripts/precompress.mjs):
  // serve those instead of compressing on every request. Hashed files never change, so they are cached for good.
  /** Send `rel` (relative to dist) from its precompressed copy when the browser accepts one. Returns false if there is none. */
  const sendPrecompressed = (req: express.Request, res: express.Response, rel: string, cache: string) => {
    const accept = String(req.headers['accept-encoding'] ?? '');
    const variant = /\bbr\b/.test(accept) ? ['br', '.br'] : /\bgzip\b/.test(accept) ? ['gzip', '.gz'] : null;
    const file = resolve(CLIENT_DIST, `.${rel}${variant?.[1] ?? ''}`);
    if (!variant || !file.startsWith(CLIENT_DIST) || !existsSync(file)) return false;
    res.setHeader('Content-Encoding', variant[0]);
    res.setHeader('Vary', 'Accept-Encoding');
    res.type(extname(rel));
    res.setHeader('Cache-Control', cache);
    res.sendFile(file, { dotfiles: 'allow' });
    return true;
  };
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !/\.(js|css|svg|json)$/.test(req.path)) return next();
    const immutable = req.path.startsWith('/assets/');
    if (!sendPrecompressed(req, res, decodeURIComponent(req.path), immutable ? 'public, max-age=31536000, immutable' : 'no-cache')) next();
  });
  app.use('/assets', express.static(resolve(CLIENT_DIST, 'assets'), { maxAge: '1y', immutable: true }));
  app.use('/art', express.static(resolve(CLIENT_DIST, 'art'), { maxAge: '30d', immutable: true }));
  app.use('/fonts', express.static(resolve(CLIENT_DIST, 'fonts'), { maxAge: '365d', immutable: true }));
  app.use(express.static(CLIENT_DIST, { maxAge: 0, index: false, etag: true }));
  // SPA fallback (room links like /r/ABCD).
  app.get('*', (req, res) => {
    if (!sendPrecompressed(req, res, '/index.html', 'no-cache')) res.sendFile(resolve(CLIENT_DIST, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
  });
} else {
  app.get('/', (_req, res) => res.send('Client not built. In dev, open the Vite server (npm run dev).'));
}

const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
  pingInterval: 10_000,
  pingTimeout: 20_000,
  // Game state is JSON that compresses ~5×; worth the CPU on slow links. Tiny messages are left alone.
  perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 5 }, concurrencyLimit: 10 },
});
const hub = new RoomHub(io);
io.on('connection', (sock) => hub.attach(sock));

http.listen(PORT, () => console.log(`逐梦东方圈 server listening on http://localhost:${PORT}`));
