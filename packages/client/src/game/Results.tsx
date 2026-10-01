import { factionLabel, roleDef, type GameView, type ScoreLine } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { sfx } from '../audio';
import { Card, CardBack } from '../cards/Card';
import { socket } from '../net';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { Confetti } from './fx';
import './ceremony.css';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * The final settlement as a little show: first the community's verdict, then every player in turn — from the lowest
 * result to the winner — with their role flipping over and the story of their score told line by line
 * (conditions ticked, base score, bonus, total, 胜点). Anyone can skip ahead; the finale shows the full board.
 */
export function Results() {
  const game = useStore((s) => s.game)!;
  const room = useStore((s) => s.room);
  const busy = useStore((s) => s.fxQueue.length > 0);
  const me = useStore((s) => s.playerId);
  const [hidden, setHidden] = useState(false);
  const [beat, setBeat] = useState(0);
  const res = game.result;
  const order = useMemo(() => (res ? [...res.lines].reverse() : []), [res]);
  const finale = order.length + 1;

  const next = () => setBeat((b) => Math.min(finale, b + 1));
  const atBoard = beat >= finale;
  useEffect(() => {
    useStore.setState({ finale: atBoard });
    return () => useStore.setState({ finale: false });
  }, [atBoard]);
  useEffect(() => {
    if (hidden || beat >= finale) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'ArrowRight'].includes(e.key) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, beat, finale]);

  if (!res) return null;
  if (busy && beat === 0) return null; // let the very last effects of the game play out first
  if (hidden) return <button className="btn btn--gold results__reopen" onClick={() => setHidden(false)}>查看结算</button>;

  return (
    <motion.div className="sheet-backdrop results ceremony" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
      {beat < finale ? (
        <>
          <div className="ceremony__bar">
            <b className="ceremony__title">终局结算</b>
            <span className="ceremony__dots">
              {Array.from({ length: finale }, (_, i) => <i key={i} className={i < beat ? 'is-done' : i === beat ? 'is-now' : ''} />)}
            </span>
            <button className="btn btn--ghost btn--sm ceremony__next" onClick={next} title="Enter / 空格 / →">下一位 ▶</button>
            <button className="btn btn--ghost btn--sm ceremony__skip" onClick={() => setBeat(finale)}>跳到结果 ⏭</button>
          </div>
          <AnimatePresence mode="wait">
            {beat === 0 ? (
              <Verdict key="v" game={game} onDone={next} />
            ) : (
              <PlayerBeat key={order[beat - 1].playerId} line={order[beat - 1]} game={game} done={order.slice(0, beat - 1)} rank={order.length - beat + 1} onDone={next} />
            )}
          </AnimatePresence>
        </>
      ) : (
        <Finale game={game} lines={res.lines} winnerIds={res.winnerIds} me={me} tutorial={!!room?.tutorial} isHost={room?.hostId === room?.youId} onHide={() => setHidden(true)} />
      )}
    </motion.div>
  );
}

// ── 1. the community's verdict ────────────────────────────────────────────────────────────

