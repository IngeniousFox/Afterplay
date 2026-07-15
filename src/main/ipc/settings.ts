import { app, ipcMain } from 'electron';
import { getConfigValue, setConfigValue } from '../config/store';
import { HIDDEN_LAUNCH_ARG } from '../lib/loginItem';
import type { TimeFormat } from '../../shared/types';

// SPEC 3E — "iniciar con Windows" como opción activable desde el modal de
// ajustes, no forzada al primer arranque. app.setLoginItemSettings es la API
// nativa de Electron: persiste a nivel de sistema operativo (registro de
// Windows), no en la DB de la app.
//
// En Windows se registra con el argumento marcador (HIDDEN_LAUNCH_ARG) para
// que loginItem.ts pueda reconocer luego "esto lo arrancó Windows solo" en
// process.argv — ver ese archivo para el porqué. getLoginItemSettings()
// tiene que consultarse con los MISMOS args que se usaron al registrar, o
// `openAtLogin` viene mal (así lo dice la propia documentación de Electron).
const loginItemQueryOptions =
  process.platform === 'win32' ? { args: [HIDDEN_LAUNCH_ARG] } : undefined;

export const registerSettingsHandlers = (): void => {
  ipcMain.handle(
    'settings:getOpenAtLogin',
    () => app.getLoginItemSettings(loginItemQueryOptions).openAtLogin,
  );

  ipcMain.handle('settings:setOpenAtLogin', (_event, enabled: boolean) => {
    app.setLoginItemSettings(
      process.platform === 'win32'
        ? { openAtLogin: enabled, args: enabled ? [HIDDEN_LAUNCH_ARG] : [] }
        : { openAtLogin: enabled },
    );
  });

  // Formato de hora (12h/24h) — preferencia de la app, no del sistema
  // operativo: se persiste en config/store.ts, no en el registro.
  ipcMain.handle('settings:getTimeFormat', () => getConfigValue('timeFormat'));

  ipcMain.handle('settings:setTimeFormat', (_event, format: TimeFormat) => {
    setConfigValue('timeFormat', format);
  });
};
