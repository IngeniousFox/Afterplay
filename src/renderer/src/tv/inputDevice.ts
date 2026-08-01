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

// ── QUÉ MANDO tienes en la mano ───────────────────────────────────────────
// Saber que hay un mando no basta: la leyenda tiene que decir ✕/○ a quien
// juega con un DualShock y A/B a quien juega con un Xbox. Enseñarle "A" al
// del PlayStation es el manual del aparato equivocado — el mismo pecado que
// enseñar botones de mando a quien va con ratón.
//
// El mapping estándar del W3C es POSICIONAL, y ahí está la gracia: el botón
// 0 siempre es el de ABAJO del cluster derecho, sea ✕ (Sony), A (Xbox) o B
// (Nintendo, que los lleva cruzados respecto a Xbox). Así que el motor no
// cambia ni una línea; solo cambia cómo se DIBUJA cada índice.
export type TvPadBrand = 'xbox' | 'playstation' | 'nintendo';

// Xbox por defecto: es el layout que asume Windows (un mando genérico por
// XInput se comporta como uno de Xbox), así que es la apuesta segura hasta
// que un id diga otra cosa.
let padBrand: TvPadBrand = 'xbox';
const brandListeners = new Set<() => void>();

export const setTvPadBrand = (next: TvPadBrand): void => {
  if (padBrand === next) return;
  padBrand = next;
  for (const listener of brandListeners) listener();
};

const subscribeBrand = (listener: () => void): (() => void) => {
  brandListeners.add(listener);
  return () => {
    brandListeners.delete(listener);
  };
};

const getBrandSnapshot = (): TvPadBrand => padBrand;

export const useTvPadBrand = (): TvPadBrand =>
  useSyncExternalStore(subscribeBrand, getBrandSnapshot);

// La marca a partir del id que publica Chromium. El id trae el vendor USB
// entre paréntesis ("… Vendor: 054c Product: 09cc") y ese es el dato duro;
// el nombre suelto es el plan B, porque por Bluetooth a veces llega sin
// vendor y solo con el modelo ("Wireless Controller", "DualSense…").
//
// Ojo con lo que NO se puede detectar: un DualShock pasado por DS4Windows o
// por Steam llega a la app disfrazado de Xbox (es XInput de verdad) y aquí
// se verá como Xbox. Es lo correcto — el propio Windows le está diciendo al
// mundo que es un Xbox, y el resto del sistema le enseñará A/B igual.
export const padBrandFromId = (id: string): TvPadBrand => {
  const value = id.toLowerCase();

  // 054c = Sony, 057e = Nintendo, 045e = Microsoft.
  if (value.includes('vendor: 054c')) return 'playstation';
  if (value.includes('vendor: 057e')) return 'nintendo';
  if (value.includes('vendor: 045e')) return 'xbox';

  if (/dualshock|dualsense|playstation|ps[45]|sony/.test(value)) return 'playstation';
  if (/nintendo|switch|joy-con|pro controller/.test(value)) return 'nintendo';
  return 'xbox';
};

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
