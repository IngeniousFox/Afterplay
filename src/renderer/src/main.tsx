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
// cargada por otra BrowserWindow con #/overlay, y aquí se decide qué monta:
// el HUD necesita el router y NADA más. El hash ya está puesto cuando este
// módulo evalúa — lo pone loadURL/loadFile del main antes de cargar.
const isOverlayWindow = window.location.hash.startsWith('#/overlay');

// LA HERENCIA ENVENENADA DEL SHELL, neutralizada ANTES del primer pintado.
//
// Cargar la misma SPA trae también su CSS global, y ahí había dos cosas
// pensadas para la ventana principal que en una ventana transparente a
// pantalla completa se veían como bugs — y costaron una tarde de cacería por
// el lado de Electron, que no tenía ninguna culpa:
//
//   · `#root { padding-top: 2rem }` reserva el hueco de la TitleBar (main.css
//     lo explica). El overlay no monta TitleBar, así que ese hueco se
//     quedaba ahí para siempre: 32px de banda muerta arriba con el juego
//     asomando por debajo — el "gap" que no cuadraba con ningún tamaño de
//     ventana, porque no era de la ventana. La clase `.is-fullscreen` que lo
//     anula la pone TitleBar, que aquí nunca se monta.
//   · `body { background: var(--background) }` es OPACO. En el primer frame
//     la ventana entera era un rectángulo oscuro —el "se pone algo en negro
//     y se quita"— hasta que un efecto de React lo ponía transparente un
//     frame más tarde.
//
// Se arregla aquí y no en un useEffect a propósito: esto corre en la
// evaluación del módulo, antes de createRoot y por tanto antes de que se
// pinte nada. Estilos INLINE porque ganan al selector `#root` de la hoja sin
// pelearse por especificidad.
if (isOverlayWindow) {
  const root = document.getElementById('root');
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  if (root) {
    root.style.background = 'transparent';
    root.style.paddingTop = '0';
  }
}

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
