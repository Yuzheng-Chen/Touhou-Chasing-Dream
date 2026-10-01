import { cardDef, type Fx } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { sfx } from '../../audio';
import { Card, CardBack } from '../../cards/Card';
import { useStore, type Flight } from '../../store';
import { playerColor } from '../../ui/colors';
import { offsetOf, seatOrigin, usePlayer } from './common';

/** Cards travelling across the table: draws, hand-to-hand transfers, discards. */

export function Flights() {
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
    const t = setTimeout(() => end(f.id), 1500);
    return () => clearTimeout(t);
  }, []);

  if (!pts) return null;
  const n = Math.min(4, f.n);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <motion.div
          key={i}
          className="fx__flight"
          initial={{ left: pts.a.x, top: pts.a.y, opacity: 0, scale: 0.8, rotate: -10 }}
          animate={{ left: pts.b.x, top: pts.b.y, opacity: [0, 1, 1, 0], scale: [0.8, 1.1, 0.95, 0.5], rotate: [-10, 6, 0, 0] }}
          transition={{ duration: 0.9, delay: i * 0.14, ease: [0.22, 1, 0.36, 1] }}
        >
          <CardBack kind="action" size="sm" />
        </motion.div>
      ))}
    </>
  );
}

/** Discarded cards fly (face up — the discard pile is public) from the player to the pile. */
export function DiscardFx({ fx }: { fx: Extract<Fx, { type: 'discard' }> }) {
  const p = usePlayer(fx.playerId);
  const from = useMemo(() => seatOrigin(fx.playerId), []);
  const cards = fx.cardIds.slice(0, 5);
  const targets = useMemo(
    () => cards.map((id) => offsetOf(document.querySelector(cardDef(id).kind === 'event' ? '.zones .zone:nth-child(2)' : '.zones .zone:nth-child(1)')) ?? { x: 0, y: 0 }),
    [],
  );
  useEffect(() => sfx('whoosh'), []);
  return (
    <motion.div className="fx__discard" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="fx__discardtag" style={{ left: from.x, top: from.y - 70 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, -8] }} transition={{ duration: 1.1, times: [0, 0.15, 0.7, 1] }}>
        <b style={{ color: p ? playerColor(p.seat) : undefined }}>{p?.name}</b> 弃置 {fx.cardIds.length} 张
      </motion.div>
      {cards.map((id, i) => (
        <motion.div
          key={i}
          className="fx__discardcard"
          initial={{ x: from.x + (i - (cards.length - 1) / 2) * 40, y: from.y, scale: 0.9, opacity: 0, rotate: (i - 2) * 6 }}
          animate={{ x: targets[i].x, y: targets[i].y, scale: 0.7, opacity: [0, 1, 1, 0.9], rotate: 0 }}
          transition={{ delay: 0.25 + i * 0.1, duration: 0.7, ease: [0.5, 0, 0.75, 0.2], opacity: { duration: 0.7, times: [0, 0.2, 0.8, 1] } }}
        >
          <Card id={id} size="sm" noPreview />
        </motion.div>
      ))}
    </motion.div>
  );
}

/** Falling confetti for winners (compositor-only: transform + opacity). */
export function Confetti({ n = 70 }: { n?: number }) {
  const bits = useMemo(
    () => Array.from({ length: n }, (_, i) => ({
      x: Math.random() * 100,
      d: 3.2 + Math.random() * 2.6,
      delay: Math.random() * 2.2,
      c: ['#f3d58a', '#f06a5d', '#58c28f', '#9aa2ff', '#f2a7bb'][i % 5],
      w: 6 + Math.random() * 6,
      r: Math.random() * 360,
    })),
    [n],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.x}%`, width: b.w, height: b.w * 1.6, background: b.c, animationDuration: `${b.d}s`, animationDelay: `${b.delay}s`, transform: `rotate(${b.r}deg)` }} />
      ))}
    </div>
  );
}
