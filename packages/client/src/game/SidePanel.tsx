import { useEffect, useRef, useState } from 'react';
import { socket } from '../net';
import { useStore } from '../store';
import { RichText } from '../ui/RichText';

export function SidePanel() {
  const sidebar = useStore((s) => s.sidebar);
  const setSidebar = useStore((s) => s.setSidebar);
  const unread = useStore((s) => s.unreadChat);
  return (
    <aside className="side panel">
      <div className="side__tabs tabs">
        <button className={`tab ${sidebar === 'log' ? 'is-active' : ''}`} onClick={() => setSidebar('log')}>战况</button>
        <button className={`tab ${sidebar === 'chat' ? 'is-active' : ''}`} onClick={() => setSidebar('chat')}>
          聊天{unread > 0 && <span className="dot">{unread}</span>}
        </button>
      </div>
      {sidebar === 'log' ? <Log /> : <Chat />}
    </aside>
  );
}

/** Auto-scrolls to the bottom unless the reader has scrolled up. */
function useStickyScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { ref, onScroll };
}

function Log() {
  const log = useStore((s) => s.game?.log ?? []);
  const { ref, onScroll } = useStickyScroll(log.at(-1)?.seq);
  return (
    <div className="log" ref={ref} onScroll={onScroll}>
      {log.map((e) => (
        <div key={e.seq} className={`log__line log__line--${e.level ?? 'info'}`}>
          <RichText text={e.text} />
        </div>
      ))}
    </div>
  );
}

export function Chat() {
  const chat = useStore((s) => s.chat);
  const me = useStore((s) => s.playerId);
  const [text, setText] = useState('');
  const { ref, onScroll } = useStickyScroll(chat.length);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    socket.emit('chat:send', { text: t });
    setText('');
  };
  return (
    <div className="chat">
      <div className="chat__list" ref={ref} onScroll={onScroll}>
        {chat.length === 0 && <p className="muted chat__empty">还没有消息，打个招呼吧 👋</p>}
        {chat.map((m) => (
          <div key={m.id} className={`chat__msg ${m.fromId === me ? 'is-me' : ''}`}>
            <span className="chat__from">{m.fromName}</span>
            <span className="chat__text">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="chat__form" onSubmit={send}>
        <input className="input" value={text} maxLength={200} placeholder="说点什么…" onChange={(e) => setText(e.target.value)} />
        <button className="btn btn--gold" disabled={!text.trim()}>发送</button>
      </form>
    </div>
  );
}
