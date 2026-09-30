import { useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, setMuted, sfx } from '../audio';

export function MuteButton() {
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  return (
    <button
      className="btn btn--ghost btn--sm btn--icon"
      title={muted ? '开启音效' : '静音'}
      aria-label={muted ? '开启音效' : '静音'}
      aria-pressed={muted}
      onClick={() => {
        setMuted(!muted);
        if (muted) sfx('click');
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
