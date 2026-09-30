import type { CardInstance, Prompt, TurnMove } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card } from '../cards/Card';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { RichText } from '../ui/RichText';
import { Countdown } from './meters';

interface PromptUi {
  prompt: Prompt | null;
  /** Hand-card selection (cards prompt with source=hand). */
  selCards: string[];
  toggleCard(uid: string): void;
  /** Player selection (players prompt). */
  selPlayers: string[];
  togglePlayer(id: string): void;
  /** Turn prompt: moves available for a hand card. */
  movesFor(uid: string): { index: number; move: TurnMove }[];
  /** Open the "how to play this card" menu. */
  menuUid: string | null;
  setMenuUid(uid: string | null): void;
  send(value: unknown): void;
}

const Ctx = createContext<PromptUi | null>(null);
export const usePromptUi = () => useContext(Ctx)!;

export function PromptProvider({ children }: { children: ReactNode }) {
  const prompt = useStore((s) => s.game?.prompt ?? null);
  const answer = useStore((s) => s.answer);
  const [selCards, setSelCards] = useState<string[]>([]);
  const [selPlayers, setSelPlayers] = useState<string[]>([]);
  const [menuUid, setMenuUid] = useState<string | null>(null);

  useEffect(() => {
    setSelCards([]);
    setSelPlayers([]);
    setMenuUid(null);
  }, [prompt?.id]);

  const ui = useMemo<PromptUi>(() => ({
    prompt,
    selCards,
    selPlayers,
    menuUid,
    setMenuUid,
    toggleCard(uid) {
      if (prompt?.kind !== 'cards') return;
      setSelCards((cur) => {
        if (cur.includes(uid)) return cur.filter((u) => u !== uid);
        if (prompt.max === 1) return [uid];
        return cur.length < prompt.max ? [...cur, uid] : cur;
      });
    },
    togglePlayer(id) {
      if (prompt?.kind !== 'players' || !prompt.candidates.includes(id)) return;
      if (prompt.max === 1) {
        answer(prompt.id, [id]);
        return;
      }
      setSelPlayers((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < prompt.max ? [...cur, id] : cur));
    },
    movesFor(uid) {
      if (prompt?.kind !== 'turn') return [];
      return prompt.moves.map((move, index) => ({ move, index })).filter((m) => m.move.uid === uid);
    },
    send(value) {
      if (prompt) answer(prompt.id, value);
    },
  }), [prompt, selCards, selPlayers, menuUid, answer]);

  return <Ctx.Provider value={ui}>{children}</Ctx.Provider>;
}

/** The floating decision panel above the hand. */
export function PromptPanel() {
  const ui = usePromptUi();
  const game = useStore((s) => s.game)!;
  const p = ui.prompt;
  const waiting = game.waitingOn.filter((id) => id !== game.me?.id);

  if (!p) {
    if (!waiting.length || game.phase === 'finished') return null;
    const names = waiting.map((id) => game.players.find((x) => x.id === id)).filter(Boolean);
    return (
      <div className="waiting">
        <span className="waiting__dots"><i /><i /><i /></span>
        等待 {names.map((n, i) => <b key={n!.id} style={{ color: playerColor(n!.seat) }}>{i ? '、' : ''}{n!.name}</b>)} 行动
      </div>
    );
  }
  if (game.phase === 'roleSelect' && p.kind === 'choice') return null; // RolePicker handles it

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={p.id}
        className={`decide decide--${p.kind}`}
        data-prompt-id={p.id}
        data-kind={p.kind}
        data-min={'min' in p ? p.min : undefined}
        data-max={'max' in p ? p.max : undefined}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="decide__head">
          {p.cardId && p.kind !== 'turn' && <Card id={p.cardId} size="xs" className="decide__thumb" />}
          <div className="decide__titles">
            <div className="decide__title"><RichText text={p.title} /></div>
            {p.body && <div className="decide__body"><RichText text={p.body} /></div>}
          </div>
          {p.deadline > 0 && <Countdown key={p.id} deadline={p.deadline} />}
        </div>
        <PromptBody p={p} />
      </motion.div>
    </AnimatePresence>
  );
}

