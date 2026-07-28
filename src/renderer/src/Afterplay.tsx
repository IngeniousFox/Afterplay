import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
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
      {/* Avisos efímeros (por ahora, el cierre de sesión). Fuera del router a
          propósito: un aviso puede llegar estando en cualquier pantalla y no
          debe morir al navegar. El toast del cierre se monta desde dentro del
          router (useSessionClosedToast en RootLayout), que es donde hay
          navigate. */}
      {/* unstyled: los toasts de la app se pintan enteros con sus propias
          clases (mismo lenguaje de panel flotante que dropdowns y popovers),
          en vez de pelearse con el CSS por defecto de Sonner. */}
      <Toaster
        position="bottom-right"
        // Más ancho que el de serie (356px): el aviso de cierre lleva
        // carátula, título, cifra y un campo de texto — apretado ahí dentro se
        // veía estrecho y pobre.
        style={{ width: 420 }}
        toastOptions={{ unstyled: true, classNames: { toast: 'w-full' } }}
      />
    </TooltipProvider>
  );
};

export default Afterplay;
