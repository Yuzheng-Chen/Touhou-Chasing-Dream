import { useEffect } from 'react';
import { useStore } from '../store';
import { usePromptUi } from './prompt';

/** Keyboard shortcuts at the table, plus a flashing tab title when you are needed while the tab is hidden. */
export function Shortcuts() {
  const ui = usePromptUi();
  const hasPrompt = useStore((s) => !!s.game?.prompt && !!s.game?.me);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const p = ui.prompt;
      if (e.key === 'l' || e.key === 'L') {
        const st = useStore.getState();
        st.setSidebar(st.sidebar === 'log' ? 'chat' : 'log');
      } else if (p?.kind === 'turn' && e.key === ' ') {
        e.preventDefault();
        ui.send({ type: 'end' });
      } else if (p?.kind === 'turn' && /^[1-9]$/.test(e.key)) {
        const hand = useStore.getState().game?.me?.hand ?? [];
        const card = hand[Number(e.key) - 1];
        if (!card) return;
        const moves = ui.movesFor(card.uid);
        if (moves.length === 1) ui.send({ type: 'move', index: moves[0].index });
        else if (moves.length > 1) ui.setMenuUid(card.uid);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  useEffect(() => {
    const base = document.title;
    if (!hasPrompt) return;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = document.hidden && on ? '🔔 轮到你了 · 逐梦东方圈' : base;
    }, 900);
    return () => {
      clearInterval(t);
      document.title = base;
    };
  }, [hasPrompt]);

  return null;
}
