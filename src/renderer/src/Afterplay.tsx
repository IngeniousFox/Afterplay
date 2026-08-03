import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AmbientMode } from './components/ambient/AmbientMode';
import { TooltipProvider } from './components/ui/tooltip';
import { useAchievementsActivitySync } from './hooks/achievements';
import { useCuriositiesActivity } from './hooks/curiosities';
import { useBigPicture } from './hooks/useBigPicture';
import { useWatcherSync } from './hooks/useWatcherSync';
import { router } from './router';
import { TvModeTransition } from './tv/TvModeTransition';

// Shell raíz de la app — routing de verdad (Bloque 3A, SPEC 10.6): rail
// lateral + Games/Sessions/Stats, ver router.tsx.
const Afterplay = (): React.JSX.Element => {
  // Bloque 3D — mantiene el caché de ['games'] al día con lo que el watcher
  // del main detecta (arranques/cierres de juegos), una sola suscripción para
  // toda la app.
  useWatcherSync();
  // Curiosidades generadas de fondo (alta de un juego, backfill): invalida
  // sus queries en cuanto el main avisa — aquí y no solo en Ajustes, porque
  // un juego recién añadido genera con el modal de Ajustes cerrado.
  useCuriositiesActivity();
  // Y los logros, por lo mismo: se sincronizan de fondo (alta de un juego,
  // cierre de sesión, vigilancia de emuladores) estés en la pantalla que
  // estés, y sus queries son staleTime Infinity — sin este aviso, una ficha
  // abierta antes de que llegara su catálogo se quedaba vacía hasta reiniciar.
  useAchievementsActivitySync();
  // Modo TV: los toasts que sobrevivan en él (errores, conexión de mando) se
  // escalan para leerse desde el sofá (BIG-PICTURE.md §4).
  const bigPicture = useBigPicture();

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
        // veía estrecho y pobre. En modo TV, escalado desde la esquina para
        // leerse a distancia de sofá.
        style={{
          width: 420,
          ...(bigPicture ? { transform: 'scale(1.35)', transformOrigin: 'bottom right' } : {}),
        }}
        toastOptions={{ unstyled: true, classNames: { toast: 'w-full' } }}
      />
      {/* Lo último del árbol y por encima de todo: cuando dejas de tocar la
          app, la biblioteca se pone a desfilar sola. Fuera del router porque
          no pertenece a ninguna pantalla — es la app entera la que se queda
          quieta, no una sección. */}
      <AmbientMode />
      {/* La cortina de Big Picture: tapa la tramoya del cambio de modo
          (fullscreen + salto de ruta). Fuera del router por lo mismo que el
          ambiente — aparece en el mismo frame en que el main cambia el
          estado, navegue lo que navegue por debajo. */}
      <TvModeTransition />
    </TooltipProvider>
  );
};

export default Afterplay;
