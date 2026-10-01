import { factionLabel, roleDef, type Faction, type GameResult, type ScoreLine, type ScoreStep } from '@tcd/shared';
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

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Rulebook 胜利条件 + 胜点规则. Every line carries the story of how its score came about (for the reveal ceremony). */
export function scoreGame(g: Game): GameResult {
  const c = g.s.community;
  const lines: ScoreLine[] = g.players.map((p) => {
    const f = factionOf(g, p);
    const i = p.influence;
    let won = false;
    let base = 0;
    let reason = '';
    const steps: ScoreStep[] = [];
    if (!f) {
      reason = '中立角色未选择阵营';
      steps.push({ label: '阵营', text: '中立角色没有选择阵营，无法得分', ok: false });
    } else {
      const commOk = f.stance === 'prosper' ? c >= 0 : c <= 0;
      steps.push({ label: '阵营', text: `${factionLabel(f)}：${f.stance === 'prosper' ? '社群规模 ≥ 0' : '社群规模 ≤ 0'}，个人影响力 ≥ 0` });
      steps.push({ label: '社群规模', text: `${signed(c)} ${f.stance === 'prosper' ? '≥ 0' : '≤ 0'}`, ok: commOk });
      const nicheTop = commOk && i < 0 && g.revealed(p, 'niche_lover');
      steps.push({ label: '个人影响力', text: nicheTop ? `${i} < 0，但「小众至高」使其依然成立` : `${signed(i)} ${i >= 0 ? '≥ 0' : '< 0'}`, ok: i >= 0 || nicheTop });
      if (commOk && i >= 0) {
        won = true;
        base = f.focus === 'community' ? Math.abs(c) : i;
        let how = f.focus === 'community' ? `基础分 = |社群规模| = ${base}` : `基础分 = 个人影响力 = ${base}`;
        if (g.revealed(p, 'platform_op')) { base = Math.max(c, i); how = `「双赢」：基础分 = max(社群规模 ${c}, 个人影响力 ${i}) = ${base}`; }
        if (g.revealed(p, 'doomsayer')) { base = Math.max(-c, i); how = `「东方乙烷」：基础分 = max(−社群规模 ${-c}, 个人影响力 ${i}) = ${base}`; }
        reason = '满足胜利条件';
        steps.push({ label: '基础分', text: how, points: base });
      } else if (nicheTop) {
        won = true; // 小众至高
        base = -i;
        reason = '小众至高';
        steps.push({ label: '基础分', text: `「小众至高」：基础分 = −个人影响力 = ${base}`, points: base });
      } else {
        reason = !commOk ? `社群规模不能为${f.stance === 'prosper' ? '负' : '正'}` : '个人影响力为负';
        steps.push({ label: '结果', text: `未满足胜利条件：${reason}，基础分 0`, ok: false });
      }
    }
    // 地区王·本地共荣: extra points regardless of victory.
    const friends = g.revealed(p, 'local_king') ? g.neighbours(p).filter((x) => x.influence > 0).length : 0;
    if (g.revealed(p, 'local_king')) steps.push({ label: '本地共荣', text: `相邻玩家中个人影响力 > 0 的有 ${friends} 位`, points: friends });
    const bonus = friends;
    return {
      playerId: p.id, roleId: p.role, faction: f ? factionLabel(f) : '中立',
      won, baseScore: base, bonus, total: base + bonus, victoryPoints: 0, reason, influence: i, steps, vpNote: '',
    };
  });

  const top = Math.max(0, ...lines.map((l) => l.total));
  let leaders = lines.filter((l) => l.total === top && top > 0);
  const tiedOnScore = leaders.length > 1;
  if (leaders.length > 1) {
    const inf = (l: ScoreLine) => g.player(l.playerId).influence;
    const best = Math.max(...leaders.map(inf));
    leaders = leaders.filter((l) => inf(l) === best);
  }
  for (const l of lines) {
    l.victoryPoints = leaders.includes(l) ? 2 : l.total !== 0 ? 1 : 0;
    l.vpNote = leaders.includes(l)
      ? !tiedOnScore ? '得分最高 → 2 胜点'
        : leaders.length === 1 ? '最高分并列，但个人影响力更高 → 2 胜点' : '最高分与个人影响力都并列 → 同获 2 胜点'
      : l.total !== 0
        ? tiedOnScore && l.total === top ? '最高分并列，但个人影响力较低 → 1 胜点' : '得分不为 0 → 1 胜点'
        : '得分为 0 → 0 胜点';
  }
  lines.sort((a, b) => b.victoryPoints - a.victoryPoints || b.total - a.total);
  return { lines, winnerIds: leaders.map((l) => l.playerId) };
}