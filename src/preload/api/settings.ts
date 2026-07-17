import { ipcRenderer } from 'electron';
import type { CredentialsValues, TimeFormat } from '../../shared/types';

export const settingsApi = {
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('settings:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setOpenAtLogin', enabled),
  getTimeFormat: (): Promise<TimeFormat> => ipcRenderer.invoke('settings:getTimeFormat'),
  setTimeFormat: (format: TimeFormat): Promise<void> =>
    ipcRenderer.invoke('settings:setTimeFormat', format),
  getCredentials: (): Promise<CredentialsValues> => ipcRenderer.invoke('settings:getCredentials'),
  // Devuelve los valores ya guardados (normalizados: '' pasa a null).
  setCredentials: (input: CredentialsValues): Promise<CredentialsValues> =>
    ipcRenderer.invoke('settings:setCredentials', input),
};
