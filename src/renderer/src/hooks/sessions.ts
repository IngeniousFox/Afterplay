import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddManualSessionInput,
  PendingSession,
  Session,
  SessionWithGame,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Bloque 5A — todas las sesiones de la biblioteca (para la vista de
// Sesiones). Misma historia que useGames(): staleTime Infinity porque solo
// cambia por las mutations de aquí (que invalidan sessions.all) o por el
// watcher del main (vía useWatcherSync).
export const useAllSessions = (): UseQueryResult<SessionWithGame[], Error> =>
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
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, gameId }) => window.api.sessions.assign(sessionId, gameId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stateEvents.all });
    },
  });
};

// Descartar una sesión de emulador sin asignar (se abrió el emulador solo
// para configurarlo, no para jugar) — nunca tocó ningún juego, así que solo
// hace falta refrescar la propia bandeja de pendientes.
export const useDeletePendingSession = (): UseMutationResult<boolean, Error, number, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => window.api.sessions.deletePending(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.pending });
    },
  });
};

export const useAddSession = (): UseMutationResult<
  Session,
  Error,
  AddManualSessionInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddManualSessionInput) => window.api.sessions.add(input),
    onSuccess: () => {
      // Una sesión nueva cambia totalHours/isLive/sessionCount del juego, y
      // la lista de sessions.all en sí.
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
};

export const useCloseSession = (): UseMutationResult<
  Session | null,
  Error,
  { id: number; endedAt: Date },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, endedAt }: { id: number; endedAt: Date }) =>
      window.api.sessions.close(id, endedAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
};

// Botón Play (ActionBar) — misma función que el watcher (startGameSession),
// vía IPC. Sustituye a la orquestación manual de addIteration/addStateEvent/
// addSession que había antes en el propio ActionBar: aquella creaba la
// sesión con addManualSession, que fuerza isManual:true SIEMPRE (pensado
// para registrar el pasado) — pero un Play que ahora lanza el .exe de
// verdad es tan automático como lo que detecta el watcher, así que debe
// contar igual (fuera de la lista "sesión manual" del heatmap, etc.).
// Invalida las tres queries que tocaban las tres mutations por separado
// (games: currentState/totalHours: sessions: la lista global; stateEvents:
// el nuevo 'started' si tocó abrir/reanudar playthrough).
export const useStartGameSession = (): UseMutationResult<
  Session | null,
  Error,
  number,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gameId: number) => window.api.sessions.startForGame(gameId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stateEvents.all });
    },
  });
};

// Corregir la fecha de un marcador manual de inicio/fin de playthrough
// (EditGameModal, fechas Started/Finished de una iteración existente).
// También corrige los stateEvents que nacieron con él (ver la query), de
// ahí que invalide stateEvents.all además de games/sessions.
export const useUpdateMilestoneSession = (): UseMutationResult<
  Session | null,
  Error,
  { id: number; date: Date; precision: 'year' | 'month' | 'day' },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date, precision }) =>
      window.api.sessions.updateMilestone(id, date, precision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stateEvents.all });
    },
  });
};
