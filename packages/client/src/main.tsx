// Global styles first so component styles can override them.
import './styles/fonts.css';
import './styles/global.css';
import './ui/ui.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadArt } from './artPreload';
import { ErrorBoundary } from './ui/ErrorBoundary';

preloadArt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
