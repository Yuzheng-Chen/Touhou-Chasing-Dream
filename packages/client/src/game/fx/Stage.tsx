import { cardDef, type SettleTo } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { sfx } from '../../audio';
import { Card } from '../../cards/Card';
import { useStore, type StageCard } from '../../store';
import { playerColor } from '../../ui/colors';
import { nameOf, offsetOf, seatOrigin, usePlayer } from './common';

/**
 * The centre of the table. A card that is being played (or an event being resolved) stands here for as long as its
 * effect is being decided — targets chosen, reactions answered, numbers changed — and flies to its pile when it is over.
 * Other effects (numbers, dice, skills…) take the middle for a moment; the card steps aside while they play.
 */

const kindWord = (id: string) => {
  try {
    const k = cardDef(id).kind;
    return k === 'role' ? '角色技能' : k === 'official' ? '官作效果' : '特殊牌效果';
  } catch {
    return '';
  }
};

const isEventCard = (c: StageCard) => c.fx.direction !== undefined || cardDef(c.fx.cardId).kind === 'event';

/** Where a settled card goes, as an offset from the screen centre. */
function destinationOf(to: SettleTo, toId: string | undefined, c: StageCard) {
  const q = (sel: string) => offsetOf(document.querySelector(sel));
  if ((to === 'gift' || to === 'keep') && (toId || c.fx.playerId)) return seatOrigin(toId ?? c.fx.playerId);
  if (to === 'delay') return q('.center__strips .strip:last-child') ?? q('.zones .zone:nth-child(1)');
  if (to === 'chain') return q('.center__strips .strip:first-child') ?? q('.zones .zone:nth-child(2)');
  return q(isEventCard(c) ? '.zones .zone:nth-child(2)' : '.zones .zone:nth-child(1)');
}

const YIELDS = new Set(['community', 'dice', 'reveal', 'official', 'event', 'turn', 'round', 'mod']);

export function Stage() {
  const stage = useStore((s) => s.stage);
  const yielding = useStore((s) => {
    const fx = s.fxQueue[0]?.fx;
    return !!fx && (fx.type === 'skill' ? !fx.passive : YIELDS.has(fx.type));
  });
  const top = stage.findIndex((c) => !c.leaving);
  return (
    <div className="stage" aria-hidden>
      <motion.div className="stage__dim" initial={false} animate={{ opacity: stage.some((c) => !c.leaving) ? 1 : 0 }} transition={{ duration: 0.5 }} />
      {stage.map((c, i) => (
        <StageCardView key={c.key} c={c} depth={stage.filter((x, j) => j > i && !x.leaving).length} yielding={yielding} lead={i === stage.length - 1 && top >= 0} />
      ))}
    </div>
  );
}

function StageCardView({ c, depth, yielding, lead }: { c: StageCard; depth: number; yielding: boolean; lead: boolean }) {
  const fx = c.fx;
  const p = usePlayer(fx.playerId);
  const origin = useMemo(() => seatOrigin(fx.playerId), []);
  const dest = useMemo(() => (c.leaving ? destinationOf(c.leaving.to, c.leaving.toId, c) ?? { x: 0, y: -240 } : null), [c.leaving]);
  const thinking = useStore((s) => lead && depth === 0 && !c.leaving && !!s.game?.waitingOn.includes(fx.playerId));
  const event = isEventCard(c);
  const side = Math.min(320, window.innerWidth * 0.28);

  useEffect(() => {
    if (c.leaving) sfx('whoosh');
  }, [!!c.leaving]);

  const rest = depth > 0
    ? { x: -depth * 150, y: -34 - depth * 14, scale: 1 - depth * 0.22, opacity: 0.7 }
    : yielding
      ? { x: -side, y: -24, scale: 0.66, opacity: 0.45 }
      : { x: 0, y: -26, scale: 1, opacity: 1 };

  return (
    <motion.div
      className={`stage__card ${event ? 'is-event' : ''} ${c.leaving ? 'is-leaving' : ''}`}
      initial={{ x: origin.x, y: origin.y, scale: 0.3, opacity: 1 }}
      animate={dest ? { x: dest.x, y: dest.y, scale: 0.26, opacity: [1, 1, 0] } : rest}
      transition={dest ? { duration: 0.85, ease: [0.5, 0, 0.75, 0.2], opacity: { duration: 0.85, times: [0, 0.7, 1] } } : { type: 'spring', stiffness: 150, damping: 20, mass: 0.9 }}
    >
      <motion.div
        className="stage__slam"
        initial={{ scale: 0.55, rotate: -14 }}
        animate={{ scale: [0.55, 1.22, 1], rotate: [-14, 3, 0] }}
        transition={{ duration: 0.7, times: [0, 0.62, 1], ease: [0.22, 1, 0.36, 1] }}
      >
        <Card id={fx.cardId} size="lg" noPreview />
      </motion.div>

      <motion.div className="stage__info" animate={{ opacity: c.leaving ? 0 : 1 }} transition={{ duration: 0.3 }}>
        {fx.via && (
          <motion.div className="stage__via" initial={{ opacity: 0, y: -8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.4, type: 'spring', stiffness: 220, damping: 18 }}>
            <Card id={fx.via.sourceId} size="xs" noPreview />
            <div>
              <small>{kindWord(fx.via.sourceId)}发动</small>
              <b>「{fx.via.skill}」</b>
              {fx.as && <span>「{nameOf(fx.cardId)}」当作「{nameOf(fx.as)}」打出</span>}
            </div>
          </motion.div>
        )}
        <div className="stage__caption">
          <b style={{ color: p ? playerColor(p.seat) : undefined }}>{p?.name}</b>
          {event ? (
            <>
              <span> 的事件</span>
              {fx.direction && fx.direction !== 'none' && <em className={`dirtag dirtag--${fx.direction}`}>{fx.direction === 'up' ? '正向发生' : '逆向发生'}</em>}
              {fx.direction === 'none' && <em className="dirtag">发生</em>}
            </>
          ) : fx.as && !fx.via ? (
            <span> 视作「{nameOf(fx.as)}」打出</span>
          ) : (
            <span> 打出</span>
          )}
          {thinking && <span className="stage__thinking"><i /><i /><i /></span>}
        </div>
      </motion.div>
    </motion.div>
  );
}
