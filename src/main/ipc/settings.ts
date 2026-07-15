import { app, ipcMain } from 'electron';
import { getConfigValue, setConfigValue } from '../config/store';
import type { TimeFormat } from '../../shared/types';

// SPEC 3E — "iniciar con Windows" como opción activable desde el modal de
// ajustes, no forzada al primer arranque. app.setLoginItemSettings es la API
// nativa de Electron: persiste a nivel de sistema operativo (registro de
// Windows), no en la DB de la app.
export const registerSettingsHandlers = (): void => {
  ipcMain.handle('settings:getOpenAtLogin', () => app.getLoginItemSettings().openAtLogin);

  ipcMain.handle('settings:setOpenAtLogin', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  // Formato de hora (12h/24h) — preferencia de la app, no del sistema
  // operativo: se persiste en config/store.ts, no en el registro.
  ipcMain.handle('settings:getTimeFormat', () => getConfigValue('timeFormat'));

  ipcMain.handle('settings:setTimeFormat', (_event, format: TimeFormat) => {
    setConfigValue('timeFormat', format);
  });
};
