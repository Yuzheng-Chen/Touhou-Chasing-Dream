import { JUDGE_LABEL, cardDef, type Fx as FxT, type LogEntry } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { sfx } from '../audio';
import { Card, CardBack } from '../cards/Card';
import { useStore, type Flight } from '../store';
import { playerColor } from '../ui/colors';
import { Burst, presetFor } from './Burst';
import './fx.css';

/**
 * The stage for everything that happens at the table. Log entries with an effect are played one after another:
 * card slams (with where an unusual play comes from), skill activations, rule modifiers, and — scaled by size —
 * the number changes they cause. Sounds are fired here, at playback, so they match what is on screen.
 */

/** 1 = small change, 2 = notable (3–4), 3 = huge (5+). */
const tierOf = (n: number) => (Math.abs(n) >= 5 ? 3 : Math.abs(n) >= 3 ? 2 : 1);

function fxDuration(fx: FxT): number {
  switch (fx.type) {
    case 'play': return fx.via ? 2000 : 1500;
    case 'skill': return fx.passive ? 950 : 1500;
    case 'mod': return 950;
    case 'community': return [1000, 1350, 1800][tierOf(fx.to - fx.from) - 1];
    case 'influence': return [900, 1150, 1500][tierOf(fx.to - fx.from) - 1];
    case 'dice': return 1500;
    case 'event': return 1700;
    case 'official': return 2000;
    case 'reveal': return 1600;
    default: return 1000;
  }
}

/** Plays queued log effects one by one over the table. */
export function FxLayer() {
  const queue = useStore((s) => s.fxQueue);
  const shift = useStore((s) => s.shiftFx);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    // When the backlog grows, play faster instead of falling further behind.
    const speed = queue.length > 8 ? 0.4 : queue.length > 4 ? 0.6 : queue.length > 2 ? 0.8 : 1;
    const t = setTimeout(shift, fxDuration(current.fx!) * speed);
    return () => clearTimeout(t);
  }, [current?.seq]);

  return (
    <div className="fx" aria-hidden>
      <AnimatePresence mode="wait">{current && <FxItem key={current.seq} e={current} />}</AnimatePresence>
      <TurnBanner />
      <Flights />
    </div>
  );
}

function usePlayer(id: string | undefined) {
  return useStore((s) => (id ? s.game?.players.find((p) => p.id === id) : undefined));
}

/** Screen position of a seat (or your own area), as an offset from the screen centre. */
function seatOrigin(playerId: string) {
  const el = document.querySelector(`[data-seat-id="${playerId}"]`) ?? document.querySelector('.myarea');
  if (!el) return { x: 0, y: 200 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - window.innerWidth / 2, y: r.top + r.height / 2 - window.innerHeight / 2 };
}

const nameOf = (id?: string) => {
  try {
    return id ? cardDef(id).name : '';
  } catch {
    return '';
  }
};
const kindWord = (id: string) => {
  try {
    const k = cardDef(id).kind;
    return k === 'role' ? '角色技能' : k === 'official' ? '官作效果' : '特殊牌效果';
  } catch {
    return '';
  }
};

function FxItem({ e }: { e: LogEntry }) {
  const fx = e.fx as FxT;
  switch (fx.type) {
    case 'play': return <PlayFx fx={fx} />;
    case 'dice': return <DiceFx fx={fx} />;
    case 'skill': return fx.passive ? <PassiveFx fx={fx} /> : <SkillFx fx={fx} />;
    case 'mod': return <ModFx fx={fx} />;
    case 'community': return <CommunityFx fx={fx} />;
    case 'influence': return <InfluenceFx fx={fx} />;
    case 'event':
      return <Banner cardId={fx.cardId} playerId={fx.playerId} caption={fx.direction === 'up' ? '正向发生' : fx.direction === 'down' ? '逆向发生' : '发生'} tone={fx.direction} sound="event" />;
    case 'official':
      return <Banner cardId={fx.cardId} caption="官作发布" tone="official" big sound="official" />;
    case 'reveal':
      return <Banner cardId={fx.roleId} playerId={fx.playerId} caption="翻开了角色牌" tone="reveal" sound="reveal" />;
    default:
      return null;
  }
}

