import { createHashRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { GameDetailRoute } from './screens/GameDetailRoute';
import { Library } from './screens/Library';
import { PlanGameDetailRoute } from './screens/PlanGameDetailRoute';
import { PlanToPlay } from './screens/PlanToPlay';
import { Sessions } from './screens/Sessions';
import { Stats } from './screens/Stats';

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
