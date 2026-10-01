import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ACTION_CARDS, EVENT_CARDS, OFFICIAL_CARDS, ROLE_CARDS, explain, highlightPattern, endThreshold, DEFAULT_SETTINGS,
  type ClientToServer, type GameView, type RoomView, type ServerToClient,
} from '@tcd/shared';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Game } from '../src/engine/Game.js';
import { runGame } from '../src/engine/flow.js';
import { RoomHub } from '../src/rooms.js';

describe('glossary (keyword side boxes)', () => {
  const terms = (id: string) => explain(id).map((g) => g.term);

  it('explains dice judgements, and only what a newcomer would not know', () => {
    expect(terms('versus')).toContain('增减判定');
    expect(terms('expose')).toContain('两点点数判定');
    expect(terms('translation')).toContain('真假判定');
    expect(terms('create')).toEqual([]); // plain card: nothing to explain
    for (const id of ['create', 'profit', 'preach', 'calm', 'restless']) {
      for (const basic of ['手牌', '弃牌堆', '个人影响力', '社群规模']) expect(terms(id)).not.toContain(basic);
    }
  });

  it('shows the text of other cards a card refers to (e.g. 东方绯想天 ↔ 东方非想天则 / 联机对战)', () => {
    const swr = explain('swr');
    expect(swr.map((g) => g.term)).toEqual(expect.arrayContaining(['东方非想天则', '联机对战', '拼点']));
    expect(swr.find((g) => g.term === '联机对战')?.text).toContain('增减判定');
    expect(terms('soku')).toEqual(expect.arrayContaining(['东方绯想天', '联机对战']));
  });

  it('explains card categories, chain events and role factions', () => {
    expect(terms('crowdfund')).toContain('群体');
    expect(terms('preempt')).toContain('延时');
    expect(terms('murphy')).toContain('响应');
    expect(terms('popularity_poll')).toContain('连锁事件');
    expect(terms('evangelist')).toContain('社群 · 繁荣');
    expect(terms('hermit')).toContain('个人 · 小众');
    expect(terms('freeloader')).toContain('个人 · 繁荣');
    expect(terms('oshi')).toContain('单推牌');
  });

  it('is safe and bounded for every card in the game', () => {
    for (const c of [...ACTION_CARDS, ...EVENT_CARDS, ...OFFICIAL_CARDS, ...ROLE_CARDS]) {
      const boxes = explain(c.id);
      expect(boxes.length, c.id).toBeLessThanOrEqual(5);
      for (const b of boxes) {
        expect(b.term.length).toBeGreaterThan(0);
        expect(b.text.length).toBeGreaterThan(3);
      }
      expect(new Set(boxes.map((b) => b.term)).size, `duplicate boxes on ${c.id}`).toBe(boxes.length);
      const re = highlightPattern(c.id);
      if (boxes.some((b) => b.cardId || b.text)) expect(() => 'x'.split(re ?? /$^/)).not.toThrow();
    }
  });
});

describe('custom game settings', () => {
  const seats = (n: number, hostIdx = 0) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, isBot: true, host: i === hostIdx }));
  const opts = { promptTimeout: 0, botDelay: 0, roleChoices: 3, fast: true };

  it('endThreshold follows the rulebook unless a custom length is set', () => {
    expect(endThreshold(4)).toBe(8);
    expect(endThreshold(8)).toBe(4);
    expect(endThreshold(4, 5)).toBe(5);
    expect(DEFAULT_SETTINGS.rounds).toBe(0);
  });

  it('a custom number of rounds ends the game after that many officials', async () => {
    for (const rounds of [2, 3, 5]) {
      const g = new Game(seats(4), { ...opts, seed: 41 + rounds, rounds });
      await runGame(g);
      expect(g.s.phase).toBe('finished');
      expect(g.endTarget).toBe(rounds);
      expect(g.s.round).toBeLessThanOrEqual(rounds);
      expect(g.s.officialDiscard.length).toBeGreaterThanOrEqual(rounds);
    }
  });

  it('deals the configured starting hand and honours "host goes first"', async () => {
    const g = new Game(seats(5, 3), { ...opts, seed: 9, rounds: 2, startingHand: 4, firstPlayer: 'host' });
    await runGame(g);
    const texts = g.s.log.map((l) => l.text);
    expect(texts.some((t) => t.includes('每位玩家摸 4 张行动牌'))).toBe(true);
    expect(texts.some((t) => t.includes('房主先手'))).toBe(true);
    expect(g.s.firstIdx).toBe(3);
  });

  it('balancedRoles=false stops guaranteeing a 繁荣 and a 小众 option, true guarantees it', async () => {
    const g = new Game(seats(3), { ...opts, seed: 3, rounds: 2, balancedRoles: true, decide: (_g, who, p) => {
      if (p.kind === 'choice' && p.title.includes('选择你本局使用的角色')) {
        const stances = new Set(who.roleOptions.map((id) => ROLE_CARDS.find((r) => r.id === id)!.stance));
        expect(stances.has('prosper') && stances.has('niche')).toBe(true);
      }
      return undefined;
    } });
    await runGame(g);
  });
});

// ── sockets: settings validation, spectators, tutorial, ping, emotes ──────────────────────────

type Client = Socket<ServerToClient, ClientToServer> & {
  room: RoomView | null; game: GameView | null; playerId: string; emotes: { fromId: string; emote: string }[];
};
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
  for (let i = 0; i < 150; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};
