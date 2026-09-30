/**
 * Headless bot-vs-bot simulator for balance checks and engine fuzzing.
 *   npm run sim -w @tcd/server -- [games=50] [players=5]
 *
 * Reports: game length, how often a game has a winner, how often a faction scores, and per-role
 * victory-point rates (2 = won the game, 1 = scored). Bots are heuristic, not optimal — use the
 * numbers to spot roles that are broken or never win, not as a precise balance measure.
 */
import { roleDef } from '@tcd/shared';
import { Game } from './engine/Game.js';
import { runGame } from './engine/flow.js';

const games = Number(process.argv[2] ?? 50);
const players = Number(process.argv[3] ?? 5);
const roles = new Map<string, { played: number; won: number; scored: number }>();
let rounds = 0;
let noWinner = 0;
let scoring = 0;
const t0 = Date.now();

for (let i = 0; i < games; i++) {
  const seats = Array.from({ length: players }, (_, k) => ({ id: `b${k}`, name: `Bot${k}`, isBot: true }));
  const g = new Game(seats, { seed: 1000 + i, promptTimeout: 0, botDelay: 0, roleChoices: 3, fast: true });
  const g0 = Date.now();
  await runGame(g);
  rounds += g.s.round;
  const res = g.s.result!;
  if (!res.winnerIds.length) noWinner++;
  for (const l of res.lines) {
    const w = roles.get(l.roleId) ?? { played: 0, won: 0, scored: 0 };
    w.played++;
    if (res.winnerIds.includes(l.playerId)) w.won++;
    if (l.total > 0) {
      w.scored++;
      scoring++;
    }
    roles.set(l.roleId, w);
  }
  if (Date.now() - g0 > 3000) console.warn(`slow game seed=${g.s.seed}: ${Date.now() - g0}ms, ${g.s.logSeq} log lines`);
}

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
console.log(`${games} games × ${players}p in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`avg rounds ${(rounds / games).toFixed(1)} · games without a winner ${pct(noWinner, games)} · players scoring ${pct(scoring, games * players)}`);
console.table(
  [...roles.entries()]
    .map(([id, w]) => ({ role: roleDef(id).name, played: w.played, wins: pct(w.won, w.played), scoring: pct(w.scored, w.played) }))
    .sort((a, b) => parseInt(b.wins) - parseInt(a.wins)),
);
