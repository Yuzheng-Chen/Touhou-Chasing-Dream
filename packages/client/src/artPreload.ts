import { ALL_CARDS, cardArtUrl } from '@tcd/shared';

/**
 * Warm the HTTP cache with every card illustration during idle time, so cards never pop in
 * when they are dealt or hovered. Throttled (3 at a time) so it never competes with the game itself.
 */
export function preloadArt() {
  const queue = ALL_CARDS.map((c) => cardArtUrl(c.id));
  let active = 0;
  const pump = () => {
    while (active < 3 && queue.length) {
      const url = queue.shift()!;
      active++;
      const img = new Image();
      img.decoding = 'async';
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
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    idle ? idle(pump) : setTimeout(pump, 120);
  };
  window.addEventListener('load', () => setTimeout(schedule, 800), { once: true });
}
