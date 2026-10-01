import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientToServer, Fx, GameView, Prompt, RoomView, ServerToClient, VoteView } from '@tcd/shared';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveEvent } from '../src/engine/events.js';
import { listMoves, playCard } from '../src/engine/flow.js';
import type { Game } from '../src/engine/Game.js';
import { useSkill } from '../src/engine/roles.js';
import { scoreGame } from '../src/engine/scoring.js';
import { RoomHub } from '../src/rooms.js';
import { giveCards, scriptedGame, setOfficial, startTurn } from './harness.js';

const fxOf = (g: Game, type: Fx['type']) => g.s.log.map((l) => l.fx).filter((f): f is Fx => !!f && f.type === type);

describe('effect events (drive the on-screen effects)', () => {
  it('number changes say which card and which player caused them', async () => {
    const g = scriptedGame(3, (_g, _w, p) => (p.kind === 'choice' ? '+' : p.kind === 'players' ? ['p1'] : undefined));
    const [a] = g.players;
    startTurn(g, a);
    const [pr, rm] = giveCards(g, a, 'preach', 'rumor');
    await playCard(g, a, pr.uid, 'preach');
    await playCard(g, a, rm.uid, 'rumor');
    const comm = fxOf(g, 'community').at(-1) as Extract<Fx, { type: 'community' }>;
    expect(comm).toMatchObject({ cardId: 'preach', by: 'p0', from: 0, to: 2 });
    const inf = fxOf(g, 'influence').find((f) => f.type === 'influence' && f.playerId === 'p1') as Extract<Fx, { type: 'influence' }>;
    expect(inf).toMatchObject({ cardId: 'rumor', by: 'p0', from: 0, to: -2 });
  });

  it('targets are announced when a card picks them', async () => {
    const g = scriptedGame(3, (_g, _w, p) => (p.kind === 'players' ? ['p2'] : undefined));
    startTurn(g, g.players[0]);
    const [c] = giveCards(g, g.players[0], 'rumor');
    await playCard(g, g.players[0], c.uid, 'rumor');
    expect(fxOf(g, 'target')).toContainEqual({ type: 'target', fromId: 'p0', toIds: ['p2'], cardId: 'rumor' });
  });

  it('every number change carries its calculation: printed number, modifiers, final value', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    const [fan] = giveCards(g, a, 'fan_flames');
    await playCard(g, a, fan.uid, 'fan_flames');
    await resolveEvent(g, a, g.newCard('calm'), 'none'); // +3, becomes +4
    const comm = fxOf(g, 'community').at(-1) as Extract<Fx, { type: 'community' }>;
    expect(comm.to - comm.from).toBe(4);
    expect(comm.calc!.map((s) => [s.sourceId, s.value])).toEqual([['calm', 3], ['fan_flames', 4]]);

    const g2 = scriptedGame(3);
    setOfficial(g2, 'ddc');
    startTurn(g2, g2.players[0]);
    await resolveEvent(g2, g2.players[0], g2.newCard('calm'), 'none');
    const c2 = fxOf(g2, 'community').at(-1) as Extract<Fx, { type: 'community' }>;
    expect(c2.calc!.map((s) => [s.label, s.value])).toEqual([['大环境沉稳', 3], ['东方辉针城', 6]]);

    // An action card under 辉针城 shows its printed number and the doubling too.
    const g3 = scriptedGame(3, (_g, _w, p) => (p.kind === 'choice' ? '+' : undefined));
    setOfficial(g3, 'ddc');
    startTurn(g3, g3.players[0]);
    const [pr] = giveCards(g3, g3.players[0], 'preach');
    await playCard(g3, g3.players[0], pr.uid, 'preach');
    const c3 = fxOf(g3, 'community').at(-1) as Extract<Fx, { type: 'community' }>;
    expect(c3.calc!.map((s) => s.value)).toEqual([2, 4]);
    // Values that hit a limit say so.
    await g3.changeCommunity(40, { cause: 'rule' });
    const capped = fxOf(g3, 'community').at(-1) as Extract<Fx, { type: 'community' }>;
    expect(capped.calc!.at(-1)!.label).toBe('上限');
  });

  it('a card stays on the stage until its effect is over, then settles', async () => {
    const g = scriptedGame(3, (_g, _w, p) => (p.kind === 'players' ? ['p1'] : undefined));
    startTurn(g, g.players[0]);
    const [c] = giveCards(g, g.players[0], 'rumor');
    await playCard(g, g.players[0], c.uid, 'rumor');
    const types = g.s.log.map((l) => l.fx?.type).filter(Boolean);
    const play = types.indexOf('play');
    const settle = types.indexOf('settle');
    expect(play).toBeGreaterThanOrEqual(0);
    expect(types.slice(play, settle)).toContain('target');
    expect(types.slice(play, settle)).toContain('influence'); // the numbers happen while the card is still in the middle
    expect(fxOf(g, 'settle')[0]).toMatchObject({ cardId: 'rumor', playerId: 'p0', to: 'discard' });
    expect(g.s.actionDiscard.at(-1)?.defId).toBe('rumor');
  });

  it('the final settlement tells how every score came about, step by step', () => {
    const g = scriptedGame(3);
    const [a, b, c] = g.players;
    a.role = 'evangelist'; a.influence = 2; // 社群·繁荣
    b.role = 'touhou_police'; b.influence = 5;
    c.role = 'freeloader'; c.influence = -1;
    g.s.community = 3;
    const res = scoreGame(g);
    const line = (id: string) => res.lines.find((l) => l.playerId === id)!;
    const ea = line('p0');
    expect(ea.won).toBe(true);
    expect(ea.baseScore).toBe(3);
    expect(ea.steps.map((s) => s.label)).toEqual(['阵营', '社群规模', '个人影响力', '基础分']);
    expect(ea.steps.find((s) => s.label === '社群规模')).toMatchObject({ ok: true });
    expect(ea.steps.at(-1)).toMatchObject({ label: '基础分', points: 3 });
    expect(ea.vpNote).toMatch(/胜点/);
    // everybody has a story and a reason for their 胜点, and the winners are told apart from the rest
    for (const l of res.lines) {
      expect(l.steps.length).toBeGreaterThan(0);
      expect(l.vpNote).toMatch(/→ \d 胜点/);
      expect(l.influence).toBe(g.player(l.playerId).influence);
    }
    const top = res.lines.filter((l) => res.winnerIds.includes(l.playerId));
    expect(top.every((l) => l.victoryPoints === 2)).toBe(true);
  });

  it('immunities show up as a block effect', async () => {
    const g = scriptedGame(3);
    const [a, b] = g.players;
    startTurn(g, a);
    g.addStatus(b, 'withdrawn', g.newCard('withdrawn'), '自闭');
    await g.changeInfluence(b, -2, { cause: 'action', source: a, cardId: 'rumor' });
    expect(fxOf(g, 'block')[0]).toMatchObject({ playerId: 'p1', label: '自闭' });
    expect(b.influence).toBe(0);
  });

  it('passive skills produce a skill effect; active skills announce even when already face-up', async () => {
    const g = scriptedGame(3);
    const [a, b] = g.players;
    a.role = 'socialite';
    a.roleRevealed = true;
    startTurn(g, b);
    await g.changeCommunity(3, { cause: 'event', source: b }); // 扩列: community +3 > 2
    const passive = fxOf(g, 'skill') as Extract<Fx, { type: 'skill' }>[];
    expect(passive.find((s) => s.skill === '扩列')).toMatchObject({ playerId: 'p0', roleId: 'socialite', passive: true });

    const g2 = scriptedGame(3, (_g, _w, p) => (p.kind === 'cards' ? (p as Extract<Prompt, { kind: 'cards' }>).cards.slice(0, p.min).map((c) => c.uid) : undefined));
    const [c] = g2.players;
    c.role = 'platform_op';
    c.roleRevealed = true;
    startTurn(g2, c);
    giveCards(g2, c, 'create');
    await useSkill(g2, c, 'promote');
    const act = (fxOf(g2, 'skill') as Extract<Fx, { type: 'skill' }>[]).find((s) => s.skill === '推广');
    expect(act).toMatchObject({ playerId: 'p0', passive: false, reveals: false });
  });
});

