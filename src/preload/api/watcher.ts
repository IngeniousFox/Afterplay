import { ipcRenderer } from 'electron';

export const watcherApi = {
  // El main emite 'games:changed' tras persistir un arranque o cierre de
  // sesión detectado por el watcher (Bloque 3D). Devuelve la función de
  // limpieza que quita el listener, para encajar con el cleanup de useEffect.
  onGamesChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('games:changed', listener);
    return () => ipcRenderer.removeListener('games:changed', listener);
  },
};
