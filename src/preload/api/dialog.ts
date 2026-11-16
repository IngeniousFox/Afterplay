import { invoke } from '../ipc';
import type { DirectoryPickResult } from '../../shared/types';

export const dialogApi = {
  // null si el usuario cancela el picker.
  pickExecutable: (): Promise<string | null> => invoke('dialog:pickExecutable'),
  pickDirectory: (): Promise<DirectoryPickResult | null> => invoke('dialog:pickDirectory'),
  pickFolder: (): Promise<string | null> => invoke('dialog:pickFolder'),
  // Un archivo suelto, para las memory cards de emulador (ver ipc/dialog.ts).
  pickFile: (): Promise<string | null> => invoke('dialog:pickFile'),
};