function Verdict({ game, onDone }: { game: GameView; onDone: () => void }) {
  const c = game.community;
  useEffect(() => {
    sfx('drum');
    const a = setTimeout(() => sfx(c === 0 ? 'thud' : c > 0 ? 'bigup' : 'bigdown'), 1500);
    const b = setTimeout(onDone, 5200);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  const side = c > 0 ? 'prosper' : c < 0 ? 'niche' : 'even';
  return (
    <motion.div className={`verdict verdict--${side}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>共 {game.round} 轮之后，社群规模停在……</motion.small>
      <motion.b initial={{ scale: 4, opacity: 0 }} animate={{ scale: [4, 0.9, 1], opacity: 1 }} transition={{ delay: 1.4, duration: 0.7, times: [0, 0.6, 1] }}>{signed(c)}</motion.b>
      <motion.div className="verdict__sides" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.4, duration: 0.6 }}>
        <span className={c >= 0 ? 'is-ok' : 'is-bad'}><em>繁荣阵营</em>需要 ≥ 0 {c >= 0 ? '✓ 成立' : '✗ 落空'}</span>
        <span className={c <= 0 ? 'is-ok' : 'is-bad'}><em>小众阵营</em>需要 ≤ 0 {c <= 0 ? '✓ 成立' : '✗ 落空'}</span>
      </motion.div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.4 }}>接下来，一位一位地揭晓每个人的得分……</motion.p>
    </motion.div>
  );
}

// ── 2. one player ─────────────────────────────────────────────────────────────────────────

const STEP_MS = 900;

function PlayerBeat({ line, game, done, rank, onDone }: { line: ScoreLine; game: GameView; done: ScoreLine[]; rank: number; onDone: () => void }) {
  const p = game.players.find((x) => x.id === line.playerId)!;
  const role = roleDef(line.roleId);
  const [faceUp, setFaceUp] = useState(false);
  const [shown, setShown] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [vp, setVp] = useState(false);
  const color = playerColor(p.seat);

  useEffect(() => {
    const timers: number[] = [];
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
    sfx('drum');
    at(1000, () => { setFaceUp(true); sfx('flip'); });
    let t = 2000;
    line.steps.forEach((s, i) => {
      at(t, () => { setShown(i + 1); sfx(s.ok === false ? 'down' : 'score'); });
      t += STEP_MS;
    });
    // the total counts up
    const tick = line.total > 0 ? Math.min(130, 1400 / line.total) : 0;
    at(t + 300, () => setTotal(0));
    for (let n = 1; n <= line.total; n++) at(t + 300 + n * tick, () => { setTotal(n); sfx('score'); });
    const end = t + 300 + line.total * tick + 500;
    at(end, () => { setVp(true); sfx(line.victoryPoints >= 2 ? 'fanfare' : line.victoryPoints === 1 ? 'up' : 'down'); });
    at(end + 2600, onDone);
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div className="pbeat" data-player={line.playerId} initial={{ opacity: 0, x: 80 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -80 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      <div className="pbeat__main">
        <div className="pbeat__card">
          <motion.div animate={faceUp ? { rotateY: [90, 0], scale: [1.1, 1] } : {}} transition={{ duration: 0.5 }}>
            {faceUp ? <Card id={line.roleId} size="lg" noPreview /> : <CardBack kind="role" size="lg" />}
          </motion.div>
          {faceUp && <motion.span className="pbeat__faction" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{role.stance === 'neutral' || role.focus === 'neutral' ? `${line.faction}（所选阵营）` : factionLabel({ stance: role.stance, focus: role.focus })}</motion.span>}
        </div>

        <div className="pbeat__story">
          <div className="pbeat__who">
            <small>第 {rank} 名候选</small>
            <b style={{ color }}>{p.name}</b>
            <span>{faceUp ? <>角色：<em>{role.name}</em> · 个人影响力 <em>{signed(line.influence)}</em></> : '角色牌尚未翻开……'}</span>
          </div>
          <div className="pbeat__steps">
            {line.steps.slice(0, shown).map((s, i) => (
              <motion.div key={i} className={`cstep ${s.ok === true ? 'is-ok' : s.ok === false ? 'is-bad' : ''}`} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
                <span className="cstep__label">{s.label}</span>
                <span className="cstep__text">{s.text}</span>
                {s.ok !== undefined && <motion.i className="cstep__mark" initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15, type: 'spring', stiffness: 400, damping: 16 }}>{s.ok ? '✓' : '✗'}</motion.i>}
                {s.points !== undefined && <motion.b className="cstep__pts" initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }}>{signed(s.points)}</motion.b>}
              </motion.div>
            ))}
          </div>
          {total !== null && (
            <motion.div className={`ptotal ${line.total === 0 ? 'is-zero' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <span>得分</span>
              <b>{total}</b>
              {line.bonus > 0 && <small>含额外 +{line.bonus}</small>}
            </motion.div>
          )}
          {vp && (
            <motion.div className={`vp vp--${line.victoryPoints}`} initial={{ opacity: 0, scale: 2.4, rotate: -10 }} animate={{ opacity: 1, scale: 1, rotate: -3 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
              <b>胜点 +{line.victoryPoints}</b>
              <span>{line.vpNote}</span>
            </motion.div>
          )}
        </div>
      </div>

      <div className="pbeat__done">
        {done.map((d) => {
          const q = game.players.find((x) => x.id === d.playerId)!;
          return (
            <motion.span key={d.playerId} className="donechip" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card id={d.roleId} size="xs" noPreview />
              <b style={{ color: playerColor(q.seat) }}>{q.name}</b>
              <em>{d.total}</em>
              <i>胜点 {d.victoryPoints}</i>
            </motion.span>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── 3. the board ──────────────────────────────────────────────────────────────────────────

function Finale({ game, lines, winnerIds, me, tutorial, isHost, onHide }: {
  game: GameView; lines: ScoreLine[]; winnerIds: string[]; me: string | null; tutorial: boolean; isHost: boolean; onHide: () => void;
}) {
  const iWon = !!me && winnerIds.includes(me);
  useEffect(() => {
    sfx(winnerIds.length ? 'fanfare' : 'lose');
    const t = setTimeout(() => sfx(iWon ? 'win' : me ? 'lose' : 'up'), 900);
    return () => clearTimeout(t);
  }, []);
  const names = winnerIds.map((id) => game.players.find((p) => p.id === id)).filter(Boolean);
  return (
    <>
      {iWon && <Confetti />}
      <motion.div className="sheet results__sheet" initial={{ y: 30, scale: 0.97 }} animate={{ y: 0, scale: 1 }} transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.6 }}>
        <div className="results__head">
          <h2 className="results__title">{names.length ? '👑 胜者诞生' : '无人获胜'}</h2>
          <p className="results__crown">
            {names.length ? names.map((p, i) => <span key={p!.id}>{i > 0 && '、'}<b style={{ color: playerColor(p!.seat) }}>{p!.name}</b></span>) : '没有人满足自己的胜利条件'}
          </p>
          <p className="results__sub">社群规模 <b className={game.community > 0 ? 'is-pos' : game.community < 0 ? 'is-neg' : ''}>{signed(game.community)}</b> · 共 {game.round} 轮</p>
        </div>
        <div className="results__list">
          {lines.map((l, i) => {
            const p = game.players.find((x) => x.id === l.playerId)!;
            const win = winnerIds.includes(l.playerId);
            return (
              <motion.div key={l.playerId} className={`rline ${win ? 'is-winner' : ''} ${l.won ? '' : 'is-lost'}`} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.1 }}>
                <span className="rline__rank">{win ? '👑' : i + 1}</span>
                <Card id={l.roleId} size="sm" />
                <div className="rline__who">
                  <b style={{ color: playerColor(p.seat) }}>{p.name}</b>
                  <span className="muted">{l.faction} · 影响力 {p.influence}</span>
                  <span className={`rline__reason ${l.won ? 'is-ok' : ''}`}>{l.reason}</span>
                  <span className="rline__note">{l.vpNote}</span>
                </div>
                <div className="rline__score">
                  <span className="label">得分</span>
                  <b>{l.total}</b>
                  {l.bonus > 0 && <small>含额外 +{l.bonus}</small>}
                </div>
                <div className="rline__vp">
                  <span className="label">胜点</span>
                  <b>{l.victoryPoints}</b>
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="results__actions">
          <button className="btn" onClick={onHide}>查看牌桌</button>
          <button className="btn" onClick={() => socket.emit('room:leave')}>离开房间</button>
          {tutorial ? (
            <button className="btn btn--primary" onClick={() => socket.emit('room:leave')}>回到首页</button>
          ) : isHost ? (
            <button className="btn btn--primary" onClick={() => socket.emit('room:rematch')}>再来一局</button>
          ) : (
            <span className="muted">等待房主开始下一局…</span>
          )}
        </div>
      </motion.div>
    </>
  );
}
