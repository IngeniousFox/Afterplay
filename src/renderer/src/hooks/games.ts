import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateGameInput,
  GameDetail,
  GameListItem,
  GameRow,
  StateEvent,
  UpdateGamePatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Infinity y no un número arbitrario: la única forma en que cambian estos
// datos AHORA MISMO es a través de las mutations de este mismo archivo
// (create/update/delete/addStateEvent/addSpend/addSession), y todas
// invalidan queryKeys.games.all al terminar. Nada más escribe en `games`
// por detrás, así que no hay ningún "después de X minutos podría estar
// desactualizado" real — solo "después de una mutation, que ya se avisa".
//
// OJO: esto deja de ser cierto en cuanto exista el watcher del Bloque 3 —
// ese proceso escribirá sesiones directo desde el main, sin pasar por
// ninguna mutation de aquí, así que el caché SÍ podrá quedarse desactualizado
// sin que nadie lo invalide (isLive, totalHours...). Cuando llegue ese
// bloque, esto necesita o un staleTime finito de verdad, o que el main
// empuje un evento al renderer para invalidar cuando el watcher detecte algo.
export const useGames = (): UseQueryResult<GameListItem[], Error> =>
  useQuery({
    queryKey: queryKeys.games.all,
    queryFn: () => window.api.games.getAll(),
    staleTime: Infinity,
  });

export const useGame = (id: number): UseQueryResult<GameDetail | null, Error> =>
  useQuery({
    queryKey: queryKeys.games.detail(id),
    queryFn: () => window.api.games.getById(id),
  });

export const useCreateGame = (): UseMutationResult<GameRow, Error, CreateGameInput, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGameInput) => window.api.games.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

export const useUpdateGame = (): UseMutationResult<
  GameRow | null,
  Error,
  { id: number; patch: UpdateGamePatch },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateGamePatch }) =>
      window.api.games.update(id, patch),
    onSuccess: () => {
      // Invalidar games.all (['games']) ya cascada por prefijo a
      // ['games', id] — no hace falta invalidar las dos keys a mano.
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

export const useDeleteGame = (): UseMutationResult<boolean, Error, number, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => window.api.games.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};

type GameStatus = Omit<UseQueryResult<GameDetail | null, Error>, 'data'> & {
  currentState: StateEvent['type'] | null;
  stateHistory: StateEvent[];
};

export const useGameStatus = (id: number): GameStatus => {
  const { data, ...rest } = useGame(id);
  return {
    ...rest,
    currentState: data?.currentState ?? null,
    stateHistory: data?.stateHistory ?? [],
  };
};
