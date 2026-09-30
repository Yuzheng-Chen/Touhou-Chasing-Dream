import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTION_CARDS, EVENT_CARDS, OFFICIAL_CARDS, ROLE_CARDS, type EventCardDef } from '@tcd/shared';
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/engine/actions.js';
import { EVENTS } from '../src/engine/events.js';

/**
 * Audit: every card named in cards.md exists in the catalogue with the same copy count, and every
 * catalogue card has engine behaviour. Keeps the "did we implement all the cards" question answerable.
 */
const md = readFileSync(fileURLToPath(new URL('../../../cards.md', import.meta.url)), 'utf8').split(/\r?\n/);

function section(from: string, to: string | null) {
  const a = md.findIndex((l) => l.trim() === from);
  const b = to ? md.findIndex((l, i) => i > a && l.trim() === to) : md.length;
  return md.slice(a + 1, b).map((l) => l.trim()).filter(Boolean);
}

/** "社会事件）新IP流行3 正：…" → { name: '新IP流行', count: 3 } */
function head(line: string) {
  const first = line.split(/\s+/)[0].replace(/^.*[）)]/, '');
  const m = first.match(/^(.*?)(\d+)$/);
  return m ? { name: m[1], count: Number(m[2]) } : null;
}

describe('cards.md ↔ catalogue', () => {
  it('action cards', () => {
    const lines = section('行动牌', '官作牌').filter((l) => !/^(直接触发|需要判定|特殊牌)/.test(l));
    const parsed = lines.map(head).filter(Boolean) as { name: string; count: number }[];
    expect(parsed.length).toBe(ACTION_CARDS.length);
    for (const p of parsed) {
      const c = ACTION_CARDS.find((x) => x.name === p.name.replace('墨菲定律', '墨菲定律'));
      expect(c, `action ${p.name} missing`).toBeTruthy();
      expect(c!.count, `count of ${p.name}`).toBe(p.count);
    }
  });

  it('event cards', () => {
    const lines = section('事件牌', '角色牌').filter((l) => /）/.test(l.split(/\s+/)[0]));
    const parsed = lines.map(head).filter(Boolean) as { name: string; count: number }[];
    expect(parsed.length).toBe(EVENT_CARDS.length);
    for (const p of parsed) {
      const c = EVENT_CARDS.find((x) => x.name === p.name);
      expect(c, `event ${p.name} missing`).toBeTruthy();
      expect(c!.count, `count of ${p.name}`).toBe(p.count);
    }
  });

  it('official cards', () => {
    const lines = section('官作牌', '事件牌');
    const names = lines.map((l) => l.split(/\s+/)[0]);
    expect(names.length).toBe(OFFICIAL_CARDS.length);
    for (const n of names) expect(OFFICIAL_CARDS.some((c) => c.name === n), `official ${n}`).toBe(true);
  });

  it('role cards', () => {
    const lines = section('角色牌', null).filter((l) => /[：:]/.test(l) && !/^(主动|被动)/.test(l));
    const names = lines
      .map((l) => l.replace(/\s+/g, '').split(/[：:]/)[0])
      .filter((n) => ROLE_CARDS.some((r) => r.name.replace(/\s+/g, '') === n));
    expect(names.length).toBe(ROLE_CARDS.length);
    expect(new Set(names).size).toBe(ROLE_CARDS.length);
  });
});

describe('engine coverage', () => {
  it('every action card has a handler', () => {
    for (const c of ACTION_CARDS) expect(ACTIONS[c.id], `action handler ${c.id}`).toBeTruthy();
  });
  it('every event card has the handlers its text needs', () => {
    for (const c of EVENT_CARDS as EventCardDef[]) {
      const h = EVENTS[c.id];
      expect(h, `event handler ${c.id}`).toBeTruthy();
      if (c.down !== undefined) expect(h.down, `逆向 handler ${c.id}`).toBeTruthy();
    }
  });
  it('catalogue sizes', () => {
    const n = (d: { count: number }[]) => d.reduce((s, c) => s + c.count, 0);
    console.log(`actions=${n(ACTION_CARDS)} events=${n(EVENT_CARDS)} officials=${OFFICIAL_CARDS.length} roles=${ROLE_CARDS.length}`);
    expect(ROLE_CARDS.length).toBe(26);
  });
});
