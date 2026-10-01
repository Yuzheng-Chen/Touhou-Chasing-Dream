import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { socket } from '../net';
import { useStore } from '../store';
import { EMOTES } from '../ui/emotes';

/** Bubble above a seat when that player sends an emote. */
export function EmoteBubble({ playerId }: { playerId: string }) {
  const e = useStore((s) => s.emotes[playerId]);
  return (
    <AnimatePresence>
      {e && EMOTES[e.emote] && (
        <motion.div
          key={e.key}
          className="emote-bubble"
          initial={{ opacity: 0, scale: 0.4, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -8 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
          title={EMOTES[e.emote].label}
        >
          {EMOTES[e.emote].glyph}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Button + popover to send an emote. */
export function EmotePicker() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="emotepicker" onClick={(e) => e.stopPropagation()}>
      <button className="btn btn--ghost btn--sm btn--icon" aria-label="表情" title="表情" aria-expanded={open} onClick={() => setOpen(!open)}>😀</button>
      <AnimatePresence>
        {open && (
          <motion.div className="emotepicker__pop" initial={{ opacity: 0, y: 6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
            {Object.entries(EMOTES).map(([id, e]) => (
              <button key={id} title={e.label} aria-label={e.label} onClick={() => { socket.emit('game:emote', { emote: id }); setOpen(false); }}>
                {e.glyph}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
