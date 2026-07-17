import { ipcRenderer } from 'electron';

export const backupApi = {
  // Devuelve la ruta del fichero creado, o lanza si falla (carpeta sin
  // permisos, disco lleno...) — el renderer lo captura como error de mutation.
  createManual: (directory: string): Promise<string> =>
    ipcRenderer.invoke('backup:createManual', directory),
};
