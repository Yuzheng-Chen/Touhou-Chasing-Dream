import { ALL_CARDS, cardThumbUrl } from '@tcd/shared';

/**
 * Warm the HTTP cache with the small card pictures during idle time so cards never pop in when dealt.
 * Only the ~15 KB thumbnails (never the full pictures), 2 at a time, and not at all on a data-saver or slow connection —
 * there, pictures are fetched when a card is first shown, and the card frame is readable without them.
 */
export function preloadArt() {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || (conn?.effectiveType && conn.effectiveType !== '4g')) return;
  const queue = ALL_CARDS.map((c) => cardThumbUrl(c.id));
  let active = 0;
  const pump = () => {
    while (active < 2 && queue.length && !document.hidden) {
      const url = queue.shift()!;
      active++;
      const img = new Image();
      img.decoding = 'async';
      (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
      const done = () => {
        active--;
        schedule();
      };
      img.onload = done;
      img.onerror = done;
      img.src = url;
    }
  };
  const schedule = () => {
    if (!queue.length) return;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    idle ? idle(pump, { timeout: 3000 }) : setTimeout(pump, 200);
  };
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('load', () => setTimeout(schedule, 1500), { once: true });
}
