import {
  ACTION_CATEGORY_LABEL, EVENT_TOPIC_COLOR, FOCUS_LABEL, STANCE_LABEL, cardArtUrl, cardDef, cardThumbUrl, highlightPattern,
  type CardDef, type CardKind,
} from '@tcd/shared';
import { Fragment, useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import './card.css';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const CATEGORY_COLOR: Record<string, string> = {
  instant: '#d9443a',
  judge: '#e0913a',
  group: '#4fae8f',
  delay: '#9a73e0',
  eventOp: '#4f9ed9',
  reaction: '#e06ea8',
  special: '#d8b25a',
};
const STANCE_COLOR = { prosper: '#e0654f', niche: '#6f7ae8', neutral: '#4fae8f' } as const;

/** Name of each kind as printed on the card's tag. Must never be confusable with another kind. */
export const KIND_LABEL: Record<CardKind, string> = { action: '行动', event: '事件', official: '官作', role: '角色' };

export function cardAccent(d: CardDef): string {
  switch (d.kind) {
    case 'action':
      return CATEGORY_COLOR[d.category];
    case 'event':
      return EVENT_TOPIC_COLOR[d.topic];
    case 'official':
      return '#d8b25a';
    case 'role':
      return STANCE_COLOR[d.stance];
  }
}

/** Secondary label: action category / event topic / role faction. */
function badge(d: CardDef): string {
  switch (d.kind) {
    case 'action':
      return ACTION_CATEGORY_LABEL[d.category];
    case 'event':
      return d.shape === 'chain' ? `连锁·${d.topic}` : d.topic;
    case 'official':
      return '';
    case 'role':
      return d.stance === 'neutral' ? '中立' : `${FOCUS_LABEL[d.focus]}·${STANCE_LABEL[d.stance]}`;
  }
}

interface CardProps {
  id: string;
  size?: CardSize;
  /** Show the card's text panel. Defaults to true for lg/xl. */
  text?: boolean;
  selected?: boolean;
  playable?: boolean;
  dim?: boolean;
  onClick?: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
  /** Disable the hover preview (e.g. inside the preview itself). */
  noPreview?: boolean;
  children?: ReactNode;
}

export function Card({ id, size = 'md', text, selected, playable, dim, onClick, className = '', style, noPreview, children }: CardProps) {
  const d = cardDef(id);
  const setHover = useStore((s) => s.setHover);
  // Touch: hover doesn't exist, so press-and-hold previews the card (and swallows the tap that follows).
  const press = useRef<{ timer?: number; fired: boolean }>({ fired: false });
  const canHover = () => window.matchMedia('(hover: hover)').matches;
  const endPress = () => {
    clearTimeout(press.current.timer);
    if (press.current.fired) setHover(null);
  };
  // A card that disappears under the pointer (closing a sheet, a played card leaving the hand) never gets a
  // mouse-leave, so release the preview ourselves when we unmount.
  const hovered = useRef(false);
  useEffect(() => () => {
    if (hovered.current && useStore.getState().hover === id) useStore.getState().setHover(null);
  }, [id]);
  const showText = text ?? (size === 'lg' || size === 'xl');
  const accent = cardAccent(d);
  const chain = d.kind === 'event' && d.shape === 'chain';
  const cls = [
    'card', `card--${size}`, `card--${d.kind}`, chain && 'card--chain',
    selected && 'is-selected', playable && 'is-playable', dim && 'is-dim', onClick && 'is-clickable', className,
  ].filter(Boolean).join(' ');
  const small = size === 'xs';

  return (
    <div
      className={cls}
      style={{ '--accent': accent, ...style } as CSSProperties}
      onClick={onClick ? (e) => {
        if (press.current.fired) { press.current.fired = false; return; }
        onClick(e);
      } : undefined}
      onMouseEnter={noPreview ? undefined : () => { if (canHover()) { hovered.current = true; setHover(id); } }}
      onMouseLeave={noPreview ? undefined : () => { hovered.current = false; if (canHover()) setHover(null); }}
      onPointerDown={noPreview ? undefined : (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        press.current.fired = false;
        press.current.timer = window.setTimeout(() => { press.current.fired = true; setHover(id); }, 420);
      }}
      onPointerUp={noPreview ? undefined : endPress}
      onPointerCancel={noPreview ? undefined : endPress}
      onContextMenu={noPreview ? undefined : (e) => canHover() || e.preventDefault()}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick(e as unknown as MouseEvent) : undefined}
      aria-label={`${KIND_LABEL[d.kind]}牌 ${d.name}`}
      data-card={id}
      data-kind={d.kind}
    >
      <div className="card__art" style={{ backgroundImage: size === 'lg' || size === 'xl' ? `url(${cardArtUrl(id)}), url(${cardThumbUrl(id)})` : `url(${cardThumbUrl(id)})` }} />
      <div className="card__tint" />
      <div className="card__frame" />

      {!small && d.kind === 'event' && (
        <div className="card__ribbon"><b>事件</b><span>{badge(d)}</span></div>
      )}
      {!small && d.kind !== 'event' && <span className="card__kind">{KIND_LABEL[d.kind]}</span>}
      {!small && d.kind !== 'event' && badge(d) && <span className="card__badge">{badge(d)}</span>}

      {d.kind === 'role' && !showText ? (
        <div className="card__vname serif">{d.name}</div>
      ) : (
        <div className="card__plate">
          <span className="card__name serif">{d.name}</span>
          {d.kind === 'official' && showText && d.subtitle && <span className="card__sub">{d.subtitle}</span>}
          {d.kind === 'event' && !small && !showText && (
            <div className="card__dirs">
              {d.down === undefined ? <i className="dir dir--none">无向</i> : <><i className="dir dir--up">正</i><i className="dir dir--down">逆</i></>}
            </div>
          )}
        </div>
      )}
      {showText && <CardText d={d} id={id} />}
      {children}
    </div>
  );
}

