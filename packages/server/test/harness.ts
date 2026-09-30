import type { Prompt } from '@tcd/shared';
import { Game } from '../src/engine/Game.js';
import type { PlayerState, TurnState } from '../src/engine/state.js';

export type Script = (g: Game, who: PlayerState, prompt: Prompt) => unknown;

/**
 * A game with `n` seats, fast mode, and every decision routed through `script`
 * (return undefined → random bot answer). Roles/hands are left empty for the test to arrange.
 */
export function scriptedGame(n: number, script: Script = () => undefined, seed = 1) {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));
  const g = new Game(seats, { seed, promptTimeout: 0, botDelay: 0, roleChoices: 3, fast: true, decide: script });
  for (const p of g.players) p.role = 'passerby';
  return g;
}

/** Put specific action cards into a player's hand (fresh uids). */
export function giveCards(g: Game, p: PlayerState, ...defIds: string[]) {
  const cards = defIds.map((d) => g.newCard(d));
  p.hand.push(...cards);
  return cards;
}

/** Start a bare turn for `p` so turn-scoped rules work. */
export function startTurn(g: Game, p: PlayerState) {
  g.s.turnIdx = p.seat;
  g.s.turn = {
    playerId: p.id, actionsPlayed: 0, handAtStart: p.hand.length, communityDecreased: false,
    gained: {}, influenceGain: {}, groupPlayed: [], uses: {}, skipDiscard: false, noHandLimit: false,
    loanActive: false, skipDraw: false, maxScoreOfficial: null, ended: false, marsEvent: false,
  } satisfies TurnState;
}

/** Make `defId` the current official card. */
export function setOfficial(g: Game, defId: string) {
  g.s.currentOfficial = g.newCard(defId);
}

/** Always answer choice prompts with the option whose label/value matches. */
export const pick = (match: string) => (p: Prompt) =>
  p.kind === 'choice' ? p.options.find((o) => o.value === match || o.label.includes(match))?.value : undefined;
