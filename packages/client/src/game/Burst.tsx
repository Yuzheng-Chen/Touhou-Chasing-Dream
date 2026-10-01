import { useMemo, type CSSProperties } from 'react';

/**
 * Card-specific particle effects. Pure CSS animations (transform/opacity only → composited on the GPU);
 * each particle gets randomised custom properties once. See fx.css for the keyframes.
 */
export type Preset =
  | 'sparkle' | 'rings' | 'coins' | 'flash' | 'siren' | 'smoke' | 'flames' | 'clash' | 'swap'
  | 'shield' | 'mirror' | 'bubbles' | 'paper' | 'rise' | 'fall' | 'pulse';

/** The effect each action card plays when it hits the table (by the card it is *treated as*). */
const BY_CARD: Record<string, Preset> = {
  create: 'sparkle', befriend: 'sparkle', mutual_praise: 'sparkle', commission: 'sparkle',
  preach: 'rings', crowdfund: 'coins', profit: 'coins',
  expose: 'flash', police: 'siren', rumor: 'smoke',
  flame: 'flames', fan_flames: 'flames', versus: 'clash',
  meetup: 'swap', freeload: 'swap', human_nature: 'swap',
  preempt: 'shield', murphy: 'mirror', meme: 'bubbles',
  insider: 'paper', leak: 'paper', mars: 'paper',
};

export const presetFor = (cardId: string): Preset => BY_CARD[cardId] ?? 'pulse';

const COUNT: Record<Preset, number> = {
  sparkle: 16, rings: 3, coins: 18, flash: 2, siren: 2, smoke: 9, flames: 18, clash: 8, swap: 2,
  shield: 3, mirror: 1, bubbles: 12, paper: 9, rise: 18, fall: 18, pulse: 2,
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function Burst({ preset }: { preset: Preset }) {
  const bits = useMemo(
    () => Array.from({ length: COUNT[preset] }, (_, i) => ({
      '--x': `${rnd(-170, 170)}px`,
      '--y': `${rnd(-190, 190)}px`,
      '--d': `${rnd(0.7, 1.3)}s`,
      '--dl': `${preset === 'rings' || preset === 'shield' ? i * 0.18 : rnd(0, 0.35)}s`,
      '--s': rnd(0.6, 1.4),
      '--r': `${rnd(-60, 60)}deg`,
      '--i': i,
    } as CSSProperties)),
    [preset],
  );
  return (
    <div className={`pfx pfx--${preset}`} aria-hidden>
      {bits.map((s, i) => <i key={i} style={s} />)}
    </div>
  );
}
