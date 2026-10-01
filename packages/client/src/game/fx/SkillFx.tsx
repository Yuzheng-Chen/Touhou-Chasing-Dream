import { explain, factionLabel, roleDef, type Fx } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { sfx } from '../../audio';
import { Card, CardBack } from '../../cards/Card';
import { playerColor } from '../../ui/colors';
import { Burst } from '../Burst';
import { Shock, isCard, seatOrigin, usePlayer } from './common';

/** Role skills, rule modifiers, shields — the "something special happened" moments. */

/** A role's skill texts, with the one that just fired marked. */
function SkillList({ roleId, hit }: { roleId: string; hit?: string }) {
  const d = roleDef(roleId);
  return (
    <div className="revealpanel__skills">
      {d.active.map((s) => (
        <p key={s.name} className={hit === s.name ? 'is-hit' : ''}><span className="skill skill--active">{s.name}</span>{s.text}</p>
      ))}
      {d.passive.map((s) => (
        <p key={s.name} className={hit === s.name ? 'is-hit' : ''}><span className="skill skill--passive">{s.name}</span>{s.text}</p>
      ))}
    </div>
  );
}

/**
 * A role card turns face up: it flips in the middle of everybody's screen and its whole text is read out,
 * so nobody has to hover anything to know what just became possible.
 */
