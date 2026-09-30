import type { Prompt } from '@tcd/shared';
import { describe, expect, it } from 'vitest';
import { decideDirection, resolveEvent } from '../src/engine/events.js';
import { listMoves, playCard } from '../src/engine/flow.js';
import { revealOfficial } from '../src/engine/officials.js';
import { useSkill } from '../src/engine/roles.js';
import { scoreGame } from '../src/engine/scoring.js';
import type { Game } from '../src/engine/Game.js';
import type { PlayerState } from '../src/engine/state.js';
import { giveCards, scriptedGame, setOfficial, startTurn } from './harness.js';

/** Answer rules: first matching predicate wins; unmatched prompts fall back to the bot. */
type Rule = [(p: Prompt, who: PlayerState) => boolean, (p: Prompt, who: PlayerState) => unknown];
const script = (...rules: Rule[]) => (_g: Game, who: PlayerState, p: Prompt) => rules.find(([m]) => m(p, who))?.[1](p, who);
const choice = (value: string): Rule => [(p) => p.kind === 'choice' && p.options.some((o) => o.value === value), () => value];
const target = (id: string): Rule => [(p) => p.kind === 'players', () => [id]];
const fixedDie = (g: Game, face: number) => { g.rng.die = () => face; };
/** Pick the first n cards offered from the asking player's hand. */
const firstCards: Rule = [(p) => p.kind === 'cards', (p) => (p.kind === 'cards' ? p.cards.slice(0, Math.max(p.min, 1)).map((c) => c.uid) : [])];
const noCards: Rule = [(p) => p.kind === 'cards' && p.min === 0, () => []];

