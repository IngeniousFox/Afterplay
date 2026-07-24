import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CredentialsValues, TimeFormat } from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Ajustes del sistema operativo (arrancar con Windows, formato de hora) que
// solo cambian por ESTA vía — basta con fijar el valor que ya se sabe
// correcto en la query al terminar, sin invalidar y volver a pedirlo.
// useSetCredentials no usa esto: su mutation devuelve el valor ya
// normalizado por el main, así que fija ESE resultado, no la variable de
// entrada tal cual (ver más abajo).
const useSettingMutation = <T>(
  mutationFn: (value: T) => Promise<void>,
  key: readonly unknown[],
): UseMutationResult<void, Error, T, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, value) => {
      queryClient.setQueryData(key, value);
    },
  });
};

// staleTime Infinity, igual que useCredentials más abajo: los tres ajustes
// de esta familia solo cambian vía su propia mutation (que ya fija el valor
// con setQueryData), nunca por otra vía — sin esto, refetcheaban de más en
// cada mount/focus sin ningún cambio real detrás.
export const useOpenAtLogin = (): UseQueryResult<boolean, Error> =>
  useQuery({
    queryKey: queryKeys.settings.openAtLogin,
    queryFn: () => window.api.settings.getOpenAtLogin(),
    staleTime: Infinity,
  });

export const useSetOpenAtLogin = (): UseMutationResult<void, Error, boolean, unknown> =>
  useSettingMutation(
    (enabled: boolean) => window.api.settings.setOpenAtLogin(enabled),
    queryKeys.settings.openAtLogin,
  );

// 12h/24h, usado por formatByPrecision en cualquier sitio que muestre un
// datetime — ver el slider en SettingsModal.
export const useTimeFormat = (): UseQueryResult<TimeFormat, Error> =>
  useQuery({
    queryKey: queryKeys.settings.timeFormat,
    queryFn: () => window.api.settings.getTimeFormat(),
    staleTime: Infinity,
  });

export const useSetTimeFormat = (): UseMutationResult<void, Error, TimeFormat, unknown> =>
  useSettingMutation(
    (format: TimeFormat) => window.api.settings.setTimeFormat(format),
    queryKeys.settings.timeFormat,
  );

// Credenciales de servicios externos (ver main/config/credentials.ts) —
// deciden qué funciona (búsqueda IGDB, carátulas SGDB, sync Turso) y guían
// el primer arranque (NavRail abre Ajustes si falta IGDB).
export const useCredentials = (): UseQueryResult<CredentialsValues, Error> =>
  useQuery({
    queryKey: queryKeys.settings.credentials,
    queryFn: () => window.api.settings.getCredentials(),
    staleTime: Infinity,
  });

export const useSetCredentials = (): UseMutationResult<
  CredentialsValues,
  Error,
  CredentialsValues,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CredentialsValues) => window.api.settings.setCredentials(input),
    onSuccess: (saved) => {
      // El main devuelve los valores ya normalizados — se fijan directos.
      queryClient.setQueryData(queryKeys.settings.credentials, saved);
    },
  });
};
