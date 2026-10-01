import type { ChatMessage, GameView, LogEntry, RoomView, Tone, VoteView } from '@tcd/shared';
import { create } from 'zustand';
import { sfx } from './audio';
import { SEAT, request, saveName, savedName, sessionToken, socket } from './net';

export interface Toast {
  id: number;
  text: string;
  tone?: Tone;
}

/** A few cards travelling from the deck (or a player) to a player. */
export interface Flight {
  id: number;
  from: string; // 'deck' or a player id
  to: string; // a player id
  n: number;
}

/** A floating "+2 / −1" next to a meter. Keyed by 'community' or a player id. */
export interface Pulse {
  delta: number;
  key: number;
}

interface State {
  connected: boolean;
  playerId: string | null;
  name: string;
  room: RoomView | null;
  game: GameView | null;
  chat: ChatMessage[];
  unreadChat: number;
  toasts: Toast[];
  /** Card id under the pointer, for the big preview. */
  hover: string | null;
  /** Log entries with visual effects waiting to be played. */
  fxQueue: LogEntry[];
  lastSeq: number;
  pulses: Record<string, Pulse>;
  sidebar: 'log' | 'chat';
  overlay: null | 'rules' | 'gallery' | 'settings';
  /** Smoothed round-trip time to the server in ms (null = unknown / offline). */
  ping: number | null;
  /** Latest emote per player id, shown as a bubble over their seat. */
  emotes: Record<string, { emote: string; key: number }>;
  /** Cards in flight (draws / transfers) waiting to be animated. */
  flights: Flight[];
  /** Bumps when something big happens (large community swing) → the table shakes. */
  shake: number;
  /** Seats currently targeted by a card (highlighted for a moment). */
  targeted: string[];
  /** The pending abandon-game vote, if any. */
  vote: VoteView | null;
  /** Bumps on every community change so the meter can flash. */
  meterHit: number;
  setMeterHit(): void;
  endFlight(id: number): void;

  setName(n: string): void;
  setHover(id: string | null): void;
  setSidebar(s: State['sidebar']): void;
  setOverlay(o: State['overlay']): void;
  toast(text: string, tone?: Tone): void;
  shiftFx(): void;
  answer(promptId: string, value: unknown): void;
}

let toastSeq = 0;
let lastAnswer = { id: '', at: 0 };
let pulseSeq = 0;

export const useStore = create<State>((set, get) => ({
  connected: false,
  playerId: null,
  name: savedName(),
  room: null,
  game: null,
  chat: [],
  unreadChat: 0,
  toasts: [],
  hover: null,
  fxQueue: [],
  lastSeq: 0,
  pulses: {},
  sidebar: 'log',
  overlay: null,
  ping: null,
  emotes: {},
  flights: [],
  shake: 0,
  targeted: [],
  vote: null,
  meterHit: 0,
  setMeterHit() {
    set({ meterHit: get().meterHit + 1 });
  },
  endFlight(id) {
    set({ flights: get().flights.filter((f) => f.id !== id) });
  },

  setName(n) {
    saveName(n);
    set({ name: n });
    if (socket.connected) hello();
  },
  setHover(id) {
    if (get().hover !== id) set({ hover: id });
  },
  setSidebar(s) {
    set({ sidebar: s, unreadChat: s === 'chat' ? 0 : get().unreadChat });
  },
  setOverlay(o) {
    set({ overlay: o, hover: null });
  },
  toast(text, tone) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3800);
  },
  shiftFx() {
    set({ fxQueue: get().fxQueue.slice(1) });
  },
  answer(promptId, value) {
    // Swallow accidental double submits of the same prompt.
    const now = Date.now();
    if (lastAnswer.id === promptId && now - lastAnswer.at < 350) return;
    lastAnswer = { id: promptId, at: now };
    sfx('click');
    socket.emit('game:answer', { promptId, value });
  },
}));

// ── session / auto-join ───────────────────────────────────────

const query = new URLSearchParams(location.search);
/** `?auto=create` or `?auto=join:CODE` — used by the local multi-seat console. */
let autoAction: string | null = query.get('auto');

function hello() {
  const { name } = useStore.getState();
  request('session:hello', { token: sessionToken(), name: name || '旅人' })
    .then(async ({ playerId, roomId }) => {
      useStore.setState({ playerId });
      if (!roomId && autoAction) {
        const action = autoAction;
        autoAction = null;
        if (action === 'create') await request('room:create');
        else if (action.startsWith('join:')) await request('room:join', { roomId: action.slice(5).toUpperCase() });
        return;
      }
      // Deep link: /r/CODE
      const m = location.pathname.match(/^\/r\/([A-Z0-9]{4})$/i);
      if (!roomId && m && useStore.getState().name) {
        await request('room:join', { roomId: m[1].toUpperCase() });
      }
    })
    .catch((e) => useStore.getState().toast(String(e), 'bad'));
}

