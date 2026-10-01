import {
  DEFAULT_SETTINGS, MAX_PLAYERS, MIN_PLAYERS, SETTING_LIMITS,
  type ChatMessage, type ClientToServer, type RoomSettings, type RoomSummary, type RoomView, type ServerToClient, type VoteView,
} from '@tcd/shared';
import type { Server, Socket } from 'socket.io';
import { AbortError, Game } from './engine/Game.js';
import { runGame } from './engine/flow.js';
import { buildView } from './engine/view.js';

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient, object, { playerId?: string }>;

interface Session {
  playerId: string;
  name: string;
  roomId: string | null;
  sockets: Set<string>;
  /** Smoothed round-trip time reported by the client. */
  rtt: number | null;
  /** Value last broadcast, so small jitter doesn't spam everyone. */
  rttShown: number | null;
  rttAt: number;
}

interface Member {
  id: string;
  name: string;
  isBot: boolean;
}

/** Test/ops knobs (see CLAUDE.md): skip cosmetic pauses, override the default decision time limit. */
const TEST_FAST = process.env.TCD_TEST_FAST === '1';
const DEFAULT_TIMEOUT = process.env.TCD_PROMPT_TIMEOUT !== undefined ? Number(process.env.TCD_PROMPT_TIMEOUT) : DEFAULT_SETTINGS.promptTimeout;
/** A human who stays disconnected this long is handed to a bot (托管). */
const OFFLINE_AUTO_MS = Number(process.env.TCD_OFFLINE_AUTO_MS ?? 25_000);