/** Wraps keyword matches in a dotted-underline span so players know they have a side-box explanation. */
function Highlighted({ text, id }: { text: string; id: string }) {
  const re = highlightPattern(id);
  if (!re) return <>{text}</>;
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <b key={i} className="kw">{p}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function CardText({ d, id }: { d: CardDef; id: string }) {
  switch (d.kind) {
    case 'action':
    case 'official':
      return <div className="card__text"><Highlighted text={d.text} id={id} /></div>;
    case 'event':
      return (
        <div className="card__text card__text--event">
          {d.down === undefined ? (
            <p><span className="dir dir--none">无向</span><Highlighted text={d.up} id={id} /></p>
          ) : (
            <>
              <p><span className="dir dir--up">正</span><Highlighted text={d.up} id={id} /></p>
              <p><span className="dir dir--down">逆</span><Highlighted text={d.down} id={id} /></p>
            </>
          )}
        </div>
      );
    case 'role':
      return (
        <div className="card__text card__text--role">
          {d.active.map((s) => (
            <p key={s.name}><span className="skill skill--active">{s.name}</span><Highlighted text={s.text} id={id} /></p>
          ))}
          {d.passive.map((s) => (
            <p key={s.name}><span className="skill skill--passive">{s.name}</span><Highlighted text={s.text} id={id} /></p>
          ))}
        </div>
      );
  }
}

const BACK_TINT: Record<CardKind, string> = {
  action: '#7a2a2a',
  event: '#2c3170',
  official: '#4d2f6e',
  role: '#1e2a3a',
};

/** Face-down card. Same silhouette as the face-up kind so decks are recognisable at a glance. */
export function CardBack({ kind = 'action', size = 'md', className = '', style, children }: {
  kind?: CardKind;
  size?: CardSize;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div className={`card card--${size} card--${kind} card--back ${className}`} style={{ '--tint': BACK_TINT[kind], ...style } as CSSProperties}>
      <div className="card__back asanoha">
        <YinYang className="card__orb" />
        {size !== 'xs' && size !== 'sm' && <span className="card__backtitle">{KIND_LABEL[kind]}</span>}
      </div>
      {children}
    </div>
  );
}

export function YinYang({ className, size }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="30" fill="#f6f0e4" />
      <path d="M32 2a30 30 0 0 1 0 60a15 15 0 0 1 0-30a15 15 0 0 0 0-30z" fill="#d9443a" />
      <circle cx="32" cy="17" r="5" fill="#f6f0e4" />
      <circle cx="32" cy="47" r="5" fill="#d9443a" />
      <circle cx="32" cy="32" r="30" fill="none" stroke="#d8b25a" strokeWidth="2.5" />
    </svg>
  );
}
