import {
  FACTIONS, OFFICIAL_CARDS, actionDef, factionLabel, roleDef,
  type CardInstance, type EventDirection, type EventTopic, type TurnMove,
} from '@tcd/shared';
import { ACTIONS } from './actions.js';
import type { ChangeOpts, Game } from './Game.js';
import type { PlayerState } from './state.js';

/*
 * Role skills. Conventions:
 *  - 主动技能 may be used face-down; using one reveals the role (g.reveal).
 *  - 被动技能 only work while revealed (g.revealed(p, role)).
 *  - Nothing may be used during 最终结算 (g.s.lockdown).
 * Reaction prompts are `secret` so the table can't tell who holds what.
 */

const live = (g: Game) => !g.s.lockdown;
const holders = (g: Game, role: string) => {
  const start = g.current ?? g.players[0];
  return g.orderFrom(start).filter((p) => p.role === role);
};

// ════════════════════════════════════════════════════════════════════
//  Reactive hooks (called from Game primitives)
// ════════════════════════════════════════════════════════════════════

/** 桃源民·遗世独立: negate another player's reduction of your hand/influence outside your turn. */
export async function hermitNegate(g: Game, t: PlayerState, source: PlayerState, what: string): Promise<boolean> {
  if (t.role !== 'hermit' || source === t || g.isTurnOf(t) || !live(g) || !t.hand.length) return false;
  const ok = await g.confirm(t, `遗世独立：弃置一张手牌，使 {p:${source.id}} 造成的${what}无效？`, {
    cardId: 'hermit', secret: true,
  });
  if (!ok) return false;
  const [c] = await g.chooseHand(t, '遗世独立：选择弃置的手牌', 1, 1, { cardId: 'hermit', secret: true });
  if (!c) return false;
  g.reveal(t, '遗世独立');
  await g.discard(t, [c], '遗世独立');
  g.log(`{p:${t.id}} 发动「遗世独立」，使效果无效`, undefined, 'major');
  return true;
}

export async function afterGain(g: Game, p: PlayerState, cards: CardInstance[], _source: PlayerState | null) {
  if (p.role === 'anti_profit' && !g.isTurnOf(p) && live(g)) {
    for (const c of cards) {
      if (g.revealed(p, 'anti_profit')) {
        g.skillFx(p, '律人律己', true);
        await g.changeInfluence(p, -1, { cause: 'skill', source: p });
      }
      if (!p.hand.includes(c)) continue;
      const drop = await g.confirm(p, `以身作则：弃置刚获得的 {c:${c.defId}}，个人影响力+1？`, { cardId: 'anti_profit', secret: true });
      if (drop) {
        g.reveal(p, '以身作则');
        await g.discard(p, [c], '以身作则');
        await g.changeInfluence(p, 1, { cause: 'skill', source: p });
      }
    }
  }
  await exBrahminCheck(g, p);
}

export async function afterLose(g: Game, p: PlayerState, cards: CardInstance[]) {
  if (g.isTurnOf(p) || !live(g)) return;
  if (g.revealed(p, 'socialite')) {
    g.skillFx(p, '人脉', true);
    await g.draw(p, cards.length);
  }
  if (g.revealed(p, 'anti_profit')) {
    g.skillFx(p, '律人律己', true);
    await g.changeInfluence(p, cards.length, { cause: 'skill', source: p });
  }
}

/** 前婆罗门·老资历: hand exceeds limit while face-down → may reveal and draw two. */
export async function exBrahminCheck(g: Game, p: PlayerState) {
  if (p.role !== 'ex_brahmin' || p.roleRevealed || !live(g)) return;
  const lim = g.handLimit(p);
  if (lim === null || p.hand.length <= lim) return;
  if (await g.confirm(p, '老资历：手牌数超过上限，翻开角色牌并抽两张行动牌？', { cardId: 'ex_brahmin', secret: true })) {
    g.reveal(p, '老资历');
    await g.draw(p, 2);
  }
}

