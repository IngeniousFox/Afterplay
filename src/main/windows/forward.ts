import type { Contract } from '../../shared/ipc/contract';
import type { EventArgs, EventChannelOf } from '../../shared/ipc/define';
import { emit } from '../ipc/contractHandlers';
import { getMainWindow } from './mainWindow';
import { sendToOverlay } from './overlay';

// ── Reenviar un evento de dominio a la ventana principal ─────────────────
//
// Este cierre estaba escrito SIETE veces (saves, curiosities, memories,
// achievements, external, radar, images), idéntico salvo el canal. El
// precedente de la casa ya estaba sentado del lado del DOMINIO —el mismo
// patrón vivía copiado en cinco módulos y se extrajo a lib/makeNotifier—, pero
// el lado del main seguía a mano: cambiar los destinatarios (lo que ya pasó
// con los logros, que además tienen que llegar al HUD) era una edición en
// siete sitios, y acordarse de los otros seis no lo garantizaba nadie.
//
// `unknown` en vez de un genérico a propósito: una función que acepta
// `unknown` es asignable a cualquier `(event: E) => void`, así que cada setter
// conserva SU tipo de evento sin que este helper tenga que conocerlos.
export const forwardToWindow =
  <C extends EventChannelOf<Contract>>(channel: C) =>
  (...args: EventArgs<Contract[C]>): void => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      emit(mainWindow.webContents, channel, ...args);
    }
  };

// La variante que además llega al HUD del overlay, que es otra ventana con
// otro caché (ver sendToOverlay). Hoy solo la usan los logros — ver allí la
// cicatriz — pero está aquí para que sumar un destino siga siendo una línea.
export const forwardToWindowAndOverlay = <C extends EventChannelOf<Contract>>(channel: C) => {
  const toWindow = forwardToWindow(channel);
  return (...args: EventArgs<Contract[C]>): void => {
    toWindow(...args);
    sendToOverlay(channel, ...args);
  };
};