function PromptBody({ p }: { p: Prompt }) {
  const ui = usePromptUi();
  const game = useStore((s) => s.game)!;
  switch (p.kind) {
    case 'turn': {
      const skills = p.moves.map((m, i) => ({ m, i })).filter((x) => x.m.skill);
      const cardMoves = p.moves.filter((m) => m.uid).length;
      return (
        <div className="decide__row">
          <span className="decide__hint">{cardMoves ? '点击发光的手牌打出' : '没有可打出的手牌'}</span>
          {skills.map(({ m, i }) => (
            <button key={i} className="btn btn--gold btn--sm" onClick={() => ui.send({ type: 'move', index: i })}>
              ✦ {m.label}
            </button>
          ))}
          <button className="btn btn--primary" onClick={() => ui.send({ type: 'end' })}>结束行动</button>
        </div>
      );
    }
    case 'choice':
      return (
        <div className="decide__options">
          {p.options.map((o) => (
            <button
              key={o.value}
              className={`btn option ${o.tone ? `btn--${o.tone === 'primary' ? 'gold' : o.tone}` : ''}`}
              disabled={o.disabled}
              onClick={() => ui.send(o.value)}
            >
              <span><RichText text={o.label} /></span>
              {o.hint && <small className="option__hint"><RichText text={o.hint} /></small>}
            </button>
          ))}
        </div>
      );
    case 'players':
      return (
        <div className="decide__options">
          {p.candidates.map((id) => {
            const pl = game.players.find((x) => x.id === id)!;
            const sel = ui.selPlayers.includes(id);
            return (
              <button key={id} className={`btn option option--player ${sel ? 'is-selected' : ''}`} style={{ '--seat': playerColor(pl.seat) } as React.CSSProperties} onClick={() => ui.togglePlayer(id)}>
                <span className="option__dot" />{pl.name}{id === game.me?.id && '（自己）'}
                <small className="option__hint">影响力 {pl.influence} · 手牌 {pl.handCount}</small>
              </button>
            );
          })}
          {p.max > 1 && (
            <button className="btn btn--primary" disabled={ui.selPlayers.length < p.min} onClick={() => ui.send(ui.selPlayers)}>确定</button>
          )}
        </div>
      );
    case 'cards':
      return p.source === 'hand' ? <HandPick p={p} /> : <ListPick p={p} />;
    case 'number':
      return <NumberPick p={p} />;
    case 'order':
      return <OrderPick p={p} />;
  }
}

function HandPick({ p }: { p: Extract<Prompt, { kind: 'cards' }> }) {
  const ui = usePromptUi();
  const n = ui.selCards.length;
  const ok = n >= p.min && n <= p.max;
  return (
    <div className="decide__row">
      <span className="decide__hint">
        在手牌中选择 {p.min === p.max ? p.min : `${p.min}~${p.max}`} 张（已选 {n}）
      </span>
      {p.min === 0 && n === 0 && <button className="btn" onClick={() => ui.send([])}>不选择</button>}
      <button className="btn btn--primary" disabled={!ok || (p.min === 0 && n === 0)} onClick={() => ui.send(ui.selCards)}>确定</button>
    </div>
  );
}

function ListPick({ p }: { p: Extract<Prompt, { kind: 'cards' }> }) {
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (uid: string) =>
    setSel((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : p.max === 1 ? [uid] : cur.length < p.max ? [...cur, uid] : cur));
  const ok = sel.length >= p.min && sel.length <= p.max;
  return (
    <>
      <div className="decide__cards">
        {p.cards.map((c) => (
          <Card key={c.uid} id={c.defId} size="md" selected={sel.includes(c.uid)} onClick={() => (p.max === 1 && p.min === 1 ? toggle(c.uid) : toggle(c.uid))} />
        ))}
      </div>
      <div className="decide__row">
        {p.min === 0 && <button className="btn" onClick={() => p && useStore.getState().answer(p.id, [])}>不选择</button>}
        <button className="btn btn--primary" disabled={!ok || sel.length === 0} onClick={() => useStore.getState().answer(p.id, sel)}>确定</button>
      </div>
    </>
  );
}

