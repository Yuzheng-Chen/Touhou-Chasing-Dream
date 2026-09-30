import type { ActionCardDef } from './types.js';

const a = (d: Omit<ActionCardDef, 'kind'>): ActionCardDef => ({ kind: 'action', ...d });

export const ACTION_CARDS: ActionCardDef[] = [
  // ── 直接触发，无需判定 ─────────────────────────────
  a({ id: 'freeload', name: '白嫖', count: 5, category: 'instant', target: 'any',
    text: '指定一名玩家，获得他的一张手牌。' }),
  a({ id: 'preach', name: '传教', count: 5, category: 'instant', target: null,
    text: '社群规模±2。' }),
  a({ id: 'rumor', name: '造谣', count: 5, category: 'instant', target: 'any',
    text: '指定一名玩家，其个人影响力-2；你的个人影响力-1。' }),
  a({ id: 'create', name: '创作', count: 5, category: 'instant', target: null,
    text: '你的个人影响力+1。' }),
  a({ id: 'profit', name: '盈利', count: 3, category: 'instant', target: null,
    text: '抽两张行动牌。' }),
  a({ id: 'meetup', name: '线下交流', count: 3, category: 'instant', target: 'other',
    text: '指定一名其他玩家，你和其各选择一张手牌交付给对方；社群规模±2。' }),
  a({ id: 'commission', name: '约稿', count: 3, category: 'instant', target: 'other',
    text: '指定一名其他玩家，你可以将X张手牌交给他，你和其个人影响力+X。社群规模±1。' }),
  a({ id: 'befriend', name: '结交同好', count: 3, category: 'instant', target: 'other',
    text: '选择下列两项中的一项执行：a.指定一名其他玩家，你与其个人影响力各+1；b.社群规模±3。' }),
  a({ id: 'meme', name: '传播模因', count: 3, category: 'instant', target: 'any',
    text: '指定一名玩家，若其个人影响力为负，则其个人影响力-1，否则其个人影响力+1。' }),
  a({ id: 'flame', name: '互撕', count: 3, category: 'instant', target: 'other',
    text: '指定一名其他玩家，其个人影响力-1；从该玩家开始其与你轮流弃置一张手牌使对方个人影响力-1，直到其中一名玩家选择不弃置手牌。' }),
  a({ id: 'mutual_praise', name: '商业互吹', count: 3, category: 'instant', target: 'other',
    text: '指定一名其他玩家，由你分配以下两个效果对你和该玩家分别生效：a.个人影响力+1；b.抽一张行动牌。' }),

  // ── 需要判定 ─────────────────────────────────────
  a({ id: 'expose', name: '挂裱', count: 6, category: 'judge', target: 'any', judge: true,
    text: '指定一名玩家，你进行一次两点点数判定，该玩家个人影响力减少判定结果的数值。当其他玩家减少你的个人影响力时可以使用，该玩家个人影响力减少相同的数值。' }),
  a({ id: 'police', name: '出警', count: 5, category: 'judge', target: 'any', judge: true,
    text: '指定一名玩家，进行一次两点点数判定，判定结果为X，该玩家的个人影响力-X；社群规模±X。' }),
  a({ id: 'versus', name: '联机对战', count: 5, category: 'judge', target: 'other', judge: true,
    text: '指定一名其他玩家，你和其各进行一次增减判定，社群规模改变X，X为两人判定结果之一，由你选择。' }),

  // ── 群体牌 ───────────────────────────────────────
  a({ id: 'crowdfund', name: '众筹', count: 1, category: 'group', target: null,
    text: '你成为众筹者，其他玩家可以弃置一张手牌成为众筹者。根据众筹者人数X，依次产生如下效果：一人：每位众筹者个人影响力+1；二人：社群规模±X；三人及以上：每位众筹者抽一张行动牌。若全部玩家均成为众筹者，则众筹被叫停，无效果。' }),

  // ── 延时牌 ───────────────────────────────────────
  a({ id: 'preempt', name: '事先科普', count: 5, category: 'delay', target: null,
    text: '防止下一张生效的事件牌对社群规模的增减。' }),
  a({ id: 'fan_flames', name: '煽风点火', count: 5, category: 'delay', target: null,
    text: '下一张生效的事件牌效果中的社群规模和个人影响力偏移量+1。' }),

  // ── 事件牌相关，立刻触发 ─────────────────────────
  a({ id: 'insider', name: '消息灵通', count: 3, category: 'eventOp', target: null,
    text: '抽两张事件牌，然后将手中一张事件牌放回事件牌堆顶部，将另一张置于事件牌堆底。' }),
  a({ id: 'mars', name: '火星', count: 1, category: 'eventOp', target: null,
    text: '弃掉你手中的事件牌，从事件牌弃牌堆中选择一张事件牌放入手中，这张事件牌本回合必须打出且效果对其他玩家无效。' }),
  a({ id: 'leak', name: '走漏风声', count: 3, category: 'eventOp', target: 'any',
    text: '指定一名玩家，查看其事件牌区中扣置的事件牌，你可以将其放回或弃置。' }),

  // ── 响应 ─────────────────────────────────────────
  a({ id: 'murphy', name: '墨菲定律', count: 3, category: 'reaction', target: null, reactionOnly: true,
    text: '当任意玩家决定事件牌发生方向时可以使用，该事件牌的发生方向逆转（不影响扣置发动的事件）；你的个人影响力-1。' }),

  // ── 触发后不进入弃牌堆 ───────────────────────────
  a({ id: 'human_nature', name: '人类的本质', count: 1, category: 'special', target: null,
    text: '该牌打出时视作上一张进入弃牌堆的行动牌的复制。该牌结算完成后不进入弃牌堆，而是交付给打出者的下一位玩家，并在下一回合开始时加入该玩家的手牌。' }),
];

export const ACTION_CATEGORY_LABEL: Record<ActionCardDef['category'], string> = {
  instant: '即时',
  judge: '判定',
  group: '群体',
  delay: '延时',
  eventOp: '事件',
  reaction: '响应',
  special: '特殊',
};
