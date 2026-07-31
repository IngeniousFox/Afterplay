import { ipcRenderer } from 'electron';

export const windowApi = {
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
};
