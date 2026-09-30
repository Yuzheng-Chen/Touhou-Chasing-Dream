import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Card } from '../cards/Card';
import { useStore } from '../store';

/** Large preview of whatever card is under the pointer. */
export function CardPreview() {
  const hover = useStore((s) => s.hover);
  const ref = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      place();
    };
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const w = 300;
      const h = 420;
      const { x, y } = pos.current;
      const left = x > window.innerWidth / 2 ? x - w - 28 : x + 28;
      const top = Math.min(Math.max(12, y - h / 2), window.innerHeight - h - 12);
      el.style.transform = `translate(${Math.max(12, left)}px, ${top}px)`;
    };
    window.addEventListener('pointermove', onMove);
    place();
    return () => window.removeEventListener('pointermove', onMove);
  }, [hover]);

  // Touch devices: no hover previews.
  if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) return null;

  return (
    <div ref={ref} className="card-preview" aria-hidden>
      <AnimatePresence>
        {hover && (
          <motion.div
            key={hover}
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16 }}
          >
            <Card id={hover} size="xl" noPreview />
          </motion.div>
        )}
      </AnimatePresence>
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
