import { ipcRenderer } from 'electron';
import type {
  CredentialsValues,
  OverlayShortcutStatus,
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
  // null = el último ciclo de sync fue bien (o todavía no hubo ninguno).
  getSyncFailure: (): Promise<SyncFailureInfo | null> =>
    ipcRenderer.invoke('settings:getSyncFailure'),
  getCredentials: (): Promise<CredentialsValues> => ipcRenderer.invoke('settings:getCredentials'),
  // Devuelve los valores ya guardados (normalizados: '' pasa a null).
  setCredentials: (input: CredentialsValues): Promise<CredentialsValues> =>
    ipcRenderer.invoke('settings:setCredentials', input),
};
