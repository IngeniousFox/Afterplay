import './assets/main.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import TitleBar from './components/TitleBar';
import { queryClient } from './lib/queryClient';

// LAS DOS VENTANAS SE PARTEN AQUÍ, Y ESO ES TODO EL TRUCO DE ARRANQUE.
//
// index.html es UNA sola entrada para DOS ventanas muy distintas (la app y el
// HUD del overlay), así que lo que este módulo importe de forma ESTÁTICA lo
// pagan las dos. Antes importaba `Afterplay` y `router` arriba del todo, y el
// resultado era un único chunk de 4,55 MB (2,08 MB ya con minificado) que
// había que descargar, parsear y ejecutar ENTERO antes del primer píxel — en
// las dos ventanas, incluida la del overlay, que de ahí usa el 3%.
//
// Con los dos `lazy` de abajo el chunk de entrada baja a 253,75 KB (React,
// react-dom, react-query y la TitleBar) y cada ventana se trae solo su árbol:
//   · la app      → + Afterplay, ~1749 KB (router + pantallas de escritorio)
//   · el overlay  → + OverlayHud, 36,02 KB (+ SessionNote, 74,72 KB, que
//                   comparte con la ficha de la app)
// El total que carga la ventana principal no cambia (son los mismos ~2,08 MB,
// solo que en dos trozos), pero el primer píxel ya no espera a los 2 MB: sale
// en cuanto están los 253 KB de entrada. Y el overlay pasa de arrastrar
// 2080,49 KB a 364,49 KB — un 82% menos, y no es un detalle: esa ventana nace
// CON UN JUEGO YA CORRIENDO, peleando por CPU con él.
const Afterplay = lazy(() => import('./Afterplay'));

// El HUD del overlay se monta AQUÍ DIRECTAMENTE y no a través del router, a
// propósito: pasar por el router obligaba a cargar su módulo, y ese arrastra
// RootLayout, Library, Stats, PlanToPlay... la app de escritorio entera, para
// una ventana que no navega a ningún sitio.
//
// Y ESTE ES EL ÚNICO SITIO donde se dice cómo se monta esa ventana. Hubo una
// ruta '/overlay' en router.tsx que hacía lo mismo y que ya no se alcanzaba
// —esta rama corre antes, al evaluar el módulo—, pero seguía ahí como segunda
// definición: la de abajo trae los arreglos del shell (transparencia, padding)
// y aquella no, así que tocarla no cambiaba nada en la app. Se borró.
//
// CICATRIZ / AVISO AL SIGUIENTE: esto solo es válido mientras NADA del árbol
// de OverlayHud consuma contexto de react-router. Se comprobó recorriendo su
// cierre de imports (31 módulos, 0 usos de react-router). Si algún día metes
// un <Link>, useNavigate o useLocation ahí dentro, reventará con "useX may be
// used only in the context of a Router" — y la solución NO es volver a montar
// el router entero, sino un router propio y mínimo para esta ventana.
const OverlayHud = lazy(() =>
  import('./overlay/OverlayHud').then((m) => ({ default: m.OverlayHud })),
);

// ¿Es esta la ventana del overlay in-game (OVERLAY.md §8.1)? Es la MISMA SPA
// cargada por otra BrowserWindow con #/overlay, y aquí se decide qué monta:
// el HUD y NADA más — ni siquiera el router (ver arriba). El hash ya está
// puesto cuando este módulo evalúa — lo pone loadURL/loadFile del main antes
// de cargar.
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
        // fallback null: la ventana es transparente y nace oculta, no hay nada
        // que cubrir. (Los avisos de esta ventana los pinta un <Toaster>
        // propio que monta el propio HUD — ver overlay/OverlayToaster.)
        <Suspense fallback={null}>
          <OverlayHud />
        </Suspense>
      ) : (
        <>
          {/* La TitleBar se queda ESTÁTICA (su cierre de imports son 4
              módulos) para que el marco de la ventana se pinte en el primer
              commit, mientras el chunk gordo de Afterplay aún se está
              parseando. fallback null y no un spinner: así el hueco de
              contenido se ve igual que antes —vacío— solo que ahora la app
              llega a pintar algo mucho antes en vez de estar en blanco hasta
              tener los 2 MB ejecutados. */}
          <TitleBar />
          <Suspense fallback={null}>
            <Afterplay />
          </Suspense>
        </>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
