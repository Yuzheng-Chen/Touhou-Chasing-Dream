import type { GameView, PlayerView, Prompt } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../net';
import { useStore } from '../store';
import './coach.css';

/**
 * Tutorial coach. Shown only in the tutorial room. Each tip is tied to a moment in the game (a phase, a kind of
 * decision, something happening on the table) and to a real element on screen, which gets a highlight ring.
 * Tips appear one at a time, in priority order, once each; the player can dismiss them or skip the whole thing.
 */
interface Ctx {
  g: GameView;
  me: PlayerView;
  myTurn: boolean;
  prompt: Prompt | null;
  /** Action cards this player has played so far. */
  played: number;
  /** The final-settlement show has reached its board. */
  finale: boolean;
}

interface Tip {
  id: string;
  when: (c: Ctx) => boolean;
  target?: string;
  title: string;
  body: string;
  /** Last tip: offers a way home. */
  finale?: boolean;
}

const promptHas = (c: Ctx, s: string) => !!c.prompt && c.prompt.title.includes(s);

/** Targets in the player's own area: their tips are docked away from the controls (see placement below). */
const DOCKED = ['.hand', '.decide', '.myarea', '.emotepicker'];

const TIPS: Tip[] = [
  {
    id: 'welcome', when: (c) => c.g.round >= 1, target: '.myarea__role',
    title: '欢迎来到教学局！',
    body: '你是「传教爱好者」——社群 · 繁荣阵营。目标：游戏结束时让「社群规模 ≥ 0」且「个人影响力 ≥ 0」，得分 = 社群规模。两位 AI 的身份保密。本局只打 3 轮。',
  },
  {
    id: 'meter', when: (c) => c.g.round >= 1, target: '.cmeter',
    title: '社群规模',
    body: '这是全场共用的「社群规模」。你希望它偏右（繁荣）。每张牌、每个事件都在推动它——有的人想推右，有的人想推左。',
  },
  {
    id: 'official', when: (c) => !!c.g.currentOfficial, target: '.official',
    title: '官作牌',
    body: '每轮开始翻开一张官作牌，本轮全场生效。把鼠标放上去看效果。官作弃牌堆满 3 张，游戏就进入最终结算。',
  },
  {
    id: 'turn', when: (c) => c.myTurn && c.g.phase !== 'roleSelect', target: '.topbar__center',
    title: '轮到你了',
    body: '顶部显示你正处于哪个阶段：事件获取 → 摸牌 → 行动 → 事件结算 → 弃牌。大部分时间你只需要在「行动」做决定。',
  },
  {
    id: 'event', when: (c) => c.myTurn && !!c.g.me?.turnEvent, target: '.myarea__events',
    title: '你的本回合事件牌',
    body: '蓝色拱形的是「事件牌」，每回合抽一张，不算手牌。行动结束后你要处理它：打出并选正向/逆向，或扣置。悬停先看看它写了什么。',
  },
  {
    id: 'action', when: (c) => c.prompt?.kind === 'turn', target: '.hand',
    title: '行动阶段',
    body: '点击发光的手牌就能打出，红色圆角的是「行动牌」。可以打出任意张，完成后点「结束行动」（或按空格）。先试着打出一张吧！',
  },
  {
    id: 'skill', when: (c) => c.prompt?.kind === 'turn' && c.prompt.moves.some((m) => m.via), target: '.hand',
    title: '你的技能：传教',
    body: '你可以把任意一张手牌当作「传教」打出（每回合最多两次）。传教让社群规模 ±2——方向由你选！',
  },
  {
    id: 'sign', when: (c) => c.prompt?.kind === 'choice' && c.prompt.options.some((o) => o.value === '+'), target: '.decide',
    title: '「±」由你决定',
    body: '带「±」的效果由发动者选择增加还是减少。你是繁荣阵营，当然选「＋」。',
  },
  {
    id: 'target', when: (c) => c.prompt?.kind === 'players', target: '.decide',
    title: '指定目标',
    body: '点击一名玩家作为目标。伤害类的牌（造谣、出警…）通常打向领先的对手；有益的牌可以给自己或盟友。',
  },
  {
    id: 'played', when: (c) => c.played >= 1, target: '.cmeter',
    title: '牌生效了',
    body: '注意社群规模和个人影响力旁边飘出的数字，战况日志里也有记录。个人影响力永远不能为负——否则无法获胜。',
  },
  {
    id: 'resolve', when: (c) => promptHas(c, '事件结算'), target: '.decide',
    title: '事件结算',
    body: '「打出」：立刻发动，并由你选择正向或逆向。「扣置」：先压在面前，之后只能正向，到最终结算时才发动。教学局里直接选「打出」就好。',
  },
  {
    id: 'direction', when: (c) => promptHas(c, '选择发生方向'), target: '.decide',
    title: '正向 / 逆向',
    body: '每张事件牌有两种发生方向，看看两边的效果，选对你有利的那边。繁荣阵营通常想让社群规模增加。',
  },
  {
    id: 'discard', when: (c) => promptHas(c, '弃牌阶段'), target: '.decide',
    title: '弃牌',
    body: '回合末手牌不能超过上限——上限等于你的个人影响力（最少 1、最多 4）。选择要弃掉的牌。',
  },
  {
    id: 'react', when: (c) => !!c.prompt && (c.prompt.cardId === 'murphy' || c.prompt.cardId === 'expose'), target: '.decide',
    title: '响应牌',
    body: '你手里有一张可以在这个时机使用的「响应牌」。不用主动找，时机一到游戏会问你。',
  },
  {
    id: 'others', when: (c) => !c.myTurn && !!c.g.currentPlayerId && c.g.round >= 1 && c.g.phase !== 'roleSelect', target: '.opponents',
    title: 'AI 的回合',
    body: '现在是对手的回合。右侧「战况」记录了发生的一切；把鼠标移到日志里的「卡名」上可以看牌。座位上的数字是对方的个人影响力和手牌数。',
  },
  {
    id: 'facedown', when: (c) => !!c.g.me?.faceDownEvent, target: '.myarea__events',
    title: '扣置的事件',
    body: '扣置的事件牌会等到最终结算才发动（或被你下一次扣置顶掉）。适合留下对你有利的事件，或把坏事先压着。',
  },
  {
    id: 'round2', when: (c) => c.g.round >= 2, target: '.topbar__progress',
    title: '第 2 轮',
    body: '上一轮的官作进入了弃牌堆，这里的金色菱形亮了一格。全部点亮后，本轮结束就进入最终结算。',
  },
  {
    id: 'emote', when: (c) => c.g.round >= 2 && c.myTurn, target: '.emotepicker',
    title: '互动一下',
    body: '想打招呼？点 😀 发个表情，会在你的座位上方冒泡。',
  },
  {
    id: 'final', when: (c) => c.g.phase === 'finalSettlement',
    title: '最终结算',
    body: '游戏即将结束：每位玩家依次把扣置的事件牌正向打出，这时不能再用手牌和技能。之后统计胜负。',
  },
  {
    id: 'end', when: (c) => c.g.phase === 'finished' && c.finale, finale: true,
    title: '教学完成！',
    body: '看看你是否满足条件：个人影响力 ≥ 0，且社群规模 ≥ 0（你是繁荣阵营）。基础玩法就是这些了——去和朋友开一局真正的游戏吧！',
  },
];

