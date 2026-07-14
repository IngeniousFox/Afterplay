import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateGameInput,
  CreateGameWithDetailsInput,
  GameDetail,
  GameListItem,
  GameRow,
  StateEvent,
  UpdateGamePatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

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

export const useCreateGameWithDetails = (): UseMutationResult<
  GameRow,
  Error,
  CreateGameWithDetailsInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGameWithDetailsInput) => window.api.games.createWithDetails(input),
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
