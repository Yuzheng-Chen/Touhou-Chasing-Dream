import { prefs } from './net';

/**
 * Tiny WebAudio sound kit — every effect is synthesised, so there are no audio files to ship.
 * Browsers only allow audio after a user gesture; `unlock()` is wired to the first pointer event.
 */
export type Sfx = 'click' | 'play' | 'draw' | 'dice' | 'event' | 'official' | 'reveal' | 'up' | 'down' | 'turn' | 'win' | 'lose';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = prefs.get('muted') === '1';
let volume = Math.min(1, Math.max(0, Number(prefs.get('volume') ?? 0.7)));
const listeners = new Set<() => void>();

export const isMuted = () => muted;
export const getVolume = () => volume;
const gain = () => (muted ? 0 : volume * 0.7);
export function setMuted(m: boolean) {
  muted = m;
  prefs.set('muted', m ? '1' : '0');
  if (master) master.gain.value = gain();
  listeners.forEach((l) => l());
}
export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  prefs.set('volume', String(volume));
  if (master) master.gain.value = gain();
  listeners.forEach((l) => l());
}
export const onMuteChange = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = gain();
  master.connect(ctx.destination);
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (c?.state === 'suspended') void c.resume();
}

interface Tone {
  f: number;
  /** End frequency for a glide. */
  to?: number;
  t?: number;
  d: number;
  type?: OscillatorType;
  v?: number;
}

function tone(o: Tone) {
  const c = ensure();
  if (!c || !master || muted) return;
  const t0 = c.currentTime + (o.t ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.d);
  const v = o.v ?? 0.25;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + o.d + 0.05);
}

/** Short filtered noise burst (card swish, dice clatter). */
function noise(d: number, t = 0, freq = 3000, v = 0.18) {
  const c = ensure();
  if (!c || !master || muted) return;
  const len = Math.floor(c.sampleRate * d);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = v;
  src.connect(f).connect(g).connect(master);
  src.start(c.currentTime + t);
}

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);

const SOUNDS: Record<Sfx, () => void> = {
  click: () => tone({ f: 620, to: 420, d: 0.06, type: 'triangle', v: 0.12 }),
  play: () => { noise(0.14, 0, 2600, 0.2); tone({ f: 330, to: 180, d: 0.16, type: 'triangle', v: 0.16 }); },
  draw: () => noise(0.1, 0, 4200, 0.12),
  dice: () => { for (let i = 0; i < 6; i++) { noise(0.05, i * 0.07, 1800 + i * 200, 0.16); tone({ f: 240 + i * 25, d: 0.04, t: i * 0.07, type: 'square', v: 0.05 }); } },
  event: () => { tone({ f: NOTE(57), d: 0.5, type: 'sawtooth', v: 0.1 }); tone({ f: NOTE(64), t: 0.12, d: 0.5, type: 'triangle', v: 0.14 }); tone({ f: NOTE(69), t: 0.24, d: 0.7, type: 'triangle', v: 0.14 }); },
  official: () => [60, 64, 67, 72].forEach((n, i) => tone({ f: NOTE(n), t: i * 0.11, d: 0.9, type: 'triangle', v: 0.15 })),
  reveal: () => { tone({ f: NOTE(72), to: NOTE(84), d: 0.35, type: 'sine', v: 0.14 }); noise(0.25, 0, 6000, 0.08); },
  up: () => tone({ f: NOTE(76), t: 0, d: 0.12, type: 'sine', v: 0.12 }),
  down: () => tone({ f: NOTE(64), to: NOTE(57), d: 0.18, type: 'sine', v: 0.12 }),
  turn: () => { tone({ f: NOTE(79), d: 0.3, type: 'sine', v: 0.16 }); tone({ f: NOTE(83), t: 0.14, d: 0.45, type: 'sine', v: 0.16 }); },
  win: () => [60, 64, 67, 72, 76].forEach((n, i) => tone({ f: NOTE(n), t: i * 0.13, d: 1.1, type: 'triangle', v: 0.16 })),
  lose: () => [64, 60, 57].forEach((n, i) => tone({ f: NOTE(n), t: i * 0.22, d: 0.9, type: 'sine', v: 0.14 })),
};

export function sfx(name: Sfx) {
  if (muted) return;
  try {
    SOUNDS[name]();
  } catch {
    /* audio is best-effort */
  }
}

window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });
