import { JUDGE_LABEL, cardDef, type Fx as FxT, type LogEntry } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Card } from '../cards/Card';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';

const DURATION: Record<string, number> = { play: 1300, dice: 1500, event: 1700, official: 2000, reveal: 1600 };

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
  return (
    <motion.div
      className="fx__play"
      initial={{ x: o.x, y: o.y, scale: 0.35, opacity: 0, rotate: -8 }}
      animate={{ x: 0, y: -30, scale: 1, opacity: 1, rotate: 0 }}
      exit={{ y: -60, scale: 0.8, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 20 }}
    >
      <Card id={fx.cardId} size="lg" noPreview />
      <div className="fx__caption">
        <b style={{ color: p ? playerColor(p.seat) : undefined }}>{p?.name}</b>
        {fx.as ? <> 视作「<RichName id={fx.as} />」打出</> : ' 打出'}
      </div>
    </motion.div>
  );
}

function RichName({ id }: { id: string }) {
  return <>{cardDef(id).name}</>;
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
      <motion.div animate={done ? { rotate: 0, scale: [1.25, 1] } : { rotate: [0, 90, 180, 270, 360] }} transition={done ? { duration: 0.3 } : { repeat: Infinity, duration: 0.5, ease: 'linear' }}>
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
