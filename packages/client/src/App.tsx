import { Suspense, lazy, useEffect } from 'react';
import { Table } from './game/Table';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Sheets } from './screens/Sheets';
import { connect, useStore } from './store';
import { CardPreview, ConnectionBanner, Toasts } from './ui/Overlays';

// The multi-seat console is a test tool: it is not part of the normal download.
const LocalSeats = lazy(() => import('./screens/LocalSeats').then((m) => ({ default: m.LocalSeats })));

export function App() {
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);
  useEffect(connect, []);

  // /local hosts several independent seats (iframes of this same app) — see LocalSeats.
  if (location.pathname === '/local') return <Suspense fallback={null}><LocalSeats /></Suspense>;

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
