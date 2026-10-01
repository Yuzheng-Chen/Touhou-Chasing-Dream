import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card } from '../cards/Card';
import { useStore } from '../store';
import { GlossList } from './GlossList';

/** Last known pointer position, tracked from page load so a preview can be placed before its first paint. */
const pointer = { x: -1, y: -1 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }, { passive: true });
}

/** Large preview of whatever card is under the pointer, with keyword boxes on its far side. */
export function CardPreview() {
  const hover = useStore((s) => s.hover);
  const ref = useRef<HTMLDivElement>(null);
  const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!hover || pointer.x < 0) {
      el.style.visibility = 'hidden';
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let flip = pointer.x > window.innerWidth / 2; // show on the pointer's left when it is on the right half
    let left = flip ? pointer.x - 26 - w : pointer.x + 26;
    // Hovering an item of the play menu: sit beside the whole menu instead of covering it.
    const menu = document.querySelector('.playmenu')?.getBoundingClientRect();
    if (menu && pointer.x >= menu.left && pointer.x <= menu.right) {
      flip = menu.right + 14 + w > window.innerWidth - 12;
      left = flip ? menu.left - 14 - w : menu.right + 14;
    }
    left = Math.min(Math.max(12, left), window.innerWidth - w - 12);
    const top = Math.min(Math.max(12, pointer.y - h / 2), Math.max(12, window.innerHeight - h - 12));
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    el.style.visibility = 'visible';
    el.dataset.flip = flip ? '1' : '0';
  }, [hover]);

  const [overflowing, setOverflowing] = useState(false);
  // Before paint: the first frame already sits beside the pointer (no flash at the wrong spot).
  useLayoutEffect(() => {
    place();
    const t = ref.current?.querySelector('.card__text') as HTMLElement | null;
    setOverflowing(!!t && t.scrollHeight > t.clientHeight + 2);
  }, [place]);

  // The preview ignores the pointer, so the wheel is forwarded to its text when that text overflows
  // (and lets the page scroll normally once the text has reached its end).
  useEffect(() => {
    if (touch || !hover) return;
    const onWheel = (e: WheelEvent) => {
      const t = ref.current?.querySelector('.card__text') as HTMLElement | null;
      if (!t || t.scrollHeight <= t.clientHeight + 2) return;
      const atEnd = (e.deltaY > 0 && t.scrollTop + t.clientHeight >= t.scrollHeight - 1) || (e.deltaY < 0 && t.scrollTop <= 0);
      if (atEnd) return;
      t.scrollTop += e.deltaY;
      e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [hover, touch]);
  useEffect(() => {
    if (touch) return;
    window.addEventListener('pointermove', place, { passive: true });
    return () => window.removeEventListener('pointermove', place);
  }, [place, touch]);

  // Touch devices: a centred preview while the card is held down.
  if (touch) {
    return (
      <AnimatePresence>
        {hover && (
          <motion.div className="card-preview card-preview--touch" key={hover} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card id={hover} size="xl" noPreview />
            <GlossList id={hover} />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div ref={ref} className="card-preview" aria-hidden style={{ visibility: 'hidden' }}>
      {hover && (
        <motion.div key={hover} className="card-preview__row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
          <div className="card-preview__col">
            <Card id={hover} size="xl" noPreview className={overflowing ? 'has-more' : ''} />
            {overflowing && <span className="card-preview__hint">🖱 滚动滚轮查看全文</span>}
          </div>
          <GlossList id={hover} />
        </motion.div>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast--${t.tone ?? 'neutral'}`}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  const everConnected = useRef(false);
  if (connected) everConnected.current = true;
  return (
    <AnimatePresence>
      {!connected && everConnected.current && (
        <motion.div className="conn-banner" initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}>
          连接中断，正在重连…
        </motion.div>
      )}
    </AnimatePresence>
  );
}