// ── a card hits the table ─────────────────────────────────────────────────────────────────

function PlayFx({ fx }: { fx: Extract<FxT, { type: 'play' }> }) {
  const p = usePlayer(fx.playerId);
  const o = seatOrigin(fx.playerId);
  const preset = presetFor(fx.as ?? fx.cardId);
  const kind = cardDef(fx.cardId).kind;
  useEffect(() => {
    sfx('play');
    if (fx.via) setTimeout(() => sfx('skill'), 260);
  }, []);
  return (
    <motion.div className={`fx__play fx__play--${kind}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.85, y: -50 }} transition={{ duration: 0.18 }}>
      <div className="fx__rays" />
      <div className="fx__aura" />
      <Shock tone="gold" />
      <Burst preset={preset} />
      {fx.via && <Burst preset="sparkle" />}
      <motion.div
        className="fx__cardwrap"
        initial={{ x: o.x, y: o.y, scale: 0.3, rotate: -14, opacity: 0 }}
        animate={{ x: 0, y: -30, scale: [0.3, 1.24, 1], rotate: [-14, 3, 0], opacity: 1 }}
        transition={{ duration: 0.62, times: [0, 0.65, 1], ease: [0.22, 1, 0.36, 1] }}
      >
        <Card id={fx.cardId} size="lg" noPreview />
      </motion.div>
      {fx.via && (
        <motion.div className="fx__via" initial={{ opacity: 0, x: -60, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: 0.35, type: 'spring', stiffness: 220, damping: 18 }}>
          <Card id={fx.via.sourceId} size="xs" noPreview />
          <div>
            <small>{kindWord(fx.via.sourceId)}发动</small>
            <b>「{fx.via.skill}」</b>
            {fx.as && <span>「{nameOf(fx.cardId)}」当作「{nameOf(fx.as)}」打出</span>}
          </div>
        </motion.div>
      )}
      <motion.div className="fx__caption" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}>
        <b style={{ color: p ? playerColor(p.seat) : undefined }}>{p?.name}</b>
        {fx.as && !fx.via ? <> 视作「{nameOf(fx.as)}」打出</> : fx.as ? <> 打出</> : ' 打出'}
      </motion.div>
    </motion.div>
  );
}

/** Expanding ring(s) — the shockwave behind an impact. */
function Shock({ tone = 'gold', count = 2 }: { tone?: 'gold' | 'warm' | 'cool'; count?: number }) {
  return (
    <div className={`fx__shock fx__shock--${tone}`}>
      {Array.from({ length: count }, (_, i) => <i key={i} style={{ animationDelay: `${0.1 + i * 0.16}s` }} />)}
    </div>
  );
}

// ── role skills ───────────────────────────────────────────────────────────────────────────

function SkillFx({ fx }: { fx: Extract<FxT, { type: 'skill' }> }) {
  const p = usePlayer(fx.playerId);
  useEffect(() => sfx('skill'), []);
  return (
    <motion.div className="fx__skill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="fx__ribbon" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} exit={{ scaleX: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
      <Burst preset="sparkle" />
      <Shock tone="gold" count={3} />
      <motion.div className="fx__skillcard" initial={{ rotateY: 110, scale: 0.7, opacity: 0 }} animate={{ rotateY: 0, scale: 1, opacity: 1 }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}>
        <Card id={fx.roleId} size="lg" noPreview />
      </motion.div>
      <motion.div className="fx__skilltext" initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.18 }}>
        <small>{p && <b style={{ color: playerColor(p.seat) }}>{p.name}</b>} 发动主动技能</small>
        <span className="fx__skillname">{fx.skill}</span>
        {fx.reveals && <em>角色牌翻开 · 身份公开</em>}
      </motion.div>
    </motion.div>
  );
}

/** Passive skills: a quick plate, so they are noticed without stopping the game. */
function PassiveFx({ fx }: { fx: Extract<FxT, { type: 'skill' }> }) {
  const p = usePlayer(fx.playerId);
  useEffect(() => sfx('mod'), []);
  return (
    <motion.div className="fx__passive" initial={{ opacity: 0, y: -30, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
      <Card id={fx.roleId} size="xs" noPreview />
      <div>
        <small>{p?.name} · 被动技能</small>
        <b>「{fx.skill}」</b>
      </div>
    </motion.div>
  );
}

// ── rule modifiers ────────────────────────────────────────────────────────────────────────

/** "煽风点火: 偏移量 +1" — pops up, then flies into the community meter to show what it modified. */
function ModFx({ fx }: { fx: Extract<FxT, { type: 'mod' }> }) {
  const [to, setTo] = useState({ x: 0, y: -260 });
  useLayoutEffect(() => {
    const m = document.querySelector('.cmeter')?.getBoundingClientRect();
    if (m) setTo({ x: m.left + m.width / 2 - window.innerWidth / 2, y: m.top + m.height / 2 - window.innerHeight / 2 });
  }, []);
  useEffect(() => sfx('mod'), []);
  const plus = fx.amount.includes('+') || fx.amount.includes('翻倍');
  return (
    <motion.div className={`fx__mod ${plus ? 'is-plus' : 'is-minus'}`} initial={{ opacity: 0, scale: 0.5, x: 0, y: 40 }} animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.2, 1.1, 0.35], x: [0, 0, 0, to.x], y: [40, 0, 0, to.y] }} transition={{ duration: 0.95, times: [0, 0.22, 0.6, 1], ease: 'easeInOut' }}>
      <Burst preset={plus ? 'rise' : 'fall'} />
      {fx.sourceId && <Card id={fx.sourceId} size="xs" noPreview />}
      <div>
        <small>{fx.label}</small>
        <b>{fx.amount}</b>
      </div>
    </motion.div>
  );
}

// ── numbers changing: the bigger the change, the bigger the show ──────────────────────────

function CommunityFx({ fx }: { fx: Extract<FxT, { type: 'community' }> }) {
  const delta = fx.to - fx.from;
  const tier = tierOf(delta);
  const by = usePlayer(fx.by);
  const up = delta > 0;
  useEffect(() => {
    useStore.getState().setMeterHit();
    sfx(tier >= 3 ? (up ? 'bigup' : 'bigdown') : tier === 2 ? 'boom' : up ? 'up' : 'down');
  }, []);
  return (
    <motion.div className={`fx__value fx__value--${up ? 'up' : 'down'} tier${tier}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {tier >= 2 && <div className="fx__vignette" />}
      <Shock tone={up ? 'warm' : 'cool'} count={tier + 1} />
      <Burst preset={up ? 'rise' : 'fall'} />
      {tier >= 2 && <Burst preset={up ? 'sparkle' : 'smoke'} />}
      {tier >= 3 && <Burst preset="flames" />}
      <motion.div className="fx__num" initial={{ scale: 3.4, opacity: 0, rotate: up ? -5 : 5 }} animate={{ scale: [3.4, 0.86, 1], opacity: 1, rotate: 0 }} transition={{ duration: 0.5, times: [0, 0.6, 1], ease: 'easeOut' }}>
        <small>社群规模</small>
        <b>{up ? '+' : '−'}{Math.abs(delta)}</b>
        <span>{fx.from} → {fx.to}</span>
      </motion.div>
      {(fx.cardId || by) && (
        <motion.div className="fx__src" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          {fx.cardId && nameOf(fx.cardId) && <>「{nameOf(fx.cardId)}」</>} {by && <b style={{ color: playerColor(by.seat) }}>{by.name}</b>}
        </motion.div>
      )}
      {tier >= 3 && <motion.div className="fx__huge" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 1.05] }} transition={{ duration: 1.5, times: [0, 0.2, 0.7, 1] }}>{up ? '社群沸腾！' : '社群骤冷！'}</motion.div>}
    </motion.div>
  );
}

