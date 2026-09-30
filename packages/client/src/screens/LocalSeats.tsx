import { MAX_PLAYERS, MIN_PLAYERS, roleDef } from '@tcd/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeatReport } from '../store';
import { SEAT_COLORS } from '../ui/colors';
import './local.css';

/**
 * Local multi-seat console (`/local`).
 * Each seat is an iframe of this same app with `?as=seatN`, which gives it its own identity (token +
 * nickname) and therefore its own private hand, role and reconnect slot — exactly like separate
 * browsers, but controllable from one window. Seat 1 creates the room; the rest join by code.
 */

const SEAT_W = 1440;
const SEAT_H = 820;

type Layout = 'focus' | 'grid';

interface Launch {
  n: number;
  /** Identity namespace — changing it makes brand-new players. */
  run: string;
  code: string | null;
}

const randomRun = () => Math.random().toString(36).slice(2, 6);

export function LocalSeats() {
  const params = new URLSearchParams(location.search);
  const [n, setN] = useState(() => clamp(Number(params.get('n') ?? 4)));
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [layout, setLayout] = useState<Layout>('focus');
  const [active, setActive] = useState(0);
  const [reports, setReports] = useState<Record<string, SeatReport>>({});
  const frames = useRef<Record<string, HTMLIFrameElement | null>>({});

  const seatId = (i: number) => `${launch?.run ?? 'x'}${i + 1}`;

  // Seat status + hotkeys from iframes.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      if (e.data?.type === 'tcd:seat') {
        const r = e.data.report as SeatReport;
        if (r.seat) setReports((cur) => ({ ...cur, [r.seat!]: r }));
      } else if (e.data?.type === 'tcd:key') {
        setActive(Number(e.data.key) - 1);
      }
    };
    window.addEventListener('message', onMsg);
    const onKey = (e: KeyboardEvent) => e.altKey && /^[1-8]$/.test(e.key) && setActive(Number(e.key) - 1);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Seat 1 reports its room code → the others may join.
  const hostReport = launch ? reports[seatId(0)] : undefined;
  useEffect(() => {
    if (launch && !launch.code && hostReport?.room) setLaunch({ ...launch, code: hostReport.room });
  }, [hostReport?.room]);

  const start = (fresh: boolean) => {
    setReports({});
    setActive(0);
    setLaunch({ n, run: fresh || !launch ? `s${randomRun()}` : launch.run, code: null });
  };

  const cmd = useCallback((seat: number, c: string) => {
    frames.current[`${launch?.run}${seat + 1}`]?.contentWindow?.postMessage({ type: 'tcd:cmd', cmd: c }, location.origin);
  }, [launch?.run]);

  const summary = useMemo(() => {
    if (!launch) return '';
    const h = hostReport;
    if (!h?.room) return '正在创建房间…';
    const label = { home: '未入房', lobby: '大厅', playing: '进行中', finished: '已结束' }[h.status];
    return `房间 ${h.room} · ${label}`;
  }, [launch, hostReport]);

  if (!launch) {
    return (
      <div className="local local--setup">
        <div className="local__card panel">
          <h1 className="local__title">本地多座位</h1>
          <p className="muted">
            在一个窗口里同时操控多名真人玩家。每个座位都是独立的“浏览器会话”：有自己的身份、手牌和角色，互相看不到对方的私有信息。
          </p>
          <div className="local__count">
            <span className="label">座位数</span>
            <div className="local__nbtns">
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((k) => (
                <button key={k} className={`btn ${n === k ? 'btn--gold' : ''}`} onClick={() => setN(k)}>{k}</button>
              ))}
            </div>
          </div>
          <button className="btn btn--primary btn--lg" onClick={() => start(false)}>创建房间并入座</button>
          <ul className="local__tips">
            <li>座位 1 是房主；大厅里用顶部的“开始游戏”按钮即可开局。</li>
            <li><kbd>Alt</kbd> + <kbd>1…8</kbd> 切换座位；右上角可切换“聚焦 / 总览”。</li>
            <li>带红点的座位表示正在等你做决定。</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="local">
      <header className="local__bar">
        <span className="local__brand">本地多座位</span>
        <nav className="local__tabs">
          {Array.from({ length: launch.n }, (_, i) => {
            const r = reports[seatId(i)];
            const role = r?.role ? roleDef(r.role).name : null;
            return (
              <button
                key={i}
                className={`seat-tab ${active === i && layout === 'focus' ? 'is-active' : ''} ${r?.waiting ? 'is-waiting' : ''} ${r?.isTurn ? 'is-turn' : ''}`}
                style={{ '--c': SEAT_COLORS[i] } as React.CSSProperties}
                onClick={() => { setActive(i); setLayout('focus'); }}
                title={`Alt+${i + 1}`}
              >
                <span className="seat-tab__n">{i + 1}</span>
                <span className="seat-tab__name">{r?.name || `玩家${i + 1}`}</span>
                {role && <span className="seat-tab__role">{role}</span>}
                {r?.auto && <span className="seat-tab__badge">托管</span>}
                {r?.waiting && <i className="seat-tab__dot" />}
              </button>
            );
          })}
        </nav>
        <div className="local__actions">
          <span className="muted local__summary">{summary}</span>
          {hostReport?.status === 'lobby' && (
            <>
              <button className="btn btn--sm" onClick={() => cmd(0, 'addBot')}>＋AI</button>
              <button className="btn btn--sm btn--gold" disabled={launch.n < MIN_PLAYERS} onClick={() => cmd(0, 'start')}>▶ 开始游戏</button>
            </>
          )}
          {hostReport?.status === 'finished' && <button className="btn btn--sm btn--gold" onClick={() => cmd(0, 'rematch')}>再来一局</button>}
          <button className={`btn btn--sm ${layout === 'grid' ? 'btn--gold' : ''}`} onClick={() => setLayout(layout === 'grid' ? 'focus' : 'grid')}>
            {layout === 'grid' ? '聚焦' : '总览'}
          </button>
          <button className="btn btn--sm" onClick={() => start(true)} title="全部换成新的玩家身份，重新开房">重置</button>
          <button className="btn btn--sm btn--ghost" onClick={() => setLaunch(null)}>退出</button>
        </div>
      </header>

      <main className={`local__stage local__stage--${layout}`} style={{ '--cols': Math.ceil(Math.sqrt(launch.n)) } as React.CSSProperties}>
        {Array.from({ length: launch.n }, (_, i) => {
          const id = seatId(i);
          const joining = i > 0;
          // Seats after the host wait for the room code.
          if (joining && !launch.code) return <div key={id} className="local__cell" hidden={layout === 'focus' && active !== i} />;
          const auto = i === 0 ? 'create' : `join:${launch.code}`;
          const src = `/?as=${id}&name=${encodeURIComponent(`玩家${i + 1}`)}&auto=${encodeURIComponent(auto)}`;
          return (
            <Cell key={id} layout={layout} hidden={layout === 'focus' && active !== i} label={`${i + 1}`} color={SEAT_COLORS[i]}>
              <iframe
                ref={(el) => { frames.current[id] = el; }}
                title={`座位 ${i + 1}`}
                src={src}
                allow="autoplay"
              />
            </Cell>
          );
        })}
      </main>
    </div>
  );
}

/** One seat. In grid mode the iframe renders at a fixed virtual resolution and is scaled to fit the cell. */
function Cell({ layout, hidden, label, color, children }: { layout: Layout; hidden: boolean; label: string; color: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / SEAT_W, el.clientHeight / SEAT_H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const grid = layout === 'grid';
  return (
    <div ref={ref} className={`local__cell ${grid ? 'is-grid' : ''}`} data-hidden={hidden} style={{ '--c': color } as React.CSSProperties}>
      {grid && <span className="local__cell-label">{label}</span>}
      <div className="local__frame" style={grid ? { width: SEAT_W, height: SEAT_H, transform: `scale(${scale})` } : undefined}>{children}</div>
    </div>
  );
}

const clamp = (v: number) => Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number.isFinite(v) ? v : 4));
