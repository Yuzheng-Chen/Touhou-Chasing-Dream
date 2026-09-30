import {
  ACTION_CARDS, BASE_INFLUENCE_CAP, COMMUNITY_LIMIT, EVENT_CARDS, JUDGE_LABEL, OFFICIAL_CARDS,
  actionDef, baseHandLimit, cardDef, judgeResult,
  type AnswerOf, type CardInstance, type Fx, type JudgeKind, type LogEntry, type Prompt,
  type PromptKind, type PromptSpec, type Tone,
} from '@tcd/shared';
import { botAnswer } from './bot.js';
import { normalizeAnswer } from './answers.js';
import { Rng } from './rng.js';
import * as Roles from './roles.js';
import type { GameState, PlayerState, Status, StatusKind, TurnState } from './state.js';

export interface Seat {
  id: string;
  name: string;
  isBot: boolean;
}

export interface GameOptions {
  seed?: number;
  /** ms before a human prompt resolves with its default. 0 = wait forever. */
  promptTimeout: number;
  /** ms bots "think" before answering. */
  botDelay: number;
  roleChoices: number;
  /** Skip cosmetic pauses (tests / simulations). */
  fast?: boolean;
  /**
   * Tests: answer every prompt synchronously with this policy (return undefined to fall back to the bot).
   * Lets a test script exact decisions without sockets.
   */
  decide?: (g: Game, who: PlayerState, prompt: Prompt) => unknown;
}

/** What caused a number to change — decides immunities and triggers. */
export type Cause = 'action' | 'event' | 'skill' | 'official' | 'rule';

export interface ChangeOpts {
  source?: PlayerState | null;
  cause: Cause;
  cardId?: string;
}

