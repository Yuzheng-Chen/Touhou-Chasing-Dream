import { ACTION_CARDS } from './cards/actions.js';
import { EVENT_CARDS } from './cards/events.js';
import { OFFICIAL_CARDS } from './cards/officials.js';
import { cardDef } from './cards/index.js';
import type { CardDef } from './cards/types.js';

/**
 * Keyword explanations shown beside a hovered card (like Slay the Spire's keyword boxes).
 * Basics every player learns in a minute (手牌, 弃牌堆, 个人影响力, 社群规模, 抽牌/弃牌…) are deliberately absent.
 */
export interface Gloss {
  term: string;
  text: string;
  /** Set when the box explains another card the text refers to. */
  cardId?: string;
}

interface Term {
  term: string;
  /** Matches in the card's text. */
  pattern: RegExp;
  text: string;
}

const TERMS: Term[] = [
  { term: '真假判定', pattern: /真假判定|真假/, text: '掷骰：1、3、5 为「真」，2、4、6 为「假」。' },
  { term: '两点点数判定', pattern: /两点点数判定/, text: '掷骰：1–2 得 0，3–4 得 1，5–6 得 2。' },
  { term: '增减判定', pattern: /增减判定/, text: '掷骰：1→−3，2→−2，3→−1，4→+1，5→+2，6→+3。' },
  { term: '判定', pattern: /判定动作/, text: '掷一枚骰子，按判定种类得出结果（真假 / 两点点数 / 增减）。' },
  { term: '拼点', pattern: /拼点/, text: '双方比较骰子点数，点数大的一方获胜。' },
  { term: '±', pattern: /±/, text: '由发动者决定是增加还是减少。' },
  { term: '偏移量', pattern: /偏移量/, text: '效果数值的变化量。「偏移量+1」让增加的更多、减少的也更多（方向不变）。' },
  { term: '正向 / 逆向', pattern: /正向|逆向|发生方向/, text: '事件牌的两种发生方向。通常打出者决定；扣置的事件只能正向。' },
  { term: '无向', pattern: /无向/, text: '没有方向选择，打出就按牌面生效。' },
  { term: '扣置', pattern: /扣置/, text: '把事件牌盖在面前，之后再正向打出。已有扣置牌时，须先打出它才能扣置新的。扣置的牌不能被「选择方向」类效果影响，也算不上手牌。' },
  { term: '连锁事件', pattern: /连锁/, text: '打出后放入连锁事件区（不是弃牌堆），之后的同类事件会与它联动。' },
  { term: '群体', pattern: /群体/, text: '效果会影响所有玩家。' },
  { term: '延时', pattern: /延时/, text: '打出后先放在延时区，等下一张事件牌生效时才触发，然后进入弃牌堆。多张延时牌会一起按打出顺序结算。' },
  { term: '响应', pattern: /当任意玩家决定事件牌发生方向时|当其他玩家减少你的个人影响力时/, text: '不能在行动阶段主动打出，只能在满足条件的时机使用。' },
  { term: '交付', pattern: /交付|交给/, text: '把手牌交给对方（对方获得、你失去，会触发相关技能）。' },
  { term: '视作 / 当作', pattern: /视作|当作/, text: '按另一张牌的效果结算，原牌仍然是被打出的那张牌。' },
  { term: '相邻', pattern: /相邻/, text: '座位上紧挨着你的两位玩家（上一位和下一位）。' },
  { term: '左边 / 右边', pattern: /左边|右边/, text: '出牌顺序里，下一位玩家在你的左手边，上一位在右手边。' },
  { term: '锁定', pattern: /锁定/, text: '期间个人影响力不再被其他效果改变。' },
  { term: '单推牌', pattern: /单推牌/, text: '放在一边的牌：不算手牌，也不占手牌上限，之后可以取回。' },
  { term: '偶像', pattern: /偶像/, text: '狂热粉丝指定的玩家。粉丝的胜利条件与偶像相同。' },
  { term: '官作牌弃牌堆', pattern: /官作牌?弃牌堆|官作弃牌堆/, text: '本局已结束的官作牌。张数达到上限（默认 12 − 人数）时，本轮结束后进入最终结算。' },
  { term: '最终结算', pattern: /最终结算/, text: '游戏结束前：从最后一名玩家起逆时针，各自正向打出扣置的事件牌，期间不能用手牌和技能。' },
  { term: '正面向上', pattern: /正面向上|翻开.{0,6}角色/, text: '角色牌翻到正面即亮明身份。主动技能一发动就会翻开；被动技能只有翻开后才生效。' },
  { term: '个人影响力上限', pattern: /影响力上限/, text: '默认 ±5；部分角色能提高上限，下限随之变为其相反数。' },
  { term: '本回合事件牌', pattern: /本回合事件牌/, text: '回合开始时抽到的事件牌，在事件结算阶段打出或扣置。' },
];