export async function afterInfluenceChange(g: Game, t: PlayerState, actual: number, o: ChangeOpts) {
  // 挂裱 as a reaction: someone else lowered your influence.
  if (actual < 0 && o.source && o.source !== t && live(g) && g.canJudge(t)) {
    const card = t.hand.find((c) => c.defId === 'expose');
    if (card && g.targetable(o.source)) {
      const use = await g.confirm(t, `打出「挂裱」反击：令 {p:${o.source.id}} 个人影响力 ${actual}？`, {
        cardId: 'expose', yes: '打出挂裱', no: '不响应', secret: true,
      });
      if (use && t.hand.includes(card)) {
        await g.loseCards(t, [card]);
        g.toDiscard([card]);
        g.log(`{p:${t.id}} 打出 {c:expose} 反击 {p:${o.source.id}}`, { type: 'play', playerId: t.id, cardId: 'expose', targetIds: [o.source.id] }, 'major');
        await g.changeInfluence(o.source, actual, { source: t, cause: 'action', cardId: 'expose' });
        if (g.officialActive('stb', t)) await g.changeInfluence(t, 1, { source: t, cause: 'official' });
      }
    }
  }
  // 狂热粉丝·洗地
  if (actual <= -2 && live(g)) {
    for (const z of g.players) {
      if (z.role !== 'zealot' || z.idolId !== t.id || z.influence <= 1) continue;
      if (!(await g.confirm(z, `洗地：为偶像 {p:${t.id}} 进行真假判定，若为真其个人影响力+1？`, { cardId: 'zealot' }))) continue;
      if (await g.judge(z, 'truth')) await g.changeInfluence(t, 1, { source: z, cause: 'skill' });
    }
  }
  // 社团主催·社团运营
  if (actual > 0 && g.revealed(t, 'circle_host') && (o.cardId === 'create' || o.cardId === 'commission')) {
    g.skillFx(t, '社团运营', true);
    await g.draw(t, 1);
  }
}

export async function afterCommunityChange(g: Game, actual: number) {
  for (const p of g.orderFrom(g.current ?? g.players[0])) {
    if (actual > 2 && g.revealed(p, 'socialite')) {
      g.skillFx(p, '扩列', true);
      await g.draw(p, 1);
    }
    if (actual > 2 && g.revealed(p, 'cosplayer')) {
      g.skillFx(p, '游场', true);
      await g.changeInfluence(p, 1, { cause: 'skill', source: p });
    }
    if (actual < -2 && g.revealed(p, 'doomsayer')) {
      g.skillFx(p, '东方乙烷', true);
      await g.changeInfluence(p, 1, { cause: 'skill', source: p });
    }
  }
}

/** 活动主办方·NPC: soften a community decrease. Returns the new (negative or zero) delta. */
export async function organizerNpc(g: Game, d: number): Promise<number> {
  if (!live(g)) return d;
  for (const o of holders(g, 'organizer')) {
    if (!o.hand.length) continue;
    const max = Math.min(o.hand.length, Math.ceil(-d / 2));
    const x = await g.ask(o, {
      kind: 'number', title: `NPC：社群规模将 ${d}。弃置 X 张手牌，使减少量 -2X？`,
      body: '然后抽 X-1 张行动牌。选 0 不发动。', cardId: 'organizer', min: 0, max, defaultValue: 0,
    }, { secret: true });
    if (!x) continue;
    const cards = await g.chooseHand(o, `NPC：选择弃置的 ${x} 张手牌`, x, x, { cardId: 'organizer' });
    g.reveal(o, 'NPC');
    await g.discard(o, cards, 'NPC');
    d = Math.min(0, d + 2 * cards.length);
    g.log(`{p:${o.id}} 发动「NPC」，社群规模减少量变为 ${-d}`);
    if (cards.length > 1) await g.draw(o, cards.length - 1);
  }
  return d;
}

