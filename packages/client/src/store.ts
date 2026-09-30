import type { ChatMessage, GameView, LogEntry, RoomView, Tone } from '@tcd/shared';
import { create } from 'zustand';
import { request, saveName, savedName, sessionToken, socket } from './net';

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
    socket.emit('game:answer', { promptId, value });
  },
}));

function hello() {
  const { name } = useStore.getState();
  request('session:hello', { token: sessionToken(), name: name || '旅人' })
    .then(({ playerId, roomId }) => {
      useStore.setState({ playerId });
      // Deep link: /r/CODE
      const m = location.pathname.match(/^\/r\/([A-Z0-9]{4})$/i);
      if (!roomId && m && useStore.getState().name) {
        request('room:join', { roomId: m[1].toUpperCase() }).catch((e) => useStore.getState().toast(String(e), 'bad'));
      }
    })
    .catch((e) => useStore.getState().toast(String(e), 'bad'));
}

function ingestGame(game: GameView | null) {
  const st = useStore.getState();
  if (!game) {
    useStore.setState({ game: null, lastSeq: 0, fxQueue: [] });
    return;
  }
  const fresh = st.lastSeq === 0 || (st.game && st.game.id !== game.id);
  const newest = game.log.at(-1)?.seq ?? 0;
  if (fresh) {
    useStore.setState({ game, lastSeq: newest });
    return;
  }
  const incoming = game.log.filter((e) => e.seq > st.lastSeq);
  const pulses = { ...st.pulses };
  for (const e of incoming) {
    if (e.fx?.type === 'community') pulses.community = { delta: e.fx.to - e.fx.from, key: ++pulseSeq };
    if (e.fx?.type === 'influence') pulses[e.fx.playerId] = { delta: e.fx.to - e.fx.from, key: ++pulseSeq };
  }
  const fx = incoming.filter((e) => e.fx && ['play', 'dice', 'event', 'official', 'reveal'].includes(e.fx.type));
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
  const want = room ? `/r/${room.id}` : '/';
  if (location.pathname !== want) history.replaceState(null, '', want);
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
  if (!socket.connected) socket.connect();
}

// Handy selectors
export const selectMe = (s: State) => s.game?.players.find((p) => p.id === s.playerId) ?? null;
