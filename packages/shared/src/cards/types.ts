export type CardKind = 'action' | 'event' | 'official' | 'role';

/** How an action card behaves; drives UI badges and engine timing. */
export type ActionCategory =
  | 'instant' // 直接触发
  | 'judge' // 需要判定
  | 'group' // 群体牌
  | 'delay' // 延时牌
  | 'eventOp' // 事件牌相关，立即触发
  | 'reaction' // 需满足条件才能打出（响应）
  | 'special'; // 触发后不进入弃牌堆

/** Whether the card text says 「指定一名玩家」(any) or 「指定一名其他玩家」(other). */
export type TargetRule = 'any' | 'other' | null;

export interface ActionCardDef {
  kind: 'action';
  id: string;
  name: string;
  count: number;
  category: ActionCategory;
  target: TargetRule;
  /** Requires a dice judgement — blocked by 东方红魔乡. */
  judge?: boolean;
  /** Can only be played as a response, never from the action phase. */
  reactionOnly?: boolean;
  text: string;
}

export type EventTopic = '社会' | '社群' | '创作' | '活动' | '官方' | '个人';
/** dual: 正/逆 two directions; none: 无向; chain: 连锁 */
export type EventShape = 'dual' | 'none' | 'chain';

export interface EventCardDef {
  kind: 'event';
  id: string;
  name: string;
  count: number;
  topic: EventTopic;
  shape: EventShape;
  /** 正向效果 (or the only effect for 无向 events). */
  up: string;
  /** 逆向效果. Absent for 无向 events. */
  down?: string;
  /** Must be played immediately when drawn (大病一场). */
  forced?: boolean;
}

export interface OfficialCardDef {
  kind: 'official';
  id: string;
  name: string;
  /** Original Japanese/Chinese title for flavour. */
  subtitle?: string;
  count: number;
  text: string;
}

export type Stance = 'prosper' | 'niche' | 'neutral';
export type Focus = 'community' | 'individual' | 'neutral';

export interface SkillText {
  name: string;
  text: string;
}

export interface RoleCardDef {
  kind: 'role';
  id: string;
  name: string;
  stance: Stance;
  focus: Focus;
  active: SkillText[];
  passive: SkillText[];
  flavor?: string;
}

export type CardDef = ActionCardDef | EventCardDef | OfficialCardDef | RoleCardDef;

/** A physical copy of a card in play. `uid` is unique per game. */
export interface CardInstance {
  uid: string;
  defId: string;
}
