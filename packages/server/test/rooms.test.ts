import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientToServer, GameView, RoomView, ServerToClient } from '@tcd/shared';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoomHub } from '../src/rooms.js';

type Client = Socket<ServerToClient, ClientToServer> & { room: RoomView | null; game: GameView | null; playerId: string; toasts: string[] };

let http: HttpServer;
let io: Server<ClientToServer, ServerToClient>;
let url: string;
const open: Client[] = [];

beforeAll(async () => {
  http = createServer();
  io = new Server(http);
  const hub = new RoomHub(io);
  io.on('connection', (s) => hub.attach(s));
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  open.forEach((c) => c.close());
  io.close();
  await new Promise((r) => http.close(r));
});

const ask = <T>(c: Client, ev: keyof ClientToServer, ...args: unknown[]) =>
  new Promise<{ ok: boolean; data?: T; error?: string }>((res) => (c.emit as unknown as (...a: unknown[]) => void)(ev, ...args, res));
const until = async (cond: () => boolean, what = 'condition') => {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** A connected, logged-in player. `token` identifies them across reconnects. */
async function player(name: string, token = `${name}-${Math.random().toString(36).slice(2)}-0123456789`): Promise<Client> {
  const c = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
  c.room = null;
  c.game = null;
  c.toasts = [];
  c.on('room:state', (r) => { c.room = r; });
  c.on('game:state', (g) => { c.game = g; });
  c.on('toast', (t) => c.toasts.push(t.text));
  open.push(c);
  await new Promise<void>((r) => c.on('connect', () => r()));
  const hello = await ask<{ playerId: string }>(c, 'session:hello', { token, name });
  c.playerId = hello.data!.playerId;
  (c as unknown as { token: string }).token = token;
  return c;
}

async function lobby(n: number) {
  const host = await player('host');
  const { data } = await ask<{ roomId: string }>(host, 'room:create');
  const guests: Client[] = [];
  for (let i = 1; i < n; i++) {
    const g = await player(`guest${i}`);
    const r = await ask(g, 'room:join', { roomId: data!.roomId });
    expect(r.ok).toBe(true);
    guests.push(g);
  }
  await until(() => host.room?.members.length === n, `${n} members`);
  return { host, guests, code: data!.roomId };
}

describe('rooms', () => {
  it('creates a room with a 4-character code and lets others join it (case-insensitive)', async () => {
    const { host, guests, code } = await lobby(1);
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    const g = await player('late');
    expect((await ask(g, 'room:join', { roomId: code.toLowerCase() })).ok).toBe(true);
    await until(() => host.room?.members.length === 2);
    expect(guests).toHaveLength(0);
    expect((await ask(g, 'room:join', { roomId: 'ZZZZ' })).error).toContain('不存在');
  });

  it('caps a lobby at 8 players', async () => {
    const { code } = await lobby(8);
    const ninth = await player('ninth');
    const r = await ask(ninth, 'room:join', { roomId: code });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('已满');
  });

  it('only the host can start, add bots, change settings or kick; needs 3+ players', async () => {
    const { host, guests } = await lobby(2);
    expect((await ask(guests[0], 'room:start')).ok).toBe(false);
    expect((await ask(host, 'room:start')).error).toContain('至少');
    guests[0].emit('room:addBot');
    guests[0].emit('room:settings', { roleChoices: 6 });
    await new Promise((r) => setTimeout(r, 80));
    expect(host.room!.members).toHaveLength(2);
    expect(host.room!.settings.roleChoices).not.toBe(6);

    host.emit('room:addBot');
    host.emit('room:settings', { roleChoices: 99, promptTimeout: -5 });
    await until(() => host.room!.members.length === 3);
    expect(host.room!.settings.roleChoices).toBe(6); // clamped
    expect(host.room!.settings.promptTimeout).toBe(0);

    host.emit('room:kick', { memberId: guests[0].playerId });
    await until(() => host.room!.members.length === 2);
    await until(() => guests[0].room === null, 'kicked player sees no room');
  });

  it('hands the host role over when the host leaves, and closes empty rooms', async () => {
    const { host, guests, code } = await lobby(3);
    host.emit('room:leave');
    await until(() => guests[0].room?.hostId === guests[0].playerId || guests[0].room?.hostId === guests[1].playerId, 'new host');
    guests.forEach((g) => g.emit('room:leave'));
    await new Promise((r) => setTimeout(r, 100));
    const probe = await player('probe');
    expect((await ask(probe, 'room:join', { roomId: code })).ok).toBe(false);
  });

  it('keeps a player\'s seat across reconnects: same token → same player, room and game view', async () => {
    const { host, guests } = await lobby(2);
    host.emit('room:addBot');
    await until(() => host.room!.members.length === 3);
    expect((await ask(host, 'room:start')).ok).toBe(true);
    await until(() => guests[0].game?.phase === 'roleSelect', 'game to start');
    const before = guests[0];
    const token = (before as unknown as { token: string }).token;
    before.close();
    await new Promise((r) => setTimeout(r, 60));
    const again = await player('guest1', token);
    expect(again.playerId).toBe(before.playerId);
    await until(() => again.game?.me?.id === before.playerId, 'private view after reconnect');
    expect(again.room?.status).toBe('playing');
    expect(again.game?.prompt?.kind).toBe('choice'); // the pending role choice comes back
    expect(again.game?.me?.roleOptions.length).toBeGreaterThan(0);
  });

  it('gives late joiners a spectator view of a running game', async () => {
    const { host, code } = await lobby(3);
    expect((await ask(host, 'room:start')).ok).toBe(true);
    const watcher = await player('watcher');
    expect((await ask(watcher, 'room:join', { roomId: code })).ok).toBe(true);
    await until(() => !!watcher.game, 'spectator game state');
    expect(watcher.game!.me).toBeNull();
    expect(watcher.game!.prompt).toBeNull();
    expect(watcher.room!.members).toHaveLength(3); // spectators take no seat
  });

  it('rate-limits chat floods', async () => {
    const { host } = await lobby(1);
    for (let i = 0; i < 12; i++) host.emit('chat:send', { text: `spam ${i}` });
    await until(() => host.toasts.some((t) => t.includes('太快')), 'flood warning');
  });
});
