/**
 * Headless bot-vs-bot simulator for balance checks and engine fuzzing.
 *   npm run sim -w @tcd/server -- [games=50] [players=5]
 */
import { roleDef } from '@tcd/shared';
import { Game } from './engine/Game.js';
import { runGame } from './engine/flow.js';

const games = Number(process.argv[2] ?? 50);
const players = Number(process.argv[3] ?? 5);
const wins = new Map<string, { played: number; won: number }>();
let rounds = 0;
const t0 = Date.now();

for (let i = 0; i < games; i++) {
  const seats = Array.from({ length: players }, (_, k) => ({ id: `b${k}`, name: `Bot${k}`, isBot: true }));
  const g = new Game(seats, { seed: 1000 + i, promptTimeout: 0, botDelay: 0, roleChoices: 3, fast: true });
  const g0 = Date.now();
  await runGame(g);
  rounds += g.s.round;
  for (const l of g.s.result!.lines) {
    const w = wins.get(l.roleId) ?? { played: 0, won: 0 };
    w.played++;
    if (l.victoryPoints === 2) w.won++;
    wins.set(l.roleId, w);
  }
  if (Date.now() - g0 > 3000) console.warn(`slow game seed=${g.s.seed}: ${Date.now() - g0}ms, ${g.s.logSeq} log lines`);
}

console.log(`${games} games × ${players}p in ${((Date.now() - t0) / 1000).toFixed(1)}s, avg ${(rounds / games).toFixed(1)} rounds`);
console.table(
  [...wins.entries()]
    .map(([id, w]) => ({ role: roleDef(id).name, played: w.played, winRate: `${((100 * w.won) / w.played).toFixed(0)}%` }))
    .sort((a, b) => parseInt(b.winRate) - parseInt(a.winRate)),
);
