import type { QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  LaunchExecutableResult,
  PlannedGameItem,
  PlannedGameListItem,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// Infinity y no un número arbitrario: la regla de la casa es que TODO EL QUE
// ESCRIBE AVISA, así que detrás de cada cambio hay siempre una invalidación
// explícita de queryKeys.games.all y no un "después de X minutos podría estar
// desactualizado".
//
// A la tabla `games` le escriben MUCHOS más sitios que las mutations de este
// archivo, y la lista no para de crecer: el watcher (Bloque 3) mete sesiones
// directo desde el main, el pull de Turso mete filas que bajan de otro PC
// tuyo (notifyPulledChanges, main/db/index.ts) y el drenado del buzón del
// Plan crea planeados venidos del móvil (main/plan/drainMailbox.ts, cableado
// en main/index.ts sobre onSyncCompleted). Ninguno pasa por aquí y todos
// AVISAN con el evento IPC 'games:changed', al que useWatcherSync() se
// suscribe para invalidar esta misma key — por eso el staleTime aguanta sin
// que este archivo tenga que conocerlos.
//
// Y por eso este comentario ya no intenta enumerarlos: el que había aquí lo
// intentó, se quedó corto (juraba que solo existían las mutations y el
// watcher), y una lista falsamente completa es lo que hizo que el bug de
// abajo tardara tanto en verse. La regla se comprueba en el emisor, no en un
// censo escrito en el consumidor.
//
// LO QUE HOY NO CUMPLE LA REGLA — no como censo, sino porque este es el que
// nos mordió: el "calentado" del alta (warmSteamData, main/external/warmNewGame.ts).
// Es fire-and-forget: escribe etiquetas y reseñas de Steam en la fila cuando
// la tienda contesta, o sea DESPUÉS del refetch que dispara la mutation del
// alta, y no emite nada. Mientras siga así, un juego recién añadido se queda
// sin sus chips de etiquetas en el Plan hasta que cualquier otra cosa invalide
// ['games'] (arrancar un juego, otra mutation, un pull, reiniciar). El arreglo
// es suyo y no de aquí: un temporizador en el renderer contra un viaje de red
// ajeno sería peor que el bug.
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
//
// Devuelve el canal ESCUETO (PlannedGameListItem, 354 KB de 661 filas): es
// lo que pagan TODOS sus consumidores en cada 'games:changed' — la columna
// de navegación, el Backlog flow de Stats, el "ya lo tienes" del buscador y
// la SagaSection de cualquier ficha abierta. La pantalla del Plan, que sí
// necesita sinopsis/notas/etiquetas, usa usePlannedGamesWithExtras (abajo).
// Antes todo viajaba junto y cualquier ficha abierta pagaba 928 KB por
// aviso; la medida completa está en ipc/games.ts.
export const usePlannedGames = (): UseQueryResult<PlannedGameListItem[], Error> =>
  useQuery({
    queryKey: queryKeys.games.planned,
    queryFn: () => window.api.games.getPlanned(),
    staleTime: Infinity,
  });

export type PlannedGamesWithExtras = {
  data: PlannedGameItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
};

// La vista COMPLETA del Plan: la lista escueta + el canal de extras, unidos
// por id. Solo la usa la pantalla del Plan — mientras no está montada, la
// query de extras queda inactiva y sus 591 KB ni se piden ni se clonan en
// los 'games:changed' (TanStack solo refetchea queries con suscriptores).
//
// La unión rellena con null los extras de un id que aún no ha llegado. Solo
// puede pasar en la ventana entre los dos refetches de una invalidación
// (llegan en paralelo pero no en el mismo tick) y solo para una fila RECIÉN
// creada: las filas que ya existían conservan sus extras viejos hasta que
// aterriza el lote nuevo, exactamente como con el canal único.
export const usePlannedGamesWithExtras = (): PlannedGamesWithExtras => {
  const list = usePlannedGames();
  const extras = useQuery({
    queryKey: queryKeys.games.plannedExtras,
    queryFn: () => window.api.games.getPlannedExtras(),
    staleTime: Infinity,
  });

  // useMemo explícito (el compilador también memoizaría): la identidad del
  // array importa — los useMemo de PlanToPlay (splitPlanSections/computePlanDebt)
  // dependen de ella, y el montaje por tandas de esa pantalla repinta decenas
  // de veces seguidas.
  const data = useMemo((): PlannedGameItem[] | undefined => {
    if (!list.data || !extras.data) return undefined;
    const extrasById = new Map(extras.data.map((extra) => [extra.id, extra]));
    return list.data.map((game): PlannedGameItem => {
      const extra = extrasById.get(game.id);
      return extra
        ? { ...game, ...extra }
        : {
            ...game,
            summary: null,
            planNote: null,
            releaseDate: null,
            releaseDatePrecision: null,
            ratingCritics: null,
            ratingCriticsCount: null,
            ratingUsers: null,
            ratingUsersCount: null,
            steamPositive: null,
            steamNegative: null,
            steamTags: null,
          };
    });
  }, [list.data, extras.data]);

  const refetch = async (): Promise<void> => {
    await Promise.all([list.refetch(), extras.refetch()]);
  };

  return {
    data,
    isLoading: list.isLoading || extras.isLoading,
    isError: list.isError || extras.isError,
    refetch,
  };
};

// Fijar y reordenar escriben UNA columna, planPinnedAt, y solo dos consultas
// la leen: getPlannedGames (la lista del Plan) y getGameById (el botón del pin
// en la ficha de un planeado, que la trae en su proyección). Ni getGames ni
// nada más la miran — está fuera de GameListItem a propósito.
//
// Por eso esto NO invalida queryKeys.games.all, que era lo que hacían las dos
// mutations de abajo y es la invalidación más ancha del archivo: el prefijo
// ['games'] arrastra la lista de la biblioteca, que la tarjeta de Now playing
// tiene montada en TODAS las pantallas (MiddleColumn), así que cada pin y cada
// suelta de un arrastre pagaba un getGames entero —8,8 ms en el main y 186 KB
// de las 333 filas cruzando el IPC, medido sobre la biblioteca real— para
// recibir exactamente la misma lista, y encima con identidad de array nueva:
// repintado de la columna de navegación, de Now playing y del modo ambiente
// para nada. El arrastre tampoco es un gesto de una vez: recolocas tres o
// cuatro filas seguidas y esto se pagaba en cada una.
//
// Y tampoco invalida games.plannedExtras: planPinnedAt viaja en la lista
// escueta, así que un pin no puede cambiar nada de lo que va en los extras —
// refetchearlos aquí serían 591 KB por gesto para recibir lo mismo.
const invalidatePlanPinned = (queryClient: QueryClient, ids: readonly number[]): void => {
  queryClient.invalidateQueries({ queryKey: queryKeys.games.planned });
  // La ficha de cada juego movido: PlanGameDetail pinta el estado del pin
  // desde useGame(id), no desde la lista, así que sin esto el botón se
  // quedaría al revés al entrar (o al volver) a la ficha.
  for (const id of ids) {
    queryClient.invalidateQueries({ queryKey: queryKeys.games.detail(id) });
  }
};

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
      const previous = queryClient.getQueryData<PlannedGameListItem[]>(queryKeys.games.planned);
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
      const previous = (context as { previous?: PlannedGameListItem[] } | undefined)?.previous;
      if (previous) queryClient.setQueryData(queryKeys.games.planned, previous);
    },
    onSettled: (_data, _error, { id }) => {
      invalidatePlanPinned(queryClient, [id]);
    },
  });
};

