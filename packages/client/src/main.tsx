// Global styles first so component styles can override them.
import './styles/global.css';
import './ui/ui.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadArt } from './artPreload';
import { applyReduceMotion } from './prefs';
import { ErrorBoundary } from './ui/ErrorBoundary';

applyReduceMotion();
preloadArt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
