import { ipcRenderer } from 'electron';

export const overlayApi = {
  // El renderer avisa de que ya está montado: el main NO enseña la ventana
  // hasta recibirlo (OVERLAY.md §8.3 + la coreografía de main/overlay.ts).
  // Sin este apretón de manos, el aviso de estado llegaba antes de que
  // nadie escuchara y la ventana se enseñaba vacía.
  ready: (): void => ipcRenderer.send('overlay:ready'),
  // Y puede preguntar en qué estado debería estar — el get()+onChange que
  // usa toda la casa para el estado que vive en el main (ver useBigPicture).
  getState: (): Promise<boolean> => ipcRenderer.invoke('overlay:getState'),
  onState: (callback: (visible: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, visible: boolean): void =>
      callback(visible);
    ipcRenderer.on('overlay:state', listener);
    return () => ipcRenderer.removeListener('overlay:state', listener);
  },
  // Esc / clic en el velo / botón de cerrar desde dentro del HUD.
  dismiss: (): void => ipcRenderer.send('overlay:dismiss'),
};
