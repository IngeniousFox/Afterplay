import { ipcRenderer } from 'electron';
import type {
  CredentialsImportResult,
  CredentialsValues,
  OverlayShortcutStatus,
  StartupKeysImport,
  SyncFailureInfo,
  TimeFormat,
} from '../../shared/types';

export const settingsApi = {
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('settings:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setOpenAtLogin', enabled),
  getTimeFormat: (): Promise<TimeFormat> => ipcRenderer.invoke('settings:getTimeFormat'),
  setTimeFormat: (format: TimeFormat): Promise<void> =>
    ipcRenderer.invoke('settings:setTimeFormat', format),
  // Modo ambiente: minutos de inactividad antes de entrar, 0 = apagado.
  getAmbientIdleMinutes: (): Promise<number> =>
    ipcRenderer.invoke('settings:getAmbientIdleMinutes'),
  setAmbientIdleMinutes: (minutes: number): Promise<void> =>
    ipcRenderer.invoke('settings:setAmbientIdleMinutes', minutes),
  // Overlay in-game (OVERLAY.md §12).
  getOverlayEnabled: (): Promise<boolean> => ipcRenderer.invoke('settings:getOverlayEnabled'),
  setOverlayEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setOverlayEnabled', enabled),
  getOverlayShortcut: (): Promise<string> => ipcRenderer.invoke('settings:getOverlayShortcut'),
  setOverlayShortcut: (accelerator: string): Promise<void> =>
    ipcRenderer.invoke('settings:setOverlayShortcut', accelerator),
  getOverlayShortcutStatus: (): Promise<OverlayShortcutStatus> =>
    ipcRenderer.invoke('settings:getOverlayShortcutStatus'),
  // Cadencia y retención de la copia local automática.
  getBackupIntervalHours: (): Promise<number> =>
    ipcRenderer.invoke('settings:getBackupIntervalHours'),
  setBackupIntervalHours: (hours: number): Promise<void> =>
    ipcRenderer.invoke('settings:setBackupIntervalHours', hours),
  getBackupCount: (): Promise<number> => ipcRenderer.invoke('settings:getBackupCount'),
  setBackupCount: (count: number): Promise<void> =>
    ipcRenderer.invoke('settings:setBackupCount', count),
  // null = el último ciclo de sync fue bien (o todavía no hubo ninguno).
  getSyncFailure: (): Promise<SyncFailureInfo | null> =>
    ipcRenderer.invoke('settings:getSyncFailure'),
  getCredentials: (): Promise<CredentialsValues> => ipcRenderer.invoke('settings:getCredentials'),
  // Devuelve los valores ya guardados (normalizados: '' pasa a null).
  setCredentials: (input: CredentialsValues): Promise<CredentialsValues> =>
    ipcRenderer.invoke('settings:setCredentials', input),
  // Llevarse las claves a otro PC (main/config/credentials.ts): exportar
  // escribe afterplay-keys.json en la carpeta elegida y devuelve su ruta;
  // importar lo lee del fichero elegido y FUSIONA con lo que ya hubiera.
  exportCredentials: (directory: string): Promise<string> =>
    ipcRenderer.invoke('settings:exportCredentials', directory),
  importCredentials: (filePath: string): Promise<CredentialsImportResult> =>
    ipcRenderer.invoke('settings:importCredentials', filePath),
  // Qué pasó con el fichero soltado en la carpeta de datos, si lo había:
  // null cuando no había ninguno (o cuando ya se preguntó una vez).
  getStartupKeysImport: (): Promise<StartupKeysImport | null> =>
    ipcRenderer.invoke('settings:getStartupKeysImport'),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('settings:openDataFolder'),
};
