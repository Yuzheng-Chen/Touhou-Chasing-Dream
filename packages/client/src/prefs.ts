import { prefs } from './net';

/** "Reduce motion": skips card/dice/banner effects and shortens CSS animation. Respects the OS setting on first run. */
const systemReduces = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const getReduceMotion = (): boolean => {
  const v = prefs.get('reduceMotion');
  return v === null ? systemReduces() : v === '1';
};

export function applyReduceMotion() {
  document.documentElement.classList.toggle('reduce-motion', getReduceMotion());
}

export function setReduceMotion(on: boolean) {
  prefs.set('reduceMotion', on ? '1' : '0');
  applyReduceMotion();
}
