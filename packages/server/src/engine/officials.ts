import { officialDef } from '@tcd/shared';
import type { Game } from './Game.js';
import type { PlayerState } from './state.js';

/**
 * Flip official cards until one sticks as the current official.
 * 东方花映塚 goes straight to the discard pile; 东方凭依华 copies a discarded official of the revealer's choice.
 * Most other official effects are queried where they apply via `g.officialActive(id)`.
 */
export async function revealOfficial(g: Game, revealer: PlayerState) {
  for (;;) {
    const card = g.s.officialDeck.pop();
    if (!card) {
      g.log('官作牌堆已空', undefined, 'minor');
      return;
    }
    g.log(`官作发布：{c:${card.defId}}`, { type: 'official', cardId: card.defId }, 'round');
    await g.pause(900);
    if (card.defId === 'pofv') {
      g.s.officialDiscard.push(card);
      g.log('「东方花映塚」立即进入官作弃牌堆，再翻开一张官作牌', undefined, 'minor');
      continue;
    }
    g.s.currentOfficial = card;
    g.s.officialCopyOf = null;
    if (card.defId === 'aocf') {
      const pool = g.s.officialDiscard.filter((c) => c.defId !== 'aocf');
      if (pool.length) {
        const [pick] = await g.chooseFromList(revealer, '东方凭依华：指定官作弃牌堆中的一张官作牌，本牌效果视为与其相同', pool, 1, 1, { cardId: 'aocf' });
        g.s.officialCopyOf = pick.defId;
        g.log(`「东方凭依华」视为 {c:${pick.defId}}`);
      } else {
        g.log('「东方凭依华」是本局第一张官作牌，没有特殊效果', undefined, 'minor');
      }
    }
    g.touch();
    return;
  }
}

/** Official effects are simple enough to list for the UI's rules reference. */
export const officialName = (id: string) => officialDef(id).name;
