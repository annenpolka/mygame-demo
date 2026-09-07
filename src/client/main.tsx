import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import './console.css';
import './pad-battle.css';
import './watch.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import './formation-ui.css';

import './playtest.css';

import './effects/effects.css';
