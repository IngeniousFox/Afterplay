import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { CreateEmulatorInput, Emulator } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

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
> =>
  useInvalidatingMutation(
    (input: CreateEmulatorInput) => window.api.emulators.create(input),
    [queryKeys.emulators.all],
  );

// Borrar un emulador se lleva sus sesiones pendientes (ver deleteEmulator) —
// la bandeja debe refrescarse también.
export const useDeleteEmulator = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (id: number) => window.api.emulators.delete(id),
    [queryKeys.emulators.all, queryKeys.sessions.all],
  );
