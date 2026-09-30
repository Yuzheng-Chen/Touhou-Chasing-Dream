import { factionLabel, roleDef, type Faction, type GameResult, type ScoreLine } from '@tcd/shared';
import type { Game } from './Game.js';
import type { PlayerState } from './state.js';

/** The faction a player is scored as, or null if they never picked one (neutral roles). */
export function factionOf(g: Game, p: PlayerState, seen = new Set<string>()): Faction | null {
  const d = roleDef(p.role);
  if (d.stance !== 'neutral' && d.focus !== 'neutral') return { stance: d.stance, focus: d.focus };
  if (p.role === 'passerby') return p.allegiance;
  if (p.role === 'zealot' && p.idolId && !seen.has(p.id)) {
    seen.add(p.id);
    return factionOf(g, g.player(p.idolId), seen);
  }
  return null;
}

/** Rulebook 胜利条件 + 胜点规则. */
export function scoreGame(g: Game): GameResult {
  const c = g.s.community;
  const lines: ScoreLine[] = g.players.map((p) => {
    const f = factionOf(g, p);
    const i = p.influence;
    let won = false;
    let base = 0;
    let reason = '';
    if (!f) {
      reason = '中立角色未选择阵营';
    } else {
      const commOk = f.stance === 'prosper' ? c >= 0 : c <= 0;
      if (commOk && i >= 0) {
        won = true;
        base = f.focus === 'community' ? Math.abs(c) : i;
        if (g.revealed(p, 'platform_op')) base = Math.max(c, i); // 双赢
        if (g.revealed(p, 'doomsayer')) base = Math.max(-c, i); // 东方乙烷③
        reason = '满足胜利条件';
      } else if (commOk && i < 0 && g.revealed(p, 'niche_lover')) {
        won = true; // 小众至高
        base = -i;
        reason = '小众至高';
      } else {
        reason = !commOk ? `社群规模不能为${f.stance === 'prosper' ? '负' : '正'}` : '个人影响力为负';
      }
    }
    // 地区王·本地共荣: extra points regardless of victory.
    const bonus = g.revealed(p, 'local_king') ? g.neighbours(p).filter((x) => x.influence > 0).length : 0;
    return {
      playerId: p.id, roleId: p.role, faction: f ? factionLabel(f) : '中立',
      won, baseScore: base, bonus, total: base + bonus, victoryPoints: 0, reason,
    };
  });

  const top = Math.max(0, ...lines.map((l) => l.total));
  let leaders = lines.filter((l) => l.total === top && top > 0);
  if (leaders.length > 1) {
    const inf = (l: ScoreLine) => g.player(l.playerId).influence;
    const best = Math.max(...leaders.map(inf));
    leaders = leaders.filter((l) => inf(l) === best);
  }
  for (const l of lines) l.victoryPoints = leaders.includes(l) ? 2 : l.total !== 0 ? 1 : 0;
  lines.sort((a, b) => b.victoryPoints - a.victoryPoints || b.total - a.total);
  return { lines, winnerIds: leaders.map((l) => l.playerId) };
}
