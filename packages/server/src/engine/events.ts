import { eventDef, type CardInstance, type EventDirection } from '@tcd/shared';
import { adjustMagnitude, type Game } from './Game.js';
import { revealOfficial } from './officials.js';
import * as Roles from './roles.js';
import type { PlayerState } from './state.js';

const DIR_LABEL: Record<EventDirection, string> = { up: '正向', down: '逆向', none: '' };

/** Everything an event effect needs; applies event-only modifiers to every number it touches. */
export class EventCtx {
  /** Card stays in front of a player as a status instead of going to the discard pile. */
  keep = false;
  /** Card went to the chain zone. */
  chained = false;
  /** Repeating another card's effect (二轩目直播): don't move this card around. */
  repeat = false;

  constructor(
    readonly g: Game,
    readonly owner: PlayerState,
    readonly card: CardInstance,
    readonly dir: EventDirection,
    private readonly mods: { preempt: boolean; fan: boolean },
  ) {}

  get cardId() {
    return this.card.defId;
  }
  n(x: number) {
    return this.g.n(x, this.owner);
  }
  private get src() {
    return { source: this.owner, cause: 'event' as const, cardId: this.cardId };
  }

  /** Change community by a printed amount (`raw` = computed X, not doubled by 辉针城). */
  async comm(printed: number, raw = false) {
    const { g } = this;
    if (this.mods.preempt) {
      g.log('「事先科普」阻止了本次社群规模变化', undefined, 'minor');
      return 0;
    }
    let v = raw ? printed : this.n(printed);
    if (this.mods.fan) v = adjustMagnitude(v, 1);
    if (g.officialActive('hm', this.owner)) v = adjustMagnitude(v, -1);
    if (g.officialActive('vd', this.owner)) v = adjustMagnitude(v, 1);
    if (v > 0) {
      for (const c of g.players) if (g.revealed(c, 'cosplayer') && g.s.community < c.influence) v += 1; // 游场②
    }
    return g.changeCommunity(v, this.src);
  }

  async inf(p: PlayerState, printed: number, raw = false) {
    if (!this.g.affects(p, 'event', this.owner)) return 0;
    let v = raw ? printed : this.n(printed);
    if (this.mods.fan) v = adjustMagnitude(v, 1);
    return this.g.changeInfluence(p, v, this.src);
  }

  async draw(p: PlayerState, k: number) {
    if (this.g.affects(p, 'event', this.owner)) await this.g.draw(p, k, this.owner);
  }

  async discard(p: PlayerState, k: number) {
    if (this.g.affects(p, 'event', this.owner)) await this.g.discardFromHand(p, k, { source: this.owner, cardId: this.cardId });
  }

  /** All affected players in turn order starting with the owner. */
  all() {
    return this.g.orderFrom(this.owner).filter((p) => this.g.affects(p, 'event', this.owner));
  }
  others() {
    return this.all().filter((p) => p !== this.owner);
  }
}

type Effect = (ev: EventCtx) => Promise<void>;
interface EventHandler {
  up: Effect;
  down?: Effect;
}

const each = async (ps: PlayerState[], f: (p: PlayerState) => Promise<unknown>) => {
  for (const p of ps) await f(p);
};

