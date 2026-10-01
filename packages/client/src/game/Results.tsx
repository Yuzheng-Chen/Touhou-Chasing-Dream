import { motion } from 'motion/react';
import { useState } from 'react';
import { Card } from '../cards/Card';
import { socket } from '../net';
import { Confetti } from './Fx';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';

export function Results() {
  const game = useStore((s) => s.game)!;
  const room = useStore((s) => s.room);
  const [hidden, setHidden] = useState(false);
  const res = game.result;
  const me = useStore((s) => s.playerId);
  if (!res) return null;
  if (hidden) {
    return <button className="btn btn--gold results__reopen" onClick={() => setHidden(false)}>查看结算</button>;
  }
  const isHost = room?.hostId === room?.youId;

  return (
    <motion.div className="sheet-backdrop results" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {me && res.winnerIds.includes(me) && !document.documentElement.classList.contains('reduce-motion') && <Confetti />}
      <motion.div className="sheet results__sheet" initial={{ y: 30, scale: 0.97 }} animate={{ y: 0, scale: 1 }} transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.6 }}>
        <div className="results__head">
          <h2 className="results__title">终局结算</h2>
          <p className="results__sub">社群规模 <b className={game.community > 0 ? 'is-pos' : game.community < 0 ? 'is-neg' : ''}>{game.community > 0 ? `+${game.community}` : game.community}</b> · 共 {game.round} 轮</p>
        </div>
        <div className="results__list">
          {res.lines.map((l, i) => {
            const p = game.players.find((x) => x.id === l.playerId)!;
            const win = res.winnerIds.includes(l.playerId);
            return (
              <motion.div
                key={l.playerId}
                className={`rline ${win ? 'is-winner' : ''} ${l.won ? '' : 'is-lost'}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08 }}
              >
                <span className="rline__rank">{win ? '👑' : i + 1}</span>
                <Card id={l.roleId} size="sm" />
                <div className="rline__who">
                  <b style={{ color: playerColor(p.seat) }}>{p.name}</b>
                  <span className="muted">{l.faction} · 影响力 {p.influence}</span>
                  <span className={`rline__reason ${l.won ? 'is-ok' : ''}`}>{l.reason}</span>
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
          <button className="btn" onClick={() => setHidden(true)}>查看牌桌</button>
          <button className="btn" onClick={() => socket.emit('room:leave')}>离开房间</button>
          {room?.tutorial ? (
            <button className="btn btn--primary" onClick={() => socket.emit('room:leave')}>回到首页</button>
          ) : isHost ? (
            <button className="btn btn--primary" onClick={() => socket.emit('room:rematch')}>再来一局</button>
          ) : (
            <span className="muted">等待房主开始下一局…</span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