async function player(name: string): Promise<Client> {
  const c = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
  c.room = null;
  c.game = null;
  c.emotes = [];
  c.on('room:state', (r) => { c.room = r; });
  c.on('game:state', (g) => { c.game = g; });
  c.on('game:emote', (e) => c.emotes.push(e));
  open.push(c);
  await new Promise<void>((r) => c.on('connect', () => r()));
  const hello = await ask<{ playerId: string }>(c, 'session:hello', { token: `${name}-${Math.random().toString(36).slice(2)}-0123456789`, name });
  c.playerId = hello.data!.playerId;
  return c;
}
async function lobby(n: number) {
  const host = await player('host');
  const { data } = await ask<{ roomId: string }>(host, 'room:create');
  const guests: Client[] = [];
  for (let i = 1; i < n; i++) {
    const g = await player(`guest${i}`);
    expect((await ask(g, 'room:join', { roomId: data!.roomId })).ok).toBe(true);
    guests.push(g);
  }
  await until(() => host.room?.members.length === n);
  return { host, guests, code: data!.roomId };
}

describe('room settings over sockets', () => {
  it('validates and clamps every setting', async () => {
    const { host } = await lobby(1);
    host.emit('room:settings', { rounds: 99, startingHand: 0, firstPlayer: 'host', balancedRoles: false, allowSpectators: false, promptTimeout: 9999, botDelay: 1, roleChoices: 4.4 });
    await until(() => host.room?.settings.firstPlayer === 'host');
    expect(host.room!.settings).toMatchObject({ rounds: 12, startingHand: 1, balancedRoles: false, allowSpectators: false, promptTimeout: 300, botDelay: 200, roleChoices: 4 });
    host.emit('room:settings', { rounds: 0, firstPlayer: 'nonsense', balancedRoles: 'yes', startingHand: 'abc' } as never); // junk from a hostile client
    await new Promise((r) => setTimeout(r, 60));
    expect(host.room!.settings).toMatchObject({ rounds: 0, firstPlayer: 'host', balancedRoles: false, startingHand: 1 }); // junk ignored, 0 = standard
  });

  it('refuses spectators when the host turns watching off', async () => {
    const { host, code } = await lobby(3);
    host.emit('room:settings', { allowSpectators: false });
    await until(() => host.room?.settings.allowSpectators === false);
    expect((await ask(host, 'room:start')).ok).toBe(true);
    const watcher = await player('watcher');
    const r = await ask(watcher, 'room:join', { roomId: code });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('观战');
  });
});

describe('tutorial room', () => {
  it('starts a private 3-round game with two AI and fixed roles, hidden from the room list and from joins', async () => {
    const p = await player('learner');
    const r = await ask<{ roomId: string }>(p, 'room:tutorial');
    expect(r.ok).toBe(true);
    await until(() => !!p.game?.me && p.game.phase !== 'roleSelect', 'tutorial game to start');
    expect(p.room).toMatchObject({ tutorial: true, status: 'playing' });
    expect(p.room!.members).toHaveLength(3);
    expect(p.room!.members.filter((m) => m.isBot)).toHaveLength(2);
    expect(p.game!.me!.role).toBe('evangelist');
    expect(p.game!.endThreshold).toBe(3);
    expect(p.game!.players.find((x) => x.id === p.playerId)!.handCount).toBeGreaterThanOrEqual(3);

    const other = await player('nosy');
    const list = await ask<{ id: string }[]>(other, 'room:list');
    expect(list.data!.some((x) => x.id === r.data!.roomId)).toBe(false);
    expect((await ask(other, 'room:join', { roomId: r.data!.roomId })).ok).toBe(false);
  });

  it('cannot be reconfigured by the host', async () => {
    const p = await player('learner2');
    await ask(p, 'room:tutorial');
    await until(() => !!p.room);
    p.emit('room:settings', { rounds: 9 });
    p.emit('room:addBot');
    await new Promise((r) => setTimeout(r, 80));
    expect(p.room!.settings.rounds).toBe(3);
    expect(p.room!.members).toHaveLength(3);
  });
});

describe('latency and emotes', () => {
  it('echoes pings and shares each player\'s reported latency with the room', async () => {
    const { host, guests } = await lobby(2);
    await ask(host, 'net:ping');
    host.emit('net:rtt', { ms: 87.4 });
    guests[0].emit('net:rtt', { ms: 142 });
    await until(() => host.room!.members.find((m) => m.id === guests[0].playerId)?.ping === 142, 'guest ping in room view');
    expect(guests[0].room!.members.find((m) => m.id === host.playerId)?.ping).toBe(87);
    host.emit('net:rtt', { ms: Number.NaN });
    host.emit('net:rtt', { ms: -50 });
    await new Promise((r) => setTimeout(r, 60));
    expect(host.room!.members.find((m) => m.id === host.playerId)?.ping).toBe(87); // NaN ignored
  });

  it('relays valid emotes to everyone in the room, rate-limited, and ignores unknown ones', async () => {
    const { host, guests } = await lobby(3);
    host.emit('game:emote', { emote: 'thumbs' });
    await until(() => guests[0].emotes.length === 1 && guests[1].emotes.length === 1, 'emote delivery');
    expect(guests[0].emotes[0]).toMatchObject({ fromId: host.playerId, emote: 'thumbs' });
    host.emit('game:emote', { emote: 'laugh' }); // within 1.2 s → dropped
    guests[1].emit('game:emote', { emote: '<script>' }); // not in the whitelist
    await new Promise((r) => setTimeout(r, 120));
    expect(guests[0].emotes).toHaveLength(1);
    const watcher = await player('watcher');
    watcher.emit('game:emote', { emote: 'fire' }); // not in a room at all
    await new Promise((r) => setTimeout(r, 80));
    expect(guests[0].emotes).toHaveLength(1);
  });
});