/** 精英主义者·分层: cancel a community increase > 1. Returns true when cancelled. */
export async function elitistStratify(g: Game, d: number): Promise<boolean> {
  if (!live(g)) return false;
  for (const e of holders(g, 'elitist')) {
    const cost = d - 1;
    if (e.hand.length < cost || g.uses(e, 'stratify')) continue;
    const ok = await g.confirm(e, `分层：弃置 ${cost} 张手牌，使本次社群规模 +${d} 无效？`, {
      cardId: 'elitist', body: `然后抽 ${cost - 1} 张行动牌，个人影响力 +${cost - 1}`, secret: true,
    });
    if (!ok) continue;
    const cards = await g.chooseHand(e, `分层：选择弃置的 ${cost} 张手牌`, cost, cost, { cardId: 'elitist' });
    g.use(e, 'stratify');
    g.reveal(e, '分层');
    await g.discard(e, cards, '分层');
    g.log(`{p:${e.id}} 发动「分层」，社群规模增加无效`, undefined, 'major');
    const x = cards.length - 1;
    if (x > 0) {
      await g.draw(e, x);
      await g.changeInfluence(e, x, { cause: 'skill', source: e });
    }
    return true;
  }
  return false;
}

/** 社群意见领袖·最终解释权 */
export async function finalSay(g: Game, owner: PlayerState, card: CardInstance, dir: EventDirection): Promise<EventDirection> {
  if (!live(g)) return dir;
  for (const ol of holders(g, 'opinion_leader')) {
    if (ol === owner || ol.influence <= -2) continue;
    const v = await g.choose(ol, `最终解释权：个人影响力 -1，由你决定 {c:${card.defId}} 的方向？`, [
      { value: 'no', label: '不发动' },
      { value: 'up', label: '改为正向', tone: 'primary' },
      { value: 'down', label: '改为逆向', tone: 'primary' },
    ], { cardId: 'opinion_leader', defaultValue: 'no', secret: true });
    if (v === 'no') continue;
    g.reveal(ol, '最终解释权');
    await g.changeInfluence(ol, -1, { cause: 'skill', source: ol });
    g.log(`{p:${ol.id}} 行使「最终解释权」：{c:${card.defId}} ${v === 'up' ? '正向' : '逆向'}发生`, undefined, 'major');
    return v as EventDirection;
  }
  return dir;
}

