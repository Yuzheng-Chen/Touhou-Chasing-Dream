import { actionDef, type ActionCardDef, type CardInstance } from '@tcd/shared';
import type { Game } from './Game.js';
import { hermitNegate } from './roles.js';
import type { PlayerState } from './state.js';

/** Context for resolving one action card. */
export interface ActionCtx {
  g: Game;
  player: PlayerState;
  /** Effective card being resolved (may differ from the physical card: 视作/当作). */
  defId: string;
  /** Pre-chosen target (地区王·共荣). */
  forcedTarget?: PlayerState;
}

export interface ActionHandler {
  /** Extra play conditions beyond the generic ones. */
  canPlay?(g: Game, p: PlayerState): boolean;
  play(ctx: ActionCtx): Promise<void>;
}

const def = (ctx: ActionCtx): ActionCardDef => actionDef(ctx.defId);
const opts = (ctx: ActionCtx) => ({ source: ctx.player, cause: 'action' as const, cardId: ctx.defId });

/** Players `p` may target with rule `any`/`other`. */
export function targetCandidates(g: Game, p: PlayerState, rule: 'any' | 'other', filter?: (t: PlayerState) => boolean) {
  return g.orderFrom(p).filter((t) => (rule === 'any' || t !== p) && g.targetable(t) && (!filter || filter(t)));
}

async function pickTarget(ctx: ActionCtx, filter?: (t: PlayerState) => boolean): Promise<PlayerState | null> {
  if (ctx.forcedTarget) return ctx.forcedTarget;
  const d = def(ctx);
  const cands = targetCandidates(ctx.g, ctx.player, d.target === 'other' ? 'other' : 'any', filter);
  if (!cands.length) return null;
  const t = await ctx.g.choosePlayer(ctx.player, `「${d.name}」：指定一名${d.target === 'other' ? '其他' : ''}玩家`, cands, {
    cardId: ctx.defId, body: d.text,
  });
  ctx.g.log(`{p:${ctx.player.id}} 指定了 {p:${t.id}}`, { type: 'target', fromId: ctx.player.id, toIds: [t.id], cardId: ctx.defId }, 'minor');
  return t;
}

const hasOthers = (g: Game, p: PlayerState) => targetCandidates(g, p, 'other').length > 0;

