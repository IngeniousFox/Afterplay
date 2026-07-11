import './assets/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TitleBar from './components/TitleBar';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TitleBar />
    <App />
  </StrictMode>,
);
