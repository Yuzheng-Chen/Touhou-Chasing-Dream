import {
  ROLE_CARDS, STARTING_HAND, actionDef, eventDef, officialDef, roleDef,
  type CardInstance, type FxVia, type SettleTo, type TurnMove,
} from '@tcd/shared';
import { ACTIONS } from './actions.js';
import { decideDirection, resolveEvent } from './events.js';
import { AbortError, type Game } from './Game.js';
import { revealOfficial } from './officials.js';
import * as Roles from './roles.js';
import { scoreGame } from './scoring.js';
import type { PlayerState, TurnState } from './state.js';

/** Run a whole game to completion. Resolves when finished; rejects with AbortError if aborted. */
export async function runGame(g: Game) {
  await selectRoles(g);
  setupTable(g);
  for (;;) {
    await playRound(g);
    if (g.s.officialDiscard.length >= g.endTarget || !g.s.officialDeck.length) break;
  }
  await finalSettlement(g);
  g.s.result = scoreGame(g);
  g.s.phase = 'finished';
  g.s.turnIdx = null;
  const names = g.s.result.winnerIds.map((id) => `{p:${id}}`).join('、');
  g.log(names ? `游戏结束！胜者：${names}` : '游戏结束！无人满足胜利条件', undefined, 'round');
}

/** Swallow rule-engine bugs so a live game keeps going; aborts still propagate. */
async function safely(g: Game, what: string, f: () => Promise<void>) {
  try {
    await f();
  } catch (e) {
    if (e instanceof AbortError) throw e;
    console.error(`[game ${g.s.id}] error during ${what}:`, e);
    g.log(`⚠ 结算「${what}」时发生错误，已跳过`, undefined, 'minor');
  }
}

// ════════════════════════════════════════════════════════════════════
//  Setup
// ════════════════════════════════════════════════════════════════════

async function selectRoles(g: Game) {
  g.s.phase = 'roleSelect';
  const n = g.players.length;
  if (g.opts.roles) {
    g.players.forEach((p, i) => {
      p.role = g.opts.roles![i % g.opts.roles!.length];
      p.roleOptions = [p.role];
      if (p.role === 'hermit' || g.opts.revealRoles) g.reveal(p, '千人千乡：开局正面向上');
    });
    return;
  }
  const k = Math.max(1, Math.min(g.opts.roleChoices, Math.floor(ROLE_CARDS.length / n)));
  // Balance: everyone is offered at least one 繁荣 and one 小众 role when possible.
  const pool = g.rng.shuffle(ROLE_CARDS.map((r) => r.id));
  const take = (pred: (id: string) => boolean) => {
    const i = pool.findIndex(pred);
    return i >= 0 ? pool.splice(i, 1)[0] : undefined;
  };
  for (const p of g.players) {
    const opts: string[] = [];
    if (k >= 2 && g.opts.balancedRoles !== false) {
      for (const stance of ['prosper', 'niche'] as const) {
        const id = take((x) => roleDef(x).stance === stance);
        if (id) opts.push(id);
      }
    }
    while (opts.length < k && pool.length) opts.push(pool.pop()!);
    p.roleOptions = g.rng.shuffle(opts);
  }
  g.log('请选择你的角色', undefined, 'round');
  const picks = await Promise.all(g.players.map((p) =>
    g.choose(p, '选择你本局使用的角色', p.roleOptions.map((id) => ({ value: id, label: roleDef(id).name })), {
      body: '角色阵营需要保密；发动主动技能时角色牌会翻开。',
      defaultValue: p.roleOptions[0],
    })));
  g.players.forEach((p, i) => {
    p.role = picks[i];
  });
  g.log('所有玩家已选定角色', undefined, 'minor');
  for (const p of g.players) if (p.role === 'hermit') g.reveal(p, '千人千乡：开局正面向上');
}

