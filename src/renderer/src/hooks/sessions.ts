import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PendingSession, Session, SessionWithGame } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// Bloque 5A — todas las sesiones de la biblioteca (para la vista de
// Sesiones). Misma historia que useGames(): staleTime Infinity porque solo
// cambia por las mutations de aquí (que invalidan sessions.all) o por el
// watcher del main (vía useWatcherSync).
export const useSessions = (): UseQueryResult<SessionWithGame[], Error> =>
  useQuery({
    queryKey: queryKeys.sessions.all,
    queryFn: () => window.api.sessions.getAll(),
    staleTime: Infinity,
  });

// EMULADORES.md §6 — la bandeja "Pending": sesiones de emulador sin asignar.
// Su key vive bajo ['sessions'], así que el watcher (useWatcherSync) y las
// mutations de sesiones la refrescan sin tocarla explícitamente.
export const usePendingSessions = (): UseQueryResult<PendingSession[], Error> =>
  useQuery({
    queryKey: queryKeys.sessions.pending,
    queryFn: () => window.api.sessions.getPending(),
    staleTime: Infinity,
  });

// Asignar una sesión pendiente a un juego emulado — el juego recibe las
// horas (y puede pasar a "Playing"/crear playthrough, ver assignSession),
// así que invalida el árbol entero de juegos además de las sesiones.
export const useAssignSession = (): UseMutationResult<
  Session | null,
  Error,
  { sessionId: number; gameId: number },
  unknown
> =>
  useInvalidatingMutation(
    ({ sessionId, gameId }: { sessionId: number; gameId: number }) =>
      window.api.sessions.assign(sessionId, gameId),
    [queryKeys.games.all, queryKeys.sessions.all, queryKeys.stateEvents.all],
  );

// Descartar una sesión de emulador sin asignar (se abrió el emulador solo
// para configurarlo, no para jugar) — nunca tocó ningún juego, así que solo
// hace falta refrescar la propia bandeja de pendientes.
export const useDeletePendingSession = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (sessionId: number) => window.api.sessions.deletePending(sessionId),
    [queryKeys.sessions.pending],
  );

// Borrar una sesión real cerrada — cambia horas/contadores/fechas derivadas
// del juego (games) y la propia lista (sessions). stateEvents no se toca:
// el borrado deja el historial de estados intacto a propósito (ver
// deleteSession.ts en el main).
export const useDeleteSession = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (id: number) => window.api.sessions.delete(id),
    [queryKeys.games.all, queryKeys.sessions.all],
  );

export const useCloseSession = (): UseMutationResult<
  Session | null,
  Error,
  { id: number; endedAt: Date },
  unknown
> =>
  useInvalidatingMutation(
    ({ id, endedAt }: { id: number; endedAt: Date }) => window.api.sessions.close(id, endedAt),
    [queryKeys.games.all, queryKeys.sessions.all],
  );

// Botón Play (ActionBar) — misma función que el watcher (startGameSession),
// vía IPC. Sustituye a la orquestación manual de addIteration/addStateEvent/
// addSession que había antes en el propio ActionBar: aquella marcaba la
// sesión como manual (era la vía de registrar el pasado) — pero un Play que
// lanza el .exe de verdad es tan automático como lo que detecta el watcher,
// así que debe contar igual (dentro del heatmap, las rachas, etc.).
// Invalida las tres queries que tocaban las tres mutations por separado
// (games: currentState/totalHours: sessions: la lista global; stateEvents:
// el nuevo 'started' si tocó abrir/reanudar playthrough).
export const useStartGameSession = (): UseMutationResult<Session | null, Error, number, unknown> =>
  useInvalidatingMutation(
    (gameId: number) => window.api.sessions.startForGame(gameId),
    [queryKeys.games.all, queryKeys.sessions.all, queryKeys.stateEvents.all],
  );

// Diario de sesión ("dónde lo dejé"). Solo toca el texto de una sesión: ni
// horas, ni estados, ni nada derivado — de ahí que invalide sessions y la
// FICHA del juego (que pinta sus sesiones), pero no stateEvents.
//
// Y solo la ficha, no el prefijo ['games'] entero, que es lo que hacía antes.
// Una nota no puede cambiar ni la lista de la biblioteca (GameListItem no
// tiene notas: horas, estado, última jugada y poco más) ni la del Plan (un
// planeado no tiene sesiones), y sin embargo las refetcheaba las dos. Medido
// sobre la biblioteca real, en la ficha de un juego con saga (que monta la
// lista del Plan para el "esto ya lo tienes"): 5 consultas y 25 ms, con algo
// más de 1 MB cruzando el IPC —893 KB de ellos, los 661 planeados— contra
// 3 consultas y 2 ms ahora.
//
// No es un gesto raro que se pague una vez al mes: el aviso de sesión cerrada
// (SessionClosedToast) trae el campo de la nota, así que esto corre JUSTO al
// cerrar cada partida — el momento en el que el main ya está cerrando la
// sesión, sincronizando logros y copiando la partida guardada.
//
// El predicate en vez de una key: la mutation recibe el id de la SESIÓN, no el
// del juego, así que no puede componer queryKeys.games.detail(id). Marcar
// todas las fichas cacheadas (['games', <número>]) es exacto por otro lado —
// la única que refetchea de verdad es la que esté abierta, y las demás se
// quedan marcadas viejas para cuando se visiten.
//
// OJO con las DOS ventanas: este mismo hook lo usa el HUD del overlay
// (OverlayHud), que corre en otra ventana con OTRO QueryClient (ver
// main/overlay.ts), y estas invalidaciones solo alcanzan la caché de SU
// ventana. Para que una nota escrita en el overlay llegue a la principal, el
// handler 'sessions:setNote' del main tiene que avisar a las dos ventanas
// (mainWindow.webContents.send + sendToOverlay, como runPlanMailboxDrain);
// hoy es un handleDb pelado que no emite nada, así que con ['sessions'] a
// staleTime Infinity la principal se queda enseñando la sesión "sin nota".
//
// El daño NO es el que decía aquí antes ("abrir el editor allí siembra un
// borrador vacío y lo machaca al confirmar"): SessionNote corta antes con
// `if ((draft.trim() || null) === note)`, y contra un prop rancio a null el
// borrador vacío compara igual, así que confirmar no manda nada. Los dos que
// sí ocurren son estos:
//   - Escribir a ciegas. No ves lo que hay escrito en el HUD, escribes otra
//     cosa y el UPDATE reemplaza la nota entera. Nada avisa de que había
//     texto debajo.
//   - Que la caché se ponga al día CON EL EDITOR ABIERTO. Cualquier
//     'games:changed' (el cierre de sesión del watcher, un pull de Turso)
//     invalida ['sessions'], el prop `note` pasa a valer el texto del HUD y
//     el borrador sigue en el '' del montaje —SessionNote no resincroniza—,
//     así que ahora la guarda ya no coincide, se manda '' y updateSessionNote
//     lo guarda como null: borrado. Es exactamente el fallo que OverlayHud
//     parchea en su fila viva con `key={session.note ?? ''}`; las listas de la
//     ventana principal (SessionRow, SessionHistoryList) no llevan esa key.
export const useSetSessionNote = (): UseMutationResult<
  Session | null,
  Error,
  { id: number; note: string },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      window.api.sessions.setNote(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.games.all,
        predicate: (query) => typeof query.queryKey[1] === 'number',
      });
    },
  });
};
