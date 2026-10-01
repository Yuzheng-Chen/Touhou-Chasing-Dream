import { cardDef } from '@tcd/shared';
import { useStore } from '../../store';

/** Shared helpers for the effects layer. */

export function usePlayer(id: string | undefined) {
  return useStore((s) => (id ? s.game?.players.find((p) => p.id === id) : undefined));
}

export const nameOf = (id?: string) => {
  try {
    return id ? cardDef(id).name : '';
  } catch {
    return '';
  }
};

/** Does this id name a card (so it can be drawn as a little icon)? */
export const isCard = (id?: string): id is string => {
  try {
    return !!id && !!cardDef(id);
  } catch {
    return false;
  }
};

/** Centre of an element as an offset from the screen centre (where the effects layer puts things). */
export function offsetOf(el: Element | null | undefined) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - window.innerWidth / 2, y: r.top + r.height / 2 - window.innerHeight / 2 };
}

/** Where a player sits on screen (their seat, or your own area). */
export function seatOrigin(playerId: string) {
  const el = document.querySelector(`[data-seat-id="${playerId}"]`) ?? document.querySelector('.myarea__row') ?? document.querySelector('.myarea');
  return offsetOf(el) ?? { x: 0, y: 200 };
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** Expanding ring(s) — the shockwave behind an impact. */
export function Shock({ tone = 'gold', count = 2 }: { tone?: 'gold' | 'warm' | 'cool'; count?: number }) {
  return (
    <div className={`fx__shock fx__shock--${tone}`}>
      {Array.from({ length: count }, (_, i) => <i key={i} style={{ animationDelay: `${0.1 + i * 0.22}s` }} />)}
    </div>
  );
}
