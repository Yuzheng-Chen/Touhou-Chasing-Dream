import type { Prompt } from '@tcd/shared';
import type { Game } from './Game.js';
import type { PlayerState } from './state.js';

/**
 * A light-weight random-but-sane bot. Good enough to fill seats for testing and to fuzz the
 * engine; a smarter policy can replace this without touching the engine.
 */
export function botAnswer(g: Game, me: PlayerState, p: Prompt): unknown {
  const r = g.rng;
  switch (p.kind) {
    case 'turn': {
      const played = g.s.turn?.actionsPlayed ?? 0;
      if (!p.moves.length || r.next() < 0.25 + played * 0.15) return { type: 'end' };
      return { type: 'move', index: r.int(p.moves.length) };
    }
    case 'choice': {
      const opts = p.options.filter((o) => !o.disabled);
      // Prefer "good" options a bit; decline optional skills half the time.
      const good = opts.filter((o) => o.tone === 'good' || o.tone === 'primary');
      if (good.length && r.next() < 0.55) return r.pick(good).value;
      return r.pick(opts).value;
    }
    case 'players': {
      const n = p.min + r.int(p.max - p.min + 1);
      return r.shuffle([...p.candidates]).slice(0, n);
    }
    case 'cards': {
      const n = p.min + (r.next() < 0.7 ? 0 : r.int(p.max - p.min + 1));
      return r.shuffle([...p.cards]).slice(0, n).map((c) => c.uid);
    }
    case 'number':
      return p.min + r.int(p.max - p.min + 1);
    case 'order':
      return r.shuffle(p.cards.map((c) => c.uid));
  }
  void me;
}