describe('action cards', () => {
  it('白嫖 takes a card from the target', async () => {
    const g = scriptedGame(3, script(target('p1')));
    const [a, b] = g.players;
    startTurn(g, a);
    const [c] = giveCards(g, a, 'freeload');
    giveCards(g, b, 'create', 'profit');
    await playCard(g, a, c.uid, 'freeload');
    expect(a.hand).toHaveLength(1);
    expect(b.hand).toHaveLength(1);
  });

  it('线下交流 swaps one card each and lets the user pick ±2', async () => {
    const g = scriptedGame(3, script(target('p1'), choice('+'), firstCards));
    const [a, b] = g.players;
    startTurn(g, a);
    const [m] = giveCards(g, a, 'meetup', 'create');
    giveCards(g, b, 'profit');
    await playCard(g, a, m.uid, 'meetup');
    expect(a.hand.map((c) => c.defId)).toEqual(['profit']);
    expect(b.hand.map((c) => c.defId)).toEqual(['create']);
    expect(g.s.community).toBe(2);
  });

  it('约稿 gives X cards and X influence to both; X may be 0', async () => {
    const g = scriptedGame(3, script(target('p1'), choice('+'), [(p) => p.kind === 'cards', (p) => (p.kind === 'cards' ? p.cards.map((c) => c.uid) : [])]));
    const [a, b] = g.players;
    startTurn(g, a);
    const [c] = giveCards(g, a, 'commission', 'create', 'profit');
    await playCard(g, a, c.uid, 'commission');
    expect(b.hand).toHaveLength(2);
    expect([a.influence, b.influence]).toEqual([2, 2]);
    expect(g.s.community).toBe(1);

    const g0 = scriptedGame(3, script(target('p1'), choice('+'), noCards));
    startTurn(g0, g0.players[0]);
    const [c0] = giveCards(g0, g0.players[0], 'commission');
    await playCard(g0, g0.players[0], c0.uid, 'commission');
    expect(g0.players[0].influence).toBe(0);
  });

  it('互撕: target loses 1, then players alternate discarding until someone stops', async () => {
    let asked = 0;
    const g = scriptedGame(3, script(
      target('p1'),
      [(p) => p.kind === 'cards', (p, who) => { asked++; return who.id === 'p1' && asked < 3 ? (p as Extract<Prompt, { kind: 'cards' }>).cards.slice(0, 1).map((c) => c.uid) : []; }],
    ));
    const [a, b] = g.players;
    startTurn(g, a);
    const [c] = giveCards(g, a, 'flame', 'create');
    giveCards(g, b, 'create', 'profit');
    await playCard(g, a, c.uid, 'flame');
    // -1 from the card, -1 from p1's single discard; p0 then declines.
    expect(a.influence).toBe(-1);
    expect(b.influence).toBe(-1);
    expect(b.hand).toHaveLength(1);
  });

  it('众筹: thresholds stack, and full participation cancels it', async () => {
    const join = (ids: string[]): Rule => [(p, who) => p.kind === 'cards' && ids.includes(who.id), (p) => (p as Extract<Prompt, { kind: 'cards' }>).cards.slice(0, 1).map((c) => c.uid)];
    const run = async (n: number, joiners: string[]) => {
      const g = scriptedGame(n, script(join(joiners), choice('+'), noCards));
      const [a, ...rest] = g.players;
      startTurn(g, a);
      const [c] = giveCards(g, a, 'crowdfund');
      for (const p of rest) giveCards(g, p, 'create');
      await playCard(g, a, c.uid, 'crowdfund');
      return g;
    };
    const one = await run(4, []);
    expect(one.players[0].influence).toBe(1);
    expect(one.s.community).toBe(0);
    const two = await run(4, ['p1']);
    expect(two.s.community).toBe(2);
    expect(two.players.slice(0, 2).map((p) => p.influence)).toEqual([1, 1]); // both funders +1 as well
    const three = await run(5, ['p1', 'p2']);
    expect(three.s.community).toBe(3);
    expect(three.players[1].hand).toHaveLength(1); // discarded 1, drew 1
    const all = await run(3, ['p1', 'p2']);
    expect(all.s.community).toBe(0);
    expect(all.players.map((p) => p.influence)).toEqual([0, 0, 0]);
  });

  it('联机对战 uses both increase/decrease rolls; 东方红魔乡 forbids judgement cards', async () => {
    const g = scriptedGame(3, script(target('p1'), choice('3')));
    fixedDie(g, 6);
    const [a] = g.players;
    startTurn(g, a);
    const [c] = giveCards(g, a, 'versus');
    await playCard(g, a, c.uid, 'versus');
    expect(g.s.community).toBe(3);

    const g2 = scriptedGame(3);
    setOfficial(g2, 'eosd');
    startTurn(g2, g2.players[0]);
    giveCards(g2, g2.players[0], 'expose', 'police', 'versus', 'create');
    const playable = listMoves(g2, g2.players[0]).filter((m) => m.uid).map((m) => g2.players[0].hand.find((h) => h.uid === m.uid)?.defId);
    expect(playable).toEqual(['create']);
  });

  it('出警: two-point roll scales both effects', async () => {
    const g = scriptedGame(3, script(target('p1'), choice('-')));
    fixedDie(g, 6); // → 2
    const [a, b] = g.players;
    startTurn(g, a);
    const [c] = giveCards(g, a, 'police');
    await playCard(g, a, c.uid, 'police');
    expect(b.influence).toBe(-2);
    expect(g.s.community).toBe(-2);
  });

  it('人类的本质 copies the last discarded action and is passed on instead of discarded', async () => {
    const g = scriptedGame(3);
    const [a, b] = g.players;
    startTurn(g, a);
    g.s.lastActionDiscarded = 'create';
    const [h] = giveCards(g, a, 'human_nature');
    const moves = listMoves(g, a);
    expect(moves.filter((m) => m.uid).map((m) => m.as)).toEqual(['create']);
    await playCard(g, a, h.uid, 'create');
    expect(a.influence).toBe(1);
    expect(b.pendingGift.map((c) => c.defId)).toEqual(['human_nature']);
    expect(g.s.actionDiscard.some((c) => c.defId === 'human_nature')).toBe(false);
  });

  it('人类的本质 copying a delay card is also passed on when it triggers', async () => {
    const g = scriptedGame(3);
    const [a, b] = g.players;
    startTurn(g, a);
    g.s.lastActionDiscarded = 'preempt';
    const [h] = giveCards(g, a, 'human_nature');
    await playCard(g, a, h.uid, 'preempt');
    expect(g.s.delayZone).toHaveLength(1);
    await resolveEvent(g, a, g.newCard('calm'), 'none');
    expect(g.s.community).toBe(0); // prevented
    expect(b.pendingGift.map((c) => c.defId)).toEqual(['human_nature']);
  });

  it('东方鬼形兽: the third card is a copy of the last discarded action', () => {
    const g = scriptedGame(3);
    setOfficial(g, 'wbawc');
    const [a] = g.players;
    startTurn(g, a);
    g.s.turn!.actionsPlayed = 2;
    g.s.lastActionDiscarded = 'create';
    giveCards(g, a, 'rumor', 'profit');
    expect(listMoves(g, a).filter((m) => m.uid).map((m) => m.as)).toEqual(['create', 'create']);
  });
});

