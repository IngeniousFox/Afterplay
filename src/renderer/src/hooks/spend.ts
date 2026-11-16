import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AddSpendEventInput,
  SpendEvent,
  SpendEventSummary,
  UpdateSpendEventPatch,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import type { SpendEventId } from '../../../shared/entityIds';

// Bloque 5B — todos los gastos de la biblioteca (para Total Spent / Avg
// Cost per Hour, con o sin filtro de año). Misma historia que useGames()/
// useSessionStats(): staleTime Infinity, invalidada por las mutations de aquí.
export const spendQueryOptions = {
  queryKey: queryKeys.spend.all,
  queryFn: () => window.api.spend.getAll(),
  staleTime: Infinity,
};

export const useSpendEvents = (): UseQueryResult<SpendEventSummary[], Error> =>
  useQuery(spendQueryOptions);

// ['games'] cascada al detalle del juego (cambia totalSpend/costPerHour).
export const useAddSpend = (): UseMutationResult<SpendEvent, Error, AddSpendEventInput, unknown> =>
  useMutation({ mutationFn: (input: AddSpendEventInput) => window.api.spend.add(input) });

export const useDeleteSpendEvent = (): UseMutationResult<boolean, Error, SpendEventId, unknown> =>
  useMutation({ mutationFn: (id: SpendEventId) => window.api.spend.delete(id) });

export const useUpdateSpendEvent = (): UseMutationResult<
  SpendEvent | null,
  Error,
  { id: SpendEventId; patch: UpdateSpendEventPatch },
  unknown
> =>
  useMutation({
    mutationFn: ({ id, patch }: { id: SpendEventId; patch: UpdateSpendEventPatch }) =>
      window.api.spend.update(id, patch),
  });
