import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

export const useOpenAtLogin = (): UseQueryResult<boolean, Error> =>
  useQuery({
    queryKey: queryKeys.settings.openAtLogin,
    queryFn: () => window.api.settings.getOpenAtLogin(),
  });

export const useSetOpenAtLogin = (): UseMutationResult<void, Error, boolean, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => window.api.settings.setOpenAtLogin(enabled),
    onSuccess: (_data, enabled) => {
      // Es un ajuste del sistema operativo, no algo que vaya a cambiar por
      // otra vía — basta con fijar el valor que ya sabemos correcto, sin
      // necesidad de invalidar y volver a pedirlo.
      queryClient.setQueryData(queryKeys.settings.openAtLogin, enabled);
    },
  });
};
