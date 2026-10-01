import { JUDGE_LABEL, judgeResult, type Fx, type JudgeKind } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { sfx } from '../../audio';
import { playerColor } from '../../ui/colors';
import { Burst } from '../Burst';
import { Shock, seatOrigin, signed, usePlayer } from './common';

/**
 * A real die: it is thrown from the roller's seat, tumbles and bounces across the table, slows down, rests for a
 * heartbeat — and only then shows what it means. Everyone at the table watches the same throw.
 * Timeline (ms): 0 throw · 0–3200 tumble & bounce · 3200 lands · 3900 result · ends at 5200 (see fxMs).
 */

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[27, 27], [73, 73]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[27, 27], [73, 27], [27, 73], [73, 73]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/** Cube rotation that brings a face to the front (opposite faces add up to 7). */
const FACE_ROT: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 }, 2: { x: 0, y: -90 }, 5: { x: 0, y: 90 }, 6: { x: 0, y: 180 }, 3: { x: -90, y: 0 }, 4: { x: 90, y: 0 },
};

function Face({ n }: { n: number }) {
  return (
    <div className={`cube__face cube__face--${n}`}>
      {PIPS[n].map(([x, y], i) => <i key={i} className={n === 1 ? 'is-red' : ''} style={{ left: `${x}%`, top: `${y}%` }} />)}
    </div>
  );
}

const show = (kind: JudgeKind, v: number | boolean) => (typeof v === 'boolean' ? (v ? '真' : '假') : kind === 'delta' ? signed(v) : String(v));

const EXPLAIN: Record<JudgeKind, (face: number, r: number | boolean) => string> = {
  truth: (f, r) => `点数 ${f}（${f % 2 ? '奇数' : '偶数'}）→ ${r ? '真' : '假'}`,
  two: (f, r) => `点数 ${f} → ${r}`,
  delta: (f, r) => `点数 ${f} → ${signed(r as number)}`,
};

export function DiceFx({ fx }: { fx: Extract<Fx, { type: 'dice' }> }) {
  const p = usePlayer(fx.playerId);
  const origin = useMemo(() => seatOrigin(fx.playerId), []);
  const [phase, setPhase] = useState<'roll' | 'land' | 'result'>('roll');
  const final = FACE_ROT[fx.face];
  const spin = useMemo(() => ({ x: 720 + Math.floor(Math.random() * 2) * 360, y: 1080 + Math.floor(Math.random() * 2) * 360, z: (Math.random() - 0.5) * 16 }), []);

  useEffect(() => {
    sfx('drum');
    const at = (ms: number, f: () => void) => window.setTimeout(f, ms);
    const timers = [
      at(750, () => sfx('tick')), at(1500, () => sfx('tick')), at(2200, () => sfx('tick')), at(2750, () => sfx('tick')), at(3050, () => sfx('tick')),
      at(3200, () => { setPhase('land'); sfx('thud'); }),
      at(3900, () => { setPhase('result'); sfx('reveal'); }),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const color = p ? playerColor(p.seat) : undefined;
  const mood = typeof fx.result === 'boolean' ? (fx.result ? 'good' : 'bad') : fx.result > 0 ? 'good' : fx.result < 0 ? 'bad' : 'plain';

  return (
    <motion.div className="fx__dice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <motion.div className="fx__dicedim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
      <motion.div className="fx__dicetitle" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <b style={{ color }}>{p?.name}</b> 掷出 <em>{JUDGE_LABEL[fx.judge]}</em>
      </motion.div>

      {/* flight from the seat to the middle of the table */}
      <motion.div className="dice3d__flight" initial={{ x: origin.x, y: origin.y, scale: 0.35 }} animate={{ x: 0, y: 0, scale: 1 }} transition={{ duration: 0.75, ease: [0.2, 0.8, 0.25, 1] }}>
        {/* bounces */}
        <motion.div
          className={`dice3d__bounce ${phase !== 'roll' ? 'is-rest' : ''}`}
          animate={{ y: [0, -190, 0, -96, 0, -44, 0, -14, 0] }}
          transition={{ duration: 3.2, times: [0, 0.12, 0.3, 0.45, 0.6, 0.74, 0.86, 0.94, 1], ease: ['easeOut', 'easeIn', 'easeOut', 'easeIn', 'easeOut', 'easeIn', 'easeOut', 'easeIn'] }}
        >
          <div className="dice3d">
            <motion.div
              className="cube"
              initial={{ rotateX: final.x + spin.x, rotateY: final.y + spin.y, rotateZ: spin.z }}
              animate={{ rotateX: final.x, rotateY: final.y, rotateZ: spin.z * 0.2 }}
              transition={{ duration: 3.2, ease: [0.12, 0.6, 0.2, 1] }}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => <Face key={n} n={n} />)}
            </motion.div>
          </div>
        </motion.div>
        <motion.div className="dice3d__shadow" animate={{ scale: [0.5, 0.35, 1, 0.5, 1, 0.75, 1, 0.9, 1], opacity: [0.2, 0.15, 0.5, 0.25, 0.5, 0.4, 0.5, 0.45, 0.5] }} transition={{ duration: 3.2, times: [0, 0.12, 0.3, 0.45, 0.6, 0.74, 0.86, 0.94, 1] }} />
        {phase !== 'roll' && <Shock tone="gold" count={1} />}
      </motion.div>

      <div className="fx__diceresult">
        {phase === 'result' ? (
          <motion.div className={`dieresult dieresult--${mood}`} initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 16 }}>
            <Burst preset={mood === 'bad' ? 'fall' : 'sparkle'} />
            <b>{show(fx.judge, fx.result)}</b>
            <span>{EXPLAIN[fx.judge](fx.face, fx.result)}</span>
          </motion.div>
        ) : (
          <div className="dieresult dieresult--wait">{phase === 'land' ? '……' : <>骰子在滚动<i className="dots"><i /><i /><i /></i></>}</div>
        )}
        <div className="dicelegend">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span key={n} className={`dicelegend__cell ${phase === 'result' && n === fx.face ? 'is-hit' : ''}`}>
              <small>{n}</small>
              <b>{show(fx.judge, judgeResult(fx.judge, n))}</b>
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
