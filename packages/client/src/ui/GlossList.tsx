import { cardDef, explain } from '@tcd/shared';
import { useMemo } from 'react';

/** Keyword side boxes for a card (see packages/shared/src/glossary.ts). Renders nothing if there is nothing to explain. */
export function GlossList({ id, className = '' }: { id: string; className?: string }) {
  const items = useMemo(() => explain(id), [id]);
  if (!items.length) return null;
  return (
    <div className={`gloss ${className}`}>
      {items.map((g) => (
        <div key={g.term} className={`gloss__box ${g.cardId ? 'is-card' : ''}`} data-kind={g.cardId ? cardDef(g.cardId).kind : undefined}>
          <div className="gloss__term">{g.term}</div>
          <div className="gloss__text">{g.text}</div>
        </div>
      ))}
    </div>
  );
}