interface Pending {
  prompt: Prompt;
  playerId: string;
  secret: boolean;
  resolve: (value: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class AbortError extends Error {
  constructor() {
    super('game aborted');
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Grow/shrink the magnitude of a signed offset, never flipping its sign. */
export const adjustMagnitude = (d: number, k: number) => (d === 0 ? 0 : Math.sign(d) * Math.max(0, Math.abs(d) + k));

/**
 * Authoritative game state plus the primitives every card, event and skill is built from.
 * The round/turn loop lives in flow.ts; card effects in actions.ts / events.ts; roles in roles.ts.
 */
export class Game {
  readonly s: GameState;
  readonly rng: Rng;
  readonly opts: GameOptions;
  private pending = new Map<string, Pending>();
  private promptSeq = 0;
  private uidSeq = 0;
  private flushQueued = false;
  aborted = false;

  constructor(seats: Seat[], opts: GameOptions, private readonly onUpdate: () => void = () => {}) {
    this.opts = opts;
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(seed);
    const build = (defs: { id: string; count: number }[]) =>
      this.rng.shuffle(defs.flatMap((d) => Array.from({ length: d.count }, () => this.newCard(d.id))));
    this.s = {
      id: Math.random().toString(36).slice(2, 10),
      seed,
      phase: 'roleSelect',
      round: 0,
      players: seats.map((seat, i) => ({
        id: seat.id, name: seat.name, seat: i, isBot: seat.isBot,
        role: '', roleOptions: [], roleRevealed: false, influence: 0,
        hand: [], turnEvent: null, faceDownEvent: null, statuses: [], oshi: [],
        allegiance: null, idolId: null, pendingGift: [], maxScoreUsed: [],
      })),
      firstIdx: 0,
      turnIdx: null,
      community: 0,
      actionDeck: build(ACTION_CARDS),
      eventDeck: build(EVENT_CARDS),
      officialDeck: build(OFFICIAL_CARDS),
      actionDiscard: [], eventDiscard: [], officialDiscard: [],
      currentOfficial: null, officialCopyOf: null, officialSuppressed: false,
      chainZone: [], delayZone: [],
      lastActionDiscarded: null, lastEvent: null,
      bloomingBonus: false, lockdown: false,
      turn: null, log: [], logSeq: 0, result: null,
    };
  }

  newCard(defId: string): CardInstance {
    return { uid: `c${++this.uidSeq}`, defId };
  }

  // ══════════════════════════════════════════════════════════════
  //  Lookups
  // ══════════════════════════════════════════════════════════════

  get players() {
    return this.s.players;
  }
  player(id: string): PlayerState {
    const p = this.s.players.find((x) => x.id === id);
    if (!p) throw new Error(`no player ${id}`);
    return p;
  }
  get current(): PlayerState | null {
    return this.s.turnIdx === null ? null : this.s.players[this.s.turnIdx];
  }
  get turn(): TurnState | null {
    return this.s.turn;
  }
  isTurnOf(p: PlayerState) {
    return this.current?.id === p.id;
  }
  /** Clockwise neighbour k seats away. next = 下一位 = 左手边. */
  next(p: PlayerState, k = 1): PlayerState {
    const n = this.s.players.length;
    return this.s.players[(((p.seat + k) % n) + n) % n];
  }
  prev(p: PlayerState) {
    return this.next(p, -1);
  }
  /** Everyone in turn order starting from `p` (inclusive). */
  orderFrom(p: PlayerState): PlayerState[] {
    return this.s.players.map((_, i) => this.next(p, i));
  }
  others(p: PlayerState) {
    return this.orderFrom(p).slice(1);
  }
  neighbours(p: PlayerState): PlayerState[] {
    const l = this.prev(p);
    const r = this.next(p);
    return l === r ? [l] : [l, r];
  }

  // ══════════════════════════════════════════════════════════════
  //  Log / broadcast
  // ══════════════════════════════════════════════════════════════

  log(text: string, fx?: Fx, level: LogEntry['level'] = 'info') {
    const e: LogEntry = { seq: ++this.s.logSeq, at: Date.now(), text, level, fx };
    this.s.log.push(e);
    if (this.s.log.length > 400) this.s.log.splice(0, this.s.log.length - 400);
    this.touch();
  }

  /** Schedule a (batched) state broadcast. */
  touch() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.onUpdate();
    });
  }

  async pause(ms: number) {
    if (this.opts.fast || ms <= 0) return;
    this.touch();
    await new Promise((r) => setTimeout(r, ms));
    if (this.aborted) throw new AbortError();
  }

  // ══════════════════════════════════════════════════════════════
  //  Prompts
  // ══════════════════════════════════════════════════════════════

  /** Pending prompt addressed to `playerId`, if any. */
  promptFor(playerId: string): Prompt | null {
    for (const p of this.pending.values()) if (p.playerId === playerId) return p.prompt;
    return null;
  }

  /** Players the table is visibly waiting on (secret reaction windows excluded). */
  waitingOn(): string[] {
    return [...new Set([...this.pending.values()].filter((p) => !p.secret).map((p) => p.playerId))];
  }

  /**
   * Ask a player to decide. Bots answer after `botDelay`; humans time out to `defaultValue`.
   * `secret` hides the wait from other players (reaction windows that would leak hand info).
   */
  ask<K extends PromptKind>(
    who: PlayerState,
    spec: Extract<PromptSpec, { kind: K }>,
    opts: { secret?: boolean } = {},
  ): Promise<AnswerOf<K>> {
    if (this.aborted) return Promise.reject(new AbortError());
    const id = `q${++this.promptSeq}`;
    const timeout = who.isBot ? 0 : this.opts.promptTimeout;
    const prompt = { ...spec, id, deadline: timeout ? Date.now() + timeout : 0 } as Prompt;
    return new Promise<AnswerOf<K>>((resolve, reject) => {
      const entry: Pending = {
        prompt, playerId: who.id, secret: !!opts.secret,
        resolve: (v) => {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          this.touch();
          if (v instanceof Error) reject(v); // AbortError, or an invalid scripted answer in tests
          else resolve(v as AnswerOf<K>);
        },
      };
      this.pending.set(id, entry);
      if (this.opts.decide) {
        setImmediate(() => {
          if (!this.pending.has(id)) return;
          const scripted = this.opts.decide!(this, who, prompt);
          const v = scripted === undefined ? undefined : normalizeAnswer(prompt, scripted);
          if (scripted !== undefined && v === undefined) {
            entry.resolve(new Error(`scripted answer ${JSON.stringify(scripted)} invalid for "${prompt.title}"`) as never);
            return;
          }
          entry.resolve(v ?? botAnswer(this, who, prompt));
        });
      } else if (who.isBot) {
        const reply = () => this.pending.has(id) && entry.resolve(botAnswer(this, who, prompt));
        if (this.opts.fast) setImmediate(reply);
        else entry.timer = setTimeout(reply, this.opts.botDelay * (0.6 + this.rng.next() * 0.8));
      } else if (timeout) {
        entry.timer = setTimeout(() => entry.resolve(prompt.defaultValue), timeout);
      }
      this.touch();
    });
  }

  /** Called by the room when a client answers. Returns false for stale/invalid answers. */
  answer(playerId: string, promptId: string, value: unknown): boolean {
    const p = this.pending.get(promptId);
    if (!p || p.playerId !== playerId) return false;
    const v = normalizeAnswer(p.prompt, value);
    if (v === undefined) return false;
    p.resolve(v);
    return true;
  }

  abort() {
    this.aborted = true;
    for (const p of [...this.pending.values()]) p.resolve(new AbortError());
  }

  // — convenience wrappers —

  async choose(
    who: PlayerState,
    title: string,
    options: { value: string; label: string; tone?: Tone; disabled?: boolean; hint?: string }[],
    extra: { body?: string; cardId?: string; defaultValue?: string; secret?: boolean } = {},
  ): Promise<string> {
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 1 && !extra.secret && options.length === 1) return enabled[0].value;
    return this.ask(who, {
      kind: 'choice', title, options, body: extra.body, cardId: extra.cardId,
      defaultValue: extra.defaultValue ?? enabled[0].value,
    }, { secret: extra.secret });
  }

