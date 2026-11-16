import { invoke, subscribe } from '../ipc';
import type {
  CredentialsImportResult,
  CredentialsValues,
  SaveStorageProvider,
  StorageMigrationProgress,
  OverlayShortcutStatus,
  StartupKeysImport,
  SyncFailureInfo,
  TimeFormat,
} from '../../shared/types';

export const settingsApi = {
  getOpenAtLogin: (): Promise<boolean> => invoke('settings:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean): Promise<void> => invoke('settings:setOpenAtLogin', enabled),
  getTimeFormat: (): Promise<TimeFormat> => invoke('settings:getTimeFormat'),
  setTimeFormat: (format: TimeFormat): Promise<void> => invoke('settings:setTimeFormat', format),
  // Modo ambiente: minutos de inactividad antes de entrar, 0 = apagado.
  getAmbientIdleMinutes: (): Promise<number> => invoke('settings:getAmbientIdleMinutes'),
  setAmbientIdleMinutes: (minutes: number): Promise<void> =>
    invoke('settings:setAmbientIdleMinutes', minutes),
  // Overlay in-game (OVERLAY.md §12).
  getOverlayEnabled: (): Promise<boolean> => invoke('settings:getOverlayEnabled'),
  setOverlayEnabled: (enabled: boolean): Promise<void> =>
    invoke('settings:setOverlayEnabled', enabled),
  getOverlayShortcut: (): Promise<string> => invoke('settings:getOverlayShortcut'),
  setOverlayShortcut: (accelerator: string): Promise<void> =>
    invoke('settings:setOverlayShortcut', accelerator),
  getOverlayShortcutStatus: (): Promise<OverlayShortcutStatus> =>
    invoke('settings:getOverlayShortcutStatus'),
  // Cadencia y retención de la copia local automática.
  getBackupIntervalHours: (): Promise<number> => invoke('settings:getBackupIntervalHours'),
  setBackupIntervalHours: (hours: number): Promise<void> =>
    invoke('settings:setBackupIntervalHours', hours),
  getBackupCount: (): Promise<number> => invoke('settings:getBackupCount'),
  setBackupCount: (count: number): Promise<void> => invoke('settings:setBackupCount', count),
  // null = el último ciclo de sync fue bien (o todavía no hubo ninguno).
  getSyncFailure: (): Promise<SyncFailureInfo | null> => invoke('settings:getSyncFailure'),
  getCredentials: (): Promise<CredentialsValues> => invoke('settings:getCredentials'),
  getSaveStorageProvider: (): Promise<SaveStorageProvider> =>
    invoke('settings:getSaveStorageProvider'),
  // Devuelve los valores ya guardados (normalizados: '' pasa a null).
  setCredentials: (
    input: CredentialsValues,
    provider?: SaveStorageProvider,
  ): Promise<CredentialsValues> => invoke('settings:setCredentials', input, provider),
  onStorageMigrationProgress: (
    callback: (progress: StorageMigrationProgress) => void,
  ): (() => void) => subscribe('settings:storageMigrationProgress', callback),
  // Llevarse las claves a otro PC (main/config/credentials.ts): exportar
  // escribe afterplay-keys.json en la carpeta elegida y devuelve su ruta;
  // importar lo lee del fichero elegido y FUSIONA con lo que ya hubiera.
  exportCredentials: (directory: string): Promise<string> =>
    invoke('settings:exportCredentials', directory),
  importCredentials: (filePath: string): Promise<CredentialsImportResult> =>
    invoke('settings:importCredentials', filePath),
  // Qué pasó con el fichero soltado en la carpeta de datos, si lo había:
  // null cuando no había ninguno (o cuando ya se preguntó una vez).
  getStartupKeysImport: (): Promise<StartupKeysImport | null> =>
    invoke('settings:getStartupKeysImport'),
  openDataFolder: (): Promise<void> => invoke('settings:openDataFolder'),
};
