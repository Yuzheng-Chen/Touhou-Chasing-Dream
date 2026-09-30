import { useEffect } from 'react';
import { Table } from './game/Table';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { LocalSeats } from './screens/LocalSeats';
import { Sheets } from './screens/Sheets';
import { connect, useStore } from './store';
import { CardPreview, ConnectionBanner, Toasts } from './ui/Overlays';

export function App() {
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);
  useEffect(connect, []);

  // /local hosts several independent seats (iframes of this same app) — see LocalSeats.
  if (location.pathname === '/local') return <LocalSeats />;

  const inGame = room && room.status !== 'lobby' && game;
  return (
    <>
      {!room ? <Home /> : inGame ? <Table /> : <Lobby />}
      <Sheets />
      <CardPreview />
      <Toasts />
      <ConnectionBanner />
    </>
  );
}