  async confirm(
    who: PlayerState,
    title: string,
    extra: { body?: string; cardId?: string; yes?: string; no?: string; secret?: boolean } = {},
  ): Promise<boolean> {
    const v = await this.choose(who, title, [
      { value: 'yes', label: extra.yes ?? '发动', tone: 'primary' },
      { value: 'no', label: extra.no ?? '不发动' },
    ], { ...extra, defaultValue: 'no' });
    return v === 'yes';
  }

  async choosePlayer(
    who: PlayerState,
    title: string,
    candidates: PlayerState[],
    extra: { body?: string; cardId?: string } = {},
  ): Promise<PlayerState> {
    if (candidates.length === 1) return candidates[0];
    const [id] = await this.ask(who, {
      kind: 'players', title, ...extra, candidates: candidates.map((c) => c.id), min: 1, max: 1,
      defaultValue: [this.rng.pick(candidates).id],
    });
    return this.player(id);
  }

  /** Pick between `min` and `max` cards from own hand. */
  async chooseHand(
    who: PlayerState,
    title: string,
    min: number,
    max: number,
    extra: { body?: string; cardId?: string; filter?: (c: CardInstance) => boolean; secret?: boolean } = {},
  ): Promise<CardInstance[]> {
    const pool = extra.filter ? who.hand.filter(extra.filter) : who.hand;
    max = Math.min(max, pool.length);
    min = Math.min(min, max);
    if (max === 0) return [];
    if (min === pool.length && max === pool.length) return [...pool];
    const uids = await this.ask(who, {
      kind: 'cards', title, body: extra.body, cardId: extra.cardId, source: 'hand',
      cards: pool, min, max, defaultValue: pool.slice(0, min).map((c) => c.uid),
    }, { secret: extra.secret });
    return uids.map((u) => pool.find((c) => c.uid === u)!).filter(Boolean);
  }

