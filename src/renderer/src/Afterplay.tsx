import { RouterProvider } from 'react-router-dom';
import { TooltipProvider } from './components/ui/tooltip';
import { useWatcherSync } from './hooks/useWatcherSync';
import { router } from './router';

// Shell raíz de la app — routing de verdad (Bloque 3A, SPEC 10.6): rail
// lateral + Games/Sessions/Stats, ver router.tsx.
const Afterplay = (): React.JSX.Element => {
  // Bloque 3D — mantiene el caché de ['games'] al día con lo que el watcher
  // del main detecta (arranques/cierres de juegos), una sola suscripción para
  // toda la app.
  useWatcherSync();

  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
};

export default Afterplay;
