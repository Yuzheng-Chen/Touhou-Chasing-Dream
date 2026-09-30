import type { CardInstance } from './cards/types.js';
import type { Faction } from './cards/roles.js';

// ════════════════════════════════════════════════════════════════════
//  Prompts — every decision the server needs from a player.
//  The engine awaits the answer; bots and timeouts use `defaultValue`.
// ════════════════════════════════════════════════════════════════════

export type Tone = 'good' | 'bad' | 'neutral' | 'primary';

interface PromptBase {
  id: string;
  title: string;
  /** Extra explanation shown under the title. May contain {p:id}/{c:defId} tokens. */
  body?: string;
  /** Card the prompt is about (shown as a thumbnail). */
  cardId?: string;
  /** Epoch ms when the server will auto-answer with `defaultValue`. */
  deadline: number;
}

/** A move available in the action phase. */
export interface TurnMove {
  /** Hand card uid to play; absent for skills. */
  uid?: string;
  /** Play the card *as* another action (白嫖党 etc). Equals the card's own id for a normal play. */
  as?: string;
  /** Skill id, for role skills. */
  skill?: string;
  label: string;
  /** Source of an alternative play, e.g. role skill name or official card. */
  via?: string;
}

export type Prompt =
  | (PromptBase & {
      kind: 'turn';
      moves: TurnMove[];
      defaultValue: TurnAnswer;
    })
  | (PromptBase & {
      kind: 'choice';
      options: { value: string; label: string; tone?: Tone; disabled?: boolean; hint?: string }[];
      defaultValue: string;
    })
  | (PromptBase & {
      kind: 'players';
      candidates: string[];
      min: number;
      max: number;
      defaultValue: string[];
    })
  | (PromptBase & {
      kind: 'cards';
      /** `hand`: pick from own hand. `list`: pick from the given cards. */
      source: 'hand' | 'list';
      cards: CardInstance[];
      min: number;
      max: number;
      defaultValue: string[];
    })
  | (PromptBase & {
      kind: 'number';
      min: number;
      max: number;
      defaultValue: number;
    })
  | (PromptBase & {
      kind: 'order';
      cards: CardInstance[];
      defaultValue: string[];
    });

export type PromptKind = Prompt['kind'];
export type TurnAnswer = { type: 'move'; index: number } | { type: 'end' };

export type AnswerOf<K extends PromptKind> = K extends 'turn'
  ? TurnAnswer
  : K extends 'choice'
    ? string
    : K extends 'number'
      ? number
      : string[];

/** A prompt as authored by the engine, before the id/deadline are stamped. */
export type PromptSpec = Prompt extends infer P ? (P extends Prompt ? Omit<P, 'id' | 'deadline'> : never) : never;

// ════════════════════════════════════════════════════════════════════
//  Log + effects. Log text uses tokens: {p:playerId} {c:cardDefId} {n:+3}
// ════════════════════════════════════════════════════════════════════

export type Fx =
  | { type: 'play'; playerId: string; cardId: string; as?: string; targetIds?: string[] }
  | { type: 'dice'; playerId: string; face: number; judge: JudgeKind; result: number | boolean }
  | { type: 'community'; from: number; to: number }
  | { type: 'influence'; playerId: string; from: number; to: number }
  | { type: 'event'; playerId: string; cardId: string; direction: EventDirection }
  | { type: 'official'; cardId: string }
  | { type: 'reveal'; playerId: string; roleId: string }
  | { type: 'draw'; playerId: string; count: number }
  | { type: 'transfer'; fromId: string; toId: string; count: number };

export interface LogEntry {
  seq: number;
  at: number;
  text: string;
  /** Visual weight in the log panel. */
  level?: 'info' | 'major' | 'minor' | 'round';
  fx?: Fx;
}

export type JudgeKind = 'truth' | 'two' | 'delta';
export type EventDirection = 'up' | 'down' | 'none';

// ════════════════════════════════════════════════════════════════════
//  Views — what each client is allowed to see.
// ════════════════════════════════════════════════════════════════════

export type Phase =
  | 'roleSelect'
  | 'official'
  | 'turnStart'
  | 'eventDraw'
  | 'draw'
  | 'action'
  | 'eventResolve'
  | 'discard'
  | 'turnEnd'
  | 'roundEnd'
  | 'finalSettlement'
  | 'finished';

