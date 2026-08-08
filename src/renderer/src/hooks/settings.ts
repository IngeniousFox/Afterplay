import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CredentialsValues,
  OverlayShortcutStatus,
  SyncFailureInfo,
  TimeFormat,
} from '../../../shared/types';
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
// La versión instalada (SPEC: pie de Ajustes). staleTime Infinity: no hay
// forma de que cambie mientras la app vive — solo con una actualización, que
// reinicia el proceso entero y con él cualquier caché.
export const useAppVersion = (): UseQueryResult<string, Error> =>
  useQuery({
    queryKey: queryKeys.window.version,
    queryFn: () => window.api.window.getVersion(),
    staleTime: Infinity,
  });

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

// Minutos sin tocar la app antes de que entre el modo ambiente. 0 = apagado
// del todo, y ese caso lo trata AmbientMode (no monta ni el temporizador).
export const useAmbientIdleMinutes = (): UseQueryResult<number, Error> =>
  useQuery({
    queryKey: queryKeys.settings.ambientIdleMinutes,
    queryFn: () => window.api.settings.getAmbientIdleMinutes(),
    staleTime: Infinity,
  });

export const useSetAmbientIdleMinutes = (): UseMutationResult<void, Error, number, unknown> =>
  useSettingMutation(
    (minutes: number) => window.api.settings.setAmbientIdleMinutes(minutes),
    queryKeys.settings.ambientIdleMinutes,
  );

// Cadencia y retención de la copia local automática (db/dailyBackup.ts) — sin
// efecto en caliente: la próxima comprobación es en el próximo arranque, no
// hay nada que despertar aquí.
export const useBackupIntervalHours = (): UseQueryResult<number, Error> =>
  useQuery({
    queryKey: queryKeys.settings.backupIntervalHours,
    queryFn: () => window.api.settings.getBackupIntervalHours(),
    staleTime: Infinity,
  });

export const useSetBackupIntervalHours = (): UseMutationResult<void, Error, number, unknown> =>
  useSettingMutation(
    (hours: number) => window.api.settings.setBackupIntervalHours(hours),
    queryKeys.settings.backupIntervalHours,
  );

export const useBackupCount = (): UseQueryResult<number, Error> =>
  useQuery({
    queryKey: queryKeys.settings.backupCount,
    queryFn: () => window.api.settings.getBackupCount(),
    staleTime: Infinity,
  });

export const useSetBackupCount = (): UseMutationResult<void, Error, number, unknown> =>
  useSettingMutation(
    (count: number) => window.api.settings.setBackupCount(count),
    queryKeys.settings.backupCount,
  );

// Overlay in-game (OVERLAY.md §12). Las mutations de esta pareja invalidan
// ADEMÁS el estado del atajo: encender el toggle o cambiar el accelerator
// re-registra en el main, y el "shortcut in use by another app" de Ajustes
// tiene que reflejar el resultado nuevo, no el de antes del cambio.
export const useOverlayEnabled = (): UseQueryResult<boolean, Error> =>
  useQuery({
    queryKey: queryKeys.settings.overlayEnabled,
    queryFn: () => window.api.settings.getOverlayEnabled(),
    staleTime: Infinity,
  });

export const useSetOverlayEnabled = (): UseMutationResult<void, Error, boolean, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => window.api.settings.setOverlayEnabled(enabled),
    onSuccess: (_data, enabled) => {
      queryClient.setQueryData(queryKeys.settings.overlayEnabled, enabled);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.overlayShortcutStatus });
    },
  });
};

export const useOverlayShortcut = (): UseQueryResult<string, Error> =>
  useQuery({
    queryKey: queryKeys.settings.overlayShortcut,
    queryFn: () => window.api.settings.getOverlayShortcut(),
    staleTime: Infinity,
  });

export const useSetOverlayShortcut = (): UseMutationResult<void, Error, string, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accelerator: string) => window.api.settings.setOverlayShortcut(accelerator),
    onSuccess: (_data, accelerator) => {
      queryClient.setQueryData(queryKeys.settings.overlayShortcut, accelerator);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.overlayShortcutStatus });
    },
  });
};

// staleTime 0 a propósito, al revés que el resto de la familia: el estado
// del atajo cambia por fuera de las mutations (arranca un juego → el main
// registra; otro programa se adelanta → conflicto), así que cada apertura
// de Ajustes vuelve a preguntar.
export const useOverlayShortcutStatus = (): UseQueryResult<OverlayShortcutStatus, Error> =>
  useQuery({
    queryKey: queryKeys.settings.overlayShortcutStatus,
    queryFn: () => window.api.settings.getOverlayShortcutStatus(),
    staleTime: 0,
  });

// Estado del sync con Turso. A diferencia del resto de esta familia SÍ se
// refresca sola cada medio minuto: es lo único de Ajustes que cambia por su
// cuenta (el ciclo de sync corre en el main cada 60s) y la gracia es
// enterarse de un fallo persistente sin tener que reabrir nada.
export const useSyncFailure = (): UseQueryResult<SyncFailureInfo | null, Error> =>
  useQuery({
    queryKey: queryKeys.settings.syncFailure,
    queryFn: () => window.api.settings.getSyncFailure(),
    refetchInterval: 30_000,
  });

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
