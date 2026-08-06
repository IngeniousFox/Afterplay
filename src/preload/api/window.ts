import { ipcRenderer } from 'electron';

export const windowApi = {
  // La versión instalada — el pie de Ajustes.
  getVersion: (): Promise<string> => ipcRenderer.invoke('window:get-version'),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  onMaximizedChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean): void =>
      callback(isMaximized);
    ipcRenderer.on('window:maximized-change', listener);
    return () => ipcRenderer.removeListener('window:maximized-change', listener);
  },
  onFullscreenChange: (callback: (isFullscreen: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean): void =>
      callback(isFullscreen);
    ipcRenderer.on('window:fullscreen-change', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-change', listener);
  },
  isVisible: (): Promise<boolean> => ipcRenderer.invoke('window:is-visible'),
  onVisibleChange: (callback: (isVisible: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isVisible: boolean): void =>
      callback(isVisible);
    ipcRenderer.on('window:visible-change', listener);
    return () => ipcRenderer.removeListener('window:visible-change', listener);
  },
  // ── Big Picture (BIG-PICTURE.md) ────────────────────────────────────────
  // El estado vive en el main (argv/F11/second-instance nacen allí); aquí
  // solo la consulta inicial + el aviso de cambios — mismo contrato que la
  // visibilidad de arriba.
  bigPicture: {
    get: (): Promise<boolean> => ipcRenderer.invoke('bigpicture:get'),
    enter: (): void => ipcRenderer.send('bigpicture:enter'),
    exit: (): void => ipcRenderer.send('bigpicture:exit'),
    onChange: (callback: (active: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, active: boolean): void =>
        callback(active);
      ipcRenderer.on('bigpicture:changed', listener);
      return () => ipcRenderer.removeListener('bigpicture:changed', listener);
    },
  },
  // El cierre REAL (menú del modo TV) — el close() de arriba solo esconde a
  // la bandeja, por diseño.
  quitApp: (): void => ipcRenderer.send('app:quit'),
};