export const PHASE_LABEL: Record<Phase, string> = {
  roleSelect: '选择角色',
  official: '官作发布',
  turnStart: '回合开始',
  eventDraw: '事件获取',
  draw: '摸牌',
  action: '行动',
  eventResolve: '事件结算',
  discard: '弃牌',
  turnEnd: '回合结束',
  roundEnd: '官作弃置',
  finalSettlement: '最终结算',
  finished: '游戏结束',
};

export interface StatusView {
  /** Source card id (event or action) for the icon/tooltip. */
  cardId: string;
  label: string;
}

export interface PlayerView {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  connected: boolean;
  /** 托管: a bot is answering for this human. */
  auto: boolean;
  influence: number;
  influenceCap: number;
  handCount: number;
  handLimit: number | null;
  /** Role id, visible when revealed (or for yourself). */
  role: string | null;
  roleRevealed: boolean;
  allegiance: Faction | null;
  idolId: string | null;
  hasFaceDownEvent: boolean;
  /** This turn's event card if it has been played face-up, otherwise just whether one is held. */
  holdsTurnEvent: boolean;
  statuses: StatusView[];
  oshiCount: number;
}

export interface ScoreLine {
  playerId: string;
  roleId: string;
  faction: string;
  won: boolean;
  baseScore: number;
  bonus: number;
  total: number;
  victoryPoints: number;
  reason: string;
}

export interface GameResult {
  lines: ScoreLine[];
  winnerIds: string[];
}

export interface GameView {
  id: string;
  phase: Phase;
  round: number;
  endThreshold: number;
  players: PlayerView[];
  firstPlayerId: string | null;
  currentPlayerId: string | null;
  community: number;
  deckCounts: { action: number; event: number; official: number };
  /** Top cards when 弹幕天邪鬼 makes decks face-up. */
  deckTops: { action: string | null; event: string | null };
  discards: { action: CardInstance[]; event: CardInstance[]; official: CardInstance[] };
  currentOfficial: CardInstance | null;
  officialSuppressed: boolean;
  officialCopyOf: string | null;
  chainZone: CardInstance[];
  delayZone: { card: CardInstance; ownerId: string }[];
  log: LogEntry[];
  me: {
    id: string;
    hand: CardInstance[];
    role: string | null;
    roleOptions: string[];
    turnEvent: CardInstance | null;
    faceDownEvent: CardInstance | null;
    oshi: CardInstance[];
  } | null;
  prompt: Prompt | null;
  /** Public list of whom the table is waiting on. */
  waitingOn: string[];
  result: GameResult | null;
}

// ════════════════════════════════════════════════════════════════════
//  Rooms / lobby
// ════════════════════════════════════════════════════════════════════

export interface RoomSettings {
  /** Role cards dealt to each player to choose from (rules: 3–6). */
  roleChoices: number;
  /** Seconds before a prompt auto-resolves with its default. 0 = no limit. */
  promptTimeout: number;
  /** Bot think time in ms, so humans can follow what happens. */
  botDelay: number;
}

export const DEFAULT_SETTINGS: RoomSettings = { roleChoices: 3, promptTimeout: 60, botDelay: 900 };
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export interface RoomMember {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
}

export interface RoomView {
  id: string;
  hostId: string;
  members: RoomMember[];
  settings: RoomSettings;
  status: 'lobby' | 'playing' | 'finished';
  youId: string;
}

export interface ChatMessage {
  id: string;
  at: number;
  fromId: string;
  fromName: string;
  text: string;
}

export interface RoomSummary {
  id: string;
  hostName: string;
  players: number;
  status: RoomView['status'];
}

// Socket.IO event maps ------------------------------------------------

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  'session:hello': (p: { token: string; name: string }, ack: Ack<{ playerId: string; roomId: string | null }>) => void;
  'room:list': (ack: Ack<RoomSummary[]>) => void;
  'room:create': (ack: Ack<{ roomId: string }>) => void;
  'room:join': (p: { roomId: string }, ack: Ack<{ roomId: string }>) => void;
  'room:leave': () => void;
  'room:settings': (p: Partial<RoomSettings>) => void;
  'room:addBot': () => void;
  'room:kick': (p: { memberId: string }) => void;
  'room:start': (ack: Ack<null>) => void;
  'room:rematch': () => void;
  'game:answer': (p: { promptId: string; value: unknown }) => void;
  /** Take your seat back from 托管. */
  'game:resume': () => void;
  'chat:send': (p: { text: string }) => void;
}

export interface ServerToClient {
  'room:state': (room: RoomView | null) => void;
  'game:state': (game: GameView | null) => void;
  'chat:message': (msg: ChatMessage) => void;
  'toast': (p: { text: string; tone?: Tone }) => void;
}
