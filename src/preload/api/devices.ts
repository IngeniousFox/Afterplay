import { ipcRenderer } from 'electron';
import type { DeviceInfo } from '../../shared/devices';

export const devicesApi = {
  // Los dispositivos vivos, con cuál es este PC (§10.8, §11.4).
  getAll: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('devices:getAll'),
};
