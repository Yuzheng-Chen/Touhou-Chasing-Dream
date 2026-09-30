import { describe, expect, it } from 'vitest';
import { playCard } from '../src/engine/flow.js';
import { resolveEvent } from '../src/engine/events.js';
import { scoreGame } from '../src/engine/scoring.js';
import { giveCards, scriptedGame, setOfficial, startTurn } from './harness.js';

describe('action cards', () => {
  it('造谣 lowers target by 2 and the user by 1; 挂裱 reaction hits back for the same amount', async () => {
    const g = scriptedGame(3, (_g, who, p) => {
      if (p.kind === 'players') return ['p1'];
      if (p.kind === 'choice' && p.cardId === 'expose') return who.id === 'p1' ? 'yes' : 'no';
      return undefined;
    });
    const [a, b] = g.players;
    startTurn(g, a);
    const [rumor] = giveCards(g, a, 'rumor');
    giveCards(g, b, 'expose');
    await playCard(g, a, rumor.uid, 'rumor');
    expect(b.influence).toBe(-2);
    expect(a.influence).toBe(-1 - 2); // own cost, then 挂裱 reaction for 2
    expect(b.hand).toHaveLength(0);
  });

  it('东方神灵庙 keeps non-negative influence from dropping below 0', async () => {
    const g = scriptedGame(3, (_g, _w, p) => (p.kind === 'players' ? ['p1'] : p.kind === 'choice' ? 'no' : undefined));
    setOfficial(g, 'td');
    const [a, b] = g.players;
    startTurn(g, a);
    b.influence = 1;
    const [rumor] = giveCards(g, a, 'rumor');
    await playCard(g, a, rumor.uid, 'rumor');
    expect(b.influence).toBe(0);
    expect(a.influence).toBe(0);
  });

  it('东方辉针城 doubles printed numbers', async () => {
    const g = scriptedGame(3, (_g, _w, p) => (p.kind === 'choice' ? '+' : undefined));
    setOfficial(g, 'ddc');
    const [a] = g.players;
    startTurn(g, a);
    const [preach] = giveCards(g, a, 'preach');
    await playCard(g, a, preach.uid, 'preach');
    expect(g.s.community).toBe(4);
  });
});

describe('events', () => {
  it('事先科普 in the delay zone cancels the next event community change', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    const [pre] = giveCards(g, a, 'preempt');
    await playCard(g, a, pre.uid, 'preempt');
    expect(g.s.delayZone).toHaveLength(1);
    await resolveEvent(g, a, g.newCard('calm'), 'none'); // 社群规模+3
    expect(g.s.community).toBe(0);
    expect(g.s.delayZone).toHaveLength(0);
  });

  it('人气投票 grows with the chain zone', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    await resolveEvent(g, a, g.newCard('popularity_poll'), 'up');
    await resolveEvent(g, a, g.newCard('popularity_poll'), 'up');
    expect(g.s.community).toBe(1 + 2);
    expect(g.s.chainZone).toHaveLength(2);
  });
});

describe('scoring', () => {
  it('scores factions and awards victory points', () => {
    const g = scriptedGame(3);
    const [a, b, c] = g.players;
    a.role = 'evangelist'; // 社群·繁荣
    b.role = 'freeloader'; // 个人·繁荣
    c.role = 'anti_fan'; // 社群·小众
    g.s.community = 4;
    a.influence = 0;
    b.influence = 3;
    c.influence = 2;
    const r = scoreGame(g);
    const line = (id: string) => r.lines.find((l) => l.playerId === id)!;
    expect(line('p0').total).toBe(4);
    expect(line('p1').total).toBe(3);
    expect(line('p2').won).toBe(false);
    expect(r.winnerIds).toEqual(['p0']);
    expect(line('p1').victoryPoints).toBe(1);
  });
});