function setupTable(g: Game) {
  const n = g.players.length;
  const hostIdx = g.players.findIndex((p) => p.host);
  const hostFirst = g.opts.firstPlayer === 'host' && hostIdx >= 0;
  g.s.firstIdx = hostFirst ? hostIdx : g.rng.int(n);
  g.log(`${hostFirst ? '房主先手' : '掷骰决定先手'}：{p:${g.players[g.s.firstIdx].id}} 为第一名玩家`, undefined, 'major');
  const hand = g.opts.startingHand ?? STARTING_HAND;
  for (const p of g.players) {
    const cards: CardInstance[] = [];
    for (let i = 0; i < hand; i++) {
      const c = g.takeActionTop();
      if (c) cards.push(c);
    }
    p.hand.push(...cards);
  }
  g.log(`每位玩家摸 ${hand} 张行动牌，游戏开始！`);
}

// ════════════════════════════════════════════════════════════════════
//  Rounds
// ════════════════════════════════════════════════════════════════════

async function playRound(g: Game) {
  const s = g.s;
  s.round += 1;
  s.phase = 'official';
  s.turnIdx = null;
  await g.show(`第 ${s.round} 轮`, { type: 'round', round: s.round, total: g.endTarget }, 'round');
  const first = g.players[s.firstIdx];
  const guesses = await Roles.researcherGuess(g);
  await revealOfficial(g, first);
  await Roles.settleGuesses(g, guesses);

  for (let k = 0; k < g.players.length; k++) {
    const idx = (s.firstIdx + k) % g.players.length;
    await playTurn(g, g.players[idx], idx);
  }

  s.phase = 'roundEnd';
  s.turnIdx = null;
  if (s.currentOfficial) {
    s.officialDiscard.push(s.currentOfficial);
    g.log(`官作弃置：{c:${s.currentOfficial.defId}}`, undefined, 'minor');
    s.currentOfficial = null;
  }
  s.officialSuppressed = false;
  g.touch();
}

function newTurn(p: PlayerState): TurnState {
  return {
    playerId: p.id, actionsPlayed: 0, handAtStart: p.hand.length, communityDecreased: false,
    gained: {}, influenceGain: {}, groupPlayed: [], uses: {}, skipDiscard: false, noHandLimit: false,
    loanActive: false, skipDraw: false, maxScoreOfficial: null, ended: false, marsEvent: false,
  };
}

async function playTurn(g: Game, p: PlayerState, idx: number) {
  const s = g.s;
  s.turnIdx = idx;
  s.turn = newTurn(p);
  const t = s.turn;
  s.phase = 'turnStart';
  await g.show(`{p:${p.id}} 的回合`, { type: 'turn', playerId: p.id, round: s.round }, 'round');

  // 人类的本质 arrives.
  if (p.pendingGift.length) {
    const gift = p.pendingGift.splice(0);
    g.log(`{p:${p.id}} 获得了 {c:human_nature}`);
    await g.gainCards(p, gift, null);
  }
  // Statuses in front of this player expire now.
  let skip = false;
  for (const st of p.statuses.splice(0)) {
    if (st.kind === 'crackdown') skip = true;
    if (st.kind === 'loan') {
      t.loanActive = true;
      t.skipDraw = true;
    }
    s.eventDiscard.push(st.card);
    g.log(`{c:${st.card.defId}} 进入弃牌堆`, undefined, 'minor');
  }
  t.handAtStart = p.hand.length;
  const brahminBonus = g.revealed(p, 'ex_brahmin') && p.hand.length === 0;

  if (skip) {
    g.log(`{p:${p.id}} 被「扫黄打非」跳过回合`, undefined, 'major');
  } else {
    await safely(g, '回合开始', () => Roles.onTurnStart(g, p));
    await eventDrawPhase(g, p);
    if (!t.ended) await drawPhase(g, p, brahminBonus);
    if (!t.ended) await actionPhase(g, p);
    if (!t.ended) await eventPhase(g, p);
    if (!t.ended) await discardPhase(g, p);
  }
  await turnEnd(g, p);
}

// ════════════════════════════════════════════════════════════════════
//  Phases
// ════════════════════════════════════════════════════════════════════

/** A freshly drawn 大病一场 is played at once and ends the turn. Returns true if it was. */
function checkSick(g: Game, p: PlayerState, card: CardInstance): boolean {
  if (!eventDef(card.defId).forced) return false;
  p.turnEvent = null;
  g.showLater(`{p:${p.id}} 抽到了 {c:${card.defId}}，立即结束回合！`, { type: 'event', playerId: p.id, cardId: card.defId, direction: 'none' }, 'major');
  g.addStatus(p, 'sick', card, '大病一场');
  if (g.turn?.playerId === p.id) g.turn.ended = true;
  return true;
}

