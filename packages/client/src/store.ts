import { PACE_FACTOR, type ChatMessage, type Fx, type GameView, type LogEntry, type RoomView, type SettleTo, type Tone, type VoteView } from '@tcd/shared';
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

/** A card standing in the middle of the table while its effect is decided (see Stage). */
export interface StageCard {
  key: number;
  fx: Extract<Fx, { type: 'play' }>;
  /** Set when the effect is over: where the card flies. It is removed shortly after. */
  leaving?: { to: SettleTo; toId?: string };
}

/**
 * What the meters show while effects are still queued: the number as it was before the effect being played.
 * `null` / missing = follow the real game state.
 */
export interface Shown {
  community: number | null;
  influence: Record<string, number>;
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
  /** Cards standing in the middle while their effect resolves (oldest first). */
  stage: StageCard[];
  /** Meter values lagging behind the game state until their effect has played. */
  shown: Shown;
  /** The final-settlement show has reached its board (the tutorial coach waits for it). */
  finale: boolean;
  setMeterHit(): void;
  endFlight(id: number): void;
  /** Called by the effects layer as each queued effect starts playing. */
  playFx(fx: Fx): void;

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
  stage: [],
  shown: { community: null, influence: {} },
  finale: false,
  setMeterHit() {
    set({ meterHit: get().meterHit + 1 });
  },
  endFlight(id) {
    set({ flights: get().flights.filter((f) => f.id !== id) });
  },
  playFx(fx) {
    const st = get();
    switch (fx.type) {
      case 'play':
        set({ stage: [...st.stage, { key: ++pulseSeq, fx }] });
        break;
      case 'settle': {
        // The newest card of that kind leaves the stage.
        const i = st.stage.findLastIndex((c) => c.fx.cardId === fx.cardId && !c.leaving);
        if (i < 0) break;
        const key = st.stage[i].key;
        set({ stage: st.stage.map((c) => (c.key === key ? { ...c, leaving: { to: fx.to, toId: fx.toId } } : c)) });
        setTimeout(() => set({ stage: get().stage.filter((c) => c.key !== key) }), 950);
        break;
      }
      case 'target': {
        const ids = fx.toIds;
        set({ targeted: ids });
        setTimeout(() => get().targeted === ids && set({ targeted: [] }), 2600);
        break;
      }
      case 'community':
        set({
          shown: { ...st.shown, community: fx.to },
          pulses: { ...st.pulses, community: { delta: fx.to - fx.from, key: ++pulseSeq } },
          shake: Math.abs(fx.to - fx.from) >= 3 ? st.shake + 1 : st.shake,
        });
        break;
      case 'influence':
        set({
          shown: { ...st.shown, influence: { ...st.shown.influence, [fx.playerId]: fx.to } },
          pulses: { ...st.pulses, [fx.playerId]: { delta: fx.to - fx.from, key: ++pulseSeq } },
        });
        break;
    }
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
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 5200);
  },
  shiftFx() {
    const fxQueue = get().fxQueue.slice(1);
    // When nothing is left to play, the meters catch up with the real state.
    set(fxQueue.length ? { fxQueue } : { fxQueue, shown: idleShown() });
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

// Browser tests (e2e/dice.mjs …) can reach the store with ?e2e in the URL, e.g. to play a chosen effect on demand.
if (new URLSearchParams(location.search).has('e2e')) (window as unknown as { __tcd: unknown }).__tcd = { useStore };

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
export const FX_TYPES: Fx['type'][] = [
  'play', 'settle', 'target', 'mod', 'block', 'skill', 'dice', 'community', 'influence', 'event', 'official', 'reveal', 'turn', 'round', 'discard',
];

/** How much a queued effect's duration is stretched or squeezed by the room's pace (a test server squeezes it to nothing). */
export const paceFactor = () => {
  const room = useStore.getState().room;
  return room?.fast ? 0.04 : PACE_FACTOR[room?.settings.pace ?? 'epic'];
};

const idleShown = (): Shown => ({ community: null, influence: {} });

/** Most log lines kept on the client (the server only sends what is new). */
const LOG_KEEP = 300;

function ingestGame(game: GameView | null) {
  const st = useStore.getState();
  if (!game) {
    useStore.setState({ game: null, lastSeq: 0, fxQueue: [], stage: [], shown: idleShown() });
    return;
  }
  const sameGame = !!st.game && st.game.id === game.id;
  // First state of this game (joined, reloaded, rematch): its recent log is history, not something to replay as effects.
  if (!sameGame) {
    useStore.setState({ game, lastSeq: game.log.at(-1)?.seq ?? 0, fxQueue: [], stage: [], shown: idleShown() });
    return;
  }
  // Updates carry only new log lines: join them to the history we already hold.
  const incoming = game.log.filter((e) => e.seq > st.lastSeq);
  game = { ...game, log: [...st.game!.log, ...incoming].slice(-LOG_KEEP) };
  const newest = game.log.at(-1)?.seq ?? st.lastSeq;
  const flights = [...st.flights];
  const shown: Shown = { community: st.shown.community, influence: { ...st.shown.influence } };
  for (const e of incoming) {
    const fx = e.fx;
    if (!fx) continue;
    if (fx.type === 'draw') flights.push({ id: ++pulseSeq, from: 'deck', to: fx.playerId, n: fx.count });
    if (fx.type === 'transfer') flights.push({ id: ++pulseSeq, from: fx.fromId, to: fx.toId, n: fx.count });
    // The meters keep showing the old number until the effect that changes it is played.
    if (fx.type === 'community' && shown.community === null) shown.community = fx.from;
    if (fx.type === 'influence' && !(fx.playerId in shown.influence)) shown.influence[fx.playerId] = fx.from;
    if (fx.type === 'draw' && fx.playerId === st.playerId) sfx('draw');
  }

  const queued = incoming.filter((e) => e.fx && FX_TYPES.includes(e.fx.type));
  const queue = [...st.fxQueue, ...queued];
  // A tab that fell far behind drops its oldest animations rather than replaying minutes of history.
  const overflow = queue.length > 24;
  useStore.setState({
    game,
    lastSeq: Math.max(st.lastSeq, newest),
    flights: flights.slice(-6),
    fxQueue: overflow ? queue.slice(-6) : queue,
    ...(overflow ? { stage: [], shown: idleShown() } : { shown }),
  });
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
