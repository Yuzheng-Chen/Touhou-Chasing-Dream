import { cardDef, type CardInstance } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Card, CardBack } from '../cards/Card';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { CommunityMeter } from './meters';

/** The middle of the table: community meter, current official, decks and zones. */
export function Center() {
  const game = useStore((s) => s.game)!;
  const [pile, setPile] = useState<null | { title: string; cards: CardInstance[] }>(null);
  const off = game.currentOfficial;

  return (
    <div className="center">
      <CommunityMeter value={game.community} />

      <div className="center__row">
        <div className="decks">
          <Deck label="行动牌" kind="action" count={game.deckCounts.action} top={game.deckTops.action} />
          <Deck label="事件牌" kind="event" count={game.deckCounts.event} top={game.deckTops.event} />
          <Deck label="官作牌" kind="official" count={game.deckCounts.official} />
        </div>

        <div className={`official ${game.officialSuppressed ? 'is-suppressed' : ''}`}>
          <span className="label">当前官作</span>
          <AnimatePresence mode="wait">
            {off ? (
              <motion.div key={off.uid} initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.5 }}>
                <Card id={off.defId} size="md" />
              </motion.div>
            ) : (
              <div className="official__empty">—</div>
            )}
          </AnimatePresence>
          {game.officialCopyOf && <span className="chip">视为「{nameOf(game.officialCopyOf)}」</span>}
          {game.officialSuppressed && <span className="chip chip--bad">连载完结：失效</span>}
        </div>

        <div className="zones">
          <Zone label="行动弃牌" cards={game.discards.action} onOpen={() => setPile({ title: '行动牌弃牌堆（最近）', cards: game.discards.action })} />
          <Zone label="事件弃牌" cards={game.discards.event} onOpen={() => setPile({ title: '事件牌弃牌堆（最近）', cards: game.discards.event })} />
          <Zone
            label={`官作弃牌 ${game.discards.official.length}/${game.endThreshold}`}
            cards={game.discards.official}
            onOpen={() => setPile({ title: '官作牌弃牌堆', cards: game.discards.official })}
          />
        </div>
      </div>

      {(game.chainZone.length > 0 || game.delayZone.length > 0) && (
        <div className="center__strips">
          {game.chainZone.length > 0 && (
            <div className="strip">
              <span className="label">连锁区</span>
              {game.chainZone.map((c) => <Card key={c.uid} id={c.defId} size="xs" />)}
            </div>
          )}
          {game.delayZone.length > 0 && (
            <div className="strip">
              <span className="label">延时区</span>
              {game.delayZone.map((d) => {
                const owner = game.players.find((p) => p.id === d.ownerId);
                return (
                  <span key={d.card.uid} className="strip__item" style={{ '--seat': owner ? playerColor(owner.seat) : undefined } as React.CSSProperties}>
                    <Card id={d.card.defId} size="xs" />
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {pile && (
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPile(null)}>
            <motion.div className="sheet sheet--pile" initial={{ y: 20 }} animate={{ y: 0 }} onClick={(e) => e.stopPropagation()}>
              <div className="sheet__head">
                <h3 className="sheet__title">{pile.title}</h3>
                <button className="btn btn--sm sheet__close" onClick={() => setPile(null)}>关闭</button>
              </div>
              <div className="sheet__body pile-grid">
                {pile.cards.length ? [...pile.cards].reverse().map((c) => <Card key={c.uid} id={c.defId} size="md" />) : <p className="muted">空</p>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const nameOf = (id: string) => cardDef(id).name;

function Deck({ label, kind, count, top }: { label: string; kind: 'action' | 'event' | 'official'; count: number; top?: string | null }) {
  return (
    <div className="deck" title={`${label}：剩余 ${count} 张`}>
      <div className="deck__stack" style={{ '--depth': Math.min(6, Math.ceil(count / 8)) } as React.CSSProperties}>
        {top ? <Card id={top} size="sm" /> : <CardBack kind={kind} size="sm" />}
      </div>
      <span className="deck__label">{label}<b>{count}</b></span>
    </div>
  );
}

function Zone({ label, cards, onOpen }: { label: string; cards: CardInstance[]; onOpen: () => void }) {
  const top = cards.at(-1);
  return (
    <button className="zone" onClick={onOpen} title="查看">
      {top ? <Card id={top.defId} size="sm" /> : <div className="zone__empty" />}
      <span className="deck__label">{label}</span>
    </button>
  );
}
