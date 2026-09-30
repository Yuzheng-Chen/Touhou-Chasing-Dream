import { ACTION_CARDS, EVENT_CARDS, OFFICIAL_CARDS } from '@tcd/shared';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/Game.js';
import { runGame } from '../src/engine/flow.js';

const total = (defs: { count: number }[]) => defs.reduce((n, d) => n + d.count, 0);

function botGame(players: number, seed: number) {
  const seats = Array.from({ length: players }, (_, i) => ({ id: `b${i}`, name: `Bot${i}`, isBot: true }));
  return new Game(seats, { seed, promptTimeout: 0, botDelay: 0, roleChoices: 3, fast: true });
}

/** Every physical card is somewhere exactly once. */
function assertConservation(g: Game) {
  const s = g.s;
  const actions = [
    ...s.actionDeck, ...s.actionDiscard, ...s.delayZone.map((d) => d.card),
    ...s.players.flatMap((p) => [...p.hand, ...p.oshi, ...p.pendingGift]),
  ];
  const events = [
    ...s.eventDeck, ...s.eventDiscard, ...s.chainZone,
    ...s.players.flatMap((p) => [...p.statuses.map((x) => x.card), ...(p.faceDownEvent ? [p.faceDownEvent] : []), ...(p.turnEvent ? [p.turnEvent] : [])]),
  ];
  const officials = [...s.officialDeck, ...s.officialDiscard];
  expect(new Set(actions.map((c) => c.uid)).size).toBe(actions.length);
  expect(actions.length).toBe(total(ACTION_CARDS));
  expect(new Set(events.map((c) => c.uid)).size).toBe(events.length);
  expect(events.length).toBe(total(EVENT_CARDS));
  expect(new Set(officials.map((c) => c.uid)).size).toBe(total(OFFICIAL_CARDS));
}

describe('bot simulations', () => {
  for (const players of [3, 4, 5, 6, 8]) {
    it(`completes ${players}-player games without errors`, async () => {
      for (let seed = 1; seed <= 25; seed++) {
        const g = botGame(players, seed * 7919 + players);
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '));
        try {
          await runGame(g);
        } finally {
          console.error = orig;
        }
        expect(errors, `seed ${g.s.seed}: ${errors[0]}`).toEqual([]);
        expect(g.s.phase).toBe('finished');
        expect(g.s.result?.lines.length).toBe(players);
        expect(Math.abs(g.s.community)).toBeLessThanOrEqual(10);
        for (const p of g.s.players) expect(Math.abs(p.influence)).toBeLessThanOrEqual(g.influenceCap(p));
        assertConservation(g);
      }
    }, 60_000);
  }
});
