import type { ClientToServer, ServerToClient } from '@tcd/shared';
import { io, type Socket } from 'socket.io-client';

export const socket: Socket<ServerToClient, ClientToServer> = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

const safeStorage = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

const params = new URLSearchParams(location.search);

/**
 * Local multi-seat testing: `?as=NAME` gives this tab its own identity (token + nickname) even though
 * every tab of one browser shares localStorage. `/local` uses it to host several seats side by side.
 */
export const SEAT = params.get('as');
const ns = SEAT ? `.${SEAT}` : '';

/** Stable per-browser secret; the server maps it to your player id so you can reconnect. */
export function sessionToken(): string {
  let t = safeStorage.get(`tcd.token${ns}`);
  if (!t || t.length < 16) {
    t = crypto.randomUUID?.() ?? Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    safeStorage.set(`tcd.token${ns}`, t);
  }
  return t;
}

export function savedName(): string {
  return params.get('name') || safeStorage.get(`tcd.name${ns}`) || '';
}
export function saveName(n: string) {
  safeStorage.set(`tcd.name${ns}`, n);
}

export const prefs = {
  get: (k: string) => safeStorage.get(`tcd.pref.${k}`),
  set: (k: string, v: string) => safeStorage.set(`tcd.pref.${k}`, v),
};

/** Data type carried by an event's ack callback. */
type AckData<E extends keyof ClientToServer> =
  Parameters<ClientToServer[E]> extends [...unknown[], (res: infer R) => void]
    ? R extends { ok: true; data: infer D } ? D : never
    : never;

/** Arguments of an event, minus the trailing ack. */
type ArgsOf<E extends keyof ClientToServer> =
  Parameters<ClientToServer[E]> extends [...infer A, (res: never) => void] ? A : [];

/** Emit an acknowledged event and resolve with its data (rejects with the server's error string). */
export function request<E extends keyof ClientToServer>(event: E, ...args: ArgsOf<E>): Promise<AckData<E>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject('服务器无响应'), 8000);
    const emit = socket.emit.bind(socket) as unknown as (ev: string, ...a: unknown[]) => void;
    emit(event, ...args, (res: { ok: boolean; data?: unknown; error?: string }) => {
      clearTimeout(timer);
      if (res.ok) resolve(res.data as AckData<E>);
      else reject(res.error ?? '未知错误');
    });
  });
}
