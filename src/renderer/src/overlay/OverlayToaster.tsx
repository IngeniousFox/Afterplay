import { TriangleAlert } from 'lucide-react';
import { Toaster } from 'sonner';
import { RED } from '../lib/colors';

// EL SITIO DONDE ESTA VENTANA PINTA SUS AVISOS, que hasta ahora no existía.
//
// El HUD es un árbol React APARTE: main.tsx parte las dos ventanas por el hash
// y la del overlay monta OverlayHud y nada más — ni router, ni Afterplay.tsx,
// que es donde vive el único <Toaster> del renderer. Así que un `toast.error`
// desde aquí llamaba a sonner, sonner no tenía dónde pintar, y no aparecía
// NADA. El caso real: pulsas el lapicero de una sesión del historial, escribes
// y confirmas con Enter; si la mutación rechaza (la DB en pleno swap del sync,
// el IPC caído), SessionNote deja el editor abierto con tu texto a propósito y
// canta el fallo por toast — un toast que en esta ventana no se veía. Lo que el
// jugador tenía delante era un input que no se cierra y ningún motivo.
//
// MÍNIMO A PROPÓSITO: aquí no hay TooltipProvider, ni el ancho de 420 del aviso
// de cierre de sesión (que lleva carátula y campo de texto y nunca se pinta en
// esta ventana), ni más iconos que el de error — es el único tipo que el HUD
// levanta hoy, y el criterio de la casa es no inventarle color a un tipo que
// todavía no tiene ni una llamada.

// El mismo chip de icono que los toasts de la app (Afterplay.tsx): un cuadro
// redondeado con el acento al 24 de alpha. Con `unstyled` puesto, un
// toast.error de una línea no trae NINGÚN estilo propio de sonner, así que sin
// esto sería texto suelto flotando sobre el juego.
const ToastIconChip = (): React.JSX.Element => (
  <span
    className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
    style={{ background: `${RED}24` }}
  >
    <TriangleAlert size={16} style={{ color: RED }} />
  </span>
);

// El panel de la casa, pero con el radio y la sombra de los paneles del HUD
// (PANEL_CLASS en OverlayHud) y no con los del toast de escritorio: sobre un
// juego en marcha, un aviso tiene que leerse como una pieza más de esta
// pantalla, no como una notificación del sistema operativo colada encima.
const toastClassNames = {
  toast:
    'flex w-full items-center gap-3 rounded-[16px] border border-input bg-[#141614] px-4 py-3.5 shadow-[0_24px_70px_rgba(0,0,0,.65)]',
  icon: 'flex-none',
  content: 'flex min-w-0 flex-1 flex-col justify-center gap-0.5',
  title: 'text-[13px] font-bold leading-snug text-foreground',
  description: 'text-[11.5px] font-semibold text-muted-foreground',
};

export const OverlayToaster = (): React.JSX.Element => (
  <Toaster
    // Abajo a la derecha, donde viven los toasts de la app (OVERLAY.md §5.5) y
    // lejos del pie centrado del HUD, que es lo único que hay a esa altura.
    position="bottom-right"
    toastOptions={{ unstyled: true, classNames: toastClassNames }}
    icons={{ error: <ToastIconChip /> }}
  />
);
