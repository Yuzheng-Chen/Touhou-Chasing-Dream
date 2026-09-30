import type { JudgeKind } from './protocol.js';

/** 社群规模 range. */
export const COMMUNITY_LIMIT = 10;
/** Default 个人影响力 cap; the floor is always the negated cap. */
export const BASE_INFLUENCE_CAP = 5;
export const STARTING_HAND = 2;

/** Official discard size that triggers the final settlement: 8p→4, 7p→5, 6p→6 … */
export const endThreshold = (players: number) => 12 - players;

/** Dice judgement tables (rulebook 其他说明 §1). */
export function judgeResult(kind: 'truth', face: number): boolean;
export function judgeResult(kind: 'two' | 'delta', face: number): number;
export function judgeResult(kind: JudgeKind, face: number): number | boolean;
export function judgeResult(kind: JudgeKind, face: number): number | boolean {
  switch (kind) {
    case 'truth':
      return face % 2 === 1;
    case 'two':
      return Math.floor((face - 1) / 2);
    case 'delta':
      return [-3, -2, -1, 1, 2, 3][face - 1];
  }
}

export const JUDGE_LABEL: Record<JudgeKind, string> = {
  truth: '真假判定',
  two: '两点点数判定',
  delta: '增减判定',
};

/** Base hand limit = influence clamped to [1, 4]. */
export const baseHandLimit = (influence: number) => Math.min(4, Math.max(1, influence));