  async chooseFromList(
    who: PlayerState,
    title: string,
    cards: CardInstance[],
    min: number,
    max: number,
    extra: { body?: string; cardId?: string } = {},
  ): Promise<CardInstance[]> {
    max = Math.min(max, cards.length);
    min = Math.min(min, max);
    if (max === 0) return [];
    const uids = await this.ask(who, {
      kind: 'cards', title, ...extra, source: 'list', cards, min, max,
      defaultValue: cards.slice(0, min).map((c) => c.uid),
    });
    return uids.map((u) => cards.find((c) => c.uid === u)!).filter(Boolean);
  }

  /** "±N": let `who` choose the sign. Returns the signed amount. */
  async chooseSign(who: PlayerState, amount: number, cardId?: string, what = '社群规模'): Promise<number> {
    if (amount === 0) return 0;
    const v = await this.choose(who, `${what} ±${amount}`, [
      { value: '+', label: `${what} +${amount}`, tone: 'good' },
      { value: '-', label: `${what} −${amount}`, tone: 'bad' },
    ], { cardId, defaultValue: this.rng.next() < 0.5 ? '+' : '-' });
    return v === '+' ? amount : -amount;
  }

  // ══════════════════════════════════════════════════════════════
  //  Official cards
  // ══════════════════════════════════════════════════════════════

  private currentOfficialEffect(): string | null {
    const { currentOfficial: cur, officialSuppressed, officialCopyOf } = this.s;
    if (!cur || officialSuppressed) return null;
    return cur.defId === 'aocf' ? officialCopyOf : cur.defId;
  }

  /**
   * Is official effect `id` in force (optionally from `subject`'s point of view — 原作玩家·极限打分
   * grants its user a second official during their own turn)?
   */
  officialActive(id: string, subject?: PlayerState | null): boolean {
    const cur = this.currentOfficialEffect();
    const inDiscard = (x: string) => this.s.officialDiscard.some((c) => c.defId === x);
    if (cur === id) return true;
    // 非想天则 ⇄ 绯想天 pairing.
    if (id === 'soku' && cur === 'swr' && inDiscard('soku')) return true;
    if (id === 'swr' && cur === 'soku' && inDiscard('swr')) return true;
    const t = this.s.turn;
    if (subject && t?.maxScoreOfficial && t.playerId === subject.id && !this.s.officialSuppressed) {
      if (t.maxScoreOfficial === id) return true;
    }
    return false;
  }

  /** 东方辉针城: printed numbers on cards are doubled. */
  n(x: number, subject?: PlayerState | null) {
    return this.officialActive('ddc', subject) ? x * 2 : x;
  }

  canJudge(subject?: PlayerState | null) {
    return !this.officialActive('eosd', subject);
  }

  // ══════════════════════════════════════════════════════════════
  //  Derived stats
  // ══════════════════════════════════════════════════════════════

  revealed(p: PlayerState, role: string) {
    return p.role === role && p.roleRevealed;
  }

  influenceCap(p: PlayerState) {
    return BASE_INFLUENCE_CAP + (this.revealed(p, 'cosplayer') ? 2 : 0);
  }

  /** Hand limit, or null when unlimited this turn. */
  handLimit(p: PlayerState): number | null {
    const t = this.s.turn;
    const own = t?.playerId === p.id;
    if (own && t!.noHandLimit) return null;
    let lim = this.revealed(p, 'niche_lover') ? 4 : baseHandLimit(p.influence);
    if (this.revealed(p, 'popular_creator')) lim += 1;
    if (this.revealed(p, 'ex_brahmin')) lim += 3;
    if (this.officialActive('mof', p)) lim += 1;
    if (this.hasStatus(p, 'loan') || (own && t!.loanActive)) lim += 2;
    return lim;
  }

