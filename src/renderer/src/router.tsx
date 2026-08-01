import { createHashRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { GameDetailRoute } from './screens/GameDetailRoute';
import { Library } from './screens/Library';
import { PlanGameDetailRoute } from './screens/PlanGameDetailRoute';
import { PlanToPlay } from './screens/PlanToPlay';
import { Sessions } from './screens/Sessions';
import { Stats } from './screens/Stats';
import { BigPictureLayout } from './tv/BigPictureLayout';
import { ModeBridge } from './tv/ModeBridge';
import { TvGameDetail } from './tv/TvGameDetail';
import { TvHome } from './tv/TvHome';
import { TvJourney } from './tv/TvJourney';
import { TvLibrary } from './tv/TvLibrary';

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
          { path: 'stats', element: <Stats /> },
        ],
      },
      {
        path: '/tv',
        element: <BigPictureLayout />,
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