describe('explaining unusual moves', () => {
  it('a role skill that lets a card be played as another says where the option comes from, and that it reveals you', () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    a.role = 'evangelist';
    startTurn(g, a);
    giveCards(g, a, 'create');
    const alt = listMoves(g, a).find((m) => m.via === '传教')!;
    expect(alt.why).toMatchObject({ title: '角色技能「传教」', sourceId: 'evangelist' });
    expect(alt.why!.text).toContain('传教爱好者');
    expect(alt.reveals).toBe(true);

    a.roleRevealed = true;
    expect(listMoves(g, a).find((m) => m.via === '传教')!.reveals).toBe(false);
  });

  it('official-granted plays and copies explain themselves', () => {
    const g = scriptedGame(3);
    setOfficial(g, 'soku');
    const [a] = g.players;
    startTurn(g, a);
    giveCards(g, a, 'create');
    const soku = listMoves(g, a).find((m) => m.via === '东方非想天则')!;
    expect(soku.why).toMatchObject({ sourceId: 'soku' });
    expect(soku.reveals).toBeFalsy(); // officials never reveal you

    const g2 = scriptedGame(3);
    startTurn(g2, g2.players[0]);
    g2.s.lastActionDiscarded = 'create';
    giveCards(g2, g2.players[0], 'human_nature');
    const copy = listMoves(g2, g2.players[0]).find((m) => m.uid)!;
    expect(copy.why).toMatchObject({ sourceId: 'human_nature' });
    expect(copy.why!.text).toContain('创作');
  });

  it('the played card records its source for the animation', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    a.role = 'evangelist';
    startTurn(g, a);
    (g as { opts: { decide?: unknown } }).opts.decide = (_g: Game, _w: unknown, p: Prompt) => (p.kind === 'choice' ? '+' : undefined);
    const [c] = giveCards(g, a, 'create');
    await playCard(g, a, c.uid, 'preach', '传教');
    const play = fxOf(g, 'play').at(-1) as Extract<Fx, { type: 'play' }>;
    expect(play).toMatchObject({ cardId: 'create', as: 'preach', via: { skill: '传教', sourceId: 'evangelist' } });
  });

  it('prompts about your own hidden role warn that saying yes reveals it', async () => {
    const seen: Prompt[] = [];
    const g = scriptedGame(3, (_g, _w, p) => { seen.push(p); return p.kind === 'choice' ? 'no' : undefined; });
    const [a, b] = g.players;
    a.role = 'hermit';
    startTurn(g, b);
    giveCards(g, a, 'create');
    await g.discardFromHand(a, 1, { source: b }); // 桃源民 may negate (a confirm about its own skill)
    const warn = seen.find((p) => p.kind === 'choice' && p.cardId === 'hermit');
    expect(warn?.reveals).toBe(true);
    a.roleRevealed = true;
    seen.length = 0;
    giveCards(g, a, 'create');
    startTurn(g, b);
    await g.discardFromHand(a, 1, { source: b });
    expect(seen.find((p) => p.kind === 'choice' && p.cardId === 'hermit')?.reveals).toBeUndefined();
  });
});

