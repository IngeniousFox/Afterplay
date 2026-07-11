import { ElectronAPI } from '@electron-toolkit/preload';

interface WindowApi {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      window: WindowApi;
    };
  }
}
