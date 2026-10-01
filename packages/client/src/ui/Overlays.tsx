import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
    const flip = pointer.x > window.innerWidth / 2; // show on the pointer's left when it is on the right half
    const left = Math.min(Math.max(12, flip ? pointer.x - 26 - w : pointer.x + 26), window.innerWidth - w - 12);
    const top = Math.min(Math.max(12, pointer.y - h / 2), Math.max(12, window.innerHeight - h - 12));
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    el.style.visibility = 'visible';
    el.dataset.flip = flip ? '1' : '0';
  }, [hover]);

  // Before paint: the first frame already sits beside the pointer (no flash at the wrong spot).
  useLayoutEffect(place, [place]);
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
          <Card id={hover} size="xl" noPreview />
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
