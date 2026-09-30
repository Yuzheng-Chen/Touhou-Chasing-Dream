import { MAX_PLAYERS, MIN_PLAYERS, type RoomSettings } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { CardBack } from '../cards/Card';
import { request, socket } from '../net';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { Chat } from '../game/SidePanel';
import './screens.css';

export function Lobby() {
  const room = useStore((s) => s.room)!;
  const toast = useStore((s) => s.toast);
  const setOverlay = useStore((s) => s.setOverlay);
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
  const set = (p: Partial<RoomSettings>) => socket.emit('room:settings', p);
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
              <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('rules')}>规则</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('gallery')}>图鉴</button>
              <button className="btn btn--sm" onClick={() => socket.emit('room:leave')}>离开</button>
            </div>
          </header>

          <div className="seats">
            <AnimatePresence initial={false}>
              {room.members.map((m, i) => (
                <motion.div
                  key={m.id}
                  layout
                  className={`seat-slot ${m.id === room.youId ? 'is-you' : ''}`}
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
                    {m.isBot ? 'AI' : m.connected ? (m.id === room.youId ? '你' : '在线') : '离线'}
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

          <footer className="lobby__foot">
            <div className="settings">
              <Setting label="候选角色数" value={room.settings.roleChoices} min={1} max={6} step={1} disabled={!isHost} onChange={(v) => set({ roleChoices: v })} format={(v) => `${v} 张`} />
              <Setting label="操作时限" value={room.settings.promptTimeout} min={0} max={180} step={15} disabled={!isHost} onChange={(v) => set({ promptTimeout: v })} format={(v) => (v ? `${v} 秒` : '不限')} />
              <Setting label="AI 速度" value={room.settings.botDelay} min={200} max={2400} step={200} disabled={!isHost} onChange={(v) => set({ botDelay: v })} format={(v) => (v <= 600 ? '快' : v <= 1400 ? '适中' : '慢')} />
            </div>
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

function Setting({ label, value, min, max, step, disabled, onChange, format }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="setting">
      <span className="label">{label}</span>
      <div className="setting__row">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
        <b>{format(value)}</b>
      </div>
    </label>
  );
}