const BOT_NAMES = ['灵梦', '魔理沙', '咲夜', '妖梦', '早苗', '射命丸', '恋恋', '芙兰', '帕秋莉', '铃仙'];
const EMOTES = new Set(['thumbs', 'laugh', 'think', 'cry', 'fire', 'wait', 'clap', 'cool']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 30 * 60_000;

const rid = (n = 10) => Array.from({ length: n }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const clampInt = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

const VOTE_MS = Number(process.env.TCD_VOTE_MS ?? 30_000);
const VOTE_COOLDOWN_MS = 45_000;

interface VoteState {
  id: string;
  byId: string;
  byName: string;
  voters: string[];
  yes: Set<string>;
  no: Set<string>;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Roles used by the coached tutorial game: simple, and on opposite sides so the win conditions can be explained. */
export const TUTORIAL_ROLES = ['evangelist', 'touhou_police', 'freeloader'];

class Room {
  members: Member[] = [];
  settings: RoomSettings = { ...DEFAULT_SETTINGS, promptTimeout: DEFAULT_TIMEOUT };
  status: RoomView['status'] = 'lobby';
  game: Game | null = null;
  chat: ChatMessage[] = [];
  lastActive = Date.now();
  tutorial = false;
  vote: VoteState | null = null;
  /** Earliest time a player may propose again after a refused vote. */
  private voteCooldown = new Map<string, number>();

  constructor(readonly id: string, public hostId: string, private readonly hub: RoomHub) {}

  get humans() {
    return this.members.filter((m) => !m.isBot);
  }

  view(youId: string): RoomView {
    return {
      id: this.id,
      hostId: this.hostId,
      members: this.members.map((m) => ({
        id: m.id, name: m.name, isBot: m.isBot, connected: m.isBot || this.hub.online(m.id), ping: m.isBot ? null : this.hub.ping(m.id),
      })),
      settings: this.settings,
      status: this.status,
      youId,
      tutorial: this.tutorial,
    };
  }

  /** Everyone attached to this room: members plus spectators. */
  audience(): string[] {
    return [...this.hub.sessionsIn(this.id)].map((s) => s.playerId);
  }

  broadcastRoom() {
    this.lastActive = Date.now();
    for (const pid of this.audience()) this.hub.emitTo(pid, 'room:state', this.view(pid));
  }

  broadcastGame() {
    const g = this.game;
    for (const pid of this.audience()) {
      const isMember = this.members.some((m) => m.id === pid);
      this.hub.emitTo(pid, 'game:state', g ? buildView(g, isMember ? pid : null, (id) => this.hub.online(id), (id) => this.hub.ping(id)) : null);
    }
  }

  // ── abandon-the-game vote ──────────────────────────────────────────────────────
  voteView(): VoteView | null {
    const v = this.vote;
    return v && { id: v.id, kind: 'abort', byId: v.byId, byName: v.byName, voters: v.voters, yes: [...v.yes], no: [...v.no], deadline: v.deadline };
  }

  broadcastVote() {
    const view = this.voteView();
    for (const pid of this.audience()) this.hub.emitTo(pid, 'vote:state', view);
  }

  /** Returns an error message, or null when the vote started. */
  startVote(byId: string): string | null {
    const me = this.members.find((m) => m.id === byId);
    if (!me || me.isBot) return '只有牌桌上的玩家可以发起';
    if (this.status !== 'playing' || !this.game) return '游戏没有在进行';
    if (this.vote) return '已经有一个投票在进行';
    const wait = (this.voteCooldown.get(byId) ?? 0) - Date.now();
    if (wait > 0) return `刚刚被拒绝，请 ${Math.ceil(wait / 1000)} 秒后再试`;
    // Everyone who is actually here must agree; absent or 托管 players can't hold the table hostage.
    const voters = this.humans.filter((m) => this.hub.online(m.id) && !this.game!.player(m.id).auto).map((m) => m.id);
    const id = Math.random().toString(36).slice(2, 8);
    const timer = setTimeout(() => this.resolveVote(true), VOTE_MS);
    this.vote = { id, byId, byName: me.name, voters, yes: new Set([byId]), no: new Set(), deadline: Date.now() + VOTE_MS, timer };
    this.broadcastVote();
    this.resolveVote(false);
    return null;
  }

  castVote(pid: string, yes: boolean) {
    const v = this.vote;
    if (!v || !v.voters.includes(pid) || v.yes.has(pid) || v.no.has(pid)) return;
    (yes ? v.yes : v.no).add(pid);
    this.broadcastVote();
    this.resolveVote(false);
  }

  /** Settle the vote when it is decided (or, with expired, when time ran out). */
  private resolveVote(expired: boolean) {
    const v = this.vote;
    if (!v) return;
    const everyoneYes = v.voters.every((id) => v.yes.has(id));
    if (!(everyoneYes || v.no.size > 0 || expired)) return;
    clearTimeout(v.timer);
    this.vote = null;
    this.broadcastVote();
    if (everyoneYes) {
      this.stop();
      this.status = 'lobby';
      for (const pid of this.audience()) this.hub.emitTo(pid, 'toast', { text: '全员同意：本局已中止，回到房间', tone: 'good' });
      this.broadcastRoom();
      this.broadcastGame();
    } else {
      this.voteCooldown.set(v.byId, Date.now() + VOTE_COOLDOWN_MS);
      const why = v.no.size ? '有人拒绝' : '投票超时';
      for (const pid of this.audience()) this.hub.emitTo(pid, 'toast', { text: `${why}，继续游戏`, tone: 'bad' });
    }
  }

  start() {
    const s = this.settings;
    const seats = this.members.map((m) => ({ ...m, host: m.id === this.hostId }));
    const game = new Game(seats, {
      promptTimeout: s.promptTimeout * 1000,
      botDelay: s.botDelay,
      roleChoices: s.roleChoices,
      fast: TEST_FAST,
      rounds: s.rounds,
      startingHand: s.startingHand,
      firstPlayer: s.firstPlayer,
      balancedRoles: s.balancedRoles,
      pace: s.pace,
      // The tutorial deals fixed roles (you are always the first seat) so the coaching can name them.
      ...(this.tutorial ? { roles: TUTORIAL_ROLES } : {}),
    }, () => this.broadcastGame());
    this.game = game;
    this.status = 'playing';
    this.broadcastRoom();
    runGame(game)
      .then(() => {
        if (this.game !== game) return;
        this.status = 'finished';
        this.broadcastRoom();
        this.broadcastGame();
      })
      .catch((e) => {
        if (!(e instanceof AbortError)) console.error(`[room ${this.id}] game crashed`, e);
      });
  }

  stop() {
    if (this.vote) {
      clearTimeout(this.vote.timer);
      this.vote = null;
      this.broadcastVote();
    }
    this.game?.abort();
    this.game = null;
  }
}

/** All rooms and player sessions. One instance per server. */
export class RoomHub {
  private rooms = new Map<string, Room>();
  private sessions = new Map<string, Session>(); // token → session
  private byPlayer = new Map<string, Session>(); // playerId → session

  constructor(private readonly io: IO) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  online(playerId: string) {
    return (this.byPlayer.get(playerId)?.sockets.size ?? 0) > 0;
  }
  ping(playerId: string): number | null {
    const s = this.byPlayer.get(playerId);
    return s && s.sockets.size ? s.rtt : null;
  }
  *sessionsIn(roomId: string) {
    for (const s of this.byPlayer.values()) if (s.roomId === roomId) yield s;
  }
  emitTo<E extends keyof ServerToClient>(playerId: string, ev: E, ...args: Parameters<ServerToClient[E]>) {
    const s = this.byPlayer.get(playerId);
    if (s) for (const sid of s.sockets) this.io.to(sid).emit(ev, ...args);
  }

  private sweep() {
    for (const [id, r] of this.rooms) {
      const anyone = r.humans.some((m) => this.online(m.id));
      if (!anyone && Date.now() - r.lastActive > ROOM_IDLE_MS) {
        r.stop();
        this.rooms.delete(id);
      }
    }
  }

  private newRoom(host: Session) {
    let id = rid(4);
    while (this.rooms.has(id)) id = rid(4);
    const r = new Room(id, host.playerId, this);
    r.members.push({ id: host.playerId, name: host.name, isBot: false });
    this.rooms.set(id, r);
    host.roomId = id;
    return r;
  }

  attach(sock: Sock) {
    let session: Session | null = null;
    const room = () => (session?.roomId ? this.rooms.get(session.roomId) ?? null : null);
    const fail = <T>(ack: ((r: { ok: false; error: string }) => void) | undefined, error: string) => ack?.({ ok: false, error }) as T;

    sock.on('session:hello', ({ token, name }, ack) => {
      token = clean(token, 64);
      if (token.length < 16) return fail(ack, '无效的会话');
      let s = this.sessions.get(token);
      if (!s) {
        s = { playerId: rid(12), name: '', roomId: null, sockets: new Set(), rtt: null, rttShown: null, rttAt: 0 };
        this.sessions.set(token, s);
        this.byPlayer.set(s.playerId, s);
      }
      s.name = clean(name, 16) || s.name || '无名氏';
      s.sockets.add(sock.id);
      session = s;
      sock.data.playerId = s.playerId;
      // Keep member names in sync.
      const r = room();
      const m = r?.members.find((x) => x.id === s!.playerId);
      if (m && r?.status === 'lobby') m.name = s.name;
      // Welcome back: a bot that was covering for you steps aside.
      if (m && r?.game) r.game.setAuto(m.id, false);
      ack({ ok: true, data: { playerId: s.playerId, roomId: s.roomId } });
      if (r) {
        r.broadcastRoom();
        r.broadcastGame();
        for (const msg of r.chat.slice(-50)) sock.emit('chat:message', msg);
        sock.emit('vote:state', r.voteView());
      } else {
        sock.emit('room:state', null);
      }
    });

    // Latency: the client times this round trip itself and reports the smoothed value back.
    sock.on('net:ping', (ack) => typeof ack === 'function' && ack());
    sock.on('net:rtt', ({ ms }) => {
      if (!session || !Number.isFinite(ms)) return;
      session.rtt = Math.max(0, Math.min(5000, Math.round(ms)));
      const now = Date.now();
      // Re-broadcast only when the number visibly changed (≥ 25 ms) and not more than every 2.5 s.
      if (session.rttShown === null || (Math.abs(session.rtt - session.rttShown) >= 25 && now - session.rttAt > 2500)) {
        session.rttShown = session.rtt;
        session.rttAt = now;
        const r = room();
        if (r) {
          r.broadcastRoom();
          if (r.status === 'playing') r.broadcastGame();
        }
      }
    });

    sock.on('room:list', (ack) => {
      const list: RoomSummary[] = [...this.rooms.values()]
        .filter((r) => !r.tutorial && r.humans.some((m) => this.online(m.id)))
        .map((r) => ({
          id: r.id,
          hostName: r.members.find((m) => m.id === r.hostId)?.name ?? '?',
          players: r.members.length,
          status: r.status,
        }));
      ack({ ok: true, data: list });
    });

    sock.on('room:create', (ack) => {
      if (!session) return fail(ack, '尚未登录');
      this.leave(session);
      const r = this.newRoom(session);
      ack({ ok: true, data: { roomId: r.id } });
      r.broadcastRoom();
    });

    /** A private practice game: you + two AI, fixed simple roles, short, no time limit; the client coaches. */
    sock.on('room:tutorial', (ack) => {
      if (!session) return fail(ack, '尚未登录');
      this.leave(session);
      const r = this.newRoom(session);
      r.tutorial = true;
      r.settings = { ...DEFAULT_SETTINGS, rounds: 3, startingHand: 3, promptTimeout: 0, botDelay: 1100, roleChoices: 1, allowSpectators: false };
      r.members.push({ id: `bot_${rid(8)}`, name: '灵梦·AI', isBot: true }, { id: `bot_${rid(8)}`, name: '魔理沙·AI', isBot: true });
      ack({ ok: true, data: { roomId: r.id } });
      r.start();
    });

    sock.on('room:join', ({ roomId }, ack) => {
      if (!session) return fail(ack, '尚未登录');
      const r = this.rooms.get(clean(roomId, 8).toUpperCase());
      if (!r || r.tutorial) return fail(ack, '房间不存在');
      if (session.roomId !== r.id) this.leave(session);
      const already = r.members.some((m) => m.id === session!.playerId);
      if (!already && r.status === 'lobby') {
        if (r.members.length >= MAX_PLAYERS) return fail(ack, '房间已满');
        r.members.push({ id: session.playerId, name: session.name, isBot: false });
      } else if (!already && !r.settings.allowSpectators) {
        return fail(ack, '房主不允许观战');
      }
      // Not a member of a running game → spectator.
      session.roomId = r.id;
      ack({ ok: true, data: { roomId: r.id } });
      r.broadcastRoom();
      r.broadcastGame();
      for (const msg of r.chat.slice(-50)) sock.emit('chat:message', msg);
    });

    sock.on('room:leave', () => {
      if (session) this.leave(session);
      sock.emit('room:state', null);
      sock.emit('game:state', null);
    });

    const hostRoom = (lobbyOnly = true) => {
      const r = room();
      if (!r || r.hostId !== session?.playerId) return null;
      if (lobbyOnly && r.status === 'playing') return null;
      return r;
    };

    sock.on('room:settings', (p) => {
      const r = hostRoom();
      if (!r || r.tutorial || !p || typeof p !== 'object') return;
      const s = r.settings;
      const L = SETTING_LIMITS;
      if (p.roleChoices !== undefined) s.roleChoices = clampInt(p.roleChoices, L.roleChoices, s.roleChoices);
      if (p.promptTimeout !== undefined) s.promptTimeout = clampInt(p.promptTimeout, L.promptTimeout, s.promptTimeout);
      if (p.botDelay !== undefined) s.botDelay = clampInt(p.botDelay, L.botDelay, s.botDelay);
      if (p.rounds !== undefined) s.rounds = Number(p.rounds) === 0 ? 0 : clampInt(p.rounds, L.rounds, s.rounds);
      if (p.startingHand !== undefined) s.startingHand = clampInt(p.startingHand, L.startingHand, s.startingHand);
      if (p.firstPlayer === 'random' || p.firstPlayer === 'host') s.firstPlayer = p.firstPlayer;
      if (typeof p.balancedRoles === 'boolean') s.balancedRoles = p.balancedRoles;
      if (typeof p.allowSpectators === 'boolean') s.allowSpectators = p.allowSpectators;
      if (p.pace === 'quick' || p.pace === 'normal' || p.pace === 'epic') s.pace = p.pace;
      r.broadcastRoom();
    });

    sock.on('room:addBot', () => {
      const r = hostRoom();
      if (!r || r.tutorial || r.status !== 'lobby' || r.members.length >= MAX_PLAYERS) return;
      const used = new Set(r.members.map((m) => m.name));
      const name = BOT_NAMES.find((n) => !used.has(`${n}·AI`)) ?? `AI${r.members.length}`;
      r.members.push({ id: `bot_${rid(8)}`, name: `${name}·AI`, isBot: true });
      r.broadcastRoom();
    });

    sock.on('room:kick', ({ memberId }) => {
      const r = hostRoom();
      if (!r || r.status !== 'lobby' || memberId === r.hostId) return;
      r.members = r.members.filter((m) => m.id !== memberId);
      const s = this.byPlayer.get(memberId);
      if (s) {
        s.roomId = null;
        this.emitTo(memberId, 'room:state', null);
        this.emitTo(memberId, 'toast', { text: '你被房主移出了房间', tone: 'bad' });
      }
      r.broadcastRoom();
    });

    sock.on('room:start', (ack) => {
      const r = hostRoom();
      if (!r || r.status !== 'lobby') return fail(ack, '只有房主可以开始游戏');
      if (r.members.length < MIN_PLAYERS) return fail(ack, `至少需要 ${MIN_PLAYERS} 名玩家（可以添加 AI）`);
      ack({ ok: true, data: null });
      r.start();
    });

    sock.on('room:rematch', () => {
      const r = hostRoom(false);
      if (!r || r.status !== 'finished') return;
      r.stop();
      r.status = 'lobby';
      r.broadcastRoom();
      r.broadcastGame();
    });

    sock.on('game:answer', ({ promptId, value }) => {
      const r = room();
      if (!r?.game || !session) return;
      const pid = String(promptId);
      const current = r.game.promptFor(session.playerId);
      // A stale prompt (double click, answer raced with a timeout) is silently ignored;
      // only an invalid answer to the *current* prompt deserves feedback.
      if (!r.game.answer(session.playerId, pid, value) && current?.id === pid) {
        sock.emit('toast', { text: '这个选择无效，请重试', tone: 'bad' });
      }
    });

    sock.on('vote:start', (ack) => {
      const r = room();
      if (!r || !session || r.tutorial) return fail(ack, '现在不能发起投票');
      const err = r.startVote(session.playerId);
      return err ? fail(ack, err) : ack({ ok: true, data: null });
    });
    sock.on('vote:cast', ({ yes }) => {
      const r = room();
      if (r && session) r.castVote(session.playerId, !!yes);
    });

    sock.on('game:resume', () => {
      const r = room();
      if (r?.game && session && r.members.some((m) => m.id === session!.playerId)) r.game.setAuto(session.playerId, false);
    });

    // Emotes: one per 1.2 s per connection, members only, from a fixed set.
    let lastEmote = 0;
    sock.on('game:emote', ({ emote }) => {
      const r = room();
      if (!r || !session || !EMOTES.has(emote) || !r.members.some((m) => m.id === session!.playerId)) return;
      const now = Date.now();
      if (now - lastEmote < 1200) return;
      lastEmote = now;
      for (const pid of r.audience()) this.emitTo(pid, 'game:emote', { fromId: session.playerId, emote, at: now });
    });

    // Simple flood guard: at most 6 chat messages per 5 s per connection.
    const chatTimes: number[] = [];
    sock.on('chat:send', ({ text }) => {
      const r = room();
      text = clean(text, 200);
      if (!r || !session || !text) return;
      const now = Date.now();
      while (chatTimes.length && now - chatTimes[0] > 5000) chatTimes.shift();
      if (chatTimes.length >= 6) return void sock.emit('toast', { text: '发言太快了，稍等一下', tone: 'bad' });
      chatTimes.push(now);
      const msg: ChatMessage = { id: rid(8), at: Date.now(), fromId: session.playerId, fromName: session.name, text };
      r.chat.push(msg);
      if (r.chat.length > 200) r.chat.shift();
      for (const pid of r.audience()) this.emitTo(pid, 'chat:message', msg);
    });

    sock.on('disconnect', () => {
      if (!session) return;
      session.sockets.delete(sock.id);
      const r = room();
      if (!r) return;
      const s = session;
      if (!this.online(s.playerId)) {
        s.rtt = null;
        s.rttShown = null;
        if (r.tutorial) {
          // Nobody to wait for: drop an abandoned tutorial after a minute.
          setTimeout(() => !this.online(s.playerId) && s.roomId === r.id && this.leave(s), 60_000);
        } else if (r.status === 'lobby') {
          // A player who fully disconnects frees their seat after a grace period.
          setTimeout(() => {
            if (!this.online(s.playerId) && s.roomId === r.id && r.status === 'lobby') this.leave(s);
          }, 45_000);
        } else if (r.status === 'playing' && r.members.some((m) => m.id === s.playerId)) {
          // Mid-game: a bot covers for them if they stay away, so the table never stalls.
          setTimeout(() => {
            if (!this.online(s.playerId) && r.status === 'playing') r.game?.setAuto(s.playerId, true);
          }, OFFLINE_AUTO_MS);
        }
      }
      r.broadcastRoom();
      r.broadcastGame();
    });
  }

  private leave(s: Session) {
    const r = s.roomId ? this.rooms.get(s.roomId) : null;
    s.roomId = null;
    if (!r) return;
    if (r.status !== 'playing' || r.tutorial) {
      r.members = r.members.filter((m) => m.id !== s.playerId);
    }
    if (!r.humans.length) {
      r.stop();
      this.rooms.delete(r.id);
      return;
    }
    if (r.hostId === s.playerId) r.hostId = (r.humans.find((m) => this.online(m.id)) ?? r.humans[0]).id;
    r.broadcastRoom();
  }
}