export const ACTIONS: Record<string, ActionHandler> = {
  // ── 白嫖 ──────────────────────────────────────────
  freeload: {
    canPlay: (g, p) => targetCandidates(g, p, 'any', (t) => t !== p && t.hand.length > 0).length > 0,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx, (x) => x !== player && x.hand.length > 0);
      if (!t || !t.hand.length) return;
      if (await hermitNegate(g, t, player, '手牌被获得')) return;
      const card = g.randomHandCard(t)!;
      await g.transfer(t, player, [card]);
    },
  },

  // ── 传教 ──────────────────────────────────────────
  preach: {
    async play(ctx) {
      const { g, player } = ctx;
      await g.changeCommunity(await g.chooseSign(player, g.n(2, player), ctx.defId), opts(ctx));
    },
  },

  // ── 造谣 ──────────────────────────────────────────
  rumor: {
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      await g.changeInfluence(t, -g.n(2, player), opts(ctx));
      if (g.officialActive('stb', player)) g.log('「东方文花帖」：造谣者不减少个人影响力', undefined, 'minor');
      else await g.changeInfluence(player, -g.n(1, player), opts(ctx));
    },
  },

  // ── 创作 ──────────────────────────────────────────
  create: {
    async play(ctx) {
      await ctx.g.changeInfluence(ctx.player, ctx.g.n(1, ctx.player), opts(ctx));
    },
  },

  // ── 盈利 ──────────────────────────────────────────
  profit: {
    async play(ctx) {
      await ctx.g.draw(ctx.player, 2);
    },
  },

  // ── 线下交流 ──────────────────────────────────────
  meetup: {
    canPlay: hasOthers,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      // Both choose simultaneously.
      const [mine, theirs] = await Promise.all([
        g.chooseHand(player, `线下交流：选择一张手牌交给 {p:${t.id}}`, 1, 1, { cardId: ctx.defId }),
        g.chooseHand(t, `线下交流：选择一张手牌交给 {p:${player.id}}`, 1, 1, { cardId: ctx.defId }),
      ]);
      await g.transfer(player, t, mine);
      await g.transfer(t, player, theirs);
      await g.changeCommunity(await g.chooseSign(player, g.n(2, player), ctx.defId), opts(ctx));
    },
  },

  // ── 约稿 ──────────────────────────────────────────
  commission: {
    canPlay: hasOthers,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      const give = await g.chooseHand(player, `约稿：选择任意张手牌交给 {p:${t.id}}（X）`, 0, player.hand.length, {
        cardId: ctx.defId, body: '你和对方的个人影响力各 +X',
      });
      await g.transfer(player, t, give);
      const x = give.length;
      if (x > 0) {
        await g.changeInfluence(player, x, opts(ctx));
        await g.changeInfluence(t, x, opts(ctx));
      }
      await g.changeCommunity(await g.chooseSign(player, g.n(1, player), ctx.defId), opts(ctx));
    },
  },

  // ── 结交同好 ──────────────────────────────────────
  befriend: {
    async play(ctx) {
      const { g, player } = ctx;
      const canA = !!ctx.forcedTarget || hasOthers(g, player);
      const pick = ctx.forcedTarget ? 'a' : await g.choose(player, '结交同好：选择一项', [
        { value: 'a', label: `与一名其他玩家个人影响力各 +${g.n(1, player)}`, tone: 'good', disabled: !canA },
        { value: 'b', label: `社群规模 ±${g.n(3, player)}` },
      ], { cardId: ctx.defId });
      if (pick === 'a') {
        const t = await pickTarget(ctx);
        if (!t) return;
        await g.changeInfluence(player, g.n(1, player), opts(ctx));
        await g.changeInfluence(t, g.n(1, player), opts(ctx));
      } else {
        await g.changeCommunity(await g.chooseSign(player, g.n(3, player), ctx.defId), opts(ctx));
      }
    },
  },

  // ── 传播模因 ──────────────────────────────────────
  meme: {
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      await g.changeInfluence(t, t.influence < 0 ? -g.n(1, player) : g.n(1, player), opts(ctx));
    },
  },

  // ── 互撕 ──────────────────────────────────────────
  flame: {
    canPlay: hasOthers,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      await g.changeInfluence(t, -g.n(1, player), opts(ctx));
      // Alternate, starting with the target, until someone declines.
      let [actor, victim] = [t, player];
      for (;;) {
        if (!actor.hand.length) break;
        const cards = await g.chooseHand(actor, `互撕：弃置一张手牌，令 {p:${victim.id}} 个人影响力 -${g.n(1, player)}？`, 0, 1, {
          cardId: ctx.defId, body: '不弃置则互撕结束。',
        });
        if (!cards.length) {
          g.log(`{p:${actor.id}} 停止了互撕`, undefined, 'minor');
          break;
        }
        await g.discard(actor, cards, '互撕');
        await g.changeInfluence(victim, -g.n(1, player), { source: actor, cause: 'action', cardId: ctx.defId });
        [actor, victim] = [victim, actor];
      }
    },
  },

  // ── 商业互吹 ──────────────────────────────────────
  mutual_praise: {
    canPlay: hasOthers,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      const v = await g.choose(player, '商业互吹：分配效果', [
        { value: 'me', label: `自己个人影响力 +${g.n(1, player)}，{p:${t.id}} 抽一张行动牌` },
        { value: 'them', label: `{p:${t.id}} 个人影响力 +${g.n(1, player)}，自己抽一张行动牌` },
      ], { cardId: ctx.defId });
      const [inf, drawer] = v === 'me' ? [player, t] : [t, player];
      await g.changeInfluence(inf, g.n(1, player), opts(ctx));
      await g.draw(drawer, 1, player);
    },
  },

  // ── 挂裱 ──────────────────────────────────────────
  expose: {
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      const x = await g.judge(player, 'two');
      await g.changeInfluence(t, -x, opts(ctx));
      if (g.officialActive('stb', player)) await g.changeInfluence(player, 1, { ...opts(ctx), cause: 'official' });
    },
  },

  // ── 出警 ──────────────────────────────────────────
  police: {
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      const x = await g.judge(player, 'two');
      if (!x) return;
      await g.changeInfluence(t, -x, opts(ctx));
      await g.changeCommunity(await g.chooseSign(player, x, ctx.defId), opts(ctx));
    },
  },

  // ── 联机对战 ──────────────────────────────────────
  versus: {
    canPlay: hasOthers,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx);
      if (!t) return;
      const a = await g.roll(player, 'delta');
      const b = await g.roll(t, 'delta');
      const ra = a.result as number;
      const rb = b.result as number;
      const x = ra === rb ? ra : Number(await g.choose(player, '联机对战：选择社群规模的变化', [
        { value: String(ra), label: `社群规模 ${ra > 0 ? '+' : ''}${ra}（你的结果）`, tone: ra > 0 ? 'good' : 'bad' },
        { value: String(rb), label: `社群规模 ${rb > 0 ? '+' : ''}${rb}（对方结果）`, tone: rb > 0 ? 'good' : 'bad' },
      ], { cardId: ctx.defId }));
      await g.changeCommunity(x, opts(ctx));
      // 东方绯想天: 拼点 (initiator +1)
      if (g.officialActive('swr', player) && a.face && b.face) {
        const pa = a.face + 1;
        const pb = b.face;
        g.log(`「东方绯想天」拼点：{p:${player.id}} ${pa} vs {p:${t.id}} ${pb}`);
        if (pa !== pb) {
          const [win, lose] = pa > pb ? [player, t] : [t, player];
          await g.changeInfluence(win, 1, { source: player, cause: 'official' });
          await g.changeInfluence(lose, -1, { source: player, cause: 'official' });
        }
      }
    },
  },

  // ── 众筹 ──────────────────────────────────────────
  crowdfund: {
    async play(ctx) {
      const { g, player } = ctx;
      const funders = [player];
      const asks = g.others(player).filter((p) => p.hand.length && g.affects(p, 'action', player));
      const answers = await Promise.all(asks.map((p) =>
        g.chooseHand(p, `{p:${player.id}} 发起了众筹：弃置一张手牌成为众筹者？`, 0, 1, {
          cardId: ctx.defId, body: '一人：众筹者个人影响力+1；二人：社群规模±X；三人及以上：众筹者各抽一张。全员参与则叫停。',
        })));
      for (let i = 0; i < asks.length; i++) {
        if (answers[i].length) {
          await g.discard(asks[i], answers[i], '众筹');
          funders.push(asks[i]);
        }
      }
      const x = funders.length;
      g.log(`众筹者 ${x} 人：${funders.map((f) => `{p:${f.id}}`).join('、')}`);
      if (x === g.players.length) {
        g.log('全员众筹——众筹被叫停，无效果。', undefined, 'major');
        return;
      }
      for (const f of funders) await g.changeInfluence(f, g.n(1, player), opts(ctx));
      if (x >= 2) await g.changeCommunity(await g.chooseSign(player, x, ctx.defId), opts(ctx));
      if (x >= 3) for (const f of funders) await g.draw(f, 1, player);
    },
  },

  // ── 延时牌 (placed in the delay zone by flow; resolved by events) ──
  preempt: { async play() {} },
  fan_flames: { async play() {} },

  // ── 消息灵通 ──────────────────────────────────────
  insider: {
    canPlay: (g, p) => !!p.turnEvent && g.s.eventDeck.length + g.s.eventDiscard.length > 0,
    async play(ctx) {
      const { g, player } = ctx;
      if (!player.turnEvent) return;
      const drawn = [g.drawEventCard(), g.drawEventCard()].filter((c): c is CardInstance => !!c);
      const pool = [player.turnEvent, ...drawn];
      const [keep] = await g.chooseFromList(player, '消息灵通：选择作为本回合事件牌的一张', pool, 1, 1, { cardId: ctx.defId });
      const rest = pool.filter((c) => c !== keep);
      let top: CardInstance | undefined = rest[0];
      if (rest.length === 2) {
        [top] = await g.chooseFromList(player, '消息灵通：选择放回事件牌堆顶的一张（另一张置底）', rest, 1, 1, { cardId: ctx.defId });
      }
      const bottom = rest.find((c) => c !== top);
      if (top) g.s.eventDeck.push(top);
      if (bottom) g.s.eventDeck.unshift(bottom);
      player.turnEvent = keep;
      g.log(`{p:${player.id}} 调整了事件牌`, undefined, 'minor');
    },
  },

  // ── 火星 ──────────────────────────────────────────
  mars: {
    canPlay: (g, p) => !!p.turnEvent && !g.turn?.marsEvent,
    async play(ctx) {
      const { g, player } = ctx;
      if (!player.turnEvent) return;
      // The held event is discarded first, so it can itself be picked back up.
      g.s.eventDiscard.push(player.turnEvent);
      player.turnEvent = null;
      const pool = [...g.s.eventDiscard];
      const [pick] = await g.chooseFromList(player, '火星：从事件弃牌堆中选择一张事件牌', pool, 1, 1, { cardId: ctx.defId });
      g.s.eventDiscard = g.s.eventDiscard.filter((c) => c !== pick);
      player.turnEvent = pick;
      if (g.turn) g.turn.marsEvent = true;
      g.log(`{p:${player.id}} 换上了事件 {c:${pick.defId}}（本回合必须打出，效果对其他玩家无效）`);
    },
  },

  // ── 走漏风声 ──────────────────────────────────────
  leak: {
    canPlay: (g, p) => targetCandidates(g, p, 'any', (t) => !!t.faceDownEvent).length > 0,
    async play(ctx) {
      const { g, player } = ctx;
      const t = await pickTarget(ctx, (x) => !!x.faceDownEvent);
      if (!t?.faceDownEvent) return;
      const card = t.faceDownEvent;
      const v = await g.choose(player, `走漏风声：{p:${t.id}} 扣置的事件牌`, [
        { value: 'keep', label: '放回' },
        { value: 'drop', label: '弃置', tone: 'bad' },
      ], { cardId: card.defId });
      if (v === 'drop') {
        t.faceDownEvent = null;
        g.s.eventDiscard.push(card);
        g.log(`{p:${player.id}} 弃置了 {p:${t.id}} 扣置的事件牌 {c:${card.defId}}`, undefined, 'major');
      } else {
        g.log(`{p:${player.id}} 查看了 {p:${t.id}} 扣置的事件牌`);
      }
    },
  },

  // ── 墨菲定律: reaction only (see events.ts decideDirection) ──
  murphy: { canPlay: () => false, async play() {} },

  // ── 人类的本质: copy handled by flow.playCard ──
  human_nature: { async play() {} },
};

export function actionHandler(defId: string): ActionHandler {
  const h = ACTIONS[defId];
  if (!h) throw new Error(`No handler for action ${defId}`);
  return h;
}
