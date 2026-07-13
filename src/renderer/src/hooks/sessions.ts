import type { UseMutationResult } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddManualSessionInput, Session } from '../../../shared/types';
import { queryKeys } from './queryKeys';

export const useAddSession = (): UseMutationResult<
  Session,
  Error,
  AddManualSessionInput,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddManualSessionInput) => window.api.sessions.add(input),
    onSuccess: () => {
      // Una sesión nueva cambia totalHours/isLive/sessionCount del juego.
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
    },
  });
};
