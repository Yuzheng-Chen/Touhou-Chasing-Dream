import type { GameView, PlayerView } from '@tcd/shared';
import type { Game } from './Game.js';

/** Project the authoritative state into what `viewerId` may see (null = spectator). */
export function buildView(g: Game, viewerId: string | null, connected: (id: string) => boolean): GameView {
  const s = g.s;
  const finished = s.phase === 'finished';
  const isteki = g.officialActive('isc');
  const me = viewerId ? s.players.find((p) => p.id === viewerId) ?? null : null;

  const players: PlayerView[] = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    isBot: p.isBot,
    connected: p.isBot || connected(p.id),
    influence: p.influence,
    influenceCap: g.influenceCap(p),
    handCount: p.hand.length,
    handLimit: g.handLimit(p),
    role: p.roleRevealed || finished || p.id === viewerId ? p.role || null : null,
    roleRevealed: p.roleRevealed,
    allegiance: p.allegiance,
    idolId: p.idolId,
    hasFaceDownEvent: !!p.faceDownEvent,
    holdsTurnEvent: !!p.turnEvent,
    statuses: p.statuses.map((st) => ({ cardId: st.card.defId, label: st.label })),
    oshiCount: p.oshi.length,
  }));

  return {
    id: s.id,
    phase: s.phase,
    round: s.round,
    endThreshold: 12 - s.players.length,
    players,
    firstPlayerId: s.round ? s.players[s.firstIdx].id : null,
    currentPlayerId: g.current?.id ?? null,
    community: s.community,
    deckCounts: { action: s.actionDeck.length, event: s.eventDeck.length, official: s.officialDeck.length },
    deckTops: {
      action: isteki ? s.actionDeck.at(-1)?.defId ?? null : null,
      event: isteki ? s.eventDeck.at(-1)?.defId ?? null : null,
    },
    discards: {
      action: s.actionDiscard.slice(-30),
      event: s.eventDiscard.slice(-30),
      official: s.officialDiscard,
    },
    currentOfficial: s.currentOfficial,
    officialSuppressed: s.officialSuppressed,
    officialCopyOf: s.officialCopyOf,
    chainZone: s.chainZone,
    delayZone: s.delayZone.map((d) => ({ card: d.card, ownerId: d.ownerId })),
    log: s.log.slice(-150),
    me: me && {
      id: me.id,
      hand: me.hand,
      role: me.role || null,
      roleOptions: me.roleOptions,
      turnEvent: me.turnEvent,
      faceDownEvent: me.faceDownEvent,
      oshi: me.oshi,
    },
    prompt: viewerId ? g.promptFor(viewerId) : null,
    waitingOn: g.waitingOn(),
    result: s.result,
  };
}
