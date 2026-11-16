import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { GameInstallInfo } from '../../../shared/devices';
import { planPinOrder } from '../../../shared/planPinOrder';
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
import type { GameId } from '../../../shared/entityIds';

// Infinity y no un número arbitrario: la regla de la casa es que NADIE
// invalida a mano. Todo lo que cambia la tabla `games` (y las que cuelgan de
// ella) pasa por la puerta de escritura del main, y esa avisa con UN solo
// evento, 'data:changed', cuando la transacción se confirma: las mutaciones de
// este archivo, el watcher al abrir o cerrar una sesión, y cada página que
// baja del sync desde otro PC (con su origen: 'local', 'watcher' o 'sync').
// Un oyente por ventana (useDataChangedSync) lo traduce a invalidaciones con la
// tabla dominio -> consultas de domainQueryKeys.ts, y por eso el staleTime
// aguanta sin que este archivo conozca a ninguno de ellos.
//
// Por eso las mutaciones de aquí no invalidan nada: el aviso sale de la propia
// escritura y llega ANTES que la respuesta del IPC. Lo que SÍ se queda aquí son
// las actualizaciones optimistas (el pin del Plan), que existen por la
// sensación al soltar y no por la frescura.
//
// LO QUE HOY NO CUMPLE LA REGLA: el "calentado" del alta (warmSteamData,
// main/external/warmNewGame.ts) es fire-and-forget y escribe etiquetas y
// reseñas de Steam cuando la tienda contesta; si esa escritura no pasa por la
// puerta, no avisa, y el juego recién añadido se queda sin sus chips hasta que
// otra cosa invalide ['games']. El arreglo es suyo, no de aquí.
export const useGames = (): UseQueryResult<GameListItem[], Error> =>
  useQuery({
    queryKey: queryKeys.games.all,
    queryFn: () => window.api.games.getAll(),
    staleTime: Infinity,
  });

// Mismo staleTime Infinity que useGames (ver su comentario): su key
// ['games', 'detail', id] cuelga del prefijo ['games'], así que toda invalidación de
// games.all (mutations + watcher) la refresca también — sin esto, refetcheaba
// de más en cada mount/focus sin ningún cambio real detrás.
//
// `null` = un id que no se pudo leer de la ruta (parseEntityId): no hay ficha
// que pedir, y la pantalla cae en su rama de "no existe", igual que con un id
// que no casa con ninguna fila.
export const useGame = (id: GameId | null): UseQueryResult<GameDetail | null, Error> =>
  useQuery({
    queryKey: queryKeys.games.detail(id),
    queryFn: () => window.api.games.getById(id as GameId),
    enabled: id !== null,
    staleTime: Infinity,
  });

// Sección Plan to Play — la contrapartida de useGames(): solo los juegos
// planeados (que useGames() nunca trae). Mismo staleTime Infinity: su key
// vive bajo el prefijo ['games'], así que todas las invalidaciones de
// games.all la refrescan también.
//
// Devuelve el canal ESCUETO (PlannedGameListItem, 354 KB de 661 filas): es
// lo que pagan TODOS sus consumidores en cada 'data:changed' — la columna
// de navegación, el Backlog flow de Stats, el "ya lo tienes" del buscador y
// la SagaSection de cualquier ficha abierta. La pantalla del Plan, que sí
// necesita sinopsis/notas/etiquetas, usa usePlannedGamesWithExtras (abajo).
// Antes todo viajaba junto y cualquier ficha abierta pagaba 928 KB por
// aviso; la medida completa está en ipc/games.ts.
export const plannedGamesQueryOptions = {
  queryKey: queryKeys.games.planned,
  queryFn: () => window.api.games.getPlanned(),
  staleTime: Infinity,
};

export const usePlannedGames = (): UseQueryResult<PlannedGameListItem[], Error> =>
  useQuery(plannedGamesQueryOptions);

export type PlannedGamesWithExtras = {
  data: PlannedGameItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
};

// La vista COMPLETA del Plan: la lista escueta + el canal de extras, unidos
// por id. Solo la usa la pantalla del Plan — mientras no está montada, la
// query de extras queda inactiva y sus 591 KB ni se piden ni se clonan en
// los 'data:changed' (TanStack solo refetchea queries con suscriptores).
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
  { id: GameId; pinned: boolean },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: GameId; pinned: boolean }) =>
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
  });
};

