import { describe, expect, it } from 'vitest';
import { buildView } from '../src/engine/view.js';
import { giveCards, scriptedGame } from './harness.js';

/**
 * Hidden information: what one seat's view contains must never leak what another seat holds.
 * Uids are unique per physical card, so a string search of the serialised view is a precise leak detector.
 */
describe('per-player views', () => {
  function table() {
    const g = scriptedGame(4);
    g.players.forEach((p, i) => { p.role = ['evangelist', 'freeloader', 'anti_fan', 'hermit'][i]; });
    g.players[3].roleRevealed = true; // hermit starts face-up
    const hands = g.players.map((p) => giveCards(g, p, 'create', 'rumor'));
    g.players[1].turnEvent = g.newCard('calm');
    g.players[2].faceDownEvent = g.newCard('zun_visit');
    g.players[0].oshi.push(g.newCard('profit'));
    return { g, hands };
  }

  it('never reveals other players\' hands, turn events, face-down events or single-target cards', () => {
    const { g, hands } = table();
    for (let me = 0; me < 4; me++) {
      const json = JSON.stringify(buildView(g, g.players[me].id, () => true));
      for (let other = 0; other < 4; other++) {
        if (other === me) continue;
        for (const c of hands[other]) expect(json, `seat ${me} sees seat ${other}'s ${c.uid}`).not.toContain(`"${c.uid}"`);
        const p = g.players[other];
        if (p.turnEvent) expect(json).not.toContain(p.turnEvent.uid);
        if (p.faceDownEvent) expect(json).not.toContain(p.faceDownEvent.uid);
        for (const c of p.oshi) expect(json).not.toContain(c.uid);
      }
    }
  });

  it('shows roles only when face-up, to yourself, or after the game', () => {
    const { g } = table();
    const v = buildView(g, 'p0', () => true);
    expect(v.players.find((p) => p.id === 'p0')!.role).toBe('evangelist');
    expect(v.players.find((p) => p.id === 'p1')!.role).toBeNull();
    expect(v.players.find((p) => p.id === 'p2')!.role).toBeNull();
    expect(v.players.find((p) => p.id === 'p3')!.role).toBe('hermit');
    expect(v.me?.role).toBe('evangelist');

    g.s.phase = 'finished';
    const end = buildView(g, 'p0', () => true);
    expect(end.players.every((p) => p.role)).toBe(true);
  });

  it('gives spectators no private data at all', () => {
    const { g, hands } = table();
    const v = buildView(g, null, () => true);
    const json = JSON.stringify(v);
    expect(v.me).toBeNull();
    expect(v.prompt).toBeNull();
    for (const c of hands.flat()) expect(json).not.toContain(`"${c.uid}"`);
    expect(v.players.filter((p) => p.role).map((p) => p.id)).toEqual(['p3']);
  });

  it('routes each prompt only to the player it is addressed to', async () => {
    const g = scriptedGame(3, () => undefined);
    const p0 = g.player('p0');
    const pending = g.ask(p0, { kind: 'choice', title: 'secret', options: [{ value: 'a', label: 'A' }], defaultValue: 'a' }, { secret: true });
    expect(buildView(g, 'p0', () => true).prompt?.title).toBe('secret');
    expect(buildView(g, 'p1', () => true).prompt).toBeNull();
    expect(buildView(g, null, () => true).prompt).toBeNull();
    expect(buildView(g, 'p1', () => true).waitingOn).toEqual([]); // secret waits are invisible
    await pending;
  });

  it('rejects answers from the wrong player or for stale prompts', async () => {
    const g = scriptedGame(3, () => undefined);
    // Hold the bot/script answer by using a prompt the script cannot answer immediately.
    const g2 = new (g.constructor as typeof import('../src/engine/Game.js').Game)(
      g.players.map((p) => ({ id: p.id, name: p.name, isBot: false })),
      { promptTimeout: 0, botDelay: 0, roleChoices: 3 },
    );
    const pending = g2.ask(g2.player('p0'), { kind: 'number', title: 'n', min: 0, max: 3, defaultValue: 0 });
    const prompt = g2.promptFor('p0')!;
    expect(g2.answer('p1', prompt.id, 2)).toBe(false); // someone else's prompt
    expect(g2.answer('p0', 'nope', 2)).toBe(false); // unknown prompt
    expect(g2.answer('p0', prompt.id, 99)).toBe(false); // out of range
    expect(g2.answer('p0', prompt.id, 2)).toBe(true);
    expect(await pending).toBe(2);
    expect(g2.answer('p0', prompt.id, 2)).toBe(false); // already answered
  });
});
