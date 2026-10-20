import React from 'react';
import { createRoot } from 'react-dom/client';
import './app/globals.css';
import './styles/desktop-lyrics.css';
import { DesktopLyricsView } from './components/desktop-lyrics-view';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopLyricsView />
  </React.StrictMode>,
);