async function eventDrawPhase(g: Game, p: PlayerState) {
  g.s.phase = 'eventDraw';
  await safely(g, '吃瓜', () => Roles.beforeEventDraw(g, p));
  const card = g.drawEventCard();
  if (!card) return;
  p.turnEvent = card;
  g.log(`{p:${p.id}} 获取了本回合事件牌`, undefined, 'minor');
  if (checkSick(g, p, card)) return;
  // 东方天空璋
  if (g.officialActive('hsifs', p) && !g.s.lockdown) {
    const redo = await g.confirm(p, '东方天空璋：弃置当前事件牌并重新抽一张？', { cardId: card.defId });
    if (redo) {
      g.s.eventDiscard.push(card);
      p.turnEvent = null;
      const again = g.drawEventCard();
      g.log(`{p:${p.id}} 弃置了事件 {c:${card.defId}} 并重新抽取`);
      if (again) {
        p.turnEvent = again;
        checkSick(g, p, again);
      }
    }
  }
}

async function drawPhase(g: Game, p: PlayerState, brahminBonus: boolean) {
  g.s.phase = 'draw';
  const t = g.turn!;
  if (t.skipDraw) {
    g.log(`{p:${p.id}} 跳过摸牌阶段（得到借款）`, undefined, 'minor');
    return;
  }
  if (g.anyStatus('generationGap')) {
    g.log('「青黄不接」：无法在摸牌阶段抽牌', undefined, 'minor');
    return;
  }
  // 东方文花帖DS: steal instead of drawing.
  if (g.officialActive('ds', p) && !g.s.lockdown) {
    const victims = g.others(p).filter((x) => x.hand.length && g.targetable(x));
    if (victims.length && (await g.confirm(p, '东方文花帖DS：放弃抽牌，改为获得另一名玩家的一张手牌？', { cardId: 'ds' }))) {
      const v = await g.choosePlayer(p, '选择一名玩家', victims, { cardId: 'ds' });
      const c = g.randomHandCard(v);
      if (c) await g.transfer(v, p, [c]);
      await g.draw(v, 1, p);
      return;
    }
  }
  let n = 1;
  if (g.officialActive('in', p)) n++;
  if (g.s.bloomingBonus) n++;
  if (g.revealed(p, 'niche_lover') && p.influence > 1) n++;
  if (brahminBonus) n++;
  await g.draw(p, n);
  if (g.revealed(p, 'popular_creator')) {
    g.log(`{p:${p.id}} 「备受瞩目」`, undefined, 'minor');
    await g.draw(p, 1);
  }
}

async function actionPhase(g: Game, p: PlayerState) {
  g.s.phase = 'action';
  const skip = await Roles.beforeActionPhase(g, p);
  if (skip) return;
  for (;;) {
    const moves = listMoves(g, p);
    const ans = await g.ask(p, {
      kind: 'turn', title: '行动阶段', body: '打出行动牌或发动技能，完成后结束行动阶段。',
      moves, defaultValue: { type: 'end' },
    });
    if (ans.type === 'end') break;
    const m = moves[ans.index];
    await safely(g, m.label, () => executeMove(g, p, m));
    if (g.turn!.ended) break;
  }
}

