import { AnimatePresence, motion } from 'motion/react';
import { request, socket } from '../net';
import { useStore } from '../store';
import { playerColor } from '../ui/colors';
import { Countdown } from './meters';

/** Ask everyone to abandon the game and go back to the room. Requires every online human to agree. */
export async function proposeAbort() {
  const st = useStore.getState();
  if (st.room?.tutorial) {
    socket.emit('room:leave');
    return;
  }
  if (!confirm('发起「中止本局并回到房间」的投票？\n需要所有在线玩家同意才会生效。')) return;
  try {
    await request('vote:start');
  } catch (e) {
    st.toast(String(e), 'bad');
  }
}

export function VoteModal() {
  const vote = useStore((s) => s.vote);
  const me = useStore((s) => s.playerId);
  const players = useStore((s) => s.game?.players ?? []);
  const nameOf = (id: string) => players.find((p) => p.id === id);
  const iVote = !!vote && !!me && vote.voters.includes(me);
  const answered = !!vote && !!me && (vote.yes.includes(me) || vote.no.includes(me));

  return (
    <AnimatePresence>
      {vote && (
        <motion.div className="votemodal" initial={{ opacity: 0, y: -24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16 }} role="alertdialog" aria-label="中止本局投票">
          <div className="votemodal__head">
            <div>
              <b>中止本局投票</b>
              <span>{vote.byId === me ? '你' : vote.byName} 提议：放弃这一局，回到房间</span>
            </div>
            <Countdown key={vote.id} deadline={vote.deadline} />
          </div>
          <div className="votemodal__voters">
            {vote.voters.map((id) => {
              const p = nameOf(id);
              const state = vote.yes.includes(id) ? 'yes' : vote.no.includes(id) ? 'no' : 'wait';
              return (
                <span key={id} className={`voter voter--${state}`} style={{ '--seat': p ? playerColor(p.seat) : undefined } as React.CSSProperties}>
                  {state === 'yes' ? '✓' : state === 'no' ? '✗' : '…'} {p?.name ?? '?'}
                </span>
              );
            })}
          </div>
          {iVote && !answered ? (
            <div className="votemodal__actions">
              <button className="btn" onClick={() => socket.emit('vote:cast', { yes: false })}>拒绝，继续玩</button>
              <button className="btn btn--gold" onClick={() => socket.emit('vote:cast', { yes: true })}>同意中止</button>
            </div>
          ) : (
            <p className="votemodal__wait">{iVote ? '已投票，等待其他玩家…' : '等待在线玩家投票…'}</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
