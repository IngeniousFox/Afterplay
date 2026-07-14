import { app, ipcMain } from 'electron';

// SPEC 3E — "iniciar con Windows" como opción activable desde el modal de
// ajustes, no forzada al primer arranque. app.setLoginItemSettings es la API
// nativa de Electron: persiste a nivel de sistema operativo (registro de
// Windows), no en la DB de la app.
export const registerSettingsHandlers = (): void => {
  ipcMain.handle('settings:getOpenAtLogin', () => app.getLoginItemSettings().openAtLogin);

  ipcMain.handle('settings:setOpenAtLogin', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });
};