async function eventPhase(g: Game, p: PlayerState) {
  g.s.phase = 'eventResolve';
  const t = g.turn!;
  const card = p.turnEvent;
  if (!card) return;
  const d = eventDef(card.defId);
  const forcedPlay = t.marsEvent;
  const forcedDown = !forcedPlay && g.officialActive('ulil', p);
  let choice: 'play' | 'down' = forcedDown ? 'down' : 'play';
  if (!forcedPlay && !forcedDown) {
    choice = (await g.choose(p, `事件结算：如何处理「${d.name}」？`, [
      { value: 'play', label: '打出', hint: '决定方向并立即结算', tone: 'primary' },
      {
        value: 'down', label: '扣置',
        hint: p.faceDownEvent ? `需先正向打出已扣置的事件，再扣置本牌；扣置的牌只能正向打出` : '扣置的事件牌只能在之后正向打出',
      },
    ], { cardId: card.defId })) as 'play' | 'down';
  } else if (forcedDown) {
    g.log('「东方深秘录」：必须扣置事件牌', undefined, 'minor');
  }
  p.turnEvent = null;
  await safely(g, `事件 ${d.name}`, async () => {
    if (choice === 'down') {
      const old = p.faceDownEvent;
      p.faceDownEvent = null;
      if (old) {
        g.log(`{p:${p.id}} 翻开扣置的事件牌`);
        await resolveEvent(g, p, old, eventDef(old.defId).shape === 'none' ? 'none' : 'up');
      }
      p.faceDownEvent = card;
      g.log(`{p:${p.id}} 扣置了本回合事件牌`);
    } else {
      const dir = await decideDirection(g, p, card);
      await resolveEvent(g, p, card, dir);
    }
  });
  // 投机主义者·蹭热度
  while (p.role === 'opportunist' && p.hand.length && !t.ended && !g.s.lockdown) {
    if (!(await g.confirm(p, '蹭热度：弃置一张手牌，立即抽一张事件牌并结算？', { cardId: 'opportunist' }))) break;
    const [c] = await g.chooseHand(p, '蹭热度：选择弃置的手牌', 1, 1, { cardId: 'opportunist' });
    g.reveal(p, '蹭热度');
    await g.discard(p, [c], '蹭热度');
    const extra = g.drawEventCard();
    if (!extra) break;
    if (checkSick(g, p, extra)) break;
    await safely(g, '蹭热度', async () => {
      const dir = await decideDirection(g, p, extra);
      await resolveEvent(g, p, extra, dir);
    });
  }
}

async function discardPhase(g: Game, p: PlayerState) {
  g.s.phase = 'discard';
  const t = g.turn!;
  await Roles.exBrahminCheck(g, p);
  if (t.skipDiscard) {
    g.log(`{p:${p.id}} 跳过弃牌阶段`, undefined, 'minor');
  } else if (g.officialActive('lolk', p)) {
    const diff = p.hand.length - t.handAtStart;
    if (diff < 0) await g.draw(p, -diff);
    if (diff > 0) await g.discardFromHand(p, diff, { title: `东方绀珠传：弃置 ${diff} 张手牌至回合开始时的手牌数`, cardId: 'lolk' });
  } else {
    const lim = g.handLimit(p);
    if (lim !== null && p.hand.length > lim) {
      const over = p.hand.length - lim;
      await g.discardFromHand(p, over, { title: `弃牌阶段：手牌上限 ${lim}，弃置 ${over} 张` });
    }
  }
  await safely(g, '弃牌阶段结束', () => Roles.afterDiscardPhase(g, p));
}

async function turnEnd(g: Game, p: PlayerState) {
  g.s.phase = 'turnEnd';
  const t = g.turn!;
  await safely(g, '回合结束', async () => {
    // 妖精大战争
    if (g.officialActive('gfw', p)) {
      const trio = [g.prev(p), p, g.next(p)];
      if (trio.every((x) => x.influence > 0) || trio.every((x) => x.influence < 0)) {
        g.log('「妖精大战争」：三人个人影响力同号', undefined, 'minor');
        await g.changeCommunity(await g.chooseSign(p, 3, 'gfw'), { source: p, cause: 'official' });
      }
    }
    // 东方妖妖梦
    if (g.officialActive('pcb', p)) {
      const lim = g.handLimit(p);
      if (lim !== null && p.hand.length >= lim) await g.changeInfluence(p, 1, { source: p, cause: 'official' });
    }
    // 东方萃梦想
    if (g.officialActive('iamp', p) && t.groupPlayed.length) {
      const back = g.s.actionDiscard.filter((c) => t.groupPlayed.includes(c.uid));
      if (back.length) {
        g.s.actionDiscard = g.s.actionDiscard.filter((c) => !back.includes(c));
        g.log(`「东方萃梦想」：{p:${p.id}} 拿回了 ${back.map((c) => `{c:${c.defId}}`).join('')}`);
        await g.gainCards(p, back, p);
      }
    }
    await Roles.onTurnEnd(g, p);
    // 东方地灵殿
    if (g.officialActive('sa', p)) {
      const top = Math.max(...g.players.map((x) => x.influence));
      const leaders = g.orderFrom(p).filter((x) => x.influence === top);
      if (leaders.length <= 2) {
        for (const l of leaders) {
          const v = await g.choose(l, '东方地灵殿：你是影响力最高的玩家，令社群规模±1？', [
            { value: 'skip', label: '不发动' },
            { value: '+', label: '社群规模 +1', tone: 'good' },
            { value: '-', label: '社群规模 −1', tone: 'bad' },
          ], { cardId: 'sa', defaultValue: 'skip' });
          if (v !== 'skip') await g.changeCommunity(v === '+' ? 1 : -1, { source: l, cause: 'official' });
        }
      }
    }
  });
  g.log(`{p:${p.id}} 的回合结束`, undefined, 'minor');
}

