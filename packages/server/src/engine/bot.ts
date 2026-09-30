import type { Prompt } from '@tcd/shared';
import type { Game } from './Game.js';
import { factionOf } from './scoring.js';
import type { PlayerState } from './state.js';

/**
 * A light-weight heuristic bot. It knows its faction (which way 社群规模 should go), values cards by
 * how useful they are to hold, and scores event directions by reading their effect text.
 * Good enough to fill seats, take over for absent players (托管) and fuzz the engine; a stronger
 * policy can replace this without touching the engine.
 */

/** Rough value of keeping a card in hand (higher = keep). */
const KEEP: Record<string, number> = {
  expose: 6, murphy: 5, create: 5, profit: 5, befriend: 4, commission: 4, mutual_praise: 4, preempt: 4,
  fan_flames: 3, human_nature: 3, insider: 3, preach: 3, meme: 2, freeload: 2, leak: 2, versus: 2,
  police: 2, meetup: 2, rumor: 1, flame: 1, crowdfund: 1, mars: 1,
};
const keep = (defId: string) => KEEP[defId] ?? 2;

/** Cards worth playing proactively, best first. */
const PLAY_ORDER = ['create', 'profit', 'befriend', 'commission', 'mutual_praise', 'preach', 'meme', 'freeload', 'insider',
  'preempt', 'fan_flames', 'meetup', 'police', 'rumor', 'versus', 'flame', 'crowdfund', 'leak', 'mars', 'human_nature'];

const HARMFUL = new Set(['rumor', 'police', 'expose', 'flame', 'crackdown']);
const FRIENDLY = new Set(['befriend', 'mutual_praise', 'commission', 'meme', 'meetup']);

const NUM: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3 };
const num = (s: string) => NUM[s] ?? Number(s);

/** Estimate how good an effect text is for me (+ = good). */
export function scoreEffect(text: string, prosper: boolean): number {
  let s = 0;
  for (const m of text.matchAll(/社群规模([+-])(\d+)/g)) s += (m[1] === '+' ? 1 : -1) * Number(m[2]) * (prosper ? 1 : -1);
  for (const m of text.matchAll(/个人影响力([+-])(\d+)/g)) s += (m[1] === '+' ? 1 : -1) * Number(m[2]) * 1.6;
  for (const m of text.matchAll(/弃(?:置)?([一两二三\d]+)张手牌/g)) s -= num(m[1]) * 0.8;
  for (const m of text.matchAll(/抽([一两二三四\d]+)张行动牌/g)) s += num(m[1]) * 0.9;
  return s;
}

function prosperous(g: Game, me: PlayerState): boolean {
  const f = me.role ? factionOf(g, me) : null; // no role yet during role selection
  if (!me.role) return true;
  if (f) return f.stance === 'prosper';
  return g.s.community >= 0; // neutral with no faction yet: drift with the table
}

/** Never throws: a bot bug must not freeze a live table, so fall back to the prompt's safe default. */
export function botAnswer(g: Game, me: PlayerState, p: Prompt): unknown {
  try {
    return decide(g, me, p);
  } catch (e) {
    console.error('[bot] policy error, using default answer:', e);
    return p.defaultValue;
  }
}

function decide(g: Game, me: PlayerState, p: Prompt): unknown {
  const r = g.rng;
  const prosper = prosperous(g, me);
  switch (p.kind) {
    case 'turn': {
      const played = g.s.turn?.actionsPlayed ?? 0;
      const limit = g.handLimit(me);
      const over = limit !== null && me.hand.length > limit;
      const candidates = p.moves
        .map((m, index) => ({ m, index }))
        .filter(({ m }) => m.uid !== undefined)
        .map((x) => {
          const id = me.hand.find((c) => c.uid === x.m.uid)?.defId ?? '';
          const as = x.m.as ?? id;
          const rank = PLAY_ORDER.indexOf(as);
          // Hold reaction cards unless the hand is overflowing; alt plays (当作X) burn the least valuable card.
          let w = rank < 0 ? 0 : 30 - rank;
          if (as === 'expose' && !over) w = -1;
          if (x.m.via) w += 2 - keep(id);
          return { ...x, w };
        })
        .filter((x) => x.w > 0 || over)
        .sort((a, b) => b.w - a.w);
      const skill = p.moves.findIndex((m) => m.skill && ['promote', 'yakumaru', 'follow', 'sidetake', 'reveal2', 'hatsune'].includes(m.skill));
      if (skill >= 0 && r.next() < 0.5) return { type: 'move', index: skill };
      if (!candidates.length || played >= 4 || (!over && r.next() < 0.18 + played * 0.12)) return { type: 'end' };
      return { type: 'move', index: candidates[r.next() < 0.75 ? 0 : r.int(candidates.length)].index };
    }
    case 'choice': {
      const opts = p.options.filter((o) => !o.disabled);
      // ± choices: steer 社群规模 toward my faction.
      if (opts.some((o) => o.value === '+') && opts.some((o) => o.value === '-')) return prosper ? '+' : '-';
      // Event direction and other options that carry effect text.
      if (opts.every((o) => o.hint !== undefined) && opts.length > 1) {
        const scored = opts.map((o) => ({ o, s: scoreEffect(o.hint!, prosper) + r.next() * 0.4 }));
        return scored.sort((a, b) => b.s - a.s)[0].o.value;
      }
      const yes = opts.find((o) => o.value === 'yes');
      if (yes && opts.some((o) => o.value === 'no')) return r.next() < 0.6 ? 'yes' : 'no';
      const good = opts.filter((o) => o.tone === 'good' || o.tone === 'primary');
      if (good.length && r.next() < 0.6) return r.pick(good).value;
      return r.pick(opts).value;
    }
    case 'players': {
      const n = p.min + r.int(p.max - p.min + 1);
      const others = p.candidates.filter((id) => id !== me.id);
      let pool = [...p.candidates];
      if (p.cardId && HARMFUL.has(p.cardId) && others.length) {
        // Hit whoever is ahead.
        pool = others.sort((a, b) => g.player(b).influence - g.player(a).influence);
        return pool.slice(0, n);
      }
      if (p.cardId && FRIENDLY.has(p.cardId) && others.length) {
        pool = others.sort((a, b) => g.player(b).hand.length - g.player(a).hand.length);
        return r.shuffle(pool.slice(0, 2)).slice(0, n);
      }
      return r.shuffle(pool).slice(0, n);
    }
    case 'cards': {
      const n = p.min + (p.max > p.min && r.next() < 0.3 ? 1 : 0);
      const cards = p.source === 'hand' ? [...p.cards].sort((a, b) => keep(a.defId) - keep(b.defId)) : r.shuffle([...p.cards]);
      return cards.slice(0, Math.min(n, p.max)).map((c) => c.uid);
    }
    case 'number':
      return p.min + r.int(p.max - p.min + 1);
    case 'order':
      return r.shuffle(p.cards.map((c) => c.uid));
  }
}
