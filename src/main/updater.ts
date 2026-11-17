import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { isMajorUpgrade } from './updateGate';

// Auto-actualización vía GitHub Releases (electron-builder.yml, provider
// github). Flujo pensado para una app de bandeja que puede pasar días sin
// cerrarse: se comprueba al arrancar y cada pocas horas; cuando hay versión
// nueva se descarga sola en segundo plano (diferencial, vía blockmap) y al
// terminar se ofrece reiniciar YA — si se elige "Later", queda lista y se
// instala sola en el próximo cierre real (autoInstallOnAppQuit), sea el
// Quit del tray o un apagado de Windows.
//
// EXCEPCIÓN — EL FRENO DE VERSIÓN MAYOR (puente 1.8, AFTERPLAY-2.0 §19.3, D-07):
// una versión mayor nueva (la 2.0 migra tus datos) NO se descarga ni se instala
// sola. Por eso autoDownload está APAGADO y la descarga se decide en
// 'update-available': las menores y parches llaman a downloadUpdate() ellos
// mismos (mismo comportamiento de antes) y las mayores preguntan primero. Si se
// rechaza, no se descarga nada y se vuelve a preguntar en la próxima
// comprobación (cada CHECK_INTERVAL_MS).
//
// En Windows funciona sin firmar: electron-updater verifica el sha512 del
// manifiesto (latest.yml) de la release. SmartScreen solo molesta en la
// primera instalación manual, nunca en las actualizaciones.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let promptShown = false;
// Hay una pregunta de versión mayor en pantalla: las comprobaciones siguientes
// no deben apilar otra encima.
let majorPromptOpen = false;
// La mayor ya se aceptó: su descarga termina en instalar y reiniciar, sin el
// "Later" de las menores (instalarla "en el próximo cierre" sería justo el
// auto-install que el freno prohíbe).
let majorAccepted = false;

const askMajorUpgrade = async (version: string): Promise<void> => {
  if (majorPromptOpen || majorAccepted) return;
  majorPromptOpen = true;
  try {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'Afterplay',
      message: 'Afterplay 2 is ready and migrates your data. Now?',
      detail: `Version ${version}. Nothing is installed until you accept; if you decline, you will be asked again later.`,
      buttons: ['Update now', 'Later'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) return;
    majorAccepted = true;
    await autoUpdater.downloadUpdate();
  } catch (error) {
    majorAccepted = false;
    console.warn(
      '[updater] fallo descargando la version mayor (se vuelve a preguntar luego):',
      error,
    );
  } finally {
    majorPromptOpen = false;
  }
};

export const startAutoUpdater = (): void => {
  // En dev no existe app-update.yml (lo genera electron-builder al
  // empaquetar) y electron-updater lanzaría al comprobar — no aplica.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (isMajorUpgrade(app.getVersion(), info.version)) {
      // Una descarga diferida de una menor anterior no se mezcla con esto: la
      // mayor manda y se pregunta.
      void askMajorUpgrade(info.version);
      return;
    }
    autoUpdater.downloadUpdate().catch((error: unknown) => {
      console.warn('[updater] fallo descargando la actualizacion (reintento luego):', error);
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (isMajorUpgrade(app.getVersion(), info.version)) {
      // Ya aceptada en askMajorUpgrade: se instala ahora (before-quit marca
      // isQuitting, así que el cierre real pasa el interceptor de la X).
      if (majorAccepted) autoUpdater.quitAndInstall();
      return;
    }
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
