import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFxVisibility } from './components/fx/motion';
import './index.css';

// Los bucles decorativos (components/fx) se paran con la pestaña oculta.
installFxVisibility();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
