import { factionLabel } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Card, CardBack } from '../cards/Card';
import { socket } from '../net';
import { selectMe, useStore } from '../store';
import { playerColor } from '../ui/colors';
import { InfluenceMeter } from './meters';
import { PlayMenu, PromptPanel, usePromptUi } from './prompt';

/** Bottom of the screen: your role, events and hand, plus the decision panel. */
export function MyArea() {
  const game = useStore((s) => s.game)!;
  const meView = useStore(selectMe);
  const me = game.me;
  if (!me || !meView) return <SpectatorBar />;
  const isTurn = game.currentPlayerId === me.id;

  return (
    <div className={`myarea ${isTurn ? 'is-turn' : ''}`} style={{ '--seat': playerColor(meView.seat) } as CSSProperties}>
      <div className="myarea__prompt">
        {meView.auto && (
          <div className="autobar">
            <span>🤖 你的座位正由 AI 托管（长时间未操作或掉线）</span>
            <button className="btn btn--gold btn--sm" onClick={() => socket.emit('game:resume')}>取消托管</button>
          </div>
        )}
        <PromptPanel />
      </div>
      <div className="myarea__row">
        <div className="myarea__self">
          <div className="myarea__role">
            {me.role ? <Card id={me.role} size="md" /> : <CardBack kind="role" size="md" />}
            <span className={`myarea__roleflag ${meView.roleRevealed ? 'is-open' : ''}`}>{meView.roleRevealed ? '已翻开' : '未公开'}</span>
          </div>
          <div className="myarea__stats">
            <div className="myarea__name">{meView.name}{isTurn && <span className="chip chip--turn">你的回合</span>}</div>
            <InfluenceMeter value={meView.influence} cap={meView.influenceCap} playerId={meView.id} big />
            <div className="myarea__limits">
              手牌 <b>{meView.handCount}</b> / 上限 <b>{meView.handLimit ?? '∞'}</b>
              {meView.allegiance && <span className="chip">{factionLabel(meView.allegiance)}</span>}
            </div>
            {meView.statuses.length > 0 && (
              <div className="seat__statuses">
                {meView.statuses.map((s, i) => <span key={i} className="status">{s.label}</span>)}
              </div>
            )}
          </div>
        </div>

        <Hand />

        <div className="myarea__events">
          {me.turnEvent && (
            <div className="evslot">
              <Card id={me.turnEvent.defId} size="md" />
              <span className="evslot__label">本回合事件</span>
            </div>
          )}
          {me.faceDownEvent && (
            <div className="evslot evslot--down">
              <Card id={me.faceDownEvent.defId} size="sm" />
              <span className="evslot__label">已扣置</span>
            </div>
          )}
          {me.oshi.length > 0 && (
            <div className="evslot">
              <div className="oshi">{me.oshi.map((c) => <Card key={c.uid} id={c.defId} size="xs" />)}</div>
              <span className="evslot__label">单推牌</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Hand() {
  const game = useStore((s) => s.game)!;
  const hand = game.me!.hand;
  const ui = usePromptUi();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [cardW, setCardW] = useState(124);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      const c = el.querySelector('.card');
      if (c) setCardW((c as HTMLElement).offsetWidth || 124); // CSS sets the size (smaller on phones)
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!ui.menuUid) return;
    const close = () => ui.setMenuUid(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ui.menuUid]);

  const n = hand.length;
  const gap = n > 1 ? Math.min(12, (width - cardW) / (n - 1) - cardW) : 0;
  const p = ui.prompt;
  const pickMode = p?.kind === 'cards' && p.source === 'hand';
  const pickable = new Set(pickMode ? p.cards.map((c) => c.uid) : []);

  return (
    <div className="hand" ref={ref}>
      <AnimatePresence initial={false}>
        {hand.map((c, i) => {
          const moves = ui.movesFor(c.uid);
          const playable = moves.length > 0;
          const selected = ui.selCards.includes(c.uid);
          const t = n > 1 ? i / (n - 1) - 0.5 : 0;
          const onClick = pickMode
            ? pickable.has(c.uid) ? () => ui.toggleCard(c.uid) : undefined
            : playable
              ? (e: React.MouseEvent) => {
                e.stopPropagation();
                if (moves.length === 1) ui.send({ type: 'move', index: moves[0].index });
                else ui.setMenuUid(ui.menuUid === c.uid ? null : c.uid);
              }
              : undefined;
          return (
            <motion.div
              key={c.uid}
              layout
              className={`hand__card ${selected ? 'is-up' : ''}`}
              style={{ marginLeft: i ? gap : 0, zIndex: ui.menuUid === c.uid ? 50 : i }}
              initial={{ opacity: 0, y: 60, scale: 0.9 }}
              animate={{ opacity: 1, y: Math.abs(t) * 18 - (selected ? 22 : 0), rotate: t * 8, scale: 1 }}
              exit={{ opacity: 0, y: -80, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            >
              <Card
                id={c.defId}
                size="md"
                playable={playable && !pickMode}
                selected={selected}
                dim={(pickMode && !pickable.has(c.uid)) || (p?.kind === 'turn' && !playable)}
                onClick={onClick}
              />
              {ui.menuUid === c.uid && <PlayMenu uid={c.uid} />}
            </motion.div>
          );
        })}
      </AnimatePresence>
      {n === 0 && <div className="hand__empty">没有手牌</div>}
    </div>
  );
}

function SpectatorBar() {
  return (
    <div className="myarea myarea--spectator">
      <div className="myarea__prompt"><PromptPanel /></div>
      <p className="muted">你正在观战</p>
    </div>
  );
}