/** Plain-language win conditions, shown for role cards. */
const FACTION: Record<string, Gloss> = {
  'prosper:community': { term: '社群 · 繁荣', text: '胜利：个人影响力 ≥ 0 且社群规模 ≥ 0。得分 = 社群规模。' },
  'prosper:individual': { term: '个人 · 繁荣', text: '胜利：个人影响力 ≥ 0 且社群规模 ≥ 0。得分 = 个人影响力。' },
  'niche:community': { term: '社群 · 小众', text: '胜利：个人影响力 ≥ 0 且社群规模 ≤ 0。得分 = 社群规模的绝对值。' },
  'niche:individual': { term: '个人 · 小众', text: '胜利：个人影响力 ≥ 0 且社群规模 ≤ 0。得分 = 个人影响力。' },
  'neutral:neutral': { term: '中立', text: '开局没有阵营：需要通过技能选择阵营才可能获胜。' },
};

const CATEGORY_GLOSS: Record<string, Gloss> = {
  group: { term: '群体', text: '效果会影响所有玩家。' },
  delay: { term: '延时', text: '打出后先放在延时区，等下一张事件牌生效时才触发。' },
  reaction: { term: '响应', text: '不能在行动阶段主动打出，只能在满足条件的时机使用。' },
  special: { term: '不进弃牌堆', text: '结算后不进入弃牌堆，而是交给下一位玩家。' },
};

/** Text of a card as a single searchable string. */
export function cardText(d: CardDef): string {
  switch (d.kind) {
    case 'action':
    case 'official':
      return d.text;
    case 'event':
      return `${d.up} ${d.down ?? ''}`;
    case 'role':
      return [...d.active, ...d.passive].map((s) => s.text).join(' ');
  }
}

/** Searchable card names (≥ 2 chars) that other cards' texts may refer to. */
const NAMES: { name: string; id: string }[] = [...ACTION_CARDS, ...OFFICIAL_CARDS, ...EVENT_CARDS]
  .map((c) => ({ name: c.name, id: c.id }))
  .filter((c) => c.name.length >= 2);

const referenced = (text: string, self: string): Gloss[] => {
  const out: Gloss[] = [];
  for (const { name, id } of NAMES) {
    if (id === self || out.length >= 3) continue;
    // Officials are named bare; everything else is written 「name」.
    const isOfficial = OFFICIAL_CARDS.some((o) => o.id === id);
    if (text.includes(`「${name}」`) || (isOfficial && text.includes(name))) {
      const d = cardDef(id);
      out.push({ term: name, text: cardText(d).replace(/\s+/g, ' '), cardId: id });
    }
  }
  return out;
};

/** Boxes to show next to a card. Ordered: faction/category, keywords, referenced cards. */
export function explain(cardId: string): Gloss[] {
  const d = cardDef(cardId);
  const text = cardText(d);
  const out: Gloss[] = [];
  if (d.kind === 'role') out.push(FACTION[`${d.stance}:${d.focus}`]);
  if (d.kind === 'action' && CATEGORY_GLOSS[d.category]) out.push(CATEGORY_GLOSS[d.category]);
  if (d.kind === 'event' && d.shape === 'chain') out.push(TERMS.find((t) => t.term === '连锁事件')!);
  if (d.kind === 'role' && d.passive.length) out.push({ term: '主动 / 被动', text: '主动技能：满足条件随时发动，发动即翻开角色牌。被动技能：角色牌正面向上时自动生效。' });
  for (const t of TERMS) if (t.pattern.test(text) && !out.some((o) => o.term === t.term || (t.term === '判定' && /判定/.test(o.term)))) out.push({ term: t.term, text: t.text });
  out.push(...referenced(text, cardId));
  return out.slice(0, 5).map((g) => ({ ...g }));
}

/** One regex that finds every keyword in `cardId`'s text, for highlighting. */
export function highlightPattern(cardId: string): RegExp | null {
  const d = cardDef(cardId);
  const text = cardText(d);
  const hits = TERMS.filter((t) => t.pattern.test(text)).map((t) => t.pattern.source);
  const names = referenced(text, cardId).map((g) => g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const all = [...hits, ...names];
  return all.length ? new RegExp(`(${all.join('|')})`, 'g') : null;
}
