import { PHASE_LABEL, type Phase } from '@tcd/shared';
import { AnimatePresence } from 'motion/react';
import { useState, type CSSProperties } from 'react';
import { socket } from '../net';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { Center } from './Center';
import { FxLayer } from './Fx';
import { MyArea } from './MyArea';
import { PromptProvider, RolePicker } from './prompt';
import { Results } from './Results';
import { Seat } from './Seat';
import { SidePanel } from './SidePanel';
import './table.css';

const TURN_PHASES: Phase[] = ['eventDraw', 'draw', 'action', 'eventResolve', 'discard'];

export function Table() {
  const game = useStore((s) => s.game)!;
  const meId = game.me?.id;
  const [sideOpen, setSideOpen] = useState(false);

  // Opponents in clockwise order starting after me (left → right across the top).
  const n = game.players.length;
  const myIdx = Math.max(0, game.players.findIndex((p) => p.id === meId));
  const opponents = Array.from({ length: n }, (_, k) => game.players[(myIdx + k + (meId ? 1 : 0)) % n]).slice(0, meId ? n - 1 : n);

  return (
    <PromptProvider>
      <div className="table">
        <div className="table__bg" />
        <TopBar onToggleSide={() => setSideOpen((v) => !v)} />
        <div className={`table__grid ${sideOpen ? 'side-open' : ''}`}>
          <main className="table__main">
            <div className="opponents" style={{ '--n': opponents.length } as CSSProperties}>
              {opponents.map((p, i) => {
                const t = opponents.length > 1 ? (i / (opponents.length - 1)) * 2 - 1 : 0;
                return <Seat key={p.id} p={p} style={{ '--arc': `${t * t * 36}px` } as CSSProperties} />;
              })}
            </div>
            <Center />
            <MyArea />
          </main>
          <SidePanel />
        </div>
        <FxLayer />
        <AnimatePresence>{game.phase === 'roleSelect' && <RolePicker />}</AnimatePresence>
        {game.phase === 'finished' && <Results />}
      </div>
    </PromptProvider>
  );
}

function TopBar({ onToggleSide }: { onToggleSide: () => void }) {
  const game = useStore((s) => s.game)!;
  const room = useStore((s) => s.room);
  const setOverlay = useStore((s) => s.setOverlay);
  const unread = useStore((s) => s.unreadChat);
  const cur = game.players.find((p) => p.id === game.currentPlayerId);
  const leave = () => {
    if (game.phase === 'finished' || confirm('确定离开游戏吗？你的座位会保留，可以用房间码重新加入。')) socket.emit('room:leave');
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="topbar__brand">逐梦东方圈</span>
        {room && <span className="chip" title="房间码">#{room.id}</span>}
        {game.round > 0 && <span className="topbar__round serif">第 {game.round} 轮</span>}
        <span className="topbar__progress" title={`官作弃牌 ${game.discards.official.length} / ${game.endThreshold} 张时进入最终结算`}>
          {Array.from({ length: game.endThreshold }, (_, i) => (
            <i key={i} className={i < game.discards.official.length ? 'is-on' : ''} />
          ))}
        </span>
      </div>

      <div className="topbar__center">
        {cur && TURN_PHASES.includes(game.phase) ? (
          <>
            <b className="topbar__who" style={{ color: playerColor(cur.seat) }}>{cur.id === game.me?.id ? '你' : cur.name}的回合</b>
            <ol className="phases">
              {TURN_PHASES.map((ph) => (
                <li key={ph} className={ph === game.phase ? 'is-now' : TURN_PHASES.indexOf(ph) < TURN_PHASES.indexOf(game.phase) ? 'is-done' : ''}>
                  {PHASE_LABEL[ph]}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <b className="topbar__who">{PHASE_LABEL[game.phase]}</b>
        )}
      </div>

      <div className="topbar__right">
        <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('rules')}>规则</button>
        <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('gallery')}>图鉴</button>
        <button className="btn btn--ghost btn--sm topbar__sidetoggle" onClick={onToggleSide}>
          战况{unread > 0 && <span className="dot">{unread}</span>}
        </button>
        <button className="btn btn--sm" onClick={leave}>离开</button>
      </div>
    </header>
  );
}
