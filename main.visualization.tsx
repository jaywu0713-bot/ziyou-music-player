import React from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopVisualizationView } from './components/desktop-visualization-view';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><DesktopVisualizationView /></React.StrictMode>,
);
