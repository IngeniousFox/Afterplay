import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SessionClosedToast } from '../components/SessionClosedToast';
import { queryKeys } from './queryKeys';

// Cuánto vive el aviso. Generoso a propósito: el toast trae un campo de texto
// y escribir "me quedé en el jefe del castillo" lleva más que leer un mensaje.
const TOAST_DURATION_MS = 15000;

// Sesión que hay que resaltar al llegar a la ficha de un juego, y quién la
// pide. Vive fuera de React (un módulo, no un contexto) porque el aviso puede
// llegar estando en cualquier pantalla: la ficha lo consulta al montar, sin
// que haya que cablear un provider por toda la app.
let pendingFlashSessionId: number | null = null;
const flashListeners = new Set<() => void>();

const emitFlashChange = (): void => {
  for (const listener of flashListeners) listener();
};

export const requestSessionFlash = (sessionId: number): void => {
  pendingFlashSessionId = sessionId;
  // Avisar a quien YA esté montado: si estás viendo la ficha de ese juego, la
  // ruta no cambia al pulsar el aviso, así que no hay remontaje y nadie
  // leería el valor pendiente por su cuenta.
  emitFlashChange();
};

// Se consume una vez ya usado: si no, volver a la ficha días después
// parpadearía otra vez una sesión vieja sin motivo.
export const consumeSessionFlash = (): void => {
  if (pendingFlashSessionId === null) return;
  pendingFlashSessionId = null;
  emitFlashChange();
};

// Las dos piezas de useSyncExternalStore, que es la forma correcta de leer un
// valor que vive FUERA de React. Antes esto se leía en el inicializador de
// useState y estaba roto: consumir vacía el valor (o sea, es un efecto
// secundario) y StrictMode invoca los inicializadores dos veces — la primera
// llamada se llevaba el id y React se quedaba con el resultado de la segunda,
// null. El parpadeo no salía jamás.
export const subscribeSessionFlash = (listener: () => void): (() => void) => {
  flashListeners.add(listener);
  return () => {
    flashListeners.delete(listener);
  };
};

export const getPendingSessionFlash = (): number | null => pendingFlashSessionId;

// Levanta el aviso de "acabas de cerrar X" cuando el watcher cierra una
// sesión. Una sola suscripción para toda la app, montada en la raíz.
//
// Cierres encadenados (cierras A, no tocas nada, abres y cierras B) NO apilan
// diálogos: cada aviso REEMPLAZA al anterior reusando el mismo toastId. Como
// mucho hay uno, siempre el del último cierre — y la nota de A no se pierde
// ninguna oportunidad, porque su campo sigue en la fila de esa sesión para
// siempre. El toast es un atajo, no la única puerta.
const TOAST_ID = 'session-closed';

export const useSessionClosedToast = (): void => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.sessions.onSessionClosed((event) => {
      // El main manda esto también al pulsar la notificación de Windows: ahí
      // no toca enseñar un toast, sino llevar directo a la ficha con la
      // sesión resaltada, que es lo que el clic pedía.
      if ('openGame' in event && event.openGame) {
        requestSessionFlash(event.sessionId);
        navigate(`/games/${event.gameId}`);
        return;
      }

      // La sesión acaba de escribirse en la DB desde el main: sin esto, la
      // ficha que ya tuvieras abierta no la vería.
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });

      toast.custom(
        (id) => (
          <SessionClosedToast
            event={event}
            toastId={id}
            durationMs={TOAST_DURATION_MS}
            onOpenGame={() => {
              requestSessionFlash(event.sessionId);
              navigate(`/games/${event.gameId}`);
              toast.dismiss(id);
            }}
          />
        ),
        { id: TOAST_ID, duration: TOAST_DURATION_MS },
      );
    });
  }, [navigate, queryClient]);
};
