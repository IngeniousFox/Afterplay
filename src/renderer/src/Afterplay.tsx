import { RouterProvider } from 'react-router-dom';
import { TooltipProvider } from './components/ui/tooltip';
import { router } from './router';

// Shell raíz de la app — routing de verdad (Bloque 3A, SPEC 10.6): rail
// lateral + Games/Sessions/Stats, ver router.tsx.
const Afterplay = (): React.JSX.Element => (
  <TooltipProvider>
    <RouterProvider router={router} />
  </TooltipProvider>
);

export default Afterplay;
