import { TriangleAlert } from 'lucide-react';
import { Toaster } from 'sonner';

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
// de 4 px en Live tenue. Con `unstyled` puesto, un toast.error de una línea no trae NINGÚN estilo propio de sonner, así que sin
// esto sería texto suelto flotando sobre el juego.
const ToastIconChip = (): React.JSX.Element => (
  <span className="flex size-9 flex-none items-center justify-center rounded-sm bg-live/14">
    <TriangleAlert aria-hidden size={16} className="text-live" />
  </span>
);

// El panel del HUD (Overlay, Line strong, 8 px y shadow-modal) con el borde
// izquierdo en Live de los avisos de error de Fósforo, y no el toast de
// escritorio: sobre un juego en marcha, un aviso tiene que leerse como una pieza más de esta
// pantalla, no como una notificación del sistema operativo colada encima.
const toastClassNames = {
  toast:
    'flex w-full items-center gap-3 rounded-md border border-line-strong border-l-2 border-l-live bg-overlay px-4 py-3.5 shadow-modal',
  icon: 'flex-none',
  content: 'flex min-w-0 flex-1 flex-col justify-center gap-0.5',
  title: 'text-small font-semibold leading-snug text-bone',
  description: 'text-micro text-dust',
};

export const OverlayToaster = (): React.JSX.Element => (
  <Toaster
    // Abajo al centro, sobre el juego: el HUD ocupa ahora la columna derecha
    // casi entera, y abajo a la derecha (OVERLAY.md §5.5) el aviso taparía su
    // pie con el panel a altura máxima.
    position="bottom-center"
    toastOptions={{ unstyled: true, classNames: toastClassNames }}
    icons={{ error: <ToastIconChip /> }}
  />
);
