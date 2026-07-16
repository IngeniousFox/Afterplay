import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateEmulatorInput, Emulator } from '../../../shared/types';
import { queryKeys } from './queryKeys';

// EMULADORES.md — emuladores registrados (Ajustes). staleTime Infinity como
// el resto: solo cambian por las mutations de aquí, que invalidan la key.
export const useEmulators = (): UseQueryResult<Emulator[], Error> =>
  useQuery({
    queryKey: queryKeys.emulators.all,
    queryFn: () => window.api.emulators.getAll(),
    staleTime: Infinity,
  });

export const useCreateEmulator = (): UseMutationResult<
  Emulator,
  Error,
  CreateEmulatorInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmulatorInput) => window.api.emulators.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.emulators.all });
    },
  });
};

export const useDeleteEmulator = (): UseMutationResult<boolean, Error, number, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => window.api.emulators.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.emulators.all });
      // Borrar un emulador se lleva sus sesiones pendientes (ver
      // deleteEmulator) — la bandeja debe refrescarse también.
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
};