describe('events and delay cards', () => {
  it('煽风点火 adds one to the next event\'s offsets; 事先科普 cannot stop 文化自信', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    const [fan] = giveCards(g, a, 'fan_flames');
    await playCard(g, a, fan.uid, 'fan_flames');
    await resolveEvent(g, a, g.newCard('calm'), 'none');
    expect(g.s.community).toBe(4);

    const g2 = scriptedGame(3);
    startTurn(g2, g2.players[0]);
    g2.s.community = 5;
    const [pre] = giveCards(g2, g2.players[0], 'preempt');
    await playCard(g2, g2.players[0], pre.uid, 'preempt');
    await resolveEvent(g2, g2.players[0], g2.newCard('cultural_confidence'), 'none');
    expect(g2.s.community).toBe(0);
  });

  it('墨菲定律 flips the direction once and costs its user 1 influence; it cannot answer itself', async () => {
    const g = scriptedGame(3, script(
      [(p) => p.kind === 'choice' && p.options.some((o) => o.value === 'up'), () => 'up'],
      [(p, who) => p.kind === 'choice' && p.options.some((o) => o.value === 'yes'), () => 'yes'],
    ));
    const [a, b, c] = g.players;
    giveCards(g, b, 'murphy');
    giveCards(g, c, 'murphy');
    const dir = await decideDirection(g, a, g.newCard('headline'));
    expect(dir).toBe('down');
    expect(b.influence).toBe(-1);
    expect(c.influence).toBe(0); // second murphy could not respond to the first
    expect(c.hand).toHaveLength(1);
  });

  it('社群意见领袖·最终解释权 overrides the direction for -1 influence', async () => {
    const g = scriptedGame(3, script(
      [(p) => p.kind === 'choice' && p.options.some((o) => o.value === 'up' && o.tone === 'primary' && o.label.includes('正向') && !o.hint), () => 'down'],
      [(p) => p.kind === 'choice' && p.options.some((o) => o.value === 'no'), () => 'down'],
      [(p) => p.kind === 'choice' && p.options.some((o) => o.value === 'up'), () => 'up'],
    ));
    const [a, b] = g.players;
    b.role = 'opinion_leader';
    const dir = await decideDirection(g, a, g.newCard('headline'));
    expect(dir).toBe('down');
    expect(b.influence).toBe(-1);
    expect(b.roleRevealed).toBe(true);
  });

  it('备受瞩目 locks influence (正: 2; 逆: hand size) until the next turn', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    await resolveEvent(g, a, g.newCard('spotlight'), 'up');
    expect(a.influence).toBe(2);
    await g.changeInfluence(a, -3, { cause: 'action' });
    expect(a.influence).toBe(2);

    const g2 = scriptedGame(3);
    startTurn(g2, g2.players[0]);
    giveCards(g2, g2.players[0], 'create', 'profit', 'rumor');
    await resolveEvent(g2, g2.players[0], g2.newCard('spotlight'), 'down');
    expect(g2.players[0].influence).toBe(3);
    await g2.discard(g2.players[0], [g2.players[0].hand[0]]);
    expect(g2.players[0].influence).toBe(2);
  });

  it('自闭 makes a player untargetable and immune to others\' events', async () => {
    const g = scriptedGame(3);
    const [a, b] = g.players;
    startTurn(g, b);
    await resolveEvent(g, b, g.newCard('withdrawn'), 'up');
    startTurn(g, a);
    await resolveEvent(g, a, g.newCard('kids_influx'), 'up'); // everyone -1
    expect(a.influence).toBe(-1);
    expect(b.influence).toBe(0);
    expect(g.targetable(b)).toBe(false);
  });

  it('遍地开花 (3rd) grants +5 and the extra draw; 逆向 does nothing', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    await resolveEvent(g, a, g.newCard('blooming'), 'up');
    await resolveEvent(g, a, g.newCard('blooming'), 'up');
    expect(g.s.community).toBe(2);
    expect(g.s.bloomingBonus).toBe(false);
    await resolveEvent(g, a, g.newCard('blooming'), 'up');
    expect(g.s.community).toBe(2 + 1 + 5);
    expect(g.s.bloomingBonus).toBe(true);
    const before = g.s.chainZone.length;
    await resolveEvent(g, a, g.newCard('blooming'), 'down');
    expect(g.s.chainZone).toHaveLength(before);
  });

  it('东方辉针城 doubles, 心绮楼 / 秘封噩梦日记 shift event offsets', async () => {
    const run = async (official: string) => {
      const g = scriptedGame(3);
      setOfficial(g, official);
      startTurn(g, g.players[0]);
      await resolveEvent(g, g.players[0], g.newCard('calm'), 'none'); // +3
      return g.s.community;
    };
    expect(await run('ddc')).toBe(6);
    expect(await run('hm')).toBe(2);
    expect(await run('vd')).toBe(4);
  });

  it('二轩目直播 repeats the last resolved event', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    await resolveEvent(g, a, g.newCard('calm'), 'none');
    await resolveEvent(g, a, g.newCard('nikenme'), 'up');
    expect(g.s.community).toBe(6);
  });

  it('开除圈籍 uses the absolute value of your influence', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    startTurn(g, a);
    a.influence = -3;
    await resolveEvent(g, a, g.newCard('expelled'), 'up');
    expect(g.s.community).toBe(3);
  });
});

