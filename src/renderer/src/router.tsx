import { createHashRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { GameDetailRoute } from './screens/GameDetailRoute';
import { Library } from './screens/Library';
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
      { path: 'sessions', element: <Sessions /> },
      { path: 'stats', element: <Stats /> },
    ],
  },
]);