export function RevealFx({ playerId, roleId, skill }: { playerId: string; roleId: string; skill?: string }) {
  const p = usePlayer(playerId);
  const d = roleDef(roleId);
  const [faceUp, setFaceUp] = useState(false);
  const origin = useMemo(() => seatOrigin(playerId), []);
  const faction = explain(roleId)[0];
  useEffect(() => {
    sfx('drum');
    const t1 = window.setTimeout(() => { setFaceUp(true); sfx('flip'); sfx('skill'); }, 900);
    return () => clearTimeout(t1);
  }, []);
  const color = p ? playerColor(p.seat) : undefined;
  return (
    <motion.div className="fx__reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <div className="fx__revealdim" />
      {faceUp && <><Shock tone="gold" count={3} /><Burst preset="sparkle" /></>}
      <div className="fx__revealrow">
        <motion.div className="fx__revealcard" initial={{ x: origin.x, y: origin.y, scale: 0.3, opacity: 0 }} animate={{ x: 0, y: 0, scale: 1, opacity: 1 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
          <motion.div
            animate={faceUp ? { rotateY: [90, 0], scale: [1.15, 1] } : { rotateY: [0, 0] }}
            transition={{ duration: faceUp ? 0.5 : 0.8, ease: 'easeOut' }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {faceUp ? <Card id={roleId} size="xl" noPreview /> : <CardBack kind="role" size="xl" />}
          </motion.div>
        </motion.div>
        {faceUp && (
          <motion.div className="revealpanel" initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <small><b style={{ color }}>{p?.name}</b> 翻开了角色牌{skill ? <>，发动「{skill}」</> : null}</small>
            <h2 className="revealpanel__name">{d.name}</h2>
            <span className="revealpanel__faction">{d.stance === 'neutral' || d.focus === 'neutral' ? '中立' : factionLabel({ stance: d.stance, focus: d.focus })}</span>
            {faction && <p className="revealpanel__gloss">{faction.text}</p>}
            <SkillList roleId={roleId} hit={skill} />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/** An active skill that is used while the role is already face-up. */
export function SkillFx({ fx }: { fx: Extract<Fx, { type: 'skill' }> }) {
  const p = usePlayer(fx.playerId);
  const text = useMemo(() => [...roleDef(fx.roleId).active, ...roleDef(fx.roleId).passive].find((s) => s.name === fx.skill)?.text, []);
  useEffect(() => sfx('skill'), []);
  return (
    <motion.div className="fx__skill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <motion.div className="fx__ribbon" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} exit={{ scaleX: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
      <Burst preset="sparkle" />
      <Shock tone="gold" count={3} />
      <motion.div className="fx__skillcard" initial={{ rotateY: 110, scale: 0.7, opacity: 0 }} animate={{ rotateY: 0, scale: 1, opacity: 1 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
        <Card id={fx.roleId} size="lg" noPreview />
      </motion.div>
      <motion.div className="fx__skilltext" initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
        <small>{p && <b style={{ color: playerColor(p.seat) }}>{p.name}</b>} 发动主动技能</small>
        <span className="fx__skillname">{fx.skill}</span>
        {text && <p className="fx__skilldesc">{text}</p>}
      </motion.div>
    </motion.div>
  );
}

/** Passive skills: a plate at the top, so they are noticed without covering the table. */
export function PassiveFx({ fx }: { fx: Extract<Fx, { type: 'skill' }> }) {
  const p = usePlayer(fx.playerId);
  const text = useMemo(() => [...roleDef(fx.roleId).active, ...roleDef(fx.roleId).passive].find((s) => s.name === fx.skill)?.text, []);
  useEffect(() => sfx('mod'), []);
  return (
    <motion.div className="fx__passive" initial={{ opacity: 0, y: -30, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
      <Card id={fx.roleId} size="xs" noPreview />
      <div>
        <small>{p?.name} · 被动技能</small>
        <b>「{fx.skill}」</b>
        {text && <span>{text}</span>}
      </div>
    </motion.div>
  );
}

/** A modifier that stops a change outright ("事先科普: 防止了社群规模变化"). It pops up, then flies into the meter it affected. */
export function ModFx({ fx }: { fx: Extract<Fx, { type: 'mod' }> }) {
  const [to, setTo] = useState({ x: 0, y: -260 });
  useLayoutEffect(() => {
    const m = document.querySelector('.cmeter')?.getBoundingClientRect();
    if (m) setTo({ x: m.left + m.width / 2 - window.innerWidth / 2, y: m.top + m.height / 2 - window.innerHeight / 2 });
  }, []);
  useEffect(() => sfx('mod'), []);
  const plus = fx.amount.includes('+') || fx.amount.includes('翻倍');
  return (
    <motion.div
      className={`fx__mod ${plus ? 'is-plus' : 'is-minus'}`}
      initial={{ opacity: 0, scale: 0.5, x: 0, y: 40 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.2, 1.1, 0.35], x: [0, 0, 0, to.x], y: [40, 0, 0, to.y] }}
      transition={{ duration: 1.4, times: [0, 0.2, 0.7, 1], ease: 'easeInOut' }}
    >
      <Burst preset={plus ? 'rise' : 'fall'} />
      {isCard(fx.sourceId) && <Card id={fx.sourceId} size="xs" noPreview />}
      <div>
        <small>{fx.label}</small>
        <b>{fx.amount}</b>
      </div>
    </motion.div>
  );
}

/** A shield over a player: 自闭 / 备受瞩目 / 遗世独立 stopped a change. */
export function BlockFx({ fx }: { fx: Extract<Fx, { type: 'block' }> }) {
  const p = usePlayer(fx.playerId);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-seat-id="${fx.playerId}"]`) ?? document.querySelector('.myarea__stats');
    const r = el?.getBoundingClientRect();
    setAt(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight - 160 });
  }, []);
  useEffect(() => sfx('shield'), []);
  if (!at) return null;
  const below = at.y < window.innerHeight * 0.55;
  return (
    <motion.div className={`fx__seatfx fx__block ${below ? 'is-below' : 'is-above'}`} style={{ left: at.x, top: at.y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <Burst preset="shield" />
      <motion.div className="blockplate" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
        <span className="blockplate__icon">🛡</span>
        {isCard(fx.sourceId) && <Card id={fx.sourceId} size="xs" noPreview />}
        <div>
          <small>{p?.name}</small>
          <b>{fx.label}</b>
          <span>{fx.text}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
