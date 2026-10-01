import { cardDef, type Fx } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { sfx } from '../../audio';
import { Card } from '../../cards/Card';
import { useStore } from '../../store';
import { playerColor } from '../../ui/colors';
import { Burst } from '../Burst';
import { usePlayer } from './common';

/** Big announcements: official cards, forced events, whose turn it is, the new round. */

/** The effect text of a card, for reading out loud. */
function describe(id: string): string {
  const d = cardDef(id);
  switch (d.kind) {
    case 'action':
    case 'official':
      return d.text;
    case 'event':
      return d.down === undefined ? d.up : `正向：${d.up}　逆向：${d.down}`;
    case 'role':
      return [...d.active, ...d.passive].map((s) => `${s.name}：${s.text}`).join('　');
  }
}

export function Banner({ cardId, playerId, caption, tone, big, sound }: { cardId: string; playerId?: string; caption: string; tone: string; big?: boolean; sound: 'event' | 'official' }) {
  const p = usePlayer(playerId);
  useEffect(() => sfx(sound), []);
  const d = cardDef(cardId);
  return (
    <motion.div className={`fx__banner fx__banner--${tone}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <motion.div className="fx__ribbon" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} exit={{ scaleX: 0 }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }} />
      {(tone === 'up' || tone === 'down') && <Burst preset={tone === 'up' ? 'rise' : 'fall'} />}
      {tone === 'official' && <Burst preset="sparkle" />}
      <motion.div initial={{ rotateY: 100, scale: 0.8 }} animate={{ rotateY: 0, scale: 1 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
        <Card id={cardId} size={big ? 'xl' : 'lg'} noPreview />
      </motion.div>
      <motion.div className="fx__bannertext" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        {p && <b style={{ color: playerColor(p.seat) }}>{p.name}</b>}
        <span>{caption}</span>
        {d.kind === 'official' && d.subtitle && <em>{d.subtitle}</em>}
        <p className="fx__bannerdesc">{describe(cardId)}</p>
      </motion.div>
    </motion.div>
  );
}

/** A sweeping band: whose turn begins. Yours is gold and big; the others' carry their colour. */
export function TurnFx({ fx }: { fx: Extract<Fx, { type: 'turn' }> }) {
  const p = usePlayer(fx.playerId);
  const mine = useStore((s) => s.playerId === fx.playerId);
  useEffect(() => sfx(mine ? 'turn' : 'click'), []);
  return (
    <motion.div className={`fx__turn ${mine ? 'is-mine' : ''}`} style={{ ['--seat' as string]: p ? playerColor(p.seat) : undefined }} initial={{ opacity: 0, x: -140 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 140 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      <small>第 {fx.round} 轮</small>
      <span>{mine ? '你的回合' : `${p?.name ?? ''} 的回合`}</span>
    </motion.div>
  );
}

/** "第 3 轮" with the end-of-game countdown (officials in the discard pile). */
export function RoundFx({ fx }: { fx: Extract<Fx, { type: 'round' }> }) {
  const done = useStore((s) => s.game?.discards.official.length ?? 0);
  useEffect(() => sfx('official'), []);
  return (
    <motion.div className="fx__round" initial={{ opacity: 0, scale: 1.3 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <motion.i className="fx__roundline" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, delay: 0.1 }} />
      <b>第 {fx.round} 轮</b>
      <span className="fx__roundpips" title="官作弃牌堆达到这个数量时，进入最终结算">
        {Array.from({ length: fx.total }, (_, i) => <i key={i} className={i < done ? 'is-on' : ''} />)}
      </span>
      <small>终局倒计时　官作弃牌 {done} / {fx.total}</small>
    </motion.div>
  );
}
