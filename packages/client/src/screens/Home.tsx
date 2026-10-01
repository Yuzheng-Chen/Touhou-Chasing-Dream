import type { RoomSummary } from '@tcd/shared';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Card, YinYang } from '../cards/Card';
import { prefs, request } from '../net';
import { useStore } from '../store';
import { MuteButton } from '../ui/MuteButton';
import './screens.css';

export function Home() {
  const { name, setName, toast, setOverlay, connected } = useStore();
  const [draft, setDraft] = useState(name);
  const [code, setCode] = useState(() => location.pathname.match(/^\/r\/([A-Z0-9]{4})$/i)?.[1]?.toUpperCase() ?? '');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connected) return;
    const load = () => request('room:list').then(setRooms).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [connected]);

  const commitName = () => {
    const n = draft.trim().slice(0, 16);
    if (!n) {
      toast('先起一个昵称吧', 'bad');
      return false;
    }
    if (n !== name) setName(n);
    return true;
  };

  const create = async () => {
    if (!commitName()) return;
    setBusy(true);
    try {
      await request('room:create');
    } catch (e) {
      toast(String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const firstVisit = prefs.get('tutorialDone') === null;
  const tutorial = async () => {
    if (!commitName()) return;
    setBusy(true);
    try {
      prefs.set('tutorialDone', '1');
      await request('room:tutorial');
    } catch (e) {
      toast(String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const join = async (id = code) => {
    if (!commitName()) return;
    if (!/^[A-Z0-9]{4}$/i.test(id)) return toast('请输入 4 位房间码', 'bad');
    setBusy(true);
    try {
      await request('room:join', { roomId: id.toUpperCase() });
    } catch (e) {
      toast(String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <div className="home__bg" />
      <div className="home__veil" />
      <motion.header
        className="home__hero"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <YinYang className="home__orb" size={64} />
        <h1 className="home__title">逐梦东方圈</h1>
        <p className="home__subtitle">Touhou · Chasing Dream</p>
        <div className="home__fan" aria-hidden>
          {['preach', 'headline', 'pcb', 'evangelist'].map((id, i) => (
            <div key={id} className="home__fancard" style={{ '--i': i } as React.CSSProperties}><Card id={id} size="md" /></div>
          ))}
        </div>
        <p className="home__tagline">3–8 人隐藏身份卡牌游戏。繁荣还是小众？社群还是个人？<br />在同人圈的风云变幻里，守护你心中的东方。</p>
      </motion.header>

      <motion.main
        className="home__card panel"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      >
        <label className="field">
          <span className="label">昵称</span>
          <input
            className="input"
            value={draft}
            maxLength={16}
            placeholder="你的名字"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
          />
        </label>

        <button className="btn btn--primary btn--lg home__create" onClick={create} disabled={busy || !connected}>
          创建房间
        </button>

        <button className={`btn btn--lg home__tutorial ${firstVisit ? 'is-new' : ''}`} onClick={tutorial} disabled={busy || !connected}>
          🎓 新手教学局<small>{firstVisit ? '第一次玩？从这里开始' : '和 AI 一起，边打边学'}</small>
        </button>

        <div className="home__or"><span>或加入好友的房间</span></div>

        <form className="home__join" onSubmit={(e) => { e.preventDefault(); join(); }}>
          <input
            className="input home__code"
            value={code}
            maxLength={4}
            placeholder="房间码"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button className="btn btn--gold btn--lg" disabled={busy || !connected || code.length !== 4}>加入</button>
        </form>

        {rooms.length > 0 && (
          <div className="home__rooms">
            <span className="label">正在进行的房间</span>
            {rooms.map((r) => (
              <button key={r.id} className="room-row" onClick={() => join(r.id)}>
                <b className="room-row__code">{r.id}</b>
                <span>{r.hostName} 的房间</span>
                <span className="room-row__meta">{r.players}/8 · {r.status === 'lobby' ? '等待中' : r.status === 'playing' ? '游戏中（观战）' : '已结束'}</span>
              </button>
            ))}
          </div>
        )}

        <div className="home__links">
          <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('rules')}>📜 新手指南</button>
          <button className="btn btn--ghost btn--sm" onClick={() => setOverlay('gallery')}>🎴 卡牌图鉴</button>
          <button className="btn btn--ghost btn--sm btn--icon" title="设置" aria-label="设置" onClick={() => setOverlay('settings')}>⚙</button>
          <MuteButton />
        </div>
        {!connected && <p className="home__status">正在连接服务器…</p>}
      </motion.main>
      <footer className="home__credits">东方 Project 二次创作 · 非官方粉丝作品，非商业用途 · 插画由 AI 生成</footer>
    </div>
  );
}
