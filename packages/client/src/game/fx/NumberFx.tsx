import type { CalcStep, Fx } from '@tcd/shared';
import { motion } from 'motion/react';
import { Fragment, useEffect, useLayoutEffect, useState } from 'react';
import { sfx } from '../../audio';
import { Card } from '../../cards/Card';
import { useStore } from '../../store';
import { playerColor } from '../../ui/colors';
import { Burst } from '../Burst';
import { Shock, isCard, nameOf, signed, usePlayer } from './common';

/**
 * Numbers changing. The bigger the change the bigger the show (tier 1: 1–2, tier 2: 3–4, tier 3: 5+).
 * When modifiers took part, the calculation is told first, step by step, and the final number lands after it.
 */

export const tierOf = (n: number) => (Math.abs(n) >= 5 ? 3 : Math.abs(n) >= 3 ? 2 : 1);
/** Time per calculation step; must match fxMs in shared. */
const STEP_MS = 650;

/** Which step of the calculation is on screen, and when the result lands. */
function useCalc(calc: CalcStep[] | undefined, onLand: () => void) {
  const steps = calc ?? [];
  const told = steps.length > 1;
  const [k, setK] = useState(told ? 1 : steps.length);
  useEffect(() => {
    const timers: number[] = [];
    if (told) {
      for (let i = 1; i < steps.length; i++) timers.push(window.setTimeout(() => { setK(i + 1); sfx('mod'); }, i * STEP_MS));
    }
    timers.push(window.setTimeout(onLand, told ? (steps.length - 1) * STEP_MS + 250 : 0));
    return () => timers.forEach(clearTimeout);
  }, []);
  const landed = !told || k >= steps.length;
  return { steps, told, k, landed, running: steps[Math.min(k, steps.length) - 1]?.value };
}

/** "基础 −3 → 煽风点火 偏移量+1 → −4": the chips that tell where a number came from. */
function Tape({ steps, k, compact }: { steps: CalcStep[]; k: number; compact?: boolean }) {
  return (
    <div className={`tape ${compact ? 'tape--compact' : ''}`}>
      {steps.slice(0, k).map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <i className="tape__arrow">→</i>}
          <motion.div className="tape__step" initial={{ opacity: 0, y: 14, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
            {isCard(s.sourceId) && <Card id={s.sourceId} size="xs" noPreview />}
            <span className="tape__what"><small>{i === 0 ? '起点' : '修正'} · {s.label}</small><b>{s.text}</b></span>
            <span className="tape__val">{signed(s.value)}</span>
          </motion.div>
        </Fragment>
      ))}
    </div>
  );
}

export function CommunityFx({ fx }: { fx: Extract<Fx, { type: 'community' }> }) {
  const delta = fx.to - fx.from;
  const tier = tierOf(delta);
  const by = usePlayer(fx.by);
  const up = delta > 0;
  const { steps, told, k, landed, running } = useCalc(fx.calc, () => {
    const st = useStore.getState();
    st.playFx(fx);
    st.setMeterHit();
    sfx(tier >= 3 ? (up ? 'bigup' : 'bigdown') : tier === 2 ? 'boom' : up ? 'up' : 'down');
  });
  const shown = landed ? delta : running ?? delta;
  return (
    <motion.div className={`fx__value fx__value--${up ? 'up' : 'down'} tier${tier} ${landed ? 'is-landed' : 'is-counting'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {landed && tier >= 2 && <div className="fx__vignette" />}
      {landed && <Shock tone={up ? 'warm' : 'cool'} count={tier + 1} />}
      {landed && <Burst preset={up ? 'rise' : 'fall'} />}
      {landed && tier >= 2 && <Burst preset={up ? 'sparkle' : 'smoke'} />}
      {landed && tier >= 3 && <Burst preset="flames" />}
      {landed && tier >= 3 && (
        <motion.div className="fx__huge" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 1.05] }} transition={{ duration: 2, times: [0, 0.15, 0.75, 1] }}>
          {up ? '社群沸腾！' : '社群骤冷！'}
        </motion.div>
      )}
      <div className="fx__numhead">社群规模</div>
      <motion.div
        key={landed ? 'final' : k}
        className="fx__num"
        initial={landed ? { scale: 3.4, opacity: 0, rotate: up ? -5 : 5 } : { scale: 1.35, opacity: 0.4 }}
        animate={landed ? { scale: [3.4, 0.86, 1], opacity: 1, rotate: 0 } : { scale: 1, opacity: 1 }}
        transition={landed ? { duration: 0.6, times: [0, 0.6, 1], ease: 'easeOut' } : { duration: 0.3 }}
      >
        <b>{signed(shown)}</b>
      </motion.div>
      {told && <Tape steps={steps} k={k} />}
      {landed && (
        <motion.div className="fx__range" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <span>{fx.from}</span><i>→</i><b>{fx.to}</b>
        </motion.div>
      )}
      {(fx.cardId || by) && landed && (
        <motion.div className="fx__src" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          {fx.cardId && nameOf(fx.cardId) && <>「{nameOf(fx.cardId)}」</>} {by && <b style={{ color: playerColor(by.seat) }}>{by.name}</b>}
        </motion.div>
      )}
    </motion.div>
  );
}

export function InfluenceFx({ fx }: { fx: Extract<Fx, { type: 'influence' }> }) {
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
  const { steps, told, k, landed, running } = useCalc(fx.calc, () => {
    useStore.getState().playFx(fx);
    sfx(tier >= 2 ? 'boom' : up ? 'up' : 'down');
  });
  if (!at) return null;
  const shown = landed ? delta : running ?? delta;
  // Seats near the bottom pop their numbers upwards so nothing runs off screen.
  const below = at.y < window.innerHeight * 0.55;
  return (
    <motion.div
      className={`fx__seatfx fx__value--${up ? 'up' : 'down'} tier${tier} ${below ? 'is-below' : 'is-above'} ${landed ? 'is-landed' : 'is-counting'}`}
      style={{ left: at.x, top: at.y }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
    >
      {landed && <Shock tone={up ? 'warm' : 'cool'} count={tier} />}
      {landed && <Burst preset={up ? 'rise' : 'fall'} />}
      {landed && tier >= 2 && <Burst preset={up ? 'sparkle' : 'smoke'} />}
      <div className="seatfx__stack">
        <motion.div
          key={landed ? 'final' : k}
          className="fx__num fx__num--seat"
          initial={landed ? { scale: 2.6, opacity: 0, y: 20 } : { scale: 1.3, opacity: 0.5 }}
          animate={landed ? { scale: [2.6, 0.9, 1], opacity: 1, y: [20, 0, 0] } : { scale: 1, opacity: 1 }}
          transition={landed ? { duration: 0.7, times: [0, 0.35, 1], ease: 'easeOut' } : { duration: 0.3 }}
        >
          <small>{p?.name} 个人影响力{by && fx.by !== fx.playerId ? <> ← <b style={{ color: playerColor(by.seat) }}>{by.name}</b></> : null}</small>
          <b>{signed(shown)}</b>
          {landed && <span>{fx.from} → {fx.to}</span>}
        </motion.div>
        {told && <Tape steps={steps} k={k} compact />}
      </div>
    </motion.div>
  );
}