function InfluenceFx({ fx }: { fx: Extract<FxT, { type: 'influence' }> }) {
  const delta = fx.to - fx.from;
  const tier = tierOf(delta);
  const up = delta > 0;
  const p = usePlayer(fx.playerId);
  const by = usePlayer(fx.by);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-seat-id="${fx.playerId}"]`) ?? document.querySelector('.myarea__stats');
    const r = el?.getBoundingClientRect();
    setAt(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight - 160 });
  }, []);
  useEffect(() => sfx(tier >= 2 ? 'boom' : up ? 'up' : 'down'), []);
  if (!at) return null;
  return (
    <motion.div className={`fx__seatfx fx__value--${up ? 'up' : 'down'} tier${tier}`} style={{ left: at.x, top: at.y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <Shock tone={up ? 'warm' : 'cool'} count={tier} />
      <Burst preset={up ? 'rise' : 'fall'} />
      {tier >= 2 && <Burst preset={up ? 'sparkle' : 'smoke'} />}
      <motion.div className="fx__num fx__num--seat" initial={{ scale: 2.6, opacity: 0, y: 20 }} animate={{ scale: [2.6, 0.9, 1], opacity: 1, y: [20, 0, -26] }} transition={{ duration: 0.8, times: [0, 0.35, 1], ease: 'easeOut' }}>
        <small>{p?.name} 个人影响力{by && fx.by !== fx.playerId ? <> ← <b style={{ color: playerColor(by.seat) }}>{by.name}</b></> : null}</small>
        <b>{up ? '+' : '−'}{Math.abs(delta)}</b>
      </motion.div>
    </motion.div>
  );
}

// ── dice ──────────────────────────────────────────────────────────────────────────────────

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

function Die({ face }: { face: number }) {
  return (
    <svg viewBox="0 0 100 100" className="die">
      <rect x="4" y="4" width="92" height="92" rx="20" />
      {PIPS[face].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={face === 1 ? 13 : 9} className={face === 1 ? 'is-red' : ''} />)}
    </svg>
  );
}

function DiceFx({ fx }: { fx: Extract<FxT, { type: 'dice' }> }) {
  const p = usePlayer(fx.playerId);
  const [face, setFace] = useState(1);
  const [done, setDone] = useState(false);
  useEffect(() => {
    sfx('dice');
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (n >= 9) {
        setFace(fx.face);
        setDone(true);
        clearInterval(t);
      } else setFace(1 + Math.floor(Math.random() * 6));
    }, 70);
    return () => clearInterval(t);
  }, [fx.face]);
  const res = typeof fx.result === 'boolean' ? (fx.result ? '真' : '假') : fx.judge === 'delta' && fx.result > 0 ? `+${fx.result}` : String(fx.result);
  return (
    <motion.div className="fx__dice" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
      {done && <Shock tone="gold" count={2} />}
      <motion.div animate={done ? { rotate: 0, scale: [1.3, 1] } : { rotate: [0, 90, 180, 270, 360], y: [0, -26, 0] }} transition={done ? { duration: 0.3 } : { repeat: Infinity, duration: 0.5, ease: 'linear' }}>
        <Die face={face} />
      </motion.div>
      <div className="fx__caption">
        <b style={{ color: p ? playerColor(p.seat) : undefined }}>{p?.name}</b> · {JUDGE_LABEL[fx.judge]}
        {done && <motion.span className="fx__result" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>{res}</motion.span>}
      </div>
    </motion.div>
  );
}

// ── big announcements ─────────────────────────────────────────────────────────────────────

function Banner({ cardId, playerId, caption, tone, big, sound }: { cardId: string; playerId?: string; caption: string; tone: string; big?: boolean; sound: 'event' | 'official' | 'reveal' }) {
  const p = usePlayer(playerId);
  useEffect(() => sfx(sound), []);
  return (
    <motion.div className={`fx__banner fx__banner--${tone}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="fx__ribbon" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} exit={{ scaleX: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} />
      {(tone === 'up' || tone === 'down') && <Burst preset={tone === 'up' ? 'rise' : 'fall'} />}
      <motion.div initial={{ rotateY: 100, scale: 0.8 }} animate={{ rotateY: 0, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
        <Card id={cardId} size={big ? 'xl' : 'lg'} noPreview />
      </motion.div>
      <motion.div className="fx__bannertext" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
        {p && <b style={{ color: playerColor(p.seat) }}>{p.name}</b>}
        <span>{caption}</span>
      </motion.div>
    </motion.div>
  );
}

/** "你的回合" sweep when the turn passes to you. */
function TurnBanner() {
  const mine = useStore((s) => !!s.playerId && s.game?.currentPlayerId === s.playerId && s.game.phase !== 'finished');
  const round = useStore((s) => s.game?.round ?? 0);
  const busy = useStore((s) => s.fxQueue.length > 0); // wait for other effects to finish first
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!mine || busy || document.documentElement.classList.contains('reduce-motion')) return;
    setKey((k) => k + 1);
    const t = setTimeout(() => setKey(0), 1500);
    return () => clearTimeout(t);
  }, [mine, round, busy]);
  return (
    <AnimatePresence>
      {key > 0 && (
        <motion.div key={key} className="fx__turn" initial={{ opacity: 0, x: -120 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 120 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <span>你的回合</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── cards flying between the deck and seats ───────────────────────────────────────────────

function Flights() {
  const flights = useStore((s) => s.flights);
  return <>{flights.map((f) => <FlightItem key={f.id} f={f} />)}</>;
}

function centre(el: Element | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function FlightItem({ f }: { f: Flight }) {
  const end = useStore((s) => s.endFlight);
  const me = useStore((s) => s.playerId);
  const [pts, setPts] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  useLayoutEffect(() => {
    const seat = (id: string) => centre(document.querySelector(id === me ? '.hand, .myarea' : `[data-seat-id="${id}"]`));
    const a = f.from === 'deck' ? centre(document.querySelector('.decks .deck .card')) : seat(f.from);
    const b = seat(f.to);
    if (a && b) setPts({ a, b });
    else end(f.id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => end(f.id), 1100);
    return () => clearTimeout(t);
  }, []);

  if (!pts) return null;
  const n = Math.min(3, f.n);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <motion.div
          key={i}
          className="fx__flight"
          initial={{ left: pts.a.x, top: pts.a.y, opacity: 0, scale: 0.8, rotate: -10 }}
          animate={{ left: pts.b.x, top: pts.b.y, opacity: [0, 1, 1, 0], scale: [0.8, 1, 0.9, 0.5], rotate: [-10, 6, 0, 0] }}
          transition={{ duration: 0.65, delay: i * 0.09, ease: [0.22, 1, 0.36, 1] }}
        >
          <CardBack kind="action" size="sm" />
        </motion.div>
      ))}
    </>
  );
}

/** Falling confetti for winners (compositor-only: transform + opacity). */
export function Confetti() {
  const bits = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({
      x: Math.random() * 100,
      d: 2.4 + Math.random() * 2.2,
      delay: Math.random() * 1.6,
      c: ['#f3d58a', '#f06a5d', '#58c28f', '#9aa2ff', '#f2a7bb'][i % 5],
      w: 6 + Math.random() * 6,
      r: Math.random() * 360,
    })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.x}%`, width: b.w, height: b.w * 1.6, background: b.c, animationDuration: `${b.d}s`, animationDelay: `${b.delay}s`, transform: `rotate(${b.r}deg)` }} />
      ))}
    </div>
  );
}
