import type { BrowserWindow } from 'electron';
import { screen } from 'electron';
import { getConfigValue, setConfigValue } from '../config/store';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 768;

type WindowBounds = { x: number; y: number; width: number; height: number };

export type WindowStartOptions = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
};

// Trozo mínimo de ventana que tiene que quedar visible en ALGÚN monitor para
// darla por alcanzable — lo justo para verla y agarrarla con el ratón.
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 80;

// ¿La posición guardada sigue siendo alcanzable en algún monitor conectado
// AHORA MISMO? Si se guardó con un segundo monitor que ya no está enchufado,
// o cambió la resolución, restaurarla tal cual dejaría la ventana fuera de la
// pantalla — invisible e inalcanzable sin adivinar Win+flecha a ciegas.
//
// Antes se exigía CONTENCIÓN COMPLETA en un único monitor, y eso reseteaba a
// centrada 1280x768 en cada arranque cualquier ventana a caballo entre dos
// pantallas: no cabía entera en ninguna, aunque su posición fuera perfectamente
// visible. Ahora basta con que un trozo agarrable solape con algún monitor.
const isOnScreen = (bounds: WindowBounds): boolean =>
  screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= MIN_VISIBLE_WIDTH && overlapHeight >= MIN_VISIBLE_HEIGHT;
  });

// Llamar al crear la ventana — mismo tamaño/posición que tenía al cerrarla
// la última vez, o el de siempre (centrado, 1280x768) si es la primera vez
// o el monitor de entonces ya no está.
export const getSavedWindowOptions = (): WindowStartOptions => {
  const bounds = getConfigValue('windowBounds');
  const isMaximized = getConfigValue('windowMaximized');

  if (bounds && isOnScreen(bounds)) {
    return { ...bounds, isMaximized };
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, isMaximized: false };
};

// Guarda tamaño/posición en cada resize/move (con un pequeño margen, no en
// cada píxel arrastrado) y al cerrar de verdad — para que la próxima
// apertura restaure justo donde se quedó.
export const trackWindowState = (window: BrowserWindow): void => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const persist = (): void => {
    if (window.isDestroyed()) return;

    // 'close' salta cada vez que la X minimiza a bandeja (SPEC 3E), no solo
    // al cerrar de verdad — sin este chequeo, escribiría el mismo archivo
    // una y otra vez aunque no hayas movido ni redimensionado nada desde la
    // última vez.
    const isMaximized = window.isMaximized();
    // getNormalBounds(): el tamaño/posición SIN maximizar, incluso con la
    // ventana maximizada ahora mismo — así "restaurar" siempre parte de un
    // tamaño con sentido, nunca de las dimensiones infladas del maximizado.
    const { x, y, width, height } = window.getNormalBounds();

    const previousBounds = getConfigValue('windowBounds');
    const previousMaximized = getConfigValue('windowMaximized');
    const boundsChanged =
      !previousBounds ||
      previousBounds.x !== x ||
      previousBounds.y !== y ||
      previousBounds.width !== width ||
      previousBounds.height !== height;
    if (!boundsChanged && previousMaximized === isMaximized) return;

    setConfigValue('windowMaximized', isMaximized);
    setConfigValue('windowBounds', { x, y, width, height });
  };

  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  // 'close' y no 'closed': la SPEC 3E intercepta 'close' para minimizar a
  // bandeja en vez de cerrar, pero el evento sigue disparándose igual — es
  // el último momento seguro para leer bounds antes de ocultar/destruir.
  window.on('close', persist);
};