// La asignación vive en shared/planPinOrder: el arrastre optimista y el
// commit de SQLite comparten ahora la regla, incluidos ids repetidos,
// desconocidos y pines que se soltaron mientras se arrastraba.
const reassignPinStamps = (
  games: PlannedGameListItem[],
  orderedIds: GameId[],
): PlannedGameListItem[] => {
  const stampById = planPinOrder(games, orderedIds);
  if (stampById.size === 0) return games;
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
export const useReorderUpNext = (): UseMutationResult<boolean, Error, GameId[], unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: GameId[]) => window.api.games.reorderUpNext(orderedIds),
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
  });
};

export const useCreatePlannedGame = (): UseMutationResult<
  GameRow,
  Error,
  CreatePlannedGameInput,
  unknown
> =>
  useMutation({
    mutationFn: (input: CreatePlannedGameInput) => window.api.games.createPlanned(input),
  });

// El juego cambia de lista (planned -> library) y puede traer gasto y
// eventos nuevos — games.all cascada a planned/detail por prefijo, pero
// spend/stateEvents viven en keys propias.
export const usePromotePlannedGame = (): UseMutationResult<
  GameRow,
  Error,
  PromotePlannedGameInput,
  unknown
> =>
  useMutation({ mutationFn: (input: PromotePlannedGameInput) => window.api.games.promote(input) });

export const useMoveToPlan = (): UseMutationResult<GameRow, Error, GameId, unknown> =>
  useMutation({ mutationFn: (gameId: GameId) => window.api.games.moveToPlan(gameId) });

export const useCreateGameWithDetails = (): UseMutationResult<
  GameRow,
  Error,
  CreateGameWithDetailsInput,
  unknown
> =>
  useMutation({
    mutationFn: (input: CreateGameWithDetailsInput) => window.api.games.createWithDetails(input),
  });

// Invalidar games.all (['games']) ya cascada por prefijo a ['games', 'detail', id] —
// no hace falta invalidar las dos keys a mano.
export const useUpdateGame = (): UseMutationResult<
  GameRow | null,
  Error,
  { id: GameId; patch: UpdateGamePatch },
  unknown
> =>
  useMutation({
    mutationFn: ({ id, patch }: { id: GameId; patch: UpdateGamePatch }) =>
      window.api.games.update(id, patch),
  });

// Borrar un juego arrastra en cascada (ON DELETE CASCADE) sus playthroughs,
// sesiones, eventos de estado, gastos, logros, curiosidades y partidas. La
// puerta de escritura avisa de cada tabla que recibe lápida, así que 'data:changed'
// trae todos esos dominios y no hay que listarlos aquí.
export const useDeleteGame = (): UseMutationResult<boolean, Error, GameId, unknown> =>
  useMutation({ mutationFn: (id: GameId) => window.api.games.delete(id) });

// Conversión a endless (EditGameModal): limpia desenlaces/marcadores del
// juego conservando sesiones y horas — toca juegos, sesiones (borra
// marcadores) e historial de estados a la vez, de ahí las tres claves.
export const useResetEndlessState = (): UseMutationResult<boolean, Error, GameId, unknown> =>
  useMutation({ mutationFn: (id: GameId) => window.api.games.resetEndlessState(id) });

// Sin invalidación: lanzar el .exe no cambia ningún dato — la sesión (si el
// lanzamiento sale bien) la abre ActionBar por separado, con su propia
// mutation de siempre.
//
// Recibe el id del juego y no una ruta (§11.4): el main resuelve el ejecutable
// de la instalación de ESTE PC.
export const useLaunchExecutable = (): UseMutationResult<
  LaunchExecutableResult,
  Error,
  GameId,
  unknown
> =>
  useMutation({
    mutationFn: (gameId: GameId) => window.api.games.launchExecutable(gameId),
  });

// Botón "abrir carpeta" del detalle — sin invalidación, mismo motivo que
// useLaunchExecutable: abrir el explorador de archivos no cambia ningún dato.
export const useOpenInstallDirectory = (): UseMutationResult<
  LaunchExecutableResult,
  Error,
  GameId,
  unknown
> =>
  useMutation({
    mutationFn: (gameId: GameId) => window.api.games.openInstallDirectory(gameId),
  });

// Las instalaciones del juego para la ficha (§11.3, §11.4): en qué dispositivos
// está (sin rutas) y si el ejecutable de este PC existe. Comprobar es leer el
// disco, así que NO se queda cacheado para siempre: staleTime 0 y se relee al
// montar y al volver a la ventana — mover el juego fuera de Afterplay y volver
// es justo cuando hace falta enterarse.
export const useGameInstallInfo = (id: GameId | null): UseQueryResult<GameInstallInfo, Error> =>
  useQuery({
    queryKey: queryKeys.games.installInfo(id),
    queryFn: () => window.api.games.getInstallInfo(id as GameId),
    enabled: id !== null,
    staleTime: 0,
  });
