import type { UseMutationResult } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// Compartido por las ~21 mutations de games/sessions/iterations/emulators/
// spend/stateEvents.ts que repetían el mismo patrón: useMutation + invalidar
// una lista fija de queryKeys al terminar, sin usar el resultado ni las
// variables en el onSuccess. Cada caller sigue eligiendo SU PROPIA lista de
// keys a invalidar — el motivo de cada elección vive en el comentario de su
// propio hook (no aquí), este helper solo evita repetir el useMutation +
// bucle de invalidateQueries.
export const useInvalidatingMutation = <TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidateKeys: readonly (readonly unknown[])[],
): UseMutationResult<TData, Error, TVariables, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
};
