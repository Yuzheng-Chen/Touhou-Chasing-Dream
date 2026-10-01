import { cardDef, fxMs, type Fx as FxT, type LogEntry } from '@tcd/shared';
import { AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { sfx } from '../../audio';
import { paceFactor, useStore } from '../../store';
import { Burst, presetFor } from '../Burst';
import { Banner, RoundFx, TurnFx } from './Banners';
import { DiceFx } from './DiceFx';
import { DiscardFx, Flights } from './Flights';
import { CommunityFx, InfluenceFx } from './NumberFx';
import { BlockFx, ModFx, PassiveFx, RevealFx, SkillFx } from './SkillFx';
import { Stage } from './Stage';
import { TargetFx } from './TargetFx';
import { Shock } from './common';
import '../fx.css';

export { Confetti } from './Flights';

/**
 * The stage for everything that happens at the table. Log entries with an effect are played one after another —
 * a card landing, a target being locked, dice rolling, a number being calculated — each for as long as the server
 * lingers on it (shared `fxMs`, scaled by the room's pace). Sounds fire here, at playback, so they match the picture.
 */
export function FxLayer() {
  const queue = useStore((s) => s.fxQueue);
  const shift = useStore((s) => s.shiftFx);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const fx = current.fx!;
    // Numbers update the meters themselves, at the moment their calculation lands.
    if (fx.type === 'play' || fx.type === 'settle' || fx.type === 'target') useStore.getState().playFx(fx);
    // When the backlog grows (a slow connection, a tab in the background) play a little faster instead of falling behind.
    const speed = queue.length > 12 ? 0.5 : queue.length > 8 ? 0.7 : queue.length > 5 ? 0.85 : 1;
    const t = setTimeout(shift, Math.max(250, fxMs(fx) * paceFactor() * speed));
    return () => clearTimeout(t);
  }, [current?.seq]);

  // Safety net: a card must never stand in the middle forever if its "settle" got lost.
  const stageSize = useStore((s) => s.stage.length);
  const busy = useStore((s) => !!s.game?.prompt || !!s.game?.waitingOn.length);
  useEffect(() => {
    if (!stageSize || queue.length || busy) return;
    const t = setTimeout(() => useStore.setState({ stage: [] }), 60_000);
    return () => clearTimeout(t);
  }, [stageSize, queue.length, busy]);

  return (
    <div className="fx" aria-hidden>
      <Stage />
      <AnimatePresence>{current && <FxItem key={current.seq} e={current} />}</AnimatePresence>
      <Flights />
    </div>
  );
}

function FxItem({ e }: { e: LogEntry }) {
  const fx = e.fx as FxT;
  switch (fx.type) {
    case 'play': return <PlayFx fx={fx} />;
    case 'target': return <TargetFx fx={fx} />;
    case 'dice': return <DiceFx fx={fx} />;
    case 'skill': return fx.reveals ? <RevealFx playerId={fx.playerId} roleId={fx.roleId} skill={fx.skill} /> : fx.passive ? <PassiveFx fx={fx} /> : <SkillFx fx={fx} />;
    case 'reveal': return <RevealFx playerId={fx.playerId} roleId={fx.roleId} />;
    case 'mod': return <ModFx fx={fx} />;
    case 'block': return <BlockFx fx={fx} />;
    case 'community': return <CommunityFx fx={fx} />;
    case 'influence': return <InfluenceFx fx={fx} />;
    case 'discard': return <DiscardFx fx={fx} />;
    case 'turn': return <TurnFx fx={fx} />;
    case 'round': return <RoundFx fx={fx} />;
    case 'event':
      return <Banner cardId={fx.cardId} playerId={fx.playerId} caption={fx.direction === 'up' ? '正向发生' : fx.direction === 'down' ? '逆向发生' : '发生'} tone={fx.direction} sound="event" />;
    case 'official':
      return <Banner cardId={fx.cardId} caption="官作发布" tone="official" big sound="official" />;
    default:
      return null; // settle: the stage animates the card away by itself
  }
}

/** The burst behind a card as it lands on the stage (the card itself lives in <Stage>). */
function PlayFx({ fx }: { fx: Extract<FxT, { type: 'play' }> }) {
  const preset = presetFor(fx.as ?? fx.cardId);
  const kind = cardDef(fx.cardId).kind;
  useEffect(() => {
    sfx('play');
    if (fx.via) setTimeout(() => sfx('skill'), 300);
    if (fx.direction === 'up' || fx.direction === 'down') setTimeout(() => sfx('event'), 150);
  }, []);
  return (
    <div className={`fx__play fx__play--${kind}`}>
      <div className="fx__rays" />
      <div className="fx__aura" />
      <Shock tone="gold" />
      <Burst preset={fx.direction === 'up' ? 'rise' : fx.direction === 'down' ? 'fall' : preset} />
      {fx.via && <Burst preset="sparkle" />}
    </div>
  );
}
