import type { ChatMessage, GameView, LogEntry, RoomView, Tone } from '@tcd/shared';
import { create } from 'zustand';
import { sfx } from './audio';
import { SEAT, request, saveName, savedName, sessionToken, socket } from './net';

export interface Toast {
  id: number;
  text: string;
  tone?: Tone;
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
  overlay: null | 'rules' | 'gallery';

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
    set({ overlay: o });
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

const FX_TYPES = ['play', 'dice', 'event', 'official', 'reveal'];
const FX_SOUND = { play: 'play', dice: 'dice', event: 'event', official: 'official', reveal: 'reveal' } as const;

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
  let mood: 'up' | 'down' | null = null;
  for (const e of incoming) {
    if (e.fx?.type === 'community') {
      const d = e.fx.to - e.fx.from;
      pulses.community = { delta: d, key: ++pulseSeq };
      mood = d > 0 ? 'up' : 'down';
    }
    if (e.fx?.type === 'influence') {
      const d = e.fx.to - e.fx.from;
      pulses[e.fx.playerId] = { delta: d, key: ++pulseSeq };
      if (e.fx.playerId === st.playerId) mood = d > 0 ? 'up' : 'down';
    }
    if (e.fx && e.fx.type in FX_SOUND) sfx(FX_SOUND[e.fx.type as keyof typeof FX_SOUND]);
    else if (e.fx?.type === 'draw' && e.fx.playerId === st.playerId) sfx('draw');
  }
  if (mood && !incoming.some((e) => e.fx && FX_TYPES.includes(e.fx.type))) sfx(mood);

  // Personal cues: my turn begins / the game ends.
  const me = st.playerId;
  if (me && game.currentPlayerId === me && st.game?.currentPlayerId !== me) sfx('turn');
  if (me && game.phase === 'finished' && st.game?.phase !== 'finished') sfx(game.result?.winnerIds.includes(me) ? 'win' : 'lose');

  const fx = incoming.filter((e) => e.fx && FX_TYPES.includes(e.fx.type));
  // If we fell far behind (tab in background), drop the backlog of animations.
  const queue = [...st.fxQueue, ...fx];
  useStore.setState({
    game,
    lastSeq: Math.max(st.lastSeq, newest),
    pulses,
    fxQueue: queue.length > 6 ? queue.slice(-2) : queue,
  });
}

// ── socket wiring ─────────────────────────────────────────────
socket.on('connect', () => {
  useStore.setState({ connected: true });
  hello();
});
socket.on('disconnect', () => useStore.setState({ connected: false }));
socket.on('room:state', (room) => {
  useStore.setState({ room });
  const want = (room ? `/r/${room.id}` : '/') + location.search;
  if (location.pathname + location.search !== want) history.replaceState(null, '', want);
});
socket.on('game:state', ingestGame);
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
