import { net, powerMonitor } from 'electron';
import { appState } from '../bootstrap/appState';
import { isE2E } from '../lib/e2e';
import { watchNetworkBack } from '../sync/networkWatch';

// Bloque 3G / SPEC-2.md §7.2 — bloquear o suspender el PC no es tiempo
// jugado, siga el proceso vivo detrás o no. 'lock-screen'/'unlock-screen'
// son el bloqueo de pantalla (Win+L y su equivalente en macOS);
// 'suspend'/'resume' cubren además el suspendido real y Linux.
//
// Los cuatro llaman a pause()/resume() sin decir de parte de quién, y aquí
// no se decide nada más porque aquí no se puede saber. Que sean
// idempotentes NO basta —es justo lo que este comentario prometía, y era
// falso—: las dos causas comparten un único booleano en el watcher, no se
// llevan cuenta (la segunda pause() sale de vacío), así que con un bloqueo
// Y una suspensión encima bastaba un aviso de vuelta para deshacerlo todo.
// Y al despertar con contraseña Windows manda
// 'resume' ANTES que 'unlock-screen', con lo que todo el rato que tardaras
// en teclearla se contaba como jugado. Ahora resume() solo PIDE la vuelta;
// quien decide es el sondeo del watcher, preguntándole al sistema si la
// pantalla sigue bloqueada (isScreenLocked, en watcher/watcher.ts).
export const registerPowerEvents = (): void => {
  powerMonitor.on('suspend', () => appState.watcher?.pause());
  powerMonitor.on('lock-screen', () => appState.watcher?.pause());
  powerMonitor.on('resume', () => appState.watcher?.resume());
  powerMonitor.on('unlock-screen', () => appState.watcher?.resume());
  // Y el sync (§8.5): volver de la suspensión o desbloquear es el momento de
  // ponerse al día con lo que hicieron los otros PCs, y la red de vuelta tras
  // un corte, el de subir lo pendiente. En un E2E no existe nada de esto.
  if (!isE2E()) {
    powerMonitor.on('resume', () => appState.syncRuntime?.wake());
    powerMonitor.on('unlock-screen', () => appState.syncRuntime?.wake());
    appState.networkWatch = watchNetworkBack({
      isOnline: () => net.isOnline(),
      onBack: () => appState.syncRuntime?.wake(),
    });
  }
};
