import type { Prompt } from '@tcd/shared';

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Validate a client's answer against its prompt. Returns the clean value, or undefined if invalid. */
export function normalizeAnswer(prompt: Prompt, value: unknown): unknown {
  switch (prompt.kind) {
    case 'turn': {
      const v = value as { type?: string; index?: number } | null;
      if (v?.type === 'end') return { type: 'end' };
      if (v?.type === 'move' && Number.isInteger(v.index) && v.index! >= 0 && v.index! < prompt.moves.length) {
        return { type: 'move', index: v.index };
      }
      return undefined;
    }
    case 'choice': {
      const opt = prompt.options.find((o) => o.value === value);
      return opt && !opt.disabled ? opt.value : undefined;
    }
    case 'number':
      return typeof value === 'number' && Number.isInteger(value) && value >= prompt.min && value <= prompt.max
        ? value
        : undefined;
    case 'players': {
      if (!isStrArray(value) || new Set(value).size !== value.length) return undefined;
      if (value.length < prompt.min || value.length > prompt.max) return undefined;
      return value.every((id) => prompt.candidates.includes(id)) ? value : undefined;
    }
    case 'cards': {
      if (!isStrArray(value) || new Set(value).size !== value.length) return undefined;
      if (value.length < prompt.min || value.length > prompt.max) return undefined;
      return value.every((u) => prompt.cards.some((c) => c.uid === u)) ? value : undefined;
    }
    case 'order': {
      if (!isStrArray(value) || value.length !== prompt.cards.length) return undefined;
      const want = new Set(prompt.cards.map((c) => c.uid));
      return value.every((u) => want.has(u)) && new Set(value).size === value.length ? value : undefined;
    }
  }
}
