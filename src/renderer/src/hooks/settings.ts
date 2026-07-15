import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeFormat } from '../../../shared/types';
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

// 12h/24h, usado por formatByPrecision en cualquier sitio que muestre un
// datetime — ver el slider en SettingsModal.
export const useTimeFormat = (): UseQueryResult<TimeFormat, Error> =>
  useQuery({
    queryKey: queryKeys.settings.timeFormat,
    queryFn: () => window.api.settings.getTimeFormat(),
  });

export const useSetTimeFormat = (): UseMutationResult<void, Error, TimeFormat, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (format: TimeFormat) => window.api.settings.setTimeFormat(format),
    onSuccess: (_data, format) => {
      queryClient.setQueryData(queryKeys.settings.timeFormat, format);
    },
  });
};
