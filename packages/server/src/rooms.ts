import {
  DEFAULT_SETTINGS, MAX_PLAYERS, MIN_PLAYERS,
  type ChatMessage, type ClientToServer, type RoomSettings, type RoomSummary, type RoomView, type ServerToClient,
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

const BOT_NAMES =['灵梦', '魔理沙', '咲夜', '妖梦', '早苗', '射命丸', '恋恋', '芙兰', '帕秋莉', '铃仙'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 30 * 60_000;

const rid = (n = 10) => Array.from({ length: n }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

class Room {
  members: Member[] = [];
  settings: RoomSettings = { ...DEFAULT_SETTINGS, promptTimeout: DEFAULT_TIMEOUT };
  status: RoomView['status'] = 'lobby';
  game: Game | null = null;
  chat: ChatMessage[] = [];
  lastActive = Date.now();

  constructor(readonly id: string, public hostId: string, private readonly hub: RoomHub) {}

  get humans() {
    return this.members.filter((m) => !m.isBot);
  }

  view(youId: string): RoomView {
    return {
      id: this.id,
      hostId: this.hostId,
      members: this.members.map((m) => ({ id: m.id, name: m.name, isBot: m.isBot, connected: m.isBot || this.hub.online(m.id) })),
      settings: this.settings,
      status: this.status,
      youId,
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
      this.hub.emitTo(pid, 'game:state', g ? buildView(g, isMember ? pid : null, (id) => this.hub.online(id)) : null);
    }
  }

  start() {
    const game = new Game(this.members.map((m) => ({ ...m })), {
      promptTimeout: this.settings.promptTimeout * 1000,
      botDelay: this.settings.botDelay,
      roleChoices: this.settings.roleChoices,
      fast: TEST_FAST,
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

  attach(sock: Sock) {
    let session: Session | null = null;
    const room = () => (session?.roomId ? this.rooms.get(session.roomId) ?? null : null);
    const fail = <T>(ack: ((r: { ok: false; error: string }) => void) | undefined, error: string) => ack?.({ ok: false, error }) as T;

    sock.on('session:hello', ({ token, name }, ack) => {
      token = clean(token, 64);
      if (token.length < 16) return fail(ack, '无效的会话');
      let s = this.sessions.get(token);
      if (!s) {
        s = { playerId: rid(12), name: '', roomId: null, sockets: new Set() };
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
      } else {
        sock.emit('room:state', null);
      }
    });

    sock.on('room:list', (ack) => {
      const list: RoomSummary[] = [...this.rooms.values()]
        .filter((r) => r.humans.some((m) => this.online(m.id)))
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
      let id = rid(4);
      while (this.rooms.has(id)) id = rid(4);
      const r = new Room(id, session.playerId, this);
      r.members.push({ id: session.playerId, name: session.name, isBot: false });
      this.rooms.set(id, r);
      session.roomId = id;
      ack({ ok: true, data: { roomId: id } });
      r.broadcastRoom();
    });

    sock.on('room:join', ({ roomId }, ack) => {
      if (!session) return fail(ack, '尚未登录');
      const r = this.rooms.get(clean(roomId, 8).toUpperCase());
      if (!r) return fail(ack, '房间不存在');
      if (session.roomId !== r.id) this.leave(session);
      const already = r.members.some((m) => m.id === session!.playerId);
      if (!already && r.status === 'lobby') {
        if (r.members.length >= MAX_PLAYERS) return fail(ack, '房间已满');
        r.members.push({ id: session.playerId, name: session.name, isBot: false });
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
      if (!r) return;
      const s = r.settings;
      if (p.roleChoices !== undefined) s.roleChoices = Math.max(1, Math.min(6, Math.round(p.roleChoices)));
      if (p.promptTimeout !== undefined) s.promptTimeout = Math.max(0, Math.min(600, Math.round(p.promptTimeout)));
      if (p.botDelay !== undefined) s.botDelay = Math.max(0, Math.min(5000, Math.round(p.botDelay)));
      r.broadcastRoom();
    });

    sock.on('room:addBot', () => {
      const r = hostRoom();
      if (!r || r.status !== 'lobby' || r.members.length >= MAX_PLAYERS) return;
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

    sock.on('game:resume', () => {
      const r = room();
      if (r?.game && session && r.members.some((m) => m.id === session!.playerId)) r.game.setAuto(session.playerId, false);
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
        if (r.status === 'lobby') {
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
    if (r.status !== 'playing') {
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
