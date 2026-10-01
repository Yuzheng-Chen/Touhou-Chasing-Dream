import { factionLabel, type PlayerView } from '@tcd/shared';
import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { Card, CardBack } from '../cards/Card';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { Signal } from '../ui/Signal';
import { EmoteBubble } from './Emotes';
import { InfluenceMeter } from './meters';
import { usePromptUi } from './prompt';

/** An opponent around the table. */
export function Seat({ p, style }: { p: PlayerView; style?: CSSProperties }) {
  const game = useStore((s) => s.game)!;
  const ui = usePromptUi();
  const isTurn = game.currentPlayerId === p.id;
  const thinking = game.waitingOn.includes(p.id);
  const pickable = ui.prompt?.kind === 'players' && ui.prompt.candidates.includes(p.id);
  const picked = ui.selPlayers.includes(p.id);
  const idol = p.idolId ? game.players.find((x) => x.id === p.idolId) : null;

  return (
    <motion.div
      layout
      className={['seat', isTurn && 'is-turn', thinking && 'is-thinking', pickable && 'is-pickable', picked && 'is-picked', !p.connected && 'is-offline'].filter(Boolean).join(' ')}
      style={{ '--seat': playerColor(p.seat), ...style } as CSSProperties}
      onClick={pickable ? () => ui.togglePlayer(p.id) : undefined}
      data-seat-id={p.id}
    >
      <div className="seat__role">
        {p.role ? <Card id={p.role} size="sm" /> : <CardBack kind="role" size="sm" />}
        {p.hasFaceDownEvent && <span className="seat__facedown" title="有扣置的事件牌"><CardBack kind="event" size="xs" /></span>}
      </div>
      <div className="seat__info">
        <div className="seat__name">
          {game.firstPlayerId === p.id && <span className="seat__first" title="第一名玩家">先</span>}
          <span className="seat__nametext">{p.name}</span>
          {p.isBot && <span className="seat__tag">AI</span>}
          {!p.connected && <span className="seat__tag seat__tag--off">离线</span>}
          {p.auto && <span className="seat__tag seat__tag--off" title="由 AI 代为操作">托管</span>}
          {!p.isBot && p.connected && <Signal ms={p.ping} compact className="seat__signal" />}
        </div>
        <InfluenceMeter value={p.influence} cap={p.influenceCap} playerId={p.id} />
        <div className="seat__stats">
          <span className="seat__hand" title="手牌数 / 手牌上限">
            <HandFan n={p.handCount} />
            {p.handCount}
            <em>/{p.handLimit ?? '∞'}</em>
          </span>
          {p.oshiCount > 0 && <span className="chip" title="单推牌">💗{p.oshiCount}</span>}
          {p.allegiance && <span className="chip">{factionLabel(p.allegiance)}</span>}
          {idol && <span className="chip" title="偶像">★{idol.name}</span>}
        </div>
        {p.statuses.length > 0 && (
          <div className="seat__statuses">
            {p.statuses.map((s, i) => (
              <span key={i} className="status" onMouseEnter={() => useStore.getState().setHover(s.cardId)} onMouseLeave={() => useStore.getState().setHover(null)}>
                {s.label.split('：')[0]}
              </span>
            ))}
          </div>
        )}
      </div>
      <EmoteBubble playerId={p.id} />
      {thinking && <span className="seat__thinking"><i /><i /><i /></span>}
    </motion.div>
  );
}

function HandFan({ n }: { n: number }) {
  const shown = Math.min(n, 5);
  return (
    <span className="handfan" aria-hidden>
      {Array.from({ length: shown }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${(i - (shown - 1) / 2) * 10}deg)` }} />
      ))}
    </span>
  );
}