export const EVENTS: Record<string, EventHandler> = {
  new_ip: {
    up: (ev) => ev.comm(-3).then(() => {}),
    down: async (ev) => { await each(ev.all(), (p) => ev.draw(p, 1)); await ev.comm(-1); },
  },
  headline: { up: async (ev) => { await ev.comm(2); }, down: async (ev) => { await ev.comm(-3); } },
  shipping_loss: {
    up: async (ev) => { await ev.draw(ev.owner, 1); await ev.inf(ev.owner, -1); },
    down: async (ev) => { await ev.inf(ev.owner, -2); },
  },
  site_closed: {
    up: async (ev) => { await each(ev.all(), (p) => ev.discard(p, 1)); await ev.comm(-2); },
    down: async (ev) => { await ev.discard(ev.owner, 2); await ev.comm(2); await ev.inf(ev.owner, 1); },
  },
  breakthrough: {
    up: async (ev) => { await ev.draw(ev.owner, 2); },
    down: async (ev) => { await ev.discard(ev.owner, 1); await ev.inf(ev.owner, 2); },
  },
  national_event: {
    up: async (ev) => { await ev.comm(2); },
    down: async (ev) => { await ev.comm(-1); await ev.inf(ev.owner, -1); },
  },
  site_founded: {
    up: async (ev) => { await each(ev.all(), (p) => ev.draw(p, 1)); await ev.comm(1); },
    down: async (ev) => { await ev.comm(-1); },
  },
  pirated: {
    up: async (ev) => { await ev.discard(ev.owner, 2); await ev.inf(ev.owner, 1); await ev.comm(2); },
    down: async (ev) => { await ev.discard(ev.owner, 1); await ev.inf(ev.owner, 2); await ev.comm(-1); },
  },
  zun_visit: { up: async (ev) => { await ev.comm(3); }, down: async (ev) => { await ev.comm(-1); } },
  elitism: {
    up: async (ev) => { await each(ev.all().filter((p) => p.influence < 3), (p) => ev.discard(p, 1)); },
    down: async (ev) => { await each(ev.all().filter((p) => p.influence > 2), (p) => ev.discard(p, 1)); },
  },
  pirate_game: {
    up: async (ev) => { await ev.comm(3); await ev.inf(ev.owner, -2); },
    down: async (ev) => { await ev.comm(1); await ev.inf(ev.owner, 1); },
  },
  collab: { up: async (ev) => { await ev.comm(3); }, down: async (ev) => { await ev.comm(1); } },
  fake_peace: {
    up: async (ev) => { await ev.draw(ev.owner, 1); await ev.comm(1); },
    down: async (ev) => { await ev.comm(-1); },
  },
  bad_remark: { up: async (ev) => { await ev.comm(-5); }, down: async (ev) => { await ev.comm(-1); } },
  cited: {
    up: async (ev) => { await ev.inf(ev.owner, 2); },
    down: async (ev) => {
      for (const p of ev.others()) {
        const c = await ev.g.chooseHand(p, `作品被引用：选择一张手牌交给 {p:${ev.owner.id}}`, 1, 1, { cardId: ev.cardId });
        await ev.g.transfer(p, ev.owner, c);
      }
    },
  },
  big_update: {
    up: async (ev) => { await each(ev.all(), (p) => ev.inf(p, -1)); await ev.comm(3); },
    down: async (ev) => { await ev.comm(-2); },
  },
  upset: {
    up: async (ev) => { await ev.discard(ev.owner, 1); await ev.inf(ev.owner, 1); },
    down: async (ev) => { await ev.draw(ev.owner, 1); await ev.inf(ev.owner, -1); },
  },
  police_outbreak: {
    up: async (ev) => { await each(ev.others(), (p) => ev.discard(p, 1)); await ev.comm(-2); },
    down: async (ev) => { await ev.comm(-5); await ev.inf(ev.owner, -3); },
  },
  investigated: { up: async (ev) => { await ev.comm(-3); }, down: async (ev) => { await ev.comm(-1); } },
  third_contact: {
    up: async (ev) => { await ev.inf(ev.owner, 1); },
    down: async (ev) => { await ev.comm(-1); await ev.inf(ev.owner, -1); },
  },
  mass_flame: {
    up: async (ev) => { await ev.comm(-3); await ev.inf(ev.owner, 3); },
    down: async (ev) => { await ev.comm(-1); await ev.inf(ev.owner, -1); },
  },
  property_loss: {
    up: async (ev) => { await ev.discard(ev.owner, 2); },
    down: async (ev) => { await ev.inf(ev.owner, -1); },
  },
  discord: {
    up: async (ev) => { await ev.discard(ev.owner, 1); },
    down: async (ev) => { await ev.inf(ev.owner, -1); },
  },
  kids_influx: {
    up: async (ev) => { await each(ev.all(), (p) => ev.inf(p, -1)); },
    down: async (ev) => { await ev.comm(1); },
  },
  new_trend: { up: async (ev) => { await ev.comm(2); }, down: async (ev) => { await ev.comm(-1); } },
  creative_wave: {
    up: async (ev) => { await ev.comm(3); await ev.inf(ev.owner, 1); },
    down: async (ev) => { await ev.comm(1); await ev.inf(ev.owner, 3); },
  },
  intl_exchange: {
    up: async (ev) => { await ev.comm(3); },
    down: async (ev) => { await ev.comm(1); await ev.draw(ev.owner, 1); },
  },
  customs: {
    up: async (ev) => { await ev.comm(-2); },
    down: async (ev) => { await ev.discard(ev.owner, 1); },
  },
  zun_ban: {
    up: async (ev) => {
      const { g } = ev;
      for (const p of ev.all()) {
        const right = g.prev(p);
        if (!g.affects(right, 'event', ev.owner) || !p.hand.length) continue;
        const c = await g.chooseHand(p, `ZUN新规约：禁止——选择一张手牌交给右边的 {p:${right.id}}`, 1, 1, { cardId: ev.cardId });
        await g.transfer(p, right, c);
      }
    },
    down: async (ev) => { await each(ev.all(), (p) => ev.discard(p, 1)); },
  },
  expelled: {
    up: async (ev) => { await ev.comm(Math.abs(ev.owner.influence), true); },
    down: async (ev) => { await ev.comm(-Math.abs(ev.owner.influence), true); },
  },
  big_release: {
    up: async (ev) => { await ev.inf(ev.owner, 1); },
    down: async (ev) => {
      const cards = await ev.g.chooseHand(ev.owner, '进行重大发布：选择弃置 X 张手牌，个人影响力 +X', 0, ev.owner.hand.length, { cardId: ev.cardId });
      await ev.g.discard(ev.owner, cards);
      await ev.inf(ev.owner, cards.length, true);
    },
  },
  postponed: {
    up: async (ev) => { await each(ev.all(), (p) => ev.discard(p, 1)); await ev.comm(-3); },
    down: async (ev) => { await ev.discard(ev.owner, 2); },
  },
  plagiarism: {
    up: async (ev) => { await ev.discard(ev.owner, 1); await ev.inf(ev.owner, -1); },
    down: async (ev) => { await ev.discard(ev.owner, 2); },
  },
  writers_block: {
    up: async (ev) => { await ev.inf(ev.owner, -2); },
    down: async (ev) => { await ev.discard(ev.owner, 2); },
  },
  zun_riddle: {
    up: async (ev) => {
      const { g } = ev;
      for (const p of ev.all()) {
        const left = g.next(p);
        if (!g.affects(left, 'event', ev.owner) || !left.hand.length) continue;
        const c = g.randomHandCard(left)!;
        await g.transfer(left, p, [c]);
      }
    },
    down: async (ev) => { await ev.comm(-1); },
  },
  circle_union: {
    up: async (ev) => {
      const { g, owner } = ev;
      await ev.inf(owner, 1);
      let got = 0;
      for (const p of ev.others()) {
        const c = await g.chooseHand(p, `建立社团联合组织：选择一张手牌交给 {p:${owner.id}}`, 1, 1, { cardId: ev.cardId });
        await g.transfer(p, owner, c);
        got += c.length;
      }
      const back = await g.chooseHand(owner, `选择 ${got} 张手牌放回行动牌堆顶`, got, got, { cardId: ev.cardId });
      let ordered = back;
      if (back.length > 1) {
        const uids = await g.ask(owner, {
          kind: 'order', title: '排列放回牌堆顶的顺序（第一张在最上方）', cards: back, cardId: ev.cardId,
          defaultValue: back.map((c) => c.uid),
        });
        ordered = uids.map((u) => back.find((c) => c.uid === u)!);
      }
      await g.loseCards(owner, ordered);
      g.s.actionDeck.push(...[...ordered].reverse());
      g.log(`{p:${owner.id}} 将 ${ordered.length} 张牌放回了行动牌堆顶`);
      await each(ev.others(), (p) => ev.draw(p, 1));
    },
    down: async (ev) => { await ev.inf(ev.owner, 1); await ev.discard(ev.owner, 2); await ev.draw(ev.owner, 2); },
  },
  zun_frontier: {
    up: async (ev) => { await each(ev.all(), (p) => ev.draw(p, 1)); },
    down: async (ev) => {
      const { g, owner } = ev;
      const top = [g.takeActionTop(), g.takeActionTop()].filter((c): c is CardInstance => !!c);
      if (!top.length) return;
      const [mine] = await g.chooseFromList(owner, '新领域：选择一张加入你的手牌', top, 1, 1, { cardId: ev.cardId });
      await g.gainCards(owner, [mine], owner);
      const other = top.find((c) => c !== mine);
      if (!other) return;
      const who = await g.choosePlayer(owner, '新领域：将另一张交给哪位玩家？', ev.all(), { cardId: other.defId });
      await g.gainCards(who, [other], owner);
      g.log(`{p:${owner.id}} 将一张行动牌交给了 {p:${who.id}}`, undefined, 'minor');
    },
  },
  local_event: {
    up: async (ev) => {
      const { g, owner } = ev;
      await each([g.prev(owner), owner, g.next(owner)].filter((p, i, a) => a.indexOf(p) === i), (p) => ev.draw(p, 1));
      await ev.comm(1);
    },
    down: async (ev) => {
      const { g, owner } = ev;
      await each([g.prev(owner), owner, g.next(owner)].filter((p, i, a) => a.indexOf(p) === i), (p) => ev.discard(p, 1));
      await ev.comm(-1);
    },
  },
  spotlight: {
    up: async (ev) => {
      ev.keep = true;
      ev.g.addStatus(ev.owner, 'spotlightUp', ev.card, '备受瞩目：个人影响力锁定为2');
    },
    down: async (ev) => {
      ev.keep = true;
      ev.g.addStatus(ev.owner, 'spotlightDown', ev.card, '备受瞩目：个人影响力等于手牌数');
    },
  },
  giveaway: {
    up: async (ev) => { await ev.inf(ev.owner, 1); await each(ev.all(), (p) => ev.draw(p, 1)); },
    down: async (ev) => { await ev.draw(ev.owner, 2); },
  },
  weird_scene: {
    up: async (ev) => { await ev.comm(ev.g.players.every((p) => p.influence >= 0) ? 3 : -2); },
    down: async (ev) => { await ev.comm(ev.g.players.some((p) => p.influence === 0) ? -2 : -1); },
  },
  nikenme: {
    up: async (ev) => {
      const last = ev.g.s.lastEvent;
      if (!last || last.defId === 'nikenme') {
        ev.g.log('没有可以重复的事件', undefined, 'minor');
        return;
      }
      ev.g.log(`二轩目直播：重复 {c:${last.defId}} 的${DIR_LABEL[last.direction]}效果`);
      const h = EVENTS[last.defId];
      ev.repeat = true;
      await (last.direction === 'down' && h.down ? h.down : h.up)(ev);
    },
    down: async (ev) => {
      const c = ev.g.drawEventCard();
      if (!c) return;
      ev.g.log(`{p:${ev.owner.id}} 抽出 {c:${c.defId}} 并立即正向打出`);
      await resolveEvent(ev.g, ev.owner, c, eventDef(c.defId).shape === 'none' ? 'none' : 'up');
    },
  },

  // ── 连锁 ─────────────────────────────────────────
  popularity_poll: {
    up: async (ev) => {
      const x = ev.g.s.chainZone.filter((c) => c.defId === 'popularity_poll').length + 1;
      await ev.comm(x, true);
      chain(ev);
    },
    down: async (ev) => {
      const x = ev.g.s.chainZone.filter((c) => c.defId === 'popularity_poll').length + 1;
      await ev.comm(-x, true);
      chain(ev);
    },
  },
  blooming: {
    up: async (ev) => {
      await ev.comm(1);
      const others = ev.g.s.chainZone.filter((c) => c.defId === 'blooming').length;
      chain(ev);
      if (others >= 2) {
        ev.g.log('遍地开花！', undefined, 'major');
        await ev.comm(5);
        ev.g.s.bloomingBonus = true;
      }
    },
    down: async () => {},
  },

  // ── 特殊 ─────────────────────────────────────────
  crackdown: {
    up: async (ev) => {
      const { g, owner } = ev;
      const cands = ev.all().filter((p) => g.targetable(p));
      if (cands.length) {
        const t = await g.choosePlayer(owner, '扫黄打非：指定一名玩家（个人影响力-5并跳过其下个回合）', cands, { cardId: ev.cardId });
        await ev.inf(t, -5);
        ev.keep = true;
        g.addStatus(t, 'crackdown', ev.card, '扫黄打非：跳过下个回合');
      }
      await ev.comm(-1);
    },
    down: async (ev) => { await each(ev.all(), (p) => ev.inf(p, 1)); await ev.comm(2); },
  },
  withdrawn: {
    up: async (ev) => {
      ev.keep = true;
      ev.g.addStatus(ev.owner, 'withdrawn', ev.card, '自闭：不受行动牌和事件牌影响');
    },
    down: async (ev) => {
      const { g, owner } = ev;
      const cards = await g.chooseHand(owner, '自闭：弃置任意数量的手牌，然后抽等量行动牌', 0, owner.hand.length, { cardId: ev.cardId });
      await g.discard(owner, cards);
      await g.draw(owner, cards.length);
    },
  },

  // ── 无向 ─────────────────────────────────────────
  sick: {
    up: async (ev) => {
      ev.keep = true;
      ev.g.addStatus(ev.owner, 'sick', ev.card, '大病一场');
      if (ev.g.turn?.playerId === ev.owner.id) ev.g.turn.ended = true;
    },
  },
  cultural_confidence: { up: async (ev) => { ev.g.setCommunity(0); } },
  translation: {
    up: async (ev) => {
      const { g, owner } = ev;
      let yes = 0;
      for (let i = 0; i < g.players.length; i++) if (await g.judge(owner, 'truth')) yes++;
      const no = g.players.length - yes;
      g.log(`翻译修订：真 ${yes} 次，假 ${no} 次`);
      if (yes >= no) { await ev.inf(owner, 2); await ev.comm(-1); }
      else await ev.inf(owner, -3);
    },
  },
  recession: { up: async (ev) => { await each(ev.all(), (p) => ev.discard(p, 2)); } },
  calm: { up: async (ev) => { await ev.comm(3); } },
  generation_gap: {
    up: async (ev) => {
      ev.keep = true;
      ev.g.addStatus(ev.owner, 'generationGap', ev.card, '青黄不接：所有玩家不能在摸牌阶段抽牌');
    },
  },
  long_holiday: {
    up: async (ev) => {
      const { g } = ev;
      const ps = ev.all().filter((p) => p.hand.length);
      const picks = await Promise.all(ps.map((p) =>
        g.chooseHand(p, '放长假：弃置一张手牌令个人影响力+1？', 0, 1, { cardId: ev.cardId })));
      for (let i = 0; i < ps.length; i++) {
        if (!picks[i].length) continue;
        await g.discard(ps[i], picks[i], '放长假');
        await ev.inf(ps[i], 1);
      }
    },
  },
  loan: {
    up: async (ev) => {
      await ev.draw(ev.owner, 2);
      ev.keep = true;
      ev.g.addStatus(ev.owner, 'loan', ev.card, '得到借款：手牌上限+2，跳过下回合摸牌');
    },
  },
  mass_exodus: { up: async (ev) => { await each(ev.all(), (p) => ev.inf(p, 2)); await ev.comm(-5); } },
  lottery: {
    up: async (ev) => {
      await ev.draw(ev.owner, 4);
      await ev.inf(ev.owner, 2);
      if (ev.g.turn?.playerId === ev.owner.id) ev.g.turn.skipDiscard = true;
    },
  },
  restless: { up: async (ev) => { await ev.comm(-3); } },
  finale: {
    up: async (ev) => {
      ev.g.s.officialSuppressed = true;
      ev.g.log('连载完结：本轮内官作牌失去效果', undefined, 'major');
    },
  },
  trend: {
    up: async (ev) => {
      const c = ev.g.s.community;
      if (c !== 0) await ev.comm(c > 0 ? 3 : -3);
    },
  },
  new_title: {
    up: async (ev) => {
      const { g } = ev;
      if (g.s.currentOfficial) {
        g.s.officialDiscard.push(g.s.currentOfficial);
        g.s.currentOfficial = null;
        g.s.officialCopyOf = null;
      }
      await revealOfficial(g, ev.owner);
    },
  },
};

