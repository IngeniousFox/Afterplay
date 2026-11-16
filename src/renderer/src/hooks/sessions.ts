import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { PendingSession, Session, SessionWithGame } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import type { GameId, SessionId } from '../../../shared/entityIds';

// Bloque 5A — todas las sesiones de la biblioteca (para la vista de
// Sesiones). Misma historia que useGames(): staleTime Infinity porque lo único
// que la pone al día es el aviso 'data:changed' del main (mutaciones, watcher y
// bajadas del sync; ver useDataChangedSync).
export const sessionsQueryOptions = {
  queryKey: queryKeys.sessions.all,
  queryFn: () => window.api.sessions.getAll(),
  staleTime: Infinity,
};

export const useSessions = (): UseQueryResult<SessionWithGame[], Error> =>
  useQuery(sessionsQueryOptions);

// EMULADORES.md §6 — la bandeja "Pending": sesiones de emulador sin asignar.
// Su key vive bajo ['sessions'], así que el dominio 'sessions' de 'data:changed'
// la refresca sin tocarla explícitamente.
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
  { sessionId: SessionId; gameId: GameId },
  unknown
> =>
  useMutation({
    mutationFn: ({ sessionId, gameId }: { sessionId: SessionId; gameId: GameId }) =>
      window.api.sessions.assign(sessionId, gameId),
  });

// Descartar una sesión de emulador sin asignar (se abrió el emulador solo
// para configurarlo, no para jugar) — nunca tocó ningún juego, así que solo
// hace falta refrescar la propia bandeja de pendientes.
export const useDeletePendingSession = (): UseMutationResult<boolean, Error, SessionId, unknown> =>
  useMutation({
    mutationFn: (sessionId: SessionId) => window.api.sessions.deletePending(sessionId),
  });

// Borrar una sesión real cerrada — cambia horas/contadores/fechas derivadas
// del juego (games) y la propia lista (sessions). stateEvents no se toca:
// el borrado deja el historial de estados intacto a propósito (ver
// deleteSession.ts en el main).
export const useDeleteSession = (): UseMutationResult<boolean, Error, SessionId, unknown> =>
  useMutation({ mutationFn: (id: SessionId) => window.api.sessions.delete(id) });

export const useCloseSession = (): UseMutationResult<
  Session | null,
  Error,
  { id: SessionId; endedAt: Date },
  unknown
> =>
  useMutation({
    mutationFn: ({ id, endedAt }: { id: SessionId; endedAt: Date }) =>
      window.api.sessions.close(id, endedAt),
  });

// Botón Play (ActionBar) — misma función que el watcher (startGameSession),
// vía IPC. Sustituye a la orquestación manual de addIteration/addStateEvent/
// addSession que había antes en el propio ActionBar: aquella marcaba la
// sesión como manual (era la vía de registrar el pasado) — pero un Play que
// lanza el .exe de verdad es tan automático como lo que detecta el watcher,
// así que debe contar igual (dentro del heatmap, las rachas, etc.).
// El aviso de la escritura trae los tres dominios que tocaban las tres
// mutations por separado (games: currentState/totalHours; sessions: la lista
// global; stateEvents: el nuevo 'started' si tocó abrir/reanudar playthrough).
export const useStartGameSession = (): UseMutationResult<Session | null, Error, GameId, unknown> =>
  useMutation({ mutationFn: (gameId: GameId) => window.api.sessions.startForGame(gameId) });

// Diario de sesión ("dónde lo dejé"). Solo toca el texto de una sesión.
//
// No invalida nada: la escritura pasa por la puerta del main y esta avisa con
// 'data:changed' (dominio 'sessions') a las DOS ventanas. Este mismo hook lo usa
// el HUD del overlay, que corre en otra ventana con OTRO QueryClient: antes una
// nota escrita allí no llegaba a la principal (el handler no emitía nada) y,
// con ['sessions'] a staleTime Infinity, esta se quedaba enseñando la sesión
// "sin nota". Con el aviso único cada ventana se pone al día sola.
//
// Lo que cuesta, y es la contrapartida de no tener una lista a mano: el dominio
// 'sessions' refresca también la lista de juegos (horas y última vez jugada
// salen de las sesiones), que antes esta mutación se ahorraba con un predicate.
// Corre justo al cerrar cada partida, cuando el aviso de sesión cerrada trae el
// campo de la nota; son unas pocas consultas locales.
//
// OJO con el borrador: que la caché se ponga al día CON EL EDITOR ABIERTO
// cambia el prop `note` bajo SessionNote, que no resincroniza. Es el fallo que
// OverlayHud parchea en su fila viva con `key={session.note ?? ''}`; las listas
// de la ventana principal no llevan esa key.
export const useSetSessionNote = (): UseMutationResult<
  Session | null,
  Error,
  { id: SessionId; note: string },
  unknown
> =>
  useMutation({
    mutationFn: ({ id, note }: { id: SessionId; note: string }) =>
      window.api.sessions.setNote(id, note),
  });