// ── vote to abandon the game ───────────────────────────────────────────────────────────────────

type Client = Socket<ServerToClient, ClientToServer> & { room: RoomView | null; game: GameView | null; vote: VoteView | null; playerId: string; toasts: string[]; token: string };
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
  c.room = null; c.game = null; c.vote = null; c.toasts = [];
  c.on('room:state', (r) => { c.room = r; });
  c.on('game:state', (g) => { c.game = g; });
  c.on('vote:state', (v) => { c.vote = v; });
  c.on('toast', (t) => c.toasts.push(t.text));
  open.push(c);
  await new Promise<void>((r) => c.on('connect', () => r()));
  c.token = `${name}-${Math.random().toString(36).slice(2)}-0123456789`;
  const hello = await ask<{ playerId: string }>(c, 'session:hello', { token: c.token, name });
  c.playerId = hello.data!.playerId;
  return c;
}
async function runningGame(humans: number, bots: number) {
  const host = await player('host');
  const { data } = await ask<{ roomId: string }>(host, 'room:create');
  const guests: Client[] = [];
  for (let i = 1; i < humans; i++) {
    const g = await player(`guest${i}`);
    await ask(g, 'room:join', { roomId: data!.roomId });
    guests.push(g);
  }
  for (let i = 0; i < bots; i++) host.emit('room:addBot');
  await until(() => host.room?.members.length === humans + bots);
  host.emit('room:settings', { promptTimeout: 0 });
  expect((await ask(host, 'room:start')).ok).toBe(true);
  await until(() => host.game?.phase === 'roleSelect', 'game start');
  return { host, guests };
}

