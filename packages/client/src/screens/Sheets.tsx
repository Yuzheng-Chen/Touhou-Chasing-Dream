import { ACTION_CARDS, EVENT_CARDS, OFFICIAL_CARDS, ROLE_CARDS } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useSyncExternalStore, useState } from 'react';
import { Card } from '../cards/Card';
import { getVolume, isMuted, onMuteChange, setMuted, setVolume, sfx } from '../audio';
import { getReduceMotion, setReduceMotion } from '../prefs';
import { useStore } from '../store';
import { GlossList } from '../ui/GlossList';
import { Guide } from './Guide';
import './sheets.css';

export function Sheets() {
  const overlay = useStore((s) => s.overlay);
  const close = () => useStore.getState().setOverlay(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <AnimatePresence>
      {overlay && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div className="sheet" initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 16, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            {overlay === 'rules' && <Guide onClose={close} />}
            {overlay === 'gallery' && <Gallery onClose={close} />}
            {overlay === 'settings' && <Settings onClose={close} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const TABS = [
  { key: 'role', label: '角色', cards: ROLE_CARDS },
  { key: 'action', label: '行动', cards: ACTION_CARDS },
  { key: 'event', label: '事件', cards: EVENT_CARDS },
  { key: 'official', label: '官作', cards: OFFICIAL_CARDS },
] as const;

function Gallery({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('role');
  const [big, setBig] = useState<string | null>(null);
  const cur = TABS.find((t) => t.key === tab)!;
  return (
    <>
      <div className="sheet__head">
        <h2 className="sheet__title">卡牌图鉴</h2>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label} <small>{t.cards.length}</small>
            </button>
          ))}
        </div>
        <button className="btn btn--sm sheet__close" onClick={onClose}>关闭</button>
      </div>
      <div className="sheet__body gallery">
        {cur.cards.map((c) => (
          <div key={c.id} className="gallery__item">
            <Card id={c.id} size="md" onClick={() => setBig(c.id)} />
            {'count' in c && c.count > 1 && <span className="gallery__count">×{c.count}</span>}
          </div>
        ))}
      </div>
      <AnimatePresence>
        {big && (
          <motion.div className="gallery__zoom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBig(null)}>
            <motion.div className="gallery__zoomrow" initial={{ scale: 0.92 }} animate={{ scale: 1 }}>
              <Card id={big} size="xl" noPreview />
              <GlossList id={big} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  const volume = useSyncExternalStore(onMuteChange, getVolume);
  const [reduce, setReduce] = useState(getReduceMotion());
  return (
    <>
      <div className="sheet__head">
        <h2 className="sheet__title">设置</h2>
        <button className="btn btn--sm sheet__close" onClick={onClose}>关闭</button>
      </div>
      <div className="sheet__body prefs">
        <section className="pref">
          <div><b>音效</b><span>出牌、骰子、事件的声音</span></div>
          <div className="pref__ctl">
            <button className={`btn btn--sm ${muted ? '' : 'btn--gold'}`} onClick={() => { setMuted(!muted); if (muted) sfx('click'); }}>{muted ? '已静音' : '开启'}</button>
            <input type="range" min={0} max={100} value={Math.round(volume * 100)} disabled={muted} aria-label="音量"
              onChange={(e) => setVolume(Number(e.target.value) / 100)} onPointerUp={() => sfx('click')} />
            <output>{Math.round(volume * 100)}%</output>
          </div>
        </section>
        <section className="pref">
          <div><b>减少动画</b><span>关闭出牌飞行、横幅与粒子特效，适合低配电脑或容易晕的玩家</span></div>
          <label className="tog">
            <input type="checkbox" checked={reduce} onChange={(e) => { setReduce(e.target.checked); setReduceMotion(e.target.checked); }} />
            <span className="tog__track"><i /></span>
          </label>
        </section>
        <section className="pref pref--keys">
          <div><b>键盘快捷键（牌桌）</b></div>
          <div className="keys">
            <span><kbd>空格</kbd> 结束行动</span>
            <span><kbd>1</kbd>–<kbd>9</kbd> 打出第 N 张手牌</span>
            <span><kbd>L</kbd> 战况 / 聊天</span>
            <span><kbd>Esc</kbd> 关闭窗口</span>
          </div>
        </section>
      </div>
    </>
  );
}