  // ══════════════════════════════════════════════════════════════
  //  Statuses (cards lying in front of a player)
  // ══════════════════════════════════════════════════════════════

  hasStatus(p: PlayerState, kind: StatusKind) {
    return p.statuses.some((s) => s.kind === kind);
  }
  anyStatus(kind: StatusKind) {
    return this.s.players.some((p) => this.hasStatus(p, kind));
  }
  addStatus(p: PlayerState, kind: StatusKind, card: CardInstance, label: string) {
    p.statuses.push({ kind, card, label } satisfies Status);
    if (kind === 'spotlightUp') p.influence = 2;
    this.syncSpotlight(p);
    this.touch();
  }

  /** 备受瞩目·逆: influence mirrors hand size while the status is up. */
  syncSpotlight(p: PlayerState) {
    if (this.hasStatus(p, 'spotlightDown')) {
      const cap = this.influenceCap(p);
      p.influence = clamp(p.hand.length, -cap, cap);
    }
  }

  /** Can `t` be chosen as a target / affected by action & event effects? (自闭) */
  targetable(t: PlayerState) {
    return !this.hasStatus(t, 'withdrawn');
  }

  /** Whether an effect of `cause` reaches `t` (自闭 immunity, 火星 self-only events). */
  affects(t: PlayerState, cause: Cause, owner?: PlayerState | null): boolean {
    if ((cause === 'action' || cause === 'event') && !this.targetable(t) && owner !== t) return false;
    if (cause === 'event' && this.s.turn?.marsEvent && owner && owner !== t) return false;
    return true;
  }

  // ══════════════════════════════════════════════════════════════
  //  Cards: decks, hands, discards
  // ══════════════════════════════════════════════════════════════

  private refill(deck: CardInstance[], discard: CardInstance[], name: string) {
    if (deck.length || !discard.length) return;
    deck.push(...this.rng.shuffle(discard.splice(0)));
    this.log(`${name}牌堆耗尽，弃牌堆洗混成为新的牌堆。`, undefined, 'minor');
  }

  takeActionTop(): CardInstance | null {
    this.refill(this.s.actionDeck, this.s.actionDiscard, '行动');
    return this.s.actionDeck.pop() ?? null;
  }

  drawEventCard(): CardInstance | null {
    this.refill(this.s.eventDeck, this.s.eventDiscard, '事件');
    return this.s.eventDeck.pop() ?? null;
  }

  /** Draw `n` action cards into `p`'s hand. */
  async draw(p: PlayerState, n: number, source: PlayerState | null = p): Promise<CardInstance[]> {
    const got: CardInstance[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.takeActionTop();
      if (!c) break;
      got.push(c);
    }
    if (!got.length) return got;
    this.log(`{p:${p.id}} 抽了 ${got.length} 张行动牌`, { type: 'draw', playerId: p.id, count: got.length }, 'minor');
    await this.gainCards(p, got, source);
    return got;
  }

  /** Put cards into a hand and fire "获得手牌" triggers. */
  async gainCards(p: PlayerState, cards: CardInstance[], source: PlayerState | null) {
    if (!cards.length) return;
    p.hand.push(...cards);
    const t = this.s.turn;
    if (t) t.gained[p.id] = (t.gained[p.id] ?? 0) + cards.length;
    this.syncSpotlight(p);
    this.touch();
    await Roles.afterGain(this, p, cards, source);
  }

  /** Remove specific cards from a hand (no destination) and fire "失去手牌" triggers. */
  async loseCards(p: PlayerState, cards: CardInstance[]): Promise<CardInstance[]> {
    const ids = new Set(cards.map((c) => c.uid));
    const removed = p.hand.filter((c) => ids.has(c.uid));
    p.hand = p.hand.filter((c) => !ids.has(c.uid));
    if (!removed.length) return removed;
    this.syncSpotlight(p);
    this.touch();
    await Roles.afterLose(this, p, removed);
    return removed;
  }