// ── game state ingestion ──────────────────────────────────────

/** Log effects that get an on-screen moment (played one after another by FxLayer). */
export const FX_TYPES = ['play', 'dice', 'event', 'official', 'reveal', 'skill', 'mod', 'community', 'influence'];
/** In "reduce motion" mode there is no playback, so these sounds fire straight away instead. */
const QUICK_SOUND: Record<string, Parameters<typeof sfx>[0]> = { play: 'play', dice: 'dice', event: 'event', official: 'official', reveal: 'reveal', skill: 'reveal' };

function ingestGame(game: GameView | null) {
  const st = useStore.getState();
  if (!game) {
    useStore.setState({ game: null, lastSeq: 0, fxQueue: [] });
    return;
  }
  const fresh = st.lastSeq === 0 || (st.game && st.game.id !== game.id);
  const newest = game.log.at(-1)?.seq ?? 0;
  if (fresh) {
    useStore.setState({ game, lastSeq: newest, fxQueue: [] });
    return;
  }
  const incoming = game.log.filter((e) => e.seq > st.lastSeq);
  const pulses = { ...st.pulses };
  const reduced = document.documentElement.classList.contains('reduce-motion');
  const flights = [...st.flights];
  let shake = st.shake;
  let targeted: string[] | null = null;
  for (const e of incoming) {
    const fx = e.fx;
    if (!fx) continue;
    if (!reduced && fx.type === 'draw') flights.push({ id: ++pulseSeq, from: 'deck', to: fx.playerId, n: fx.count });
    if (!reduced && fx.type === 'transfer') flights.push({ id: ++pulseSeq, from: fx.fromId, to: fx.toId, n: fx.count });
    if (!reduced && fx.type === 'community' && Math.abs(fx.to - fx.from) >= 3) shake++;
    if (fx.type === 'target') targeted = fx.toIds;
    if (fx.type === 'community') pulses.community = { delta: fx.to - fx.from, key: ++pulseSeq };
    if (fx.type === 'influence') pulses[fx.playerId] = { delta: fx.to - fx.from, key: ++pulseSeq };
    if (reduced) {
      if (fx.type in QUICK_SOUND) sfx(QUICK_SOUND[fx.type]);
      if (fx.type === 'community' || (fx.type === 'influence' && fx.playerId === st.playerId)) sfx((fx.type === 'community' ? fx.to - fx.from : fx.to - fx.from) > 0 ? 'up' : 'down');
    }
    if (fx.type === 'draw' && fx.playerId === st.playerId) sfx('draw');
  }

  // Personal cues: my turn begins / the game ends.
  const me = st.playerId;
  if (me && game.currentPlayerId === me && st.game?.currentPlayerId !== me) sfx('turn');
  if (me && game.phase === 'finished' && st.game?.phase !== 'finished') sfx(game.result?.winnerIds.includes(me) ? 'win' : 'lose');

  const queued = reduced ? [] : incoming.filter((e) => e.fx && FX_TYPES.includes(e.fx.type));
  const queue = [...st.fxQueue, ...queued];
  useStore.setState({
    game,
    lastSeq: Math.max(st.lastSeq, newest),
    pulses,
    flights: flights.slice(-6),
    shake,
    // A tab that fell far behind drops its oldest animations rather than replaying minutes of history.
    fxQueue: queue.length > 14 ? queue.slice(-5) : queue,
  });
  if (targeted && !reduced) {
    const ids = targeted;
    useStore.setState({ targeted: ids });
    setTimeout(() => {
      if (useStore.getState().targeted === ids) useStore.setState({ targeted: [] });
    }, 2200);
  }
}
// ── socket wiring ─────────────────────────────────────────────
// Latency: time a ping/ack round trip, smooth it, and report it so every player's seat can show it.
let pingTimer: ReturnType<typeof setInterval> | undefined;
function measurePing() {
  if (!socket.connected) return;
  const t0 = performance.now();
  let answered = false;
  const giveUp = setTimeout(() => !answered && useStore.setState({ ping: null }), 4000);
  socket.emit('net:ping', () => {
    answered = true;
    clearTimeout(giveUp);
    const ms = performance.now() - t0;
    const prev = useStore.getState().ping;
    const smooth = Math.round(prev == null ? ms : prev * 0.6 + ms * 0.4);
    useStore.setState({ ping: smooth });
    socket.emit('net:rtt', { ms: smooth });
  });
}

