import { JUDGE_LABEL, cardDef, type Fx as FxT, type LogEntry } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Card, CardBack } from '../cards/Card';
import { useStore, type Flight } from '../store';
import { playerColor } from '../ui/colors';
import { Burst, presetFor } from './Burst';
import './fx.css';

const DURATION: Record<string, number> = { play: 1500, dice: 1500, event: 1700, official: 2000, reveal: 1600 };

/** Plays queued log effects one by one over the table. */
export function FxLayer() {
  const queue = useStore((s) => s.fxQueue);
  const shift = useStore((s) => s.shiftFx);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const base = DURATION[current.fx!.type] ?? 1200;
    const t = setTimeout(shift, queue.length > 2 ? base * 0.55 : base);
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

function usePlayer(id: string) {
  return useStore((s) => s.game?.players.find((p) => p.id === id));
}

/** Screen position of a seat, so played cards fly from their owner. */
function seatOrigin(playerId: string) {
  const el = document.querySelector(`[data-seat-id="${playerId}"]`) ?? document.querySelector('.myarea');
  if (!el) return { x: 0, y: 200 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - window.innerWidth / 2, y: r.top + r.height / 2 - window.innerHeight / 2 };
}

function FxItem({ e }: { e: LogEntry }) {
  const fx = e.fx as FxT;
  switch (fx.type) {
    case 'play':
      return <PlayFx fx={fx} />;
    case 'dice':
      return <DiceFx fx={fx} />;
    case 'event':
      return <Banner cardId={fx.cardId} playerId={fx.playerId} caption={fx.direction === 'up' ? '正向发生' : fx.direction === 'down' ? '逆向发生' : '发生'} tone={fx.direction} />;
    case 'official':
      return <Banner cardId={fx.cardId} caption="官作发布" tone="official" big />;
    case 'reveal':
      return <Banner cardId={fx.roleId} playerId={fx.playerId} caption="翻开了角色牌" tone="reveal" />;
    default:
      return null;
  }
}

function PlayFx({ fx }: { fx: Extract<FxT, { type: 'play' }> }) {
  const p = usePlayer(fx.playerId);
  const o = seatOrigin(fx.playerId);
  const preset = presetFor(fx.as ?? fx.cardId);
  return (
    <motion.div
      className="fx__play"
      initial={{ x: o.x, y: o.y, scale: 0.35, opacity: 0, rotate: -8 }}
      animate={{ x: 0, y: -30, scale: 1, opacity: 1, rotate: 0 }}
      exit={{ y: -60, scale: 0.8, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 20 }}
    >
      <Burst preset={preset} />
      <Card id={fx.cardId} size="lg" noPreview />
      <div className="fx__caption">
        <b style={{ color: p ? playerColor(p.seat) : undefined }}>{p?.name}</b>
        {fx.as ? <> 视作「{cardDef(fx.as).name}」打出</> : ' 打出'}
      </div>
    </motion.div>
  );
}

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

function Banner({ cardId, playerId, caption, tone, big }: { cardId: string; playerId?: string; caption: string; tone: string; big?: boolean }) {
  const p = usePlayer(playerId ?? '');
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
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!mine || document.documentElement.classList.contains('reduce-motion')) return;
    setKey((k) => k + 1);
    const t = setTimeout(() => setKey(0), 1500);
    return () => clearTimeout(t);
  }, [mine, round]);
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

// ── cards flying between the deck and seats ───────────────────────────────────

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
          <CardBack kind={f.from === 'deck' ? 'action' : 'action'} size="sm" />
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