// ════════════════════════════════════════════════════════════════════
//  Action phase moves
// ════════════════════════════════════════════════════════════════════

function canPlayAs(g: Game, p: PlayerState, defId: string): boolean {
  const d = actionDef(defId);
  if (d.reactionOnly || defId === 'human_nature') return false;
  if (d.judge && !g.canJudge(p)) return false;
  const h = ACTIONS[defId];
  return !h.canPlay || h.canPlay(g, p);
}

export function listMoves(g: Game, p: PlayerState): TurnMove[] {
  const t = g.turn!;
  const moves: TurnMove[] = [];
  const name = (id: string) => g.cardName(id);
  const copy = g.s.lastActionDiscarded;
  const third = t.actionsPlayed === 2 && g.officialActive('wbawc', p) && !!copy;
  const alts = Roles.altPlays(g, p);
  for (const c of p.hand) {
    let eff = c.defId === 'human_nature' ? copy : c.defId;
    if (third) eff = copy;
    if (eff && canPlayAs(g, p, eff)) {
      // Why does this card count as another one? (shown when hovering the option)
      const why = c.defId === 'human_nature'
        ? { title: '人类的本质', text: `这张牌视作上一张进入弃牌堆的行动牌「${name(eff)}」的复制。结算后它不会进入弃牌堆，而是交给你的下一位玩家。`, sourceId: 'human_nature' }
        : third && eff !== c.defId
          ? { title: '东方鬼形兽', text: `官作「东方鬼形兽」：你回合内打出的第 3 张行动牌，视作上一张进入弃牌堆的行动牌「${name(eff)}」的复制。`, sourceId: 'wbawc' }
          : undefined;
      moves.push({ uid: c.uid, as: eff, why, label: eff === c.defId ? `打出「${name(c.defId)}」` : `打出「${name(c.defId)}」（视作「${name(eff)}」）` });
    }
    if (third) continue;
    for (const a of alts) {
      if (a.as === c.defId || !canPlayAs(g, p, a.as)) continue;
      const fromRole = a.reveals;
      const skillText = fromRole ? roleDef(p.role).active.find((s) => s.name === a.via)?.text ?? '' : officialDef('soku').text;
      moves.push({
        uid: c.uid, as: a.as, via: a.via,
        label: `将「${name(c.defId)}」当作「${name(a.as)}」打出（${a.via}）`,
        why: fromRole
          ? { title: `角色技能「${a.via}」`, text: `${roleDef(p.role).name}：${skillText}`, sourceId: p.role }
          : { title: '官作「东方非想天则」', text: skillText, sourceId: 'soku' },
        reveals: fromRole && !p.roleRevealed,
      });
    }
  }
  moves.push(...Roles.skillMoves(g, p));
  return moves;
}

async function executeMove(g: Game, p: PlayerState, m: TurnMove) {
  if (m.skill) return Roles.useSkill(g, p, m.skill);
  if (m.uid && m.as) return playCard(g, p, m.uid, m.as, m.via);
}

