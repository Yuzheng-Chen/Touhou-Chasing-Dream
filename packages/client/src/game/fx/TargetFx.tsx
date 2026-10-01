import type { Fx } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { sfx } from '../../audio';
import { useStore } from '../../store';
import { playerColor } from '../../ui/colors';
import { Shock, nameOf, seatOrigin, usePlayer } from './common';

/**
 * "Who is it going to hit?" A beam shoots from the card in the middle (or from the player who picked) to each target,
 * a reticle locks on, and the seat flashes. Played right after the picker has decided, so the table sees the choice land.
 */
export function TargetFx({ fx }: { fx: Extract<Fx, { type: 'target' }> }) {
  const caster = usePlayer(fx.fromId);
  const start = useMemo(() => {
    const onStage = useStore.getState().stage.some((c) => !c.leaving);
    return onStage ? { x: 0, y: -26 } : seatOrigin(fx.fromId);
  }, []);
  const targets = useMemo(() => fx.toIds.map((id) => ({ id, ...seatOrigin(id) })), []);
  useEffect(() => {
    const t = window.setTimeout(() => sfx('lock'), 380);
    return () => clearTimeout(t);
  }, []);
  return (
    <motion.div className="fx__target" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      {targets.map((t, i) => <Lock key={t.id} id={t.id} from={start} to={t} delay={i * 0.18} cardId={fx.cardId} casterName={caster?.name} />)}
    </motion.div>
  );
}

function Lock({ id, from, to, delay, cardId, casterName }: { id: string; from: { x: number; y: number }; to: { x: number; y: number }; delay: number; cardId?: string; casterName?: string }) {
  const p = usePlayer(id);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const color = p ? playerColor(p.seat) : '#ff6a5e';
  return (
    <>
      <div className="beam" style={{ left: from.x, top: from.y, width: len, transform: `rotate(${angle}deg)` }}>
        <motion.i className="beam__line" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay, duration: 0.45, ease: [0.5, 0, 0.2, 1] }} />
        <motion.i className="beam__head" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.4, duration: 0.1 }} />
      </div>
      <div className="reticle" style={{ left: to.x, top: to.y, ['--c' as string]: color }}>
        <motion.div className="reticle__ring" initial={{ scale: 3, opacity: 0, rotate: -90 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ delay: delay + 0.35, duration: 0.45, ease: [0.2, 0.9, 0.3, 1] }}>
          <i /><i /><i /><i />
        </motion.div>
        <motion.div className="reticle__flash" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 0.9, 0], scale: [0.4, 1.4, 1.8] }} transition={{ delay: delay + 0.6, duration: 0.7 }} />
        <motion.div className="reticle__tag" initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: delay + 0.6, type: 'spring', stiffness: 260, damping: 18 }}>
          {casterName && <small>{casterName}{cardId ? ` · 「${nameOf(cardId)}」` : ''}</small>}
          <b>目标：<span style={{ color }}>{p?.name}</span></b>
        </motion.div>
        <Shock tone="warm" count={2} />
      </div>
    </>
  );
}
