import React from 'react';
import {createRoot} from 'react-dom/client';
import {MiniPlayerView} from './components/mini-player-view';
createRoot(document.getElementById('root')!).render(<React.StrictMode><MiniPlayerView/></React.StrictMode>);
