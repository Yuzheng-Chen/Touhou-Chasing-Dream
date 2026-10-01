import type { CardInstance, EventDirection, Faction, GameResult, LogEntry, Phase } from '@tcd/shared';

/** A card lying in front of a player as an ongoing effect ("buff"). */
export type StatusKind =
  | 'spotlightUp' // 备受瞩目·正: influence locked at 2
  | 'spotlightDown' // 备受瞩目·逆: influence = hand size
  | 'withdrawn' // 自闭·正: immune to action/event effects
  | 'crackdown' // 扫黄打非·正: skip next turn
  | 'sick' // 大病一场
  | 'generationGap' // 青黄不接: nobody draws in draw phase
  | 'loan'; // 得到借款

export interface Status {
  kind: StatusKind;
  card: CardInstance;
  label: string;
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  /** Room host (used by the 'host goes first' setting). */
  host: boolean;
  role: string;
  roleOptions: string[];
  roleRevealed: boolean;
  influence: number;
  hand: CardInstance[];
  /** 本回合事件牌 (only during the owner's turn). */
  turnEvent: CardInstance | null;
  /** 扣置的事件牌. */
  faceDownEvent: CardInstance | null;
  statuses: Status[];
  /** 单推牌, set aside and not counted as hand. */
  oshi: CardInstance[];
  /** 一般路过爱好者's declared faction. */
  allegiance: Faction | null;
  /** 狂热粉丝's idol. */
  idolId: string | null;
  /** 人类的本质 waiting to join the hand at next turn start. */
  pendingGift: CardInstance[];
  /** Officials already chosen with 极限打分. */
  maxScoreUsed: string[];
  /** 托管: a bot answers for this (human) player. Cleared when they act again. */
  auto: boolean;
  /** Consecutive prompts that timed out. */
  timeouts: number;
}

/** Per-turn bookkeeping. Reset at every turn start. */
export interface TurnState {
  playerId: string;
  actionsPlayed: number;
  handAtStart: number;
  communityDecreased: boolean;
  /** Cards gained by each player during this turn. */
  gained: Record<string, number>;
  /** Sum of positive influence changes per player this turn (狂热粉丝·受益). */
  influenceGain: Record<string, number>;
  /** Group action cards played this turn by the turn player (东方萃梦想). */
  groupPlayed: string[];
  /** Skill / once-per-turn usage counters, keyed `${playerId}:${key}`. */
  uses: Record<string, number>;
  skipDiscard: boolean;
  noHandLimit: boolean;
  loanActive: boolean;
  skipDraw: boolean;
  /** Official designated by 原作玩家·极限打分 for this turn. */
  maxScoreOfficial: string | null;
  /** Turn was cut short (大病一场). */
  ended: boolean;
  /** 火星: this turn's event must be played and only affects its owner. */
  marsEvent: boolean;
}

export interface GameState {
  id: string;
  seed: number;
  phase: Phase;
  round: number;
  players: PlayerState[];
  firstIdx: number;
  turnIdx: number | null;
  community: number;
  actionDeck: CardInstance[];
  eventDeck: CardInstance[];
  officialDeck: CardInstance[];
  actionDiscard: CardInstance[];
  eventDiscard: CardInstance[];
  officialDiscard: CardInstance[];
  currentOfficial: CardInstance | null;
  officialCopyOf: string | null;
  officialSuppressed: boolean;
  chainZone: CardInstance[];
  /** 延时区. `effect` is the card it was played as (usually its own id). */
  delayZone: { card: CardInstance; ownerId: string; effect: string }[];
  lastActionDiscarded: string | null;
  lastEvent: { defId: string; direction: EventDirection } | null;
  /** 遍地开花 bonus: everyone draws one extra card in the draw phase. */
  bloomingBonus: boolean;
  /** No hand cards or skills may be used (最终结算). */
  lockdown: boolean;
  turn: TurnState | null;
  log: LogEntry[];
  logSeq: number;
  result: GameResult | null;
}