function chain(ev: EventCtx) {
  if (ev.repeat) return;
  ev.chained = true;
  ev.g.s.chainZone.push(ev.card);
}

/**
 * Resolve an event card for `owner` in direction `dir`.
 * Fires the delay zone (all queued 延时牌 trigger together), then post-event role hooks.
 */
export async function resolveEvent(g: Game, owner: PlayerState, card: CardInstance, dir: EventDirection) {
  const d = eventDef(card.defId);
  const delays = g.s.delayZone.splice(0);
  const mods = {
    preempt: delays.some((x) => x.effect === 'preempt'),
    fan: delays.some((x) => x.effect === 'fan_flames'),
  };
  g.log(`{p:${owner.id}} 的事件 {c:${card.defId}} ${DIR_LABEL[dir]}发生`, { type: 'event', playerId: owner.id, cardId: card.defId, direction: dir }, 'major');
  if (delays.length) g.log(`延时牌生效：${delays.map((x) => `{c:${x.effect}}`).join('')}`);
  await g.pause(600);

  const ev = new EventCtx(g, owner, card, dir, mods);
  const h = EVENTS[card.defId];
  if (!h) throw new Error(`No handler for event ${card.defId}`);
  if (card.defId === 'blooming' && dir === 'down') g.log('遍地开花（逆向）直接进入弃牌堆，无任何效果', undefined, 'minor');
  await (dir === 'down' && h.down ? h.down : h.up)(ev);

  for (const d of delays) {
    // 人类的本质 never enters the discard pile: it is handed to the owner's next player instead.
    if (d.card.defId === 'human_nature') g.next(g.player(d.ownerId)).pendingGift.push(d.card);
    else g.toDiscard([d.card]);
  }
  if (!ev.keep && !ev.chained) {
    g.s.eventDiscard.push(card);
    g.s.lastEvent = { defId: card.defId, direction: dir };
  }
  g.touch();
  await Roles.afterEvent(g, d.topic);
}

