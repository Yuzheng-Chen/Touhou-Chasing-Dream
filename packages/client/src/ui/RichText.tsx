import { cardDef } from '@tcd/shared';
import { Fragment } from 'react';
import { useStore } from '../store';
import { playerColor } from './colors';

const TOKEN = /\{([pcn]):([^}]+)\}/g;

/** Renders engine text with {p:id} player, {c:defId} card and {n:+3} number tokens. */
export function RichText({ text }: { text: string }) {
  const players = useStore((s) => s.game?.players);
  const setHover = useStore((s) => s.setHover);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const [, kind, val] = m;
    const key = `${m.index}`;
    if (kind === 'p') {
      const p = players?.find((x) => x.id === val);
      out.push(
        <span key={key} className="rt-player" style={{ color: p ? playerColor(p.seat) : undefined }}>
          {p?.name ?? '?'}
        </span>,
      );
    } else if (kind === 'c') {
      let name = val;
      try {
        name = cardDef(val).name;
      } catch {
        /* unknown id */
      }
      out.push(
        <span key={key} className="rt-card" onMouseEnter={() => setHover(val)} onMouseLeave={() => setHover(null)}>
          「{name}」
        </span>,
      );
    } else {
      const neg = val.startsWith('-');
      out.push(<b key={key} className={neg ? 'rt-neg' : 'rt-pos'}>{val}</b>);
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
