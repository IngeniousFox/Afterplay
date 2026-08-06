import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AmbientMode } from './components/ambient/AmbientMode';
import { TooltipProvider } from './components/ui/tooltip';
import { useAchievementsActivitySync } from './hooks/achievements';
import { useCuriositiesActivity } from './hooks/curiosities';
import { useExternalRefreshActivity } from './hooks/external';
import { useRadarActivity } from './hooks/radar';
import { useBigPicture } from './hooks/useBigPicture';
import { useWatcherSync } from './hooks/useWatcherSync';
import { BLUE, GREEN, RED } from './lib/colors';
import { router } from './router';
import { TvModeTransition } from './tv/TvModeTransition';

// Icono con chip de color — mismo lenguaje que el aviso de recap
// (useMemoryArrivalToast) y las cards de la ficha (SavesSection y
// compañía): un cuadro redondeado con el acento al 24 de alpha detrás del
// icono. Hacía falta: con el Toaster en unstyled (más abajo), un
// toast.success/error/info de una sola línea no tenía NINGÚN estilo propio
// — nada de fondo, borde ni icono a color, solo texto suelto flotando en la
// esquina, indistinguible de cualquier otra cosa en pantalla.
const ToastIconChip = ({
  icon: Icon,
  color,
}: {
  icon: typeof CircleCheck;
  color: string;
}): React.JSX.Element => (
  <span
    className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
    style={{ background: `${color}24` }}
  >
    <Icon size={16} style={{ color }} />
  </span>
);

// Mismo trío borde/fondo/sombra que los avisos hechos a medida
// (SessionClosedToast, useMemoryArrivalToast) — así un básico y uno a
// medida se sienten de la MISMA familia si coinciden apilados, en vez de
// que uno luzca y el otro parezca un aviso del sistema operativo.
const toastClassNames = {
  toast:
    'flex w-full items-center gap-3 rounded-[14px] border border-input bg-[#141614] px-3.5 py-3 shadow-[0_20px_55px_rgba(0,0,0,.6)]',
  icon: 'flex-none',
  content: 'flex min-w-0 flex-1 flex-col justify-center gap-0.5',
  title: 'text-[13px] font-bold leading-snug text-foreground',
  description: 'text-[11.5px] font-semibold text-muted-foreground',
};

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
  // Y el refresco de datos externos (PLAN-TO-PLAY.md 5): su parte de
  // SteamSpy dura minutos, mucho mas de lo que nadie deja Ajustes abierto.
  // La suscripcion vive AQUI para que la pasada se siga viendo desde
  // cualquier pantalla y su aviso de "ya esta" te llegue estes donde estes.
  useExternalRefreshActivity();
  // Y el radar de secuelas: su pasada semanal puede caer estes en la pantalla
  // que estes (o con la app en la bandeja), asi que su aviso vive aqui.
  useRadarActivity();
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
          en vez de pelearse con el CSS por defecto de Sonner. Los "a medida"
          (toast.custom: SessionClosedToast, el recap) ya traían su propio
          panel completo y no les toca nada de esto. Los básicos
          (toast.success/error/info, un mensaje de una línea) SÍ vivían sin
          ningún estilo — toastOptions.classNames + icons de abajo es su
          panel, coherente con el resto de la familia. Solo success/error/
          info llevan icono a color: son los tres tipos que la app usa de
          verdad hoy (ver toast.success/error/info en el código) — warning y
          loading, sin ninguna llamada todavía, se quedan con el icono de
          serie de Sonner en vez de inventarles un color de antemano. */}
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
        toastOptions={{ unstyled: true, classNames: toastClassNames }}
        icons={{
          success: <ToastIconChip icon={CircleCheck} color={GREEN} />,
          error: <ToastIconChip icon={TriangleAlert} color={RED} />,
          info: <ToastIconChip icon={Info} color={BLUE} />,
        }}
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
