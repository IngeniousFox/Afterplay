import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  LaunchExecutableResult,
  PlannedGameItem,
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
export const usePlannedGames = (): UseQueryResult<PlannedGameItem[], Error> =>
  useQuery({
    queryKey: queryKeys.games.planned,
    queryFn: () => window.api.games.getPlanned(),
    staleTime: Infinity,
  });

// "Up next" (PLAN-TO-PLAY.md 2.2) — fijar o soltar un planeado como
// prioridad de verdad.
//
// OPTIMISTA, igual que el reordenar de mas abajo, y por un motivo que se veia
// en pantalla: con la version anterior (invalidar y esperar) el clic tenia que
// pagar DOS saltos asincronos —el viaje por IPC y el refetch de la lista—
// antes de que la fila se moviera. En ese hueco no pasaba nada, y despues
// saltaba todo de golpe: el pin no respondia al dedo, respondia al reloj.
//
// Ahora la fila cambia de estanteria en el mismo tick que el clic, que es
// cuando la animacion de llegada tiene que arrancar. El unico "dato inventado"
// es la marca de tiempo: se pone new Date() igual que hace el main, asi que la
// lista optimista queda ordenada como quedara la de verdad y el refetch no
// mueve nada.
export const useSetPlanPinned = (): UseMutationResult<
  boolean,
  Error,
  { id: number; pinned: boolean },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) =>
      window.api.games.setPlanPinned(id, pinned),
    onMutate: async ({ id, pinned }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.games.planned });
      const previous = queryClient.getQueryData<PlannedGameItem[]>(queryKeys.games.planned);
      if (previous) {
        queryClient.setQueryData(
          queryKeys.games.planned,
          previous.map((game) =>
            game.id === id ? { ...game, planPinnedAt: pinned ? new Date() : null } : game,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      const previous = (context as { previous?: PlannedGameItem[] } | undefined)?.previous;
      if (previous) queryClient.setQueryData(queryKeys.games.planned, previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

// El MISMO reparto de timestamps que hace el main (reorderUpNext en la
// query): los planPinnedAt existentes, ordenados de antiguo a nuevo, se
// reasignan en el orden nuevo. Duplicado aqui a proposito — es lo que hace
// posible la actualizacion OPTIMISTA de abajo: la cache queda exactamente
// como va a quedar la DB, asi que cuando llegue el refetch no se mueve nada.
const reassignPinStamps = (games: PlannedGameItem[], orderedIds: number[]): PlannedGameItem[] => {
  const byId = new Map(games.map((game) => [game.id, game]));
  const ids = orderedIds.filter((id) => byId.get(id)?.planPinnedAt != null);
  if (ids.length < 2) return games;

  const stamps = ids
    .map((id) => (byId.get(id)?.planPinnedAt as Date).getTime())
    .sort((a, b) => a - b);
  for (let k = 1; k < stamps.length; k++) {
    if (stamps[k] <= stamps[k - 1]) stamps[k] = stamps[k - 1] + 1;
  }

  const stampById = new Map(ids.map((id, k) => [id, stamps[k]]));
  return games.map((game) => {
    const stamp = stampById.get(game.id);
    return stamp === undefined ? game : { ...game, planPinnedAt: new Date(stamp) };
  });
};

// Reordenar Up next arrastrando. OPTIMISTA a proposito: el gesto termina con
// la fila ya posada donde la soltaste, y esperar la ida y vuelta al main para
// reflejarlo la haria saltar un frame despues — justo lo que delata que "no
// era verdad todavia". Se pinta el orden nuevo al instante; si el main
// fallara (rarisimo: es un update local), se restaura el anterior.
//
// El orden de las lineas de onMutate NO es cosmetico, y es lo que arreglo el
// "al soltar la fila se recoloca a medias": UpNextList lanza esta mutation y
// limpia los transforms del gesto en el mismo tick, contando con que React
// agrupe las dos cosas en un solo render. Con `await cancelQueries` DELANTE,
// el setQueryData caia en un microtask posterior: React pintaba primero un
// frame sin transforms y con el orden VIEJO —la fila volvia de un salto a
// donde la habias cogido— y solo despues llegaba el orden nuevo y el FLIP la
// llevaba otra vez a su sitio. Dos viajes para un solo gesto.
//
// Escribiendo antes de cualquier await, el estado optimista es sincrono y
// entra en el mismo render que el fin del gesto. La cancelacion no se pierde:
// cancelQueries actua al invocarla, lo unico que se aplaza es esperarla.
export const useReorderUpNext = (): UseMutationResult<boolean, Error, number[], unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: number[]) => window.api.games.reorderUpNext(orderedIds),
    onMutate: async (orderedIds) => {
      const cancelled = queryClient.cancelQueries({ queryKey: queryKeys.games.planned });
      const previous = queryClient.getQueryData<PlannedGameItem[]>(queryKeys.games.planned);
      if (previous) {
        queryClient.setQueryData(queryKeys.games.planned, reassignPinStamps(previous, orderedIds));
      }
      await cancelled;
      return { previous };
    },
    onError: (_error, _ids, context) => {
      const previous = (context as { previous?: PlannedGameItem[] } | undefined)?.previous;
      if (previous) queryClient.setQueryData(queryKeys.games.planned, previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

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
    // saves.all incluida porque save_backups cuelga de games con ON DELETE
    // CASCADE: sin esto quedaría en caché el índice de partidas de un juego
    // que ya no existe — el mismo bug que ya pasó con sessions/spend.
    //
    // achievements y curiosities cuelgan IGUAL de games por cascada, pero son
    // staleTime:Infinity y solo se refrescan cuando el main emite su evento —
    // que un borrado desde el renderer nunca dispara. Sin invalidarlas, Stats
    // seguía contando los trofeos del juego borrado y la tarjeta de curiosidad
    // lo seguía enseñando hasta reiniciar (mismo bug, dos tablas que faltaban).
    [
      queryKeys.games.all,
      queryKeys.sessions.all,
      queryKeys.spend.all,
      queryKeys.stateEvents.all,
      queryKeys.saves.all,
      queryKeys.achievements.all,
      queryKeys.curiosities.all,
    ],
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
