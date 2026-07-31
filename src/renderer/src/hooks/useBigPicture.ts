import { useSyncExternalStore } from 'react';

// El estado de Big Picture en el renderer: un store de módulo (no un
// contexto) porque lo consultan piezas de árboles distintos — el Toaster de
// Afterplay.tsx (fuera del router), ModeBridge (dentro), las pantallas TV —
// y todas deben ver EL MISMO valor sin cablear providers. Mismo espíritu que
// el store del parpadeo de sesión (useSessionClosedToast).
//
// La fuente de verdad es el MAIN (BIG-PICTURE.md §3): aquí solo se refleja.
// Arranca con consulta + suscripción, con la guarda anti-carrera de siempre
// (useWindowVisible): si un evento llega antes que la respuesta a la
// consulta, la foto vieja se descarta.

let active = false;
let started = false;
let eventSeen = false;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const setActive = (value: boolean): void => {
  if (active === value) return;
  active = value;
  emit();
};

const start = (): void => {
  if (started) return;
  started = true;
  window.api.window.bigPicture.onChange((value) => {
    eventSeen = true;
    setActive(value);
  });
  void window.api.window.bigPicture.get().then((value) => {
    if (!eventSeen) setActive(value);
  });
};

const subscribe = (listener: () => void): (() => void) => {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): boolean => active;

export const useBigPicture = (): boolean => useSyncExternalStore(subscribe, getSnapshot);

// Acciones — delgadas a propósito: el main decide, esto solo pide.
export const requestEnterBigPicture = (): void => window.api.window.bigPicture.enter();
export const requestExitBigPicture = (): void => window.api.window.bigPicture.exit();
