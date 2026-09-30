import { ACTION_CARDS } from './actions.js';
import { EVENT_CARDS } from './events.js';
import { OFFICIAL_CARDS } from './officials.js';
import { ROLE_CARDS } from './roles.js';
import type { ActionCardDef, CardDef, EventCardDef, OfficialCardDef, RoleCardDef } from './types.js';

export * from './types.js';
export * from './actions.js';
export * from './events.js';
export * from './officials.js';
export * from './roles.js';

export const ALL_CARDS: CardDef[] = [...ACTION_CARDS, ...EVENT_CARDS, ...OFFICIAL_CARDS, ...ROLE_CARDS];

const byId = new Map<string, CardDef>(ALL_CARDS.map((c) => [c.id, c]));
if (byId.size !== ALL_CARDS.length) throw new Error('Duplicate card id in catalogue');

export function cardDef(id: string): CardDef {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown card: ${id}`);
  return d;
}
export const actionDef = (id: string) => cardDef(id) as ActionCardDef;
export const eventDef = (id: string) => cardDef(id) as EventCardDef;
export const officialDef = (id: string) => cardDef(id) as OfficialCardDef;
export const roleDef = (id: string) => cardDef(id) as RoleCardDef;

/** Public URL of a card's illustration (served from client/public/art). */
export const cardArtUrl = (id: string) => `/art/cards/${id}.webp`;