export async function afterEvent(g: Game, topic: EventTopic) {
  if (!live(g)) return;
  if (topic === '活动') {
    for (const p of holders(g, 'organizer')) {
      if (!g.revealed(p, 'organizer')) continue;
      g.skillFx(p, '开办', true);
      await g.draw(p, 1);
    }
  }
  if (topic === '官方') {
    const top = g.s.officialDeck.at(-1);
    for (const p of holders(g, 'researcher')) {
      if (!top) break;
      if (!(await g.confirm(p, '发表考据：查看官作牌堆顶的牌？', { cardId: 'researcher', secret: true }))) continue;
      g.reveal(p, '发表考据');
      await g.choose(p, '官作牌堆顶是', [{ value: 'ok', label: '知道了' }], { cardId: top.defId, secret: true });
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  Round / turn boundary hooks (called from flow.ts)
// ════════════════════════════════════════════════════════════════════

/** 考据党·猜新作, before the official is revealed. Returns guesses to check afterwards. */
export async function researcherGuess(g: Game): Promise<Map<PlayerState, string>> {
  const guesses = new Map<PlayerState, string>();
  if (!live(g)) return guesses;
  const seen = new Set(g.s.officialDiscard.map((c) => c.defId));
  const options = OFFICIAL_CARDS.filter((o) => !seen.has(o.id)).map((o) => ({ value: o.id, label: o.name }));
  for (const p of holders(g, 'researcher')) {
    const v = await g.choose(p, '猜新作：猜测本轮的官作牌？', [{ value: 'skip', label: '不猜' }, ...options], {
      cardId: 'researcher', defaultValue: 'skip', secret: true,
    });
    if (v !== 'skip') guesses.set(p, v);
  }
  return guesses;
}

export async function settleGuesses(g: Game, guesses: Map<PlayerState, string>) {
  for (const [p, id] of guesses) {
    g.reveal(p, '猜新作');
    g.log(`{p:${p.id}} 猜测本轮官作为 {c:${id}}`);
    if (g.s.currentOfficial?.defId === id) {
      g.log(`{p:${p.id}} 猜中了！`, undefined, 'major');
      await g.draw(p, 2);
      await g.changeInfluence(p, 2, { cause: 'skill', source: p });
    }
  }
}

export async function onTurnStart(g: Game, p: PlayerState) {
  const t = g.turn!;
  // 原作玩家·极限打分
  if (g.revealed(p, 'original_player') && live(g)) {
    const pool = g.s.officialDiscard.filter((c, i, a) => !p.maxScoreUsed.includes(c.defId) && a.findIndex((x) => x.defId === c.defId) === i);
    if (pool.length) {
      const v = await g.choose(p, '极限打分：指定官作弃牌堆中的一张官作牌，本回合只对你额外生效', [
        { value: 'skip', label: '不发动' }, ...pool.map((c) => ({ value: c.defId, label: g.cardName(c.defId) })),
      ], { cardId: 'original_player', defaultValue: 'skip' });
      if (v !== 'skip') {
        p.maxScoreUsed.push(v);
        let eff = v;
        if (v === 'aocf') {
          const others = pool.filter((c) => c.defId !== 'aocf');
          eff = others.length
            ? (await g.chooseFromList(p, '东方凭依华：指定其视为的官作牌', others, 1, 1, { cardId: 'aocf' }))[0].defId
            : '';
        }
        t.maxScoreOfficial = eff || null;
        g.log(`{p:${p.id}} 「极限打分」：本回合 {c:${v}} 对其额外生效`);
      }
    }
  }
  // 单推厨·专一
  if (g.revealed(p, 'oshi') && p.oshi.length > 2) {
    g.skillFx(p, '专一', true);
    await g.changeInfluence(p, 1, { cause: 'skill', source: p });
  }
}

/** 一般路过爱好者·吃瓜 */
export async function beforeEventDraw(g: Game, p: PlayerState) {
  if (!g.revealed(p, 'passerby') || p.influence !== 0 || !live(g)) return;
  const v = await g.choose(p, '吃瓜：改变你的阵营从属？', [
    { value: 'skip', label: '不改变' },
    ...FACTIONS.map((f, i) => ({ value: String(i), label: factionLabel(f) })),
  ], { cardId: 'passerby', defaultValue: 'skip' });
  if (v === 'skip') return;
  p.allegiance = FACTIONS[Number(v)];
  g.log(`{p:${p.id}} 「吃瓜」：改为 ${factionLabel(p.allegiance)} 阵营`, undefined, 'major');
}

/** Returns true if the action phase should be skipped (社群意见领袖·安排). */
export async function beforeActionPhase(g: Game, p: PlayerState): Promise<boolean> {
  if (!live(g)) return false;
  // 单推厨·厨力
  if (p.role === 'oshi' && p.oshi.length && p.influence + 1 >= 1) {
    const max = Math.min(p.oshi.length, p.influence + 1);
    const picked = await g.chooseFromList(p, `厨力：将 1~${max} 张单推牌加入手牌？（不选则不发动）`, p.oshi, 0, max, {
      cardId: 'oshi', body: '本回合手牌无上限；加入两张或以上时社群规模-2。',
    });
    if (picked.length) {
      g.reveal(p, '厨力');
      p.oshi = p.oshi.filter((c) => !picked.includes(c));
      await g.gainCards(p, picked, p);
      g.turn!.noHandLimit = true;
      g.log(`{p:${p.id}} 「厨力」：取回 ${picked.length} 张单推牌`);
      if (picked.length >= 2) await g.changeCommunity(-2, { cause: 'skill', source: p });
    }
  }
  // 社群意见领袖·安排
  if (p.role === 'opinion_leader' && g.s.eventDeck.length) {
    const x = Math.min(g.players.length - 1, g.s.eventDeck.length);
    const ok = await g.confirm(p, `安排：跳过行动阶段，查看并重排事件牌堆顶 ${x} 张牌？`, { cardId: 'opinion_leader' });
    if (ok) {
      g.reveal(p, '安排');
      const top = g.s.eventDeck.splice(-x).reverse(); // top first
      const uids = await g.ask(p, {
        kind: 'order', title: '安排：排列事件牌堆顶的顺序（第一张在最上方）', cards: top, cardId: 'opinion_leader',
        defaultValue: top.map((c) => c.uid),
      });
      const ordered = uids.map((u) => top.find((c) => c.uid === u)!);
      g.s.eventDeck.push(...ordered.reverse());
      g.log(`{p:${p.id}} 「安排」：重排了事件牌堆顶 ${x} 张牌`);
      return true;
    }
  }
  return false;
}

export async function afterDiscardPhase(g: Game, p: PlayerState) {
  if (g.revealed(p, 'hermit') && p.hand.length) {
    g.skillFx(p, '千人千乡', true);
    await g.changeCommunity(-p.hand.length, { cause: 'skill', source: p });
  }
  if (p.role === 'niche_lover' && p.influence < 0 && live(g)) {
    const n = -p.influence;
    if (await g.confirm(p, `自我产粮：翻开角色牌并抽 ${n} 张行动牌？`, { cardId: 'niche_lover' })) {
      g.reveal(p, '自我产粮');
      await g.draw(p, n);
    }
  }
}

export async function onTurnEnd(g: Game, p: PlayerState) {
  const t = g.turn!;
  if (!live(g)) return;
  // 激进集体主义者·批评
  if (t.communityDecreased) {
    for (const c of holders(g, 'collectivist')) {
      if (c === p) continue;
      if (!(await g.confirm(c, `批评：{p:${p.id}} 本回合令社群规模减少。抽一张牌，然后弃置 X 张手牌令其个人影响力 -X？`, { cardId: 'collectivist' }))) continue;
      g.reveal(c, '批评');
      await g.draw(c, 1);
      const cards = await g.chooseHand(c, '批评：弃置 X（≥1）张手牌', 1, c.hand.length, { cardId: 'collectivist' });
      await g.discard(c, cards, '批评');
      await g.changeInfluence(p, -cards.length, { source: c, cause: 'skill' });
    }
  }
  // 盈利抵制者·抵制盈利
  if ((t.gained[p.id] ?? 0) > 1) {
    for (const a of holders(g, 'anti_profit')) {
      if (a === p) continue;
      if (!(await g.confirm(a, `抵制盈利：{p:${p.id}} 本回合获得了 ${t.gained[p.id]} 张手牌，令其选择：社群规模-1 或 弃置一张手牌？`, { cardId: 'anti_profit' }))) continue;
      g.reveal(a, '抵制盈利');
      const v = await g.choose(p, `{p:${a.id}} 抵制盈利：选择一项`, [
        { value: 'comm', label: '社群规模 -1', tone: 'bad' },
        { value: 'discard', label: '弃置一张手牌', disabled: !p.hand.length },
      ], { cardId: 'anti_profit' });
      if (v === 'comm') await g.changeCommunity(-1, { source: a, cause: 'skill' });
      else await g.discardFromHand(p, 1, { cardId: 'anti_profit' });
    }
  }
  // 狂热粉丝·受益
  for (const z of g.players) {
    if (!g.revealed(z, 'zealot') || !z.idolId) continue;
    if ((t.influenceGain[z.idolId] ?? 0) > 2) {
      g.skillFx(z, '受益', true);
      await g.changeInfluence(z, 1, { cause: 'skill', source: z });
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  Action-phase options: alternative plays and skill buttons
// ════════════════════════════════════════════════════════════════════

interface AltPlay {
  as: string;
  via: string;
  key: string;
  limit: number;
  /** Using it reveals the role. */
  reveals: boolean;
}

/** Ways `p` may play *any* hand card as a specific action this turn. */
export function altPlays(g: Game, p: PlayerState): AltPlay[] {
  const out: AltPlay[] = [];
  const role = (r: string, as: string, via: string, limit: number) => {
    if (p.role === r) out.push({ as, via, key: `alt:${r}`, limit, reveals: true });
  };
  role('freeloader', 'freeload', '留邮箱', 1);
  role('circle_host', 'commission', '合同招募', 1);
  role('evangelist', 'preach', '传教', 2);
  role('touhou_police', 'police', '出警', 2);
  if (g.officialActive('soku', p)) out.push({ as: 'versus', via: '东方非想天则', key: 'alt:soku', limit: 1, reveals: false });
  return out.filter((a) => g.uses(p, a.key) < a.limit);
}

export function findAlt(g: Game, p: PlayerState, as: string, via: string) {
  return altPlays(g, p).find((a) => a.as === as && a.via === via);
}

const lastRound = (g: Game) => g.s.officialDiscard.length + 1 >= g.endTarget;

/** Skill buttons for the action phase. */
export function skillMoves(g: Game, p: PlayerState): TurnMove[] {
  if (!live(g)) return [];
  const m: TurnMove[] = [];
  const add = (skill: string, label: string, ok: boolean) => {
    if (!ok) return;
    const text = roleDef(p.role).active.find((s) => s.name === label)?.text ?? roleDef(p.role).active[0]?.text ?? '';
    m.push({
      skill, label,
      why: { title: `角色技能「${label}」`, text: `${roleDef(p.role).name}：${text}`, sourceId: p.role },
      reveals: !p.roleRevealed, // active skills turn the role card face-up
    });
  };
  const r = p.role;
  const face = !p.roleRevealed;
  add('reveal2', r === 'popular_creator' ? '新刊预告' : r === 'socialite' ? '社交教育' : '发布正片',
    ['popular_creator', 'socialite', 'cosplayer'].includes(r) && face && p.hand.length >= 2);
  add('hatsune', '初音', r === 'original_player' && face && p.hand.length >= 1);
  add('promote', '推广', r === 'platform_op' && p.hand.length >= 1 && !g.uses(p, 'promote'));
  add('kyoei', '共荣', r === 'local_king' && !g.uses(p, 'kyoei') && p.hand.some((c) => kyoeiEligible(g, p, c)));
  add('selfdestruct', '自爆', r === 'anti_fan' && p.influence > 1 && !g.uses(p, 'selfdestruct'));
  add('yakumaru', '东方药丸', r === 'doomsayer' && face && !lastRound(g));
  add('denounce', '斥责垄断', r === 'anti_authority' && p.hand.length >= 2);
  add('condescend', '居高临下', r === 'ex_brahmin' && p.hand.length >= g.s.officialDiscard.length && !g.uses(p, 'condescend'));
  add('follow', '追随', r === 'zealot' && !p.idolId);
  add('sidetake', '站队', r === 'passerby' && face);
  add('oshi', '单推', r === 'oshi' && p.hand.length >= 1 && !g.uses(p, 'oshi'));
  return m;
}

function kyoeiEligible(g: Game, p: PlayerState, c: CardInstance) {
  const d = actionDef(c.defId);
  return d.target !== null && !d.reactionOnly && (!d.judge || g.canJudge(p));
}

export async function useSkill(g: Game, p: PlayerState, skill: string) {
  const cardId = p.role;
  switch (skill) {
    case 'reveal2': {
      const name = roleDef(p.role).active[0].name;
      const cards = await g.chooseHand(p, `${name}：弃置两张手牌，翻开角色牌`, 2, 2, { cardId });
      await g.discard(p, cards);
      g.reveal(p, name);
      return;
    }
    case 'hatsune': {
      const cards = await g.chooseHand(p, '初音：弃置一张手牌，翻开角色牌', 1, 1, { cardId });
      await g.discard(p, cards);
      g.reveal(p, '初音');
      return;
    }
    case 'promote': {
      const cards = await g.chooseHand(p, '推广：弃置一张手牌', 1, 1, { cardId });
      g.use(p, 'promote');
      g.reveal(p, '推广');
      await g.discard(p, cards);
      if (g.s.community > p.influence) await g.changeInfluence(p, 1, { cause: 'skill', source: p });
      else if (p.influence > g.s.community) await g.changeCommunity(2, { cause: 'skill', source: p });
      else g.log('推广：社群规模与个人影响力相等，无效果', undefined, 'minor');
      return;
    }
    case 'kyoei': {
      const [c] = await g.chooseHand(p, '共荣：弃置一张含「指定一名（其他）玩家」的行动牌', 1, 1, {
        cardId, filter: (x) => kyoeiEligible(g, p, x),
      });
      if (!c) return;
      g.use(p, 'kyoei');
      g.reveal(p, '共荣');
      await g.discard(p, [c], '共荣');
      g.log(`{p:${p.id}} 「共荣」：视为对相邻玩家依次使用 {c:${c.defId}}`, { type: 'play', playerId: p.id, cardId: c.defId }, 'major');
      for (const t of g.neighbours(p)) {
        if (!g.targetable(t)) continue;
        await ACTIONS[c.defId].play({ g, player: p, defId: c.defId, forcedTarget: t });
      }
      return;
    }
    case 'selfdestruct': {
      const x = await g.ask(p, {
        kind: 'number', title: '自爆：个人影响力 -X，社群规模 -2X', cardId, min: 1, max: 5, defaultValue: 1,
      });
      g.use(p, 'selfdestruct');
      g.reveal(p, '自爆');
      await g.changeInfluence(p, -x, { cause: 'skill', source: p });
      await g.changeCommunity(-2 * x, { cause: 'skill', source: p });
      return;
    }
    case 'yakumaru':
      g.reveal(p, '东方药丸');
      await g.changeInfluence(p, 2, { cause: 'skill', source: p });
      return;
    case 'denounce': {
      const cards = await g.chooseHand(p, '斥责垄断：弃置两张手牌', 2, 2, { cardId });
      g.reveal(p, '斥责垄断');
      await g.discard(p, cards);
      for (const t of g.others(p).filter((x) => x.influence > p.influence)) {
        const v = await g.choose(t, `{p:${p.id}} 斥责垄断：选择一项`, [
          { value: 'discard', label: '弃置两张手牌', disabled: t.hand.length <= 1 },
          { value: 'inf', label: '个人影响力 -2', tone: 'bad' },
          { value: 'comm', label: '社群规模 -3', tone: 'bad' },
        ], { cardId });
        if (v === 'discard') await g.discardFromHand(t, 2, { cardId });
        else if (v === 'inf') await g.changeInfluence(t, -2, { cause: 'skill', source: p });
        else await g.changeCommunity(-3, { cause: 'skill', source: p });
      }
      return;
    }
    case 'condescend': {
      const x = g.s.officialDiscard.length;
      const cards = await g.chooseHand(p, `居高临下：弃置 ${x} 张手牌，社群规模成为0`, x, x, { cardId });
      g.use(p, 'condescend');
      g.reveal(p, '居高临下');
      await g.discard(p, cards);
      g.setCommunity(0);
      return;
    }
    case 'follow': {
      const idol = await g.choosePlayer(p, '追随：指定一名其他玩家成为你的偶像', g.others(p), { cardId });
      g.reveal(p, '追随');
      p.idolId = idol.id;
      g.log(`{p:${p.id}} 成为了 {p:${idol.id}} 的狂热粉丝`, undefined, 'major');
      return;
    }
    case 'sidetake': {
      const v = await g.choose(p, '站队：宣称你从属的阵营', FACTIONS.map((f, i) => ({ value: String(i), label: factionLabel(f) })), { cardId });
      g.reveal(p, '站队');
      p.allegiance = FACTIONS[Number(v)];
      g.log(`{p:${p.id}} 宣称从属于 ${factionLabel(p.allegiance)} 阵营`, undefined, 'major');
      return;
    }
    case 'oshi': {
      const cards = await g.chooseHand(p, '单推：将一张手牌作为单推牌放在一边', 1, 1, { cardId });
      g.use(p, 'oshi');
      g.reveal(p, '单推');
      const removed = await g.loseCards(p, cards);
      p.oshi.push(...removed);
      g.log(`{p:${p.id}} 「单推」：放置了一张单推牌（共 ${p.oshi.length} 张）`);
      return;
    }
  }
}
