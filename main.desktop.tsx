import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import './app/globals.css';
import { isLyricsWindow } from './lib/desktop/window';
import { DesktopLyricsView } from './components/desktop-lyrics-view';
import { AppErrorBoundary } from './components/app-error-boundary';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {isLyricsWindow() ? <DesktopLyricsView /> : <Home />}
    </AppErrorBoundary>
  </React.StrictMode>,
);