  /** Cards to the action discard pile (tracks 「上一张进入弃牌堆的行动牌」). */
  toDiscard(cards: CardInstance[]) {
    for (const c of cards) {
      this.s.actionDiscard.push(c);
      this.s.lastActionDiscarded = c.defId;
    }
    this.touch();
  }

  /** Discard specific hand cards. */
  async discard(p: PlayerState, cards: CardInstance[], why?: string) {
    if (!cards.length) return;
    const removed = await this.loseCards(p, cards);
    this.toDiscard(removed);
    this.log(`{p:${p.id}} 弃置了 ${removed.map((c) => `{c:${c.defId}}`).join('')}${why ? `（${why}）` : ''}`, undefined, 'minor');
  }

  /**
   * Make `p` choose and discard `n` hand cards (as many as possible).
   * If another player is the source, 桃源民 may negate it.
   */
  async discardFromHand(
    p: PlayerState,
    n: number,
    extra: { source?: PlayerState | null; cardId?: string; title?: string } = {},
  ): Promise<CardInstance[]> {
    if (n <= 0 || !p.hand.length) return [];
    if (extra.source && extra.source !== p && (await Roles.hermitNegate(this, p, extra.source, '弃置手牌'))) return [];
    const picked = await this.chooseHand(p, extra.title ?? `弃置 ${Math.min(n, p.hand.length)} 张手牌`, n, n, { cardId: extra.cardId });
    await this.discard(p, picked);
    return picked;
  }

  /** Move cards from one hand to another (交付/获得). */
  async transfer(from: PlayerState, to: PlayerState, cards: CardInstance[]) {
    if (!cards.length) return;
    const removed = await this.loseCards(from, cards);
    this.log(`{p:${from.id}} 将 ${removed.length} 张手牌交给 {p:${to.id}}`, { type: 'transfer', fromId: from.id, toId: to.id, count: removed.length }, 'minor');
    await this.gainCards(to, removed, from);
  }

  randomHandCard(p: PlayerState): CardInstance | null {
    return p.hand.length ? this.rng.pick(p.hand) : null;
  }

  // ══════════════════════════════════════════════════════════════
  //  Numbers: influence & community
  // ══════════════════════════════════════════════════════════════

  /** Change 个人影响力. Returns the change that actually happened. */
  async changeInfluence(t: PlayerState, delta: number, o: ChangeOpts): Promise<number> {
    if (delta === 0) return 0;
    if (!this.affects(t, o.cause, o.source)) {
      this.log(`{p:${t.id}} 不受影响（自闭）`, undefined, 'minor');
      return 0;
    }
    if (this.hasStatus(t, 'spotlightUp') || this.hasStatus(t, 'spotlightDown')) {
      this.log(`{p:${t.id}} 的个人影响力被「备受瞩目」锁定`, undefined, 'minor');
      return 0;
    }
    if (delta < 0 && o.source && o.source !== t && (await Roles.hermitNegate(this, t, o.source, '个人影响力扣减'))) return 0;

    const cap = this.influenceCap(t);
    const from = t.influence;
    let to = clamp(from + delta, -cap, cap);
    if (to < 0 && from >= 0 && this.officialActive('td', t)) to = 0; // 东方神灵庙
    const actual = to - from;
    if (actual === 0) return 0;
    t.influence = to;
    this.log(
      `{p:${t.id}} 个人影响力 {n:${actual > 0 ? '+' : ''}${actual}} → ${to}`,
      { type: 'influence', playerId: t.id, from, to },
    );
    if (actual > 0 && this.s.turn) this.s.turn.influenceGain[t.id] = (this.s.turn.influenceGain[t.id] ?? 0) + actual;
    await Roles.afterInfluenceChange(this, t, actual, o);
    return actual;
  }

