/** Latency indicator: four bars + number. Green < 90 ms, yellow < 180, orange < 350, red beyond. */
export function Signal({ ms, compact, className = '' }: { ms: number | null | undefined; compact?: boolean; className?: string }) {
  const known = typeof ms === 'number';
  const tier = !known ? 0 : ms < 90 ? 4 : ms < 180 ? 3 : ms < 350 ? 2 : 1;
  const tone = !known ? 'off' : tier === 4 ? 'good' : tier === 3 ? 'ok' : tier === 2 ? 'warn' : 'bad';
  const label = known ? `延迟 ${ms} ms` : '延迟：测量中';
  return (
    <span className={`signal signal--${tone} ${className}`} title={label} aria-label={label} data-ping={known ? ms : undefined}>
      <span className="signal__bars" aria-hidden>
        {[1, 2, 3, 4].map((n) => <i key={n} className={n <= tier ? 'is-on' : ''} />)}
      </span>
      {!compact && <b className="signal__ms">{known ? ms : '—'}<small>ms</small></b>}
    </span>
  );
}