export function Coach() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const finaleShown = useStore((s) => s.finale);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [off, setOff] = useState(false);
  const shown = useRef<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [decide, setDecide] = useState<DOMRect | null>(null);

  const ctx = useMemo<Ctx | null>(() => {
    if (!game || !playerId) return null;
    const me = game.players.find((p) => p.id === playerId);
    if (!me) return null;
    return {
      g: game, me, myTurn: game.currentPlayerId === playerId, prompt: game.prompt,
      played: game.log.filter((e) => e.fx?.type === 'play' && e.fx.playerId === playerId).length,
      finale: finaleShown,
    };
  }, [game, playerId, finaleShown]);

  const tip = ctx && !off ? TIPS.find((t) => !seen.has(t.id) && t.when(ctx)) : undefined;

  // A tip whose moment has passed (and which was on screen) counts as seen.
  useEffect(() => {
    if (!ctx) return;
    const cur = shown.current ? TIPS.find((t) => t.id === shown.current) : null;
    if (cur && !cur.when(ctx)) {
      setSeen((s) => new Set(s).add(cur.id));
      shown.current = null;
    }
    if (tip) shown.current = tip.id;
  }, [ctx, tip?.id]);

  // Keep the highlight glued to its target (layout changes, scrolling, animations).
  useEffect(() => {
    if (!tip?.target) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(tip.target!);
      setRect(el ? el.getBoundingClientRect() : null);
      setDecide(document.querySelector('.decide')?.getBoundingClientRect() ?? null);
    };
    measure();
    // A new decision panel slides in: re-measure while it settles so the tip steps out of its way at once.
    const settle = [60, 160, 320, 600].map((ms) => setTimeout(measure, ms));
    const t = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      settle.forEach(clearTimeout);
      clearInterval(t);
      window.removeEventListener('resize', measure);
    };
  }, [tip?.id, tip?.target, game?.prompt?.id]);

  if (!game || off) return off ? <ResumeCoach onClick={() => setOff(false)} /> : null;
  const done = seen.size;

  // Placement: tips about the upper board sit next to their target. Tips about your own area (hand, decision panel,
  // events) are docked at the left edge instead, so they never cover the controls the player has to use.
  const wide = window.innerWidth >= 1100;
  let compact = false;
  const W = wide ? 290 : Math.min(340, window.innerWidth - 24);
  let style: React.CSSProperties = { left: 12, right: 12, bottom: 12, margin: '0 auto', width: W, maxHeight: '38vh', overflow: 'auto' };
  if (wide) {
    const lowerArea = !!tip?.target && DOCKED.some((s) => tip.target!.startsWith(s));
    // Docked at the left edge. If the decision panel reaches into that column, only use the free space above it
    // (compact bar when there is little), or sit just under it.
    const clash = !!decide && decide.left < 14 + W + 12;
    const room = decide ? decide.top - 90 : Infinity;
    const dock: React.CSSProperties = !clash || room >= 150
      ? { left: 14, top: 78, width: W, maxHeight: clash ? room : undefined, overflow: 'auto' }
      : decide!.top < 190
        ? { left: 14, top: decide!.bottom + 10, width: W }
        : { left: 14, top: 78, width: W };
    compact = clash && room < 150;
    if (lowerArea || !rect || !tip) style = dock;
    else {
      const h = 110 + Math.ceil(tip.body.length / 20) * 22; // rough height of the tip card
      const below = rect.bottom + 14 + h < window.innerHeight;
      const left = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 12);
      const top = below ? rect.bottom + 14 : rect.top - 14 - h;
      // Never cover the decision panel: if the anchored spot would, use the dock.
      const hits = decide && !(left + W < decide.left - 8 || left > decide.right + 8 || top + h < decide.top - 8 || top > decide.bottom + 8);
      style = hits ? dock : below ? { left, top, width: W } : { left, bottom: window.innerHeight - rect.top + 14, width: W };
    }
  }

  return (
    <div className="coach" aria-live="polite">
      <AnimatePresence>
        {tip && rect && (
          <motion.div
            key={`ring-${tip.id}`}
            className="coach__ring"
            style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {tip && (
          <motion.div key={tip.id} className={`coach__tip ${compact ? 'is-compact' : ''}`} style={style} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.22 }}>
            <div className="coach__title">{tip.title}</div>
            {!compact && <p>{tip.body}</p>}
            <div className="coach__actions">
              <span className="coach__count">{done}/{TIPS.length - 1}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setOff(true)}>跳过教学</button>
              {tip.finale ? (
                <button className="btn btn--gold btn--sm" onClick={() => socket.emit('room:leave')}>回到首页</button>
              ) : (
                <button className="btn btn--gold btn--sm" onClick={() => { setSeen((s) => new Set(s).add(tip.id)); shown.current = null; }}>知道了</button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResumeCoach({ onClick }: { onClick: () => void }) {
  return <button className="coach__resume btn btn--sm" onClick={onClick}>🎓 恢复教学提示</button>;
}
