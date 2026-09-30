import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/Game.js';

const humans = (timeoutMs: number) =>
  new Game(['a', 'b', 'c'].map((id) => ({ id, name: id, isBot: false })), { promptTimeout: timeoutMs, botDelay: 0, roleChoices: 3, fast: true });

const number = (g: Game, id: string) => g.ask(g.player(id), { kind: 'number', title: 'n', min: 0, max: 5, defaultValue: 0 });

describe('托管 (auto-play)', () => {
  it('two timed-out prompts in a row hand the seat to a bot, which then answers without waiting', async () => {
    const g = humans(15);
    expect(await number(g, 'a')).toBe(0); // timed out → default
    expect(g.player('a').auto).toBe(false);
    expect(await number(g, 'a')).toBe(0);
    expect(g.player('a').auto).toBe(true);
    const t0 = Date.now();
    const v = await number(g, 'a'); // bot answers at once (fast mode), no 15 ms timeout needed
    expect(v).toBeGreaterThanOrEqual(0);
    expect(Date.now() - t0).toBeLessThan(15);
  });

  it('acting yourself resets the timeout streak; answering takes the seat back', async () => {
    const g = humans(30);
    await number(g, 'b'); // one timeout
    const pending = number(g, 'b');
    const prompt = g.promptFor('b')!;
    expect(g.answer('b', prompt.id, 3)).toBe(true);
    expect(await pending).toBe(3);
    expect(g.player('b').timeouts).toBe(0);
    await number(g, 'b');
    expect(g.player('b').auto).toBe(false); // only one timeout since the answer

    g.setAuto('b', true);
    const p2 = number(g, 'b');
    await p2;
    expect(g.player('b').auto).toBe(true);
    g.setAuto('b', false);
    expect(g.player('b').auto).toBe(false);
  });

  it('setAuto resolves a prompt that is already waiting on that player', async () => {
    const g = humans(0); // no timeout: would wait forever
    const pending = number(g, 'c');
    expect(g.promptFor('c')).not.toBeNull();
    g.setAuto('c', true);
    await expect(pending).resolves.toBeGreaterThanOrEqual(0);
    expect(g.promptFor('c')).toBeNull();
  });

  it('never applies to AI seats', () => {
    const g = new Game([{ id: 'x', name: 'x', isBot: true }, { id: 'y', name: 'y', isBot: false }, { id: 'z', name: 'z', isBot: false }], { promptTimeout: 0, botDelay: 0, roleChoices: 3 });
    g.setAuto('x', true);
    expect(g.player('x').auto).toBe(false);
  });
});