// El MISMO reparto de timestamps que hace el main (reorderUpNext en la
// query): los planPinnedAt existentes, ordenados de antiguo a nuevo, se
// reasignan en el orden nuevo. Duplicado aqui a proposito — es lo que hace
// posible la actualizacion OPTIMISTA de abajo: la cache queda exactamente
// como va a quedar la DB, asi que cuando llegue el refetch no se mueve nada.
//
// Y "el MISMO" incluye el Set: el main deduplica antes de contar porque un
// [A, A] con un solo juego fijado medía 2, se colaba por el guardián y le
// corría la marca 1ms (el porqué entero está en getPlannedGames.ts). Sin el
// Set aquí, esa misma orden malformada haría lo contrario en cada lado — el
// main no escribe nada y devuelve false, mientras la cache se queda con una
// marca inventada hasta que el refetch de onSettled la deshace. Que las dos
// copias cuenten IGUAL es justo lo que sostiene la promesa de arriba.
const reassignPinStamps = (
  games: PlannedGameListItem[],
  orderedIds: number[],
): PlannedGameListItem[] => {
  const byId = new Map(games.map((game) => [game.id, game]));
  const ids = [...new Set(orderedIds)].filter((id) => byId.get(id)?.planPinnedAt != null);
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
      const previous = queryClient.getQueryData<PlannedGameListItem[]>(queryKeys.games.planned);
      if (previous) {
        queryClient.setQueryData(queryKeys.games.planned, reassignPinStamps(previous, orderedIds));
      }
      await cancelled;
      return { previous };
    },
    onError: (_error, _ids, context) => {
      const previous = (context as { previous?: PlannedGameListItem[] } | undefined)?.previous;
      if (previous) queryClient.setQueryData(queryKeys.games.planned, previous);
    },
    onSettled: (_data, _error, orderedIds) => {
      invalidatePlanPinned(queryClient, orderedIds);
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
