import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

// Auto-actualización vía GitHub Releases (electron-builder.yml, provider
// github). Flujo pensado para una app de bandeja que puede pasar días sin
// cerrarse: se comprueba al arrancar y cada pocas horas; cuando hay versión
// nueva se descarga sola en segundo plano (diferencial, vía blockmap) y al
// terminar se ofrece reiniciar YA — si se elige "Later", queda lista y se
// instala sola en el próximo cierre real (autoInstallOnAppQuit), sea el
// Quit del tray o un apagado de Windows.
//
// En Windows funciona sin firmar: electron-updater verifica el sha512 del
// manifiesto (latest.yml) de la release. SmartScreen solo molesta en la
// primera instalación manual, nunca en las actualizaciones.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let promptShown = false;

export const startAutoUpdater = (): void => {
  // En dev no existe app-update.yml (lo genera electron-builder al
  // empaquetar) y electron-updater lanzaría al comprobar — no aplica.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    // Solo un aviso por descarga — el diálogo puede salir con la ventana
    // oculta en la bandeja y no debe apilarse en cada comprobación.
    if (promptShown) return;
    promptShown = true;

    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Afterplay',
        message: `Update ${info.version} is ready`,
        detail: 'It was downloaded in the background. Restart now to apply it?',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        // before-quit ya marca isQuitting, así que el interceptor de la X
        // (minimizar a bandeja) deja pasar este cierre real.
        if (result.response === 0) autoUpdater.quitAndInstall();
        // "Later": autoInstallOnAppQuit la aplica en el próximo cierre.
      });
  });

  autoUpdater.on('error', (error) => {
    // Sin red, GitHub caído, release a medio subir... nunca debe molestar:
    // se reintenta en el próximo ciclo.
    console.warn('[updater] fallo comprobando actualizaciones (reintento luego):', error);
  });

  void autoUpdater.checkForUpdates();
  setInterval(() => {
    void autoUpdater.checkForUpdates();
  }, CHECK_INTERVAL_MS);
};
