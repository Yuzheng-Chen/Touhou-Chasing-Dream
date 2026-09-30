import { useEffect } from 'react';
import { Table } from './game/Table';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Sheets } from './screens/Sheets';
import { connect, useStore } from './store';
import { CardPreview, ConnectionBanner, Toasts } from './ui/Overlays';

export function App() {
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);
  useEffect(connect, []);

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
