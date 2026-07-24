import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  AddSpendEventInput,
  SpendEvent,
  SpendEventSummary,
  UpdateSpendEventPatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// Bloque 5B — todos los gastos de la biblioteca (para Total Spent / Avg
// Cost per Hour, con o sin filtro de año). Misma historia que useGames()/
// useSessions(): staleTime Infinity, invalidada por las mutations de aquí.
export const useSpendEvents = (): UseQueryResult<SpendEventSummary[], Error> =>
  useQuery({
    queryKey: queryKeys.spend.all,
    queryFn: () => window.api.spend.getAll(),
    staleTime: Infinity,
  });

// ['games'] cascada al detalle del juego (cambia totalSpend/costPerHour).
export const useAddSpend = (): UseMutationResult<SpendEvent, Error, AddSpendEventInput, unknown> =>
  useInvalidatingMutation(
    (input: AddSpendEventInput) => window.api.spend.add(input),
    [queryKeys.games.all, queryKeys.spend.all],
  );

export const useDeleteSpendEvent = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (id: number) => window.api.spend.delete(id),
    [queryKeys.games.all, queryKeys.spend.all],
  );

export const useUpdateSpendEvent = (): UseMutationResult<
  SpendEvent | null,
  Error,
  { id: number; patch: UpdateSpendEventPatch },
  unknown
> =>
  useInvalidatingMutation(
    ({ id, patch }: { id: number; patch: UpdateSpendEventPatch }) =>
      window.api.spend.update(id, patch),
    [queryKeys.games.all, queryKeys.spend.all],
  );
