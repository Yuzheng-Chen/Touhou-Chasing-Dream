import { prefs } from './net';

/**
 * Tiny WebAudio sound kit — every effect is synthesised, so there are no audio files to ship.
 * Browsers only allow audio after a user gesture; `unlock()` is wired to the first pointer event.
 */
export type Sfx = 'click' | 'play' | 'draw' | 'dice' | 'event' | 'official' | 'reveal' | 'up' | 'down' | 'turn' | 'win' | 'lose' | 'skill' | 'mod' | 'boom' | 'bigup' | 'bigdown'
  | 'tick' | 'drum' | 'lock' | 'shield' | 'whoosh' | 'flip' | 'score' | 'fanfare' | 'thud';

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
  skill: () => { tone({ f: NOTE(60), to: NOTE(84), d: 0.5, type: 'sawtooth', v: 0.07 }); [72, 76, 79, 84].forEach((n, i) => tone({ f: NOTE(n), t: 0.12 + i * 0.07, d: 0.5, type: 'triangle', v: 0.12 })); noise(0.3, 0, 7000, 0.08); },
  mod: () => { tone({ f: NOTE(88), d: 0.1, type: 'square', v: 0.05 }); tone({ f: NOTE(93), t: 0.07, d: 0.18, type: 'triangle', v: 0.1 }); },
  boom: () => { tone({ f: 90, to: 38, d: 0.5, type: 'sine', v: 0.4 }); noise(0.35, 0, 600, 0.3); },
  bigup: () => { tone({ f: 90, to: 38, d: 0.45, type: 'sine', v: 0.35 }); [60, 64, 67, 72, 79].forEach((n, i) => tone({ f: NOTE(n), t: 0.05 + i * 0.07, d: 0.7, type: 'triangle', v: 0.13 })); noise(0.25, 0, 5000, 0.12); },
  bigdown: () => { tone({ f: 80, to: 30, d: 0.7, type: 'sine', v: 0.4 }); [67, 63, 58, 53].forEach((n, i) => tone({ f: NOTE(n), t: 0.05 + i * 0.1, d: 0.6, type: 'sawtooth', v: 0.07 })); noise(0.4, 0, 400, 0.25); },
  tick: () => { noise(0.04, 0, 2400, 0.2); tone({ f: 190, to: 120, d: 0.05, type: 'square', v: 0.07 }); },
  drum: () => { for (let i = 0; i < 14; i++) { const t = i * (0.16 - i * 0.006); noise(0.09, t, 260, 0.1 + i * 0.012); tone({ f: 70 + i * 3, to: 50, d: 0.1, t, type: 'sine', v: 0.1 + i * 0.012 }); } },
  lock: () => { tone({ f: NOTE(84), d: 0.07, type: 'square', v: 0.07 }); tone({ f: NOTE(84), t: 0.11, d: 0.07, type: 'square', v: 0.07 }); tone({ f: 120, to: 50, t: 0.24, d: 0.3, type: 'sine', v: 0.3 }); noise(0.2, 0.24, 900, 0.18); },
  shield: () => { tone({ f: NOTE(91), to: NOTE(88), d: 0.5, type: 'triangle', v: 0.12 }); tone({ f: NOTE(96), d: 0.35, type: 'sine', v: 0.08 }); noise(0.12, 0, 5200, 0.12); },
  whoosh: () => { noise(0.34, 0, 1600, 0.16); tone({ f: 500, to: 160, d: 0.3, type: 'sine', v: 0.06 }); },
  flip: () => { noise(0.18, 0, 3400, 0.14); tone({ f: 260, to: 520, d: 0.18, type: 'triangle', v: 0.07 }); },
  score: () => { tone({ f: NOTE(84), d: 0.09, type: 'triangle', v: 0.09 }); },
  fanfare: () => { [60, 64, 67, 72, 67, 72, 76, 79].forEach((n, i) => tone({ f: NOTE(n), t: i * 0.11, d: 0.9, type: 'triangle', v: 0.14 })); tone({ f: 80, to: 40, d: 0.6, type: 'sine', v: 0.3 }); noise(0.3, 0, 5000, 0.12); },
  thud: () => { tone({ f: 110, to: 45, d: 0.35, type: 'sine', v: 0.35 }); noise(0.15, 0, 500, 0.2); },
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