/**
 * The owner decides the direction; then 最终解释权 and 墨菲定律 may respond.
 * Face-down events never go through here (always 正向, no choice).
 */
export async function decideDirection(g: Game, owner: PlayerState, card: CardInstance): Promise<EventDirection> {
  const d = eventDef(card.defId);
  if (d.shape === 'none') return 'none';
  let dir = (await g.choose(owner, `事件「${d.name}」：选择发生方向`, [
    { value: 'up', label: '正向', hint: d.up, tone: 'primary' },
    { value: 'down', label: '逆向', hint: d.down },
  ], { cardId: card.defId })) as EventDirection;
  g.log(`{p:${owner.id}} 决定 {c:${card.defId}} ${DIR_LABEL[dir]}发生`);
  dir = await Roles.finalSay(g, owner, card, dir);
  return murphyWindow(g, owner, card, dir);
}

async function murphyWindow(g: Game, owner: PlayerState, card: CardInstance, dir: EventDirection): Promise<EventDirection> {
  if (g.s.lockdown) return dir;
  for (const p of g.orderFrom(owner)) {
    const m = p.hand.find((c) => c.defId === 'murphy');
    if (!m) continue;
    const flip: EventDirection = dir === 'up' ? 'down' : 'up';
    const use = await g.confirm(p, `打出「墨菲定律」令 {c:${card.defId}} 改为${DIR_LABEL[flip]}发生？`, {
      cardId: 'murphy', body: '你的个人影响力 -1', yes: '打出墨菲定律', no: '不响应', secret: true,
    });
    if (!use) continue;
    await g.loseCards(p, [m]);
    g.toDiscard([m]);
    g.log(`{p:${p.id}} 打出 {c:murphy}：事件方向逆转为${DIR_LABEL[flip]}`, { type: 'play', playerId: p.id, cardId: 'murphy' }, 'major');
    await g.changeInfluence(p, -g.n(1, p), { source: p, cause: 'action', cardId: 'murphy' });
    return flip; // 墨菲定律 cannot respond to 墨菲定律
  }
  return dir;
}