describe('abandoning a game by vote', () => {
  it('one refusal keeps the game; unanimous agreement returns everyone to the room', async () => {
    const { host, guests } = await runningGame(2, 1);
    const [b] = guests;
    expect((await ask(host, 'vote:start')).ok).toBe(true);
    await until(() => !!b.vote && b.vote.byId === host.playerId, 'vote shown to the other player');
    expect(b.vote!.voters.sort()).toEqual([host.playerId, b.playerId].sort());
    expect(b.vote!.yes).toEqual([host.playerId]);
    expect((await ask(b, 'vote:start')).error).toContain('已经有一个投票');

    b.emit('vote:cast', { yes: false });
    await until(() => host.vote === null && b.vote === null, 'vote closed');
    expect(host.room!.status).toBe('playing');
    expect(host.toasts.some((t) => t.includes('拒绝'))).toBe(true);
    expect((await ask(host, 'vote:start')).error).toContain('秒后再试'); // cooldown for the proposer

    expect((await ask(b, 'vote:start')).ok).toBe(true); // someone else may propose
    host.emit('vote:cast', { yes: true });
    await until(() => host.room?.status === 'lobby' && b.room?.status === 'lobby', 'both back in the lobby');
    expect(host.game).toBeNull();
    expect(b.game).toBeNull();
  });

  it('passes at once when the proposer is the only human; not available to bots, spectators or the tutorial', async () => {
    const { host } = await runningGame(1, 2);
    expect((await ask(host, 'vote:start')).ok).toBe(true);
    await until(() => host.room?.status === 'lobby', 'solo vote passes');

    const watcher = await player('watcher');
    const t = await player('learner');
    await ask(t, 'room:tutorial');
    await until(() => t.room?.tutorial === true);
    expect((await ask(t, 'vote:start')).ok).toBe(false);
    expect((await ask(watcher, 'vote:start')).ok).toBe(false);
  });

  it('pace is a validated room setting', async () => {
    const host = await player('pacer');
    await ask(host, 'room:create');
    await until(() => host.room?.settings.pace === 'epic'); // the default is the full show
    host.emit('room:settings', { pace: 'quick' });
    await until(() => host.room?.settings.pace === 'quick');
    host.emit('room:settings', { pace: 'warp' } as never);
    await new Promise((r) => setTimeout(r, 60));
    expect(host.room!.settings.pace).toBe('quick');
  });

  it('game updates carry only the new log lines; a (re)connecting client gets the recent history again', async () => {
    const { host } = await runningGame(1, 2);
    await until(() => (host.game?.log.length ?? 0) > 0, 'first state with log');
    const first = host.game!.log.at(-1)!.seq;
    host.emit('net:rtt', { ms: 300 }); // makes the server broadcast again without logging anything new
    await until(() => host.room?.members[0].ping === 300, 'rebroadcast');
    expect(host.game!.log.every((e) => e.seq > first) || host.game!.log.length === 0).toBe(true); // no repeated history
    // a second connection for the same player is a fresh client: it gets the history
    const again = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
    open.push(again);
    let got: GameView | null = null;
    again.on('game:state', (g) => { got = g; });
    await new Promise<void>((r) => again.on('connect', () => r()));
    await ask(again, 'session:hello', { token: host.token, name: 'host' });
    await until(() => !!got, 'state for the new connection');
    expect(got!.log.length).toBeGreaterThanOrEqual(host.game!.log.length);
    expect(got!.log[0].seq).toBeLessThanOrEqual(first);
  });
});
