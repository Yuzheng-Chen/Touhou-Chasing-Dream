import { AnimatePresence, motion } from 'motion/react';
import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { getVolume, isMuted, onMuteChange, setMuted, setVolume, sfx } from '../audio';
import { useStore } from '../store';

// The illustrated rules and the gallery are only downloaded when somebody opens them.
const Gallery = lazy(() => import('./Gallery').then((m) => ({ default: m.Gallery })));
const Guide = lazy(() => import('./Guide').then((m) => ({ default: m.Guide })));
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
            <Suspense fallback={<div className="sheet__loading">载入中…</div>}>
              {overlay === 'rules' && <Guide onClose={close} />}
              {overlay === 'gallery' && <Gallery onClose={close} />}
            </Suspense>
            {overlay === 'settings' && <Settings onClose={close} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  const volume = useSyncExternalStore(onMuteChange, getVolume);
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
