import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CreateEmulatorInput, Emulator } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import type { EmulatorId } from '../../../shared/entityIds';

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
  useMutation({ mutationFn: (input: CreateEmulatorInput) => window.api.emulators.create(input) });

// Borrar un emulador se lleva sus sesiones pendientes (ver deleteEmulator) —
// la bandeja debe refrescarse también.
export const useDeleteEmulator = (): UseMutationResult<boolean, Error, EmulatorId, unknown> =>
  useMutation({ mutationFn: (id: EmulatorId) => window.api.emulators.delete(id) });
