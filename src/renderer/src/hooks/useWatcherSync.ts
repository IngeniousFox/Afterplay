import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from './queryKeys';

// El watcher del main (Bloque 3) escribe sesiones directamente en la DB, sin
// pasar por ninguna mutation del renderer, así que el caché de ['games'] no se
// enteraría por su cuenta. Aquí nos suscribimos al aviso IPC que el main emite
// tras cada arranque/cierre de sesión e invalidamos ['games'] — que cascada
// por prefijo a ['games', id] — para que biblioteca y detalle se refresquen en
// tiempo real (card a "PLAYING", horas recalculadas al cerrar, etc.).
//
// LO QUE CUESTA CADA AVISO, medido con el QueryClient de verdad sobre la
// biblioteca real: 4 consultas (11 ms) en Library con una ficha abierta, 5
// consultas (30 ms) en Stats. Es barato, y no se dispara en cada sondeo de
// 5 s: el watcher
// solo avisa cuando algo cambió de verdad (`if (changed)` en su poll), o sea
// arranques, cierres, adopciones y los cierres de recuperación del arranque.
// Aquí no hay nada que recortar por ahora — si alguien viene a "optimizar la
// invalidación", que empiece por otro sitio.
//
// LO ÚNICO ANCHO DE MÁS, y no se puede arreglar desde aquí: ['games'] arrastra
// también ['games','planned'] (14 ms, la lista del Plan), y una sesión no
// puede cambiarla — getPlannedGames solo lee la tabla `games` con planned=1 y
// las notas de 'plan_to_play'. Pero 'games:changed' es un canal COMPARTIDO:
// además del watcher lo emiten el pull de Turso (notifyPulledChanges) y el
// drenado del buzón del Plan (que crea planeados venidos del móvil), y esos
// sí. Sin un dato en el propio evento que diga quién avisa, distinguirlo desde
// el renderer sería adivinar.
export const useWatcherSync = (): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.watcher.onGamesChanged(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      // El watcher también crea/cierra sesiones directo en la DB — la vista
      // de Sesiones (Bloque 5A) necesita el mismo aviso que games.all.
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      // Y eventos de estado: detectar un arranque pasa por
      // resolveIterationForPlay, que apila un 'started' (playthrough nuevo o
      // reanudado). Sin esto, abrir un juego cambiaba su estado en la
      // biblioteca pero el History de la ficha y el desglose de Stats seguían
      // enseñando lo de antes hasta recargar.
      queryClient.invalidateQueries({ queryKey: queryKeys.stateEvents.all });
    });
  }, [queryClient]);
};
