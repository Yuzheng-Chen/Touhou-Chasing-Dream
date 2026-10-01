import { COMMUNITY_LIMIT } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { YinYang } from '../cards/Card';
import { useStore } from '../store';

/** Floating "+2" that rises from a meter whenever its value changes. */
export function PulseFloat({ target }: { target: string }) {
  const pulse = useStore((s) => s.pulses[target]);
  const [shown, setShown] = useState<typeof pulse | null>(null);
  useEffect(() => {
    if (!pulse) return;
    setShown(pulse);
    const t = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(t);
  }, [pulse?.key]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.span
          key={shown.key}
          className={`pulse ${shown.delta > 0 ? 'pulse--up' : 'pulse--down'}`}
          initial={{ opacity: 0, y: 6, scale: 0.8 }}
          animate={{ opacity: 1, y: -18, scale: 1 }}
          exit={{ opacity: 0, y: -30 }}
          transition={{ duration: 0.8 }}
        >
          {shown.delta > 0 ? `+${shown.delta}` : shown.delta}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** 社群规模 track from −10 (小众) to +10 (繁荣) with a yin-yang orb marker. */
export function CommunityMeter({ value: real }: { value: number }) {
  const hit = useStore((s) => s.meterHit);
  const value = useStore((s) => s.shown.community) ?? real;
  const pct = ((value + COMMUNITY_LIMIT) / (2 * COMMUNITY_LIMIT)) * 100;
  return (
    <div className="cmeter" aria-label={`社群规模 ${value}`}>
      <div className="cmeter__head">
        <span className="cmeter__side cmeter__side--niche">小众</span>
        <span className="cmeter__title">社群规模</span>
        <span className="cmeter__side cmeter__side--prosper">繁荣</span>
      </div>
      <div className="cmeter__track">
        <div className="cmeter__fill" style={{ left: `${Math.min(pct, 50)}%`, right: `${100 - Math.max(pct, 50)}%` }} data-sign={Math.sign(value)} />
        {Array.from({ length: 21 }, (_, i) => (
          <span key={i} className={`cmeter__tick ${i % 5 === 0 ? 'is-major' : ''}`} style={{ left: `${(i / 20) * 100}%` }} />
        ))}
        <motion.div className="cmeter__orb" animate={{ left: `${pct}%`, rotate: value * 36 }} transition={{ type: 'spring', stiffness: 120, damping: 14 }}>
          <YinYang size={34} />
          {hit > 0 && <i key={hit} className="orb-ring" />}
        </motion.div>
      </div>
      <div className="cmeter__value">
        <motion.b key={value} initial={{ scale: 1.5, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className={value > 0 ? 'is-pos' : value < 0 ? 'is-neg' : ''}>
          {value > 0 ? `+${value}` : value}
        </motion.b>
        <PulseFloat target="community" />
      </div>
    </div>
  );
}

/** Compact 个人影响力 pips (−cap … +cap). */
export function InfluenceMeter({ value: real, cap, playerId, big }: { value: number; cap: number; playerId: string; big?: boolean }) {
  // While an effect that changes this number is still queued, show the number as it was.
  const value = useStore((s) => s.shown.influence[playerId]) ?? real;
  return (
    <div className={`imeter ${big ? 'imeter--big' : ''}`} title={`个人影响力 ${value}（上限 ±${cap}）`}>
      <span className={`imeter__num ${value > 0 ? 'is-pos' : value < 0 ? 'is-neg' : ''}`}>
        {value > 0 ? `+${value}` : value}
      </span>
      <span className="imeter__pips">
        {Array.from({ length: cap * 2 + 1 }, (_, i) => {
          const v = i - cap;
          const on = v !== 0 && (value > 0 ? v > 0 && v <= value : v < 0 && v >= value);
          return <i key={i} className={`${v === 0 ? 'is-zero' : ''} ${on ? (v > 0 ? 'is-on-pos' : 'is-on-neg') : ''}`} />;
        })}
      </span>
      <PulseFloat target={playerId} />
    </div>
  );
}

/** Countdown ring for prompt deadlines. */
export function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());
  const [total] = useState(() => Math.max(1, deadline - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  const left = Math.max(0, deadline - now);
  const frac = left / total;
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className={`countdown ${left < 10_000 ? 'is-urgent' : ''}`} title="剩余时间">
      <svg width="38" height="38" viewBox="0 0 38 38">
        <circle cx="19" cy="19" r={r} className="countdown__bg" />
        <circle cx="19" cy="19" r={r} className="countdown__fg" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <b>{Math.ceil(left / 1000)}</b>
    </span>
  );
}
