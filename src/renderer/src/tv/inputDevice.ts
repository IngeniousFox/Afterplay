import { useSyncExternalStore } from 'react';

// Con qué se está manejando el modo TV AHORA MISMO: mando, o teclado/ratón.
// Lo alimentan el bucle del gamepad (cualquier acción) y los listeners de
// teclado/puntero del layout; lo consume la leyenda del pie, que enseña Ⓐ/Ⓑ
// o Enter/Esc según quién hablara último — una leyenda de botones de mando
// delante de alguien con ratón es un manual del aparato equivocado.
//
// Store de módulo (como useBigPicture): valor único compartido por quien
// pregunte, sin providers.

export type TvInputDevice = 'gamepad' | 'kbm';

let device: TvInputDevice = 'kbm';
const listeners = new Set<() => void>();

export const setTvInputDevice = (next: TvInputDevice): void => {
  if (device === next) return;
  device = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): TvInputDevice => device;

export const useTvInputDevice = (): TvInputDevice => useSyncExternalStore(subscribe, getSnapshot);

// ── Movimiento REAL del puntero ───────────────────────────────────────────
// Chromium re-despacha eventos de frontera (pointerenter) cuando el layout
// se desliza bajo un cursor QUIETO — p.ej. el scrollIntoView del D-pad
// moviendo la parrilla bajo el ratón aparcado. Sin esta marca, ese enter
// fantasma le devolvía el foco al cursor en cada pulsación del mando (el
// foco "rebotaba"). El hover solo cuenta si el puntero se movió DE VERDAD
// hace un instante.
let lastPointerMoveAt = 0;

export const markRealPointerMove = (): void => {
  lastPointerMoveAt = performance.now();
};

export const pointerMovedRecently = (): boolean => performance.now() - lastPointerMoveAt < 200;
