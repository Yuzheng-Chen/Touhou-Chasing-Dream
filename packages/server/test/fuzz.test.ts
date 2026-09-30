import { ACTION_CARDS, EVENT_CARDS, OFFICIAL_CARDS, ROLE_CARDS } from '@tcd/shared';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/Game.js';
import { runGame } from '../src/engine/flow.js';
import { Rng } from '../src/engine/rng.js';

function play(players: number, seed: number, extra: Partial<ConstructorParameters<typeof Game>[1]> = {}) {
  const seats = Array.from({ length: players }, (_, i) => ({ id: `b${i}`, name: `Bot${i}`, isBot: true }));
  const g = new Game(seats, { seed, promptTimeout: 0, botDelay: 0, roleChoices: 3, fast: true, ...extra });
  return g;
}

/** Run a game, capturing engine errors (handler exceptions are swallowed by flow.safely and logged). */
async function run(g: Game) {
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' '));
  try {
    await runGame(g);
  } finally {
    console.error = orig;
  }
  return errors;
}

function invariants(g: Game) {
  expect(g.s.phase).toBe('finished');
  expect(Math.abs(g.s.community)).toBeLessThanOrEqual(10);
  for (const p of g.players) {
    expect(Math.abs(p.influence)).toBeLessThanOrEqual(g.influenceCap(p));
    expect(p.hand.length).toBeGreaterThanOrEqual(0);
  }
  const uids = [
    ...g.s.actionDeck, ...g.s.actionDiscard, ...g.s.delayZone.map((d) => d.card),
    ...g.players.flatMap((p) => [...p.hand, ...p.oshi, ...p.pendingGift]),
  ].map((c) => c.uid);
  expect(new Set(uids).size).toBe(uids.length);
  expect(uids.length).toBe(ACTION_CARDS.reduce((n, c) => n + c.count, 0));
}

describe('role fuzzing', () => {
  // Every role, face-down and face-up, in a few table sizes — passives only run when revealed.
  for (const role of ROLE_CARDS) {
    it(`${role.name} survives full games`, async () => {
      for (const revealRoles of [false, true]) {
        for (let seed = 1; seed <= 6; seed++) {
          const players = 3 + ((seed + role.id.length) % 6); // 3..8
          const rng = new Rng(seed * 31 + role.id.length);
          const others = rng.shuffle(ROLE_CARDS.filter((r) => r.id !== role.id).map((r) => r.id));
          const g = play(players, seed * 977 + 13, { roles: [role.id, ...others], revealRoles });
          const errors = await run(g);
          expect(errors, `seed ${g.s.seed} players ${players} reveal ${revealRoles}: ${errors[0]}`).toEqual([]);
          invariants(g);
        }
      }
    }, 60_000);
  }
});

describe('reachability', () => {
  it('bots reach every action, event and official card across many games', async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const g = play(3 + (seed % 6), seed * 131);
      const errors = await run(g);
      expect(errors, `seed ${g.s.seed}: ${errors[0]}`).toEqual([]);
      for (const e of g.s.log) for (const m of e.text.matchAll(/\{c:([a-z_0-9]+)\}/g)) seen.add(m[1]);
    }
    const missing = [...ACTION_CARDS, ...EVENT_CARDS, ...OFFICIAL_CARDS].map((c) => c.id).filter((id) => !seen.has(id));
    expect(missing, `never appeared in any game log: ${missing.join(', ')}`).toEqual([]);
  }, 120_000);
});