socket.on('connect', () => {
  useStore.setState({ connected: true });
  hello();
  measurePing();
  clearInterval(pingTimer);
  pingTimer = setInterval(measurePing, 3000);
});
socket.on('disconnect', () => {
  useStore.setState({ connected: false, ping: null, vote: null });
  clearInterval(pingTimer);
});
socket.on('game:emote', ({ fromId, emote }) => {
  const key = ++pulseSeq;
  useStore.setState({ emotes: { ...useStore.getState().emotes, [fromId]: { emote, key } } });
  setTimeout(() => {
    const cur = useStore.getState().emotes[fromId];
    if (cur?.key === key) {
      const { [fromId]: _gone, ...rest } = useStore.getState().emotes;
      useStore.setState({ emotes: rest });
    }
  }, 2600);
});
socket.on('room:state', (room) => {
  useStore.setState({ room });
  const want = (room ? `/r/${room.id}` : '/') + location.search;
  if (location.pathname + location.search !== want) history.replaceState(null, '', want);
});
socket.on('game:state', ingestGame);
socket.on('vote:state', (vote) => useStore.setState({ vote }));
socket.on('chat:message', (msg) => {
  const st = useStore.getState();
  if (st.chat.some((m) => m.id === msg.id)) return;
  useStore.setState({
    chat: [...st.chat.slice(-199), msg],
    unreadChat: st.sidebar === 'chat' || msg.fromId === st.playerId ? st.unreadChat : st.unreadChat + 1,
  });
});
socket.on('toast', ({ text, tone }) => useStore.getState().toast(text, tone));

export function connect() {
  if (location.pathname === '/local') return; // the console itself has no seat
  if (!socket.connected) socket.connect();
}

// Handy selectors
export const selectMe = (s: State) => s.game?.players.find((p) => p.id === s.playerId) ?? null;

// Animations pause while the tab is in the background or this seat is hidden inside the /local console.
let embeddedActive = true;
const syncPaused = () => document.documentElement.classList.toggle('paused', document.hidden || !embeddedActive);
document.addEventListener('visibilitychange', syncPaused);

// ── local multi-seat console integration ──────────────────────
// When embedded by /local, report this seat's status upward and accept a few commands back.

export interface SeatReport {
  seat: string | null;
  name: string;
  room: string | null;
  status: 'home' | 'lobby' | 'playing' | 'finished';
  /** This seat has a decision to make. */
  waiting: boolean;
  isHost: boolean;
  isTurn: boolean;
  phase: string | null;
  role: string | null;
  auto: boolean;
}

if (window.parent !== window) {
  let last = '';
  const report = () => {
    const s = useStore.getState();
    const me = s.game?.players.find((p) => p.id === s.playerId);
    const r: SeatReport = {
      seat: SEAT,
      name: s.name,
      room: s.room?.id ?? null,
      status: !s.room ? 'home' : s.room.status,
      waiting: !!s.game?.prompt,
      isHost: !!s.room && s.room.hostId === s.room.youId,
      isTurn: !!me && s.game?.currentPlayerId === me.id,
      phase: s.game?.phase ?? null,
      role: s.game?.me?.role ?? null,
      auto: !!me?.auto,
    };
    const json = JSON.stringify(r);
    if (json === last) return;
    last = json;
    window.parent.postMessage({ type: 'tcd:seat', report: r }, location.origin);
  };
  useStore.subscribe(report);

  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data?.type === 'tcd:active') {
      embeddedActive = !!e.data.on;
      syncPaused();
      return;
    }
    if (e.origin !== location.origin || e.data?.type !== 'tcd:cmd') return;
    const { cmd } = e.data as { cmd: string };
    if (cmd === 'start') request('room:start').catch((err) => useStore.getState().toast(String(err), 'bad'));
    if (cmd === 'addBot') socket.emit('room:addBot');
    if (cmd === 'rematch') socket.emit('room:rematch');
  });
  // Let the console switch seats with Alt+1…8 even while an iframe has focus.
  window.addEventListener('keydown', (e) => {
    if (e.altKey && /^[1-8]$/.test(e.key)) window.parent.postMessage({ type: 'tcd:key', key: e.key }, location.origin);
  });
}
