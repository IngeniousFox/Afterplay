import { invoke, send, subscribe } from '../ipc';

export const overlayApi = {
  // El renderer avisa de que ya está montado: el main NO enseña la ventana
  // hasta recibirlo (OVERLAY.md §8.3 + la coreografía de main/overlay.ts).
  // Sin este apretón de manos, el aviso de estado llegaba antes de que
  // nadie escuchara y la ventana se enseñaba vacía.
  ready: (): void => send('overlay:ready'),
  // Y puede preguntar en qué estado debería estar — el get()+onChange que
  // usa toda la casa para el estado que vive en el main (ver useBigPicture).
  getState: (): Promise<boolean> => invoke('overlay:getState'),
  onState: (callback: (visible: boolean) => void): (() => void) =>
    subscribe('overlay:state', callback),
  // Esc / clic en el velo / botón de cerrar desde dentro del HUD.
  dismiss: (): void => send('overlay:dismiss'),
};