  /** Change 社群规模. Returns the change that actually happened. */
  async changeCommunity(delta: number, o: ChangeOpts): Promise<number> {
    if (delta === 0) return 0;
    let d = delta;
    // 悲观预言家·东方乙烷②
    if (d < 0 && this.s.players.some((p) => this.revealed(p, 'doomsayer') && p.influence > 4)) d -= 1;
    if (d < 0) d = await Roles.organizerNpc(this, d);
    if (d > 1 && (await Roles.elitistStratify(this, d))) return 0;
    const from = this.s.community;
    const to = clamp(from + d, -COMMUNITY_LIMIT, COMMUNITY_LIMIT);
    const actual = to - from;
    if (actual === 0) return 0;
    this.s.community = to;
    this.log(`社群规模 {n:${actual > 0 ? '+' : ''}${actual}} → ${to}`, { type: 'community', from, to });
    if (actual < 0 && this.s.turn) this.s.turn.communityDecreased = true;
    await Roles.afterCommunityChange(this, actual);
    return actual;
  }

  /** Set 社群规模 directly (文化自信, 居高临下). Does not trigger increase/decrease hooks. */
  setCommunity(v: number) {
    const from = this.s.community;
    this.s.community = v;
    this.log(`社群规模成为 ${v}`, { type: 'community', from, to: v }, 'major');
  }

  // ══════════════════════════════════════════════════════════════
  //  Dice
  // ══════════════════════════════════════════════════════════════

  /** Roll a judgement. Under 东方红魔乡 the roll is skipped (false / 0). */
  async judge(p: PlayerState, kind: 'truth'): Promise<boolean>;
  async judge(p: PlayerState, kind: 'two' | 'delta'): Promise<number>;
  async judge(p: PlayerState, kind: JudgeKind): Promise<number | boolean> {
    const r = await this.roll(p, kind);
    return r.result;
  }

  async roll(p: PlayerState, kind: JudgeKind): Promise<{ face: number; result: number | boolean }> {
    if (!this.canJudge(p)) {
      this.log(`{p:${p.id}} 无法进行${JUDGE_LABEL[kind]}（东方红魔乡）`, undefined, 'minor');
      return { face: 0, result: kind === 'truth' ? false : 0 };
    }
    const face = this.rng.die();
    const result = judgeResult(kind, face);
    const shown = typeof result === 'boolean' ? (result ? '真' : '假') : result > 0 && kind === 'delta' ? `+${result}` : `${result}`;
    this.log(`{p:${p.id}} 进行${JUDGE_LABEL[kind]}：🎲${face} → ${shown}`, { type: 'dice', playerId: p.id, face, judge: kind, result });
    await this.pause(1100);
    if (face <= 3 && this.revealed(p, 'original_player')) {
      this.log(`{p:${p.id}} 「游戏直播」`, undefined, 'minor');
      await this.changeInfluence(p, 1, { cause: 'skill', source: p });
    }
    return { face, result };
  }

  // ══════════════════════════════════════════════════════════════
  //  Roles
  // ══════════════════════════════════════════════════════════════

  reveal(p: PlayerState, why?: string) {
    if (p.roleRevealed) return;
    p.roleRevealed = true;
    this.log(`{p:${p.id}} 翻开了角色牌 {c:${p.role}}${why ? `（${why}）` : ''}`, { type: 'reveal', playerId: p.id, roleId: p.role }, 'major');
  }

  /** Once-per-turn style counters. */
  uses(p: PlayerState, key: string) {
    return this.s.turn?.uses[`${p.id}:${key}`] ?? 0;
  }
  use(p: PlayerState, key: string) {
    const t = this.s.turn;
    if (t) t.uses[`${p.id}:${key}`] = (t.uses[`${p.id}:${key}`] ?? 0) + 1;
  }

  cardName(defId: string) {
    return cardDef(defId).name;
  }
  isAction(defId: string) {
    return cardDef(defId).kind === 'action' && !!actionDef(defId);
  }
}
