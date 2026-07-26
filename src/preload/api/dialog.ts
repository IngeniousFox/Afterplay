import { ipcRenderer } from 'electron';
import type { DirectoryPickResult } from '../../shared/types';

export const dialogApi = {
  // null si el usuario cancela el picker.
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickExecutable'),
  pickDirectory: (): Promise<DirectoryPickResult | null> =>
    ipcRenderer.invoke('dialog:pickDirectory'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  // Un archivo suelto, para las memory cards de emulador (ver ipc/dialog.ts).
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFile'),
};