describe('officials', () => {
  it('东方神灵庙 + 东方黑·自爆: influence floors at 0 but community drops the full 2X', async () => {
    const g = scriptedGame(3);
    setOfficial(g, 'td');
    const [a] = g.players;
    a.role = 'anti_fan';
    a.influence = 2;
    startTurn(g, a);
    (g as { opts: { decide?: unknown } }).opts.decide = script([(p) => p.kind === 'number', () => 5]);
    await useSkill(g, a, 'selfdestruct');
    expect(a.influence).toBe(0);
    expect(g.s.community).toBe(-10);
  });

  it('东方花映塚 goes straight to the discard pile and flips another; 凭依华 copies a discarded official', async () => {
    const g = scriptedGame(3, script([(p) => p.kind === 'cards', (p) => (p as Extract<Prompt, { kind: 'cards' }>).cards.slice(0, 1).map((c) => c.uid)]));
    g.s.officialDeck = [g.newCard('old_works'), g.newCard('pofv')];
    await revealOfficial(g, g.players[0]);
    expect(g.s.officialDiscard.map((c) => c.defId)).toEqual(['pofv']);
    expect(g.s.currentOfficial?.defId).toBe('old_works');

    g.s.currentOfficial = null;
    g.s.officialDeck = [g.newCard('aocf')];
    g.s.officialDiscard = [g.newCard('ddc')];
    await revealOfficial(g, g.players[0]);
    expect(g.officialActive('ddc')).toBe(true);
    expect(g.n(2)).toBe(4);
  });

  it('非想天则 ⇄ 绯想天 pair up through the discard pile', () => {
    const g = scriptedGame(3);
    setOfficial(g, 'swr');
    expect(g.officialActive('soku')).toBe(false);
    g.s.officialDiscard.push(g.newCard('soku'));
    expect(g.officialActive('soku')).toBe(true);
    g.s.officialSuppressed = true;
    expect(g.officialActive('swr')).toBe(false); // 连载完结
  });
});

