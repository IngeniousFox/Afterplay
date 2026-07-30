import { createHashRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { GameDetailRoute } from './screens/GameDetailRoute';
import { Library } from './screens/Library';
import { PlanGameDetailRoute } from './screens/PlanGameDetailRoute';
import { PlanToPlay } from './screens/PlanToPlay';
import { Sessions } from './screens/Sessions';
import { Stats } from './screens/Stats';

// HashRouter y no BrowserRouter: la app no se sirve por HTTP sino desde
// file://, y ahí un router de rutas normales pide al disco un fichero que no
// existe en cuanto navegas o recargas.
//
// Todo cuelga de RootLayout, que es quien pinta el rail y las columnas fijas
// — así navegar cambia solo el panel de la derecha y el resto ni parpadea.
// La raíz redirige a /games porque la biblioteca es la pantalla de entrada.
export const router = createHashRouter([
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
]);
