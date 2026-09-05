import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { createHashRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { GameDetailRoute } from './screens/GameDetailRoute';
import { Library } from './screens/Library';
import { PlanGameDetailRoute } from './screens/PlanGameDetailRoute';
import { PlanToPlay } from './screens/PlanToPlay';
import { Sessions } from './screens/Sessions';
import { loadStatsRoute } from './lib/statsRoute';
import { ModeBridge } from './tv/ModeBridge';

// Todo el árbol de TV (BIG-PICTURE.md §3) en imports dinámicos, y no en el
// bundle principal: gamepad, sonido generativo, el sistema de foco a mando,
// el canvas de luciérnagas... ninguna de las miles de líneas de ese árbol
// sirve de nada mientras se usa la app en escritorio (el caso normal), y
// hasta ahora se descargaban y parseaban en CADA arranque igual. Con
// React.lazy, ese peso solo se paga la primera vez que se entra de verdad
// en el modo (F11 o el mando) — el Suspense de más abajo, con un fondo del
// mismo negro que BigPictureLayout, cubre el hueco mientras carga.
const BigPictureLayout = lazy(() =>
  import('./tv/BigPictureLayout').then((m) => ({ default: m.BigPictureLayout })),
);
const TvHome = lazy(() => import('./tv/TvHome').then((m) => ({ default: m.TvHome })));
const TvLibrary = lazy(() => import('./tv/TvLibrary').then((m) => ({ default: m.TvLibrary })));
const TvGameDetail = lazy(() =>
  import('./tv/TvGameDetail').then((m) => ({ default: m.TvGameDetail })),
);
const TvJourney = lazy(() => import('./tv/TvJourney').then((m) => ({ default: m.TvJourney })));

// AQUÍ NO HAY NADA DEL OVERLAY, y es a propósito. La ventana del HUD in-game
// (OVERLAY.md §8.1) carga esta misma SPA con #/overlay, pero NO pasa por este
// router: main.tsx mira el hash al evaluar el módulo y monta OverlayHud
// directamente, para no arrastrar a esa ventana el árbol de escritorio entero
// que este fichero importa de forma estática (RootLayout, Library, Stats...).
// Había aquí una ruta '/overlay' que era exactamente eso, y era INALCANZABLE:
// la rama de main.tsx corre antes que nada y no existe ni un navigate ni un
// Link que apunte a ella. Lo peligroso no era el peso muerto, era que las dos
// definiciones se habían separado —los arreglos de transparencia y de padding
// del shell solo viven en la de main.tsx—, así que quien viniera a "arreglar el
// overlay" tocando este fichero no cambiaría nada en la app.

// Un solo Suspense en la raíz del árbol de TV: aunque BigPictureLayout y la
// pantalla hija (TvHome, TvLibrary...) sean chunks distintos, React Router
// los resuelve en el mismo commit a través de sus Outlet anidados, y una
// suspensión en cualquiera de los dos burbujea hasta este límite — no hace
// falta un Suspense por pantalla. Inline y no un componente aparte: este
// fichero solo exporta `router` (no un componente), y react-refresh exige
// que un componente propio viva en su propio fichero para no perder el HMR.
const tvFallback = (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#070908]">
    <Loader2 className="animate-spin text-muted-foreground/60" size={28} />
  </div>
);

// HashRouter y no BrowserRouter: la app no se sirve por HTTP sino desde
// file://, y ahí un router de rutas normales pide al disco un fichero que no
// existe en cuanto navegas o recargas.
//
// Dos árboles hermanos bajo un puente común (ModeBridge, BIG-PICTURE.md §3):
//
//   · El de ESCRITORIO cuelga de RootLayout, que pinta el rail y las
//     columnas fijas — navegar cambia solo el panel de la derecha.
//   · El de TV (/tv) cuelga de BigPictureLayout: pantalla completa, escala
//     10-foot, mando. RootLayout ni se monta ahí — fuera todo el chrome.
//
// ModeBridge es lo único montado SIEMPRE: escucha el estado de Big Picture
// del main y mueve el router de un árbol al otro (recordando la ruta de
// escritorio para la vuelta). La raíz redirige a /games porque la
// biblioteca es la pantalla de entrada.
export const router = createHashRouter([
  {
    element: <ModeBridge />,
    children: [
      {
        path: '/',
        element: <RootLayout />,
        children: [
          { index: true, element: <Navigate to="/games" replace /> },
          {
            path: 'games',
            children: [
              { index: true, element: <Library /> },
              { path: ':id', element: <GameDetailRoute /> },
            ],
          },
          {
            path: 'plan',
            children: [
              { index: true, element: <PlanToPlay /> },
              { path: ':id', element: <PlanGameDetailRoute /> },
            ],
          },
          { path: 'sessions', element: <Sessions /> },
          {
            path: 'stats',
            // The separate module is warmed after startup and reused on navigation.
            lazy: loadStatsRoute,
          },
        ],
      },
      {
        path: '/tv',
        element: (
          <Suspense fallback={tvFallback}>
            <BigPictureLayout />
          </Suspense>
        ),
        children: [
          { index: true, element: <TvHome /> },
          { path: 'library', element: <TvLibrary /> },
          { path: 'game/:id', element: <TvGameDetail /> },
          { path: 'journey', element: <TvJourney /> },
        ],
      },
    ],
  },
]);
