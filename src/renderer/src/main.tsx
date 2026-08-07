import './assets/main.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import Afterplay from './Afterplay';
import TitleBar from './components/TitleBar';
import { queryClient } from './lib/queryClient';
import { router } from './router';

// ¿Es esta la ventana del overlay in-game (OVERLAY.md §8.1)? Es la MISMA SPA
// cargada por otra BrowserWindow con #/overlay, y aquí se decide qué árbol
// monta: el HUD necesita el router y NADA más. La primera versión montaba el
// shell entero y se veía en pantalla: la barra de título propia de la app
// (con sus botones de ventana) plantada encima del juego, más el Toaster, el
// modo ambiente y todas las suscripciones del shell corriendo en una ventana
// que solo tiene que enseñar un contador. El hash ya está puesto cuando este
// módulo evalúa — lo pone loadURL/loadFile del main antes de cargar.
const isOverlayWindow = window.location.hash.startsWith('#/overlay');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isOverlayWindow ? (
        <RouterProvider router={router} />
      ) : (
        <>
          <TitleBar />
          <Afterplay />
        </>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
