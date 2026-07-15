import { ipcRenderer } from 'electron';
import type { TimeFormat } from '../../shared/types';

export const settingsApi = {
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('settings:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setOpenAtLogin', enabled),
  getTimeFormat: (): Promise<TimeFormat> => ipcRenderer.invoke('settings:getTimeFormat'),
  setTimeFormat: (format: TimeFormat): Promise<void> =>
    ipcRenderer.invoke('settings:setTimeFormat', format),
};
