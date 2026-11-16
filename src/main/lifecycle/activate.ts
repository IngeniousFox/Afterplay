import { app, BrowserWindow } from 'electron';
import { createWindow } from '../windows/mainWindow';

export const registerActivate = (): void => {
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
};