describe('roles', () => {
  it('精英主义者·分层 cancels a big increase and pays back', async () => {
    const g = scriptedGame(3, script(choice('yes'), [(p) => p.kind === 'cards', (p) => (p as Extract<Prompt, { kind: 'cards' }>).cards.slice(0, (p as Extract<Prompt, { kind: 'cards' }>).min).map((c) => c.uid)], choice('+')));
    const [a, b] = g.players;
    a.role = 'elitist';
    startTurn(g, b);
    giveCards(g, a, 'create', 'profit', 'rumor');
    const [p] = giveCards(g, b, 'preach');
    await playCard(g, b, p.uid, 'preach'); // ±2 → wants +2 → cost 1 card
    expect(g.s.community).toBe(0);
    expect(a.hand.length).toBe(3 - 1 + 0); // paid 1, drew 0 (x = 0)
  });

  it('活动主办方·NPC softens a decrease and draws X−1', async () => {
    const g = scriptedGame(3, script(
      [(p) => p.kind === 'number', () => 2],
      [(p) => p.kind === 'cards', (p) => (p as Extract<Prompt, { kind: 'cards' }>).cards.slice(0, 2).map((c) => c.uid)],
    ));
    const [a] = g.players;
    a.role = 'organizer';
    startTurn(g, g.players[1]);
    giveCards(g, a, 'create', 'profit', 'rumor');
    await g.changeCommunity(-4, { cause: 'event' });
    expect(g.s.community).toBe(0);
    expect(a.hand).toHaveLength(2); // 3 − 2 + 1
  });

  it('桃源民·遗世独立 cancels another player\'s hit for one card', async () => {
    const g = scriptedGame(3, script(target('p1'), choice('yes'), firstCards));
    const [a, b] = g.players;
    b.role = 'hermit';
    startTurn(g, a);
    giveCards(g, b, 'create');
    const [r] = giveCards(g, a, 'rumor');
    await playCard(g, a, r.uid, 'rumor');
    expect(b.influence).toBe(0);
    expect(b.hand).toHaveLength(0);
    expect(a.influence).toBe(-1);
  });

  it('社团主催·社团运营 draws when 创作 raises influence, but not when already capped', async () => {
    const g = scriptedGame(3);
    const [a] = g.players;
    a.role = 'circle_host';
    a.roleRevealed = true;
    startTurn(g, a);
    const [c1, c2] = giveCards(g, a, 'create', 'create');
    await playCard(g, a, c1.uid, 'create');
    expect(a.hand).toHaveLength(1 + 1);
    a.influence = 5;
    await playCard(g, a, c2.uid, 'create');
    expect(a.hand).toHaveLength(1);
  });

  it('盈利抵制者·律人律己 adjusts influence for cards gained/lost off-turn', async () => {
    const g = scriptedGame(3, script(choice('no')));
    const [a, b] = g.players;
    a.role = 'anti_profit';
    a.roleRevealed = true;
    startTurn(g, b);
    await g.draw(a, 2);
    expect(a.influence).toBe(-2);
    await g.discard(a, [a.hand[0]]);
    expect(a.influence).toBe(-1);
  });

  it('反权威主义者·斥责垄断 only affects players with more influence', async () => {
    const g = scriptedGame(3, script(choice('inf')));
    const [a, b, c] = g.players;
    a.role = 'anti_authority';
    b.influence = 2;
    startTurn(g, a);
    giveCards(g, a, 'create', 'profit');
    (g as { opts: { decide?: unknown } }).opts.decide = script(choice('inf'), firstCards);
    await useSkill(g, a, 'denounce');
    expect(b.influence).toBe(0);
    expect(c.influence).toBe(0);
    expect(a.hand).toHaveLength(0);
  });
});

