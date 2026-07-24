import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  LaunchExecutableResult,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// Infinity y no un número arbitrario: estos datos solo cambian por dos vías,
// y las dos invalidan queryKeys.games.all al terminar:
//   1. Las mutations de este archivo (create/update/delete/addStateEvent/
//      addSpend/addSession).
//   2. El watcher del main (Bloque 3), que escribe sesiones directo desde el
//      main sin pasar por ninguna mutation de aquí — pero avisa con el evento
//      IPC 'games:changed', al que useWatcherSync() se suscribe para invalidar
//      esta misma key.
// Así no hay ningún "después de X minutos podría estar desactualizado" real:
// siempre hay un aviso explícito detrás de cada cambio.
export const useGames = (): UseQueryResult<GameListItem[], Error> =>
  useQuery({
    queryKey: queryKeys.games.all,
    queryFn: () => window.api.games.getAll(),
    staleTime: Infinity,
  });

// Mismo staleTime Infinity que useGames (ver su comentario): su key
// ['games', id] cuelga del prefijo ['games'], así que toda invalidación de
// games.all (mutations + watcher) la refresca también — sin esto, refetcheaba
// de más en cada mount/focus sin ningún cambio real detrás.
export const useGame = (id: number): UseQueryResult<GameDetail | null, Error> =>
  useQuery({
    queryKey: queryKeys.games.detail(id),
    queryFn: () => window.api.games.getById(id),
    staleTime: Infinity,
  });

// Sección Plan to Play — la contrapartida de useGames(): solo los juegos
// planeados (que useGames() nunca trae). Mismo staleTime Infinity: su key
// vive bajo el prefijo ['games'], así que todas las invalidaciones de
// games.all la refrescan también.
export const usePlannedGames = (): UseQueryResult<GameListItem[], Error> =>
  useQuery({
    queryKey: queryKeys.games.planned,
    queryFn: () => window.api.games.getPlanned(),
    staleTime: Infinity,
  });

export const useCreatePlannedGame = (): UseMutationResult<
  GameRow,
  Error,
  CreatePlannedGameInput,
  unknown
> =>
  useInvalidatingMutation(
    (input: CreatePlannedGameInput) => window.api.games.createPlanned(input),
    [queryKeys.games.all],
  );

// El juego cambia de lista (planned -> library) y puede traer gasto y
// eventos nuevos — games.all cascada a planned/detail por prefijo, pero
// spend/stateEvents viven en keys propias.
export const usePromotePlannedGame = (): UseMutationResult<
  GameRow,
  Error,
  PromotePlannedGameInput,
  unknown
> =>
  useInvalidatingMutation(
    (input: PromotePlannedGameInput) => window.api.games.promote(input),
    [queryKeys.games.all, queryKeys.spend.all, queryKeys.stateEvents.all],
  );

export const useCreateGameWithDetails = (): UseMutationResult<
  GameRow,
  Error,
  CreateGameWithDetailsInput,
  unknown
> =>
  useInvalidatingMutation(
    (input: CreateGameWithDetailsInput) => window.api.games.createWithDetails(input),
    [queryKeys.games.all],
  );

// Invalidar games.all (['games']) ya cascada por prefijo a ['games', id] —
// no hace falta invalidar las dos keys a mano.
export const useUpdateGame = (): UseMutationResult<
  GameRow | null,
  Error,
  { id: number; patch: UpdateGamePatch },
  unknown
> =>
  useInvalidatingMutation(
    ({ id, patch }: { id: number; patch: UpdateGamePatch }) => window.api.games.update(id, patch),
    [queryKeys.games.all],
  );

// Borrar un juego arrastra en cascada (ON DELETE CASCADE, ver deleteGame.ts)
// sus iterations, sessions, state_events y spend_events. Las tres listas
// aparte de games.all tienen que invalidarse también — sin esto, las
// sesiones/gastos/historial del juego borrado seguían apareciendo en
// Sesiones y Stats hasta reiniciar la app (bug real, encontrado en auditoría).
export const useDeleteGame = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (id: number) => window.api.games.delete(id),
    [queryKeys.games.all, queryKeys.sessions.all, queryKeys.spend.all, queryKeys.stateEvents.all],
  );

// Conversión a endless (EditGameModal): limpia desenlaces/marcadores del
// juego conservando sesiones y horas — toca juegos, sesiones (borra
// marcadores) e historial de estados a la vez, de ahí las tres claves.
export const useResetEndlessState = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (id: number) => window.api.games.resetEndlessState(id),
    [queryKeys.games.all, queryKeys.sessions.all, queryKeys.stateEvents.all],
  );

// Sin invalidación: lanzar el .exe no cambia ningún dato — la sesión (si el
// lanzamiento sale bien) la abre ActionBar por separado, con su propia
// mutation de siempre.
export const useLaunchExecutable = (): UseMutationResult<
  LaunchExecutableResult,
  Error,
  string,
  unknown
> =>
  useMutation({
    mutationFn: (executablePath: string) => window.api.games.launchExecutable(executablePath),
  });

// Botón "abrir carpeta" del detalle — sin invalidación, mismo motivo que
// useLaunchExecutable: abrir el explorador de archivos no cambia ningún dato.
export const useOpenInstallDirectory = (): UseMutationResult<
  LaunchExecutableResult,
  Error,
  string,
  unknown
> =>
  useMutation({
    mutationFn: (installDirectory: string) =>
      window.api.games.openInstallDirectory(installDirectory),
  });
