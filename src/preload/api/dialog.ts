import { ipcRenderer } from 'electron';
import type { DirectoryPickResult } from '../../shared/types';

export const dialogApi = {
  // null si el usuario cancela el picker.
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickExecutable'),
  pickDirectory: (): Promise<DirectoryPickResult | null> =>
    ipcRenderer.invoke('dialog:pickDirectory'),
};