describe('scoring', () => {
  const setup = () => {
    const g = scriptedGame(5);
    const role = (i: number, r: string, inf: number, reveal = true) => {
      g.players[i].role = r;
      g.players[i].influence = inf;
      g.players[i].roleRevealed = reveal;
    };
    return { g, role };
  };

  it('平台运营者·双赢 and 悲观预言家·东方乙烷 take the larger value', () => {
    const { g, role } = setup();
    role(0, 'platform_op', 4);
    role(1, 'doomsayer', 1);
    role(2, 'evangelist', 0);
    role(3, 'freeloader', 0);
    role(4, 'passerby', 0, false);
    g.s.community = 6;
    let r = scoreGame(g);
    expect(r.lines.find((l) => l.playerId === 'p0')!.baseScore).toBe(6);
    expect(r.lines.find((l) => l.playerId === 'p1')!.won).toBe(false); // 小众 needs community ≤ 0
    g.s.community = -6;
    r = scoreGame(g);
    expect(r.lines.find((l) => l.playerId === 'p1')!.baseScore).toBe(6); // max(6, 1)
  });

  it('冷门爱好者·小众至高 wins with negative influence; other factions do not', () => {
    const { g, role } = setup();
    role(0, 'niche_lover', -3);
    role(1, 'researcher', -3); // also 个人·小众 but without the skill
    g.s.community = -2;
    const r = scoreGame(g);
    expect(r.lines.find((l) => l.playerId === 'p0')).toMatchObject({ won: true, baseScore: 3 });
    expect(r.lines.find((l) => l.playerId === 'p1')!.won).toBe(false);
  });

  it('狂热粉丝 scores as the idol\'s faction; 一般路过爱好者 as the declared one; unchosen neutrals never win', () => {
    const { g, role } = setup();
    role(0, 'zealot', 1);
    g.players[0].idolId = 'p1';
    role(1, 'freeloader', 3); // 个人·繁荣
    role(2, 'passerby', 2);
    g.players[2].allegiance = { stance: 'niche', focus: 'individual' };
    role(3, 'passerby', 5, false);
    g.s.community = -1;
    const r = scoreGame(g);
    const l = (id: string) => r.lines.find((x) => x.playerId === id)!;
    expect(l('p0').won).toBe(false); // prosper needs community ≥ 0
    expect(l('p2')).toMatchObject({ won: true, baseScore: 2 });
    expect(l('p3').won).toBe(false);
    g.s.community = 3;
    expect(scoreGame(g).lines.find((x) => x.playerId === 'p0')).toMatchObject({ won: true, baseScore: 1 });
  });

  it('地区王·本地共荣 adds points even without a win; ties go to higher influence', () => {
    const { g, role } = setup();
    role(0, 'local_king', -1); // neighbours: p4 and p1
    role(1, 'freeloader', 3);
    role(4, 'cosplayer', 1);
    role(2, 'anti_fan', 0);
    role(3, 'anti_fan', 0);
    g.s.community = 0;
    const r = scoreGame(g);
    const l = (id: string) => r.lines.find((x) => x.playerId === id)!;
    expect(l('p0')).toMatchObject({ won: false, bonus: 2, total: 2 });
    expect(l('p1').total).toBe(3);
    expect(r.winnerIds).toEqual(['p1']);
    expect(l('p0').victoryPoints).toBe(1);

    // tie on score → higher influence takes the 2 victory points
    g.players[1].influence = 2;
    g.players[4].influence = 2;
    g.players[0].role = 'passerby';
    g.players[0].roleRevealed = false;
    const t = scoreGame(g);
    expect(t.lines.find((x) => x.playerId === 'p1')!.total).toBe(2);
    expect(t.lines.find((x) => x.playerId === 'p4')!.total).toBe(2); // 个人·繁荣: base = influence
    expect(t.winnerIds.sort()).toEqual(['p1', 'p4']); // equal score and influence → both take 2 VP
  });
});