export async function playCard(g: Game, p: PlayerState, uid: string, as: string, via?: string) {
  const t = g.turn!;
  const card = p.hand.find((c) => c.uid === uid);
  if (!card) return;
  if (via) {
    const alt = Roles.findAlt(g, p, as, via);
    if (!alt) return;
    g.use(p, alt.key);
    if (alt.reveals) g.reveal(p, via);
  }
  await g.loseCards(p, [card]);
  t.actionsPlayed += 1;
  const d = actionDef(as);
  // Where does an unusual play come from? Shown on the card as it lands.
  let source: FxVia | undefined;
  if (via) {
    source = Roles.findAlt(g, p, as, via)?.reveals !== false && p.role && roleDef(p.role).active.some((s) => s.name === via)
      ? { skill: via, sourceId: p.role }
      : { skill: '东方非想天则', sourceId: 'soku' };
  } else if (card.defId === 'human_nature') source = { skill: '人类的本质', sourceId: 'human_nature' };
  else if (as !== card.defId) source = { skill: '东方鬼形兽', sourceId: 'wbawc' };
  let to: SettleTo = 'discard';
  let delayed = false;
  await g.stage(
    p,
    `{p:${p.id}} 打出 {c:${card.defId}}${as !== card.defId ? ` 视作 {c:${as}}` : ''}`,
    { type: 'play', playerId: p.id, cardId: card.defId, as: as !== card.defId ? as : undefined, via: source },
    async () => {
      if (t.actionsPlayed === 3 && g.officialActive('ufo', p)) {
        g.log('「东方星莲船」：第三张行动牌，抽一张', undefined, 'minor');
        await g.draw(p, 1);
      }
      // 东方黑·黑料
      if (p.role === 'anti_fan' && ['expose', 'police', 'rumor'].includes(as)) {
        if (!p.roleRevealed && (await g.confirm(p, '黑料：翻开角色牌？此后每次打出挂裱/出警/造谣时个人影响力+1', { cardId: 'anti_fan' }))) {
          g.reveal(p, '黑料');
        }
        if (p.roleRevealed) await g.changeInfluence(p, 1, { source: p, cause: 'skill' });
      }
      if (d.category === 'delay') {
        delayed = true;
        to = 'delay';
        g.s.delayZone.push({ card, ownerId: p.id, effect: as });
        g.log(`{c:${as}} 进入延时区，将在下一张事件牌生效时触发`, undefined, 'minor');
        return;
      }
      await ACTIONS[as].play({ g, player: p, defId: as });
    },
    {
      to: () => (card.defId === 'human_nature' && !delayed ? 'gift' : to),
      toId: () => (card.defId === 'human_nature' && !delayed ? g.next(p).id : undefined),
      finish: () => {
        if (delayed) return;
        if (d.category === 'group') t.groupPlayed.push(card.uid);
        if (card.defId === 'human_nature') {
          const nxt = g.next(p);
          nxt.pendingGift.push(card);
          g.log(`{c:human_nature} 交付给 {p:${nxt.id}}，将在其回合开始时加入手牌`, undefined, 'minor');
        } else {
          g.toDiscard([card]);
        }
      },
    },
  );
}

// ════════════════════════════════════════════════════════════════════
//  Final settlement
// ════════════════════════════════════════════════════════════════════

async function finalSettlement(g: Game) {
  const s = g.s;
  s.phase = 'finalSettlement';
  s.lockdown = true;
  // The last official to enter the discard pile stays in effect (lifted back out while it is current).
  s.currentOfficial = s.officialDiscard.pop() ?? null;
  g.log('最终事件结算：从最后一名玩家开始逆时针翻开扣置的事件牌', undefined, 'round');
  const last = g.prev(g.players[s.firstIdx]);
  for (let k = 0; k < g.players.length; k++) {
    const p = g.next(last, -k);
    if (!p.faceDownEvent) continue;
    s.turnIdx = p.seat;
    s.turn = newTurn(p);
    const card = p.faceDownEvent;
    p.faceDownEvent = null;
    await safely(g, `最终结算 ${eventDef(card.defId).name}`, () =>
      resolveEvent(g, p, card, eventDef(card.defId).shape === 'none' ? 'none' : 'up'));
  }
  if (s.currentOfficial) s.officialDiscard.push(s.currentOfficial);
  s.currentOfficial = null;
  s.turnIdx = null;
}