function NumberPick({ p }: { p: Extract<Prompt, { kind: 'number' }> }) {
  const [v, setV] = useState(p.defaultValue);
  return (
    <div className="decide__row">
      <div className="stepper">
        <button className="btn btn--icon" disabled={v <= p.min} onClick={() => setV(v - 1)}>−</button>
        <b>{v}</b>
        <button className="btn btn--icon" disabled={v >= p.max} onClick={() => setV(v + 1)}>＋</button>
      </div>
      <button className="btn btn--primary" onClick={() => useStore.getState().answer(p.id, v)}>确定</button>
    </div>
  );
}

function OrderPick({ p }: { p: Extract<Prompt, { kind: 'order' }> }) {
  const [list, setList] = useState<CardInstance[]>(p.cards);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  return (
    <>
      <div className="decide__cards">
        {list.map((c, i) => (
          <div key={c.uid} className="order-item">
            <span className="order-item__n">{i === 0 ? '顶' : i + 1}</span>
            <Card id={c.defId} size="md" />
            <div className="order-item__btns">
              <button className="btn btn--icon btn--sm" disabled={i === 0} onClick={() => move(i, -1)}>◀</button>
              <button className="btn btn--icon btn--sm" disabled={i === list.length - 1} onClick={() => move(i, 1)}>▶</button>
            </div>
          </div>
        ))}
      </div>
      <div className="decide__row">
        <button className="btn btn--primary" onClick={() => useStore.getState().answer(p.id, list.map((c) => c.uid))}>确定顺序</button>
      </div>
    </>
  );
}

/** Popover listing the ways to play a clicked hand card. */
export function PlayMenu({ uid }: { uid: string }) {
  const ui = usePromptUi();
  const moves = ui.movesFor(uid);
  return (
    <motion.div className="playmenu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={(e) => e.stopPropagation()}>
      {moves.map(({ move, index }) => (
        <button key={index} className="playmenu__item" onClick={() => ui.send({ type: 'move', index })}>
          {move.label}
        </button>
      ))}
      <button className="playmenu__item playmenu__item--cancel" onClick={() => ui.setMenuUid(null)}>取消</button>
    </motion.div>
  );
}

/** Full-screen role selection at game start. */
export function RolePicker() {
  const game = useStore((s) => s.game)!;
  const ui = usePromptUi();
  const p = ui.prompt;
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = game.me?.role ?? picked;
  if (game.phase !== 'roleSelect') return null;
  const choosing = p?.kind === 'choice';
  return (
    <motion.div className="rolepick" data-prompt-id={p?.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <h2 className="rolepick__title">{choosing ? '选择你的角色' : '等待其他玩家选择角色…'}</h2>
      <p className="rolepick__sub">角色的阵营决定胜利条件。在发动主动技能之前，请对其他玩家保密。</p>
      <div className="rolepick__cards">
        {(game.me?.roleOptions ?? []).map((id, i) => (
          <motion.div key={id} initial={{ opacity: 0, y: 30, rotate: (i - 1) * 3 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }}>
            <Card
              id={id}
              size="xl"
              noPreview
              selected={chosen === id}
              dim={!!chosen && chosen !== id && !choosing}
              onClick={choosing ? () => { setPicked(id); ui.send(id); } : undefined}
            />
          </motion.div>
        ))}
      </div>
      {p?.deadline ? <Countdown key={p.id} deadline={p.deadline} /> : null}
    </motion.div>
  );
}
