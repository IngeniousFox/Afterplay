import { ipcRenderer } from 'electron';

export const dialogApi = {
  // null si el usuario cancela el picker.
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickExecutable'),
};
