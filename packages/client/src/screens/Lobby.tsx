import { MAX_PLAYERS, MIN_PLAYERS } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { CardBack } from '../cards/Card';
import { Chat } from '../game/SidePanel';
import { request, socket } from '../net';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { MuteButton } from '../ui/MuteButton';
import { Signal } from '../ui/Signal';
import { SettingsPanel } from './SettingsPanel';
import './screens.css';

export function Lobby() {
  const room = useStore((s) => s.room)!;
  const toast = useStore((s) => s.toast);
  const setOverlay = useStore((s) => s.setOverlay);
  const myPing = useStore((s) => s.ping);
  const isHost = room.hostId === room.youId;
  const canStart = room.members.length >= MIN_PLAYERS;
  const link = `${location.origin}/r/${room.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('邀请链接已复制', 'good');
    } catch {
      toast(link);
    }
  };
  const start = () => request('room:start').catch((e) => toast(String(e), 'bad'));

  return (
    <div className="lobby">
      <div className="home__bg home__bg--dim" />
      <div className="lobby__grid">
        <section className="lobby__main panel">
          <header className="lobby__head">
            <div>
              <span className="label">房间码</span>
              <button className="lobby__code" onClick={copy} title="复制邀请链接">
                {room.id}
                <span className="lobby__copy">复制链接</span>
              </button>
            </div>
            <div className="lobby__head-actions">
              <Signal ms={myPing} />
              <MuteButton />
              <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('rules')}>规则</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('gallery')}>图鉴</button>
              <button className="btn btn--ghost btn--sm btn--icon" title="设置" aria-label="设置" onClick={() => setOverlay('settings')}>⚙</button>
              <button className="btn btn--sm" onClick={() => socket.emit('room:leave')}>离开</button>
            </div>
          </header>

          <div className="seats">
            <AnimatePresence initial={false}>
              {room.members.map((m, i) => (
                <motion.div
                  key={m.id}
                  layout
                  className={`seat-slot ${m.id === room.youId ? 'is-you' : ''} ${!m.connected ? 'is-off' : ''}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  style={{ '--seat': playerColor(i) } as React.CSSProperties}
                >
                  <CardBack kind="role" size="sm" />
                  <div className="seat-slot__name">
                    {m.id === room.hostId && <span title="房主">👑</span>}
                    {m.name}
                  </div>
                  <div className="seat-slot__meta">
                    {m.isBot ? <span className="seat-slot__ai">AI</span> : m.connected ? <Signal ms={m.id === room.youId ? myPing ?? m.ping : m.ping} /> : <span className="seat-slot__off">离线</span>}
                    {m.id === room.youId && <em>你</em>}
                  </div>
                  {isHost && m.id !== room.youId && (
                    <button className="seat-slot__kick" title="移出" onClick={() => socket.emit('room:kick', { memberId: m.id })}>×</button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {Array.from({ length: MAX_PLAYERS - room.members.length }).map((_, i) => (
              <div key={`empty${i}`} className="seat-slot seat-slot--empty">
                {isHost && i === 0 ? (
                  <button className="seat-slot__add" onClick={() => socket.emit('room:addBot')}>＋ 添加 AI</button>
                ) : (
                  <span>空位</span>
                )}
              </div>
            ))}
          </div>

          <SettingsPanel room={room} />

          <footer className="lobby__foot">
            {isHost ? (
              <button className="btn btn--primary btn--lg" disabled={!canStart} onClick={start}>
                {canStart ? '开始游戏' : `还需 ${MIN_PLAYERS - room.members.length} 人`}
              </button>
            ) : (
              <p className="lobby__wait">等待房主开始游戏…</p>
            )}
          </footer>
        </section>

        <aside className="lobby__chat panel">
          <Chat />
        </aside>
      </div>
    </div>
  );
}
