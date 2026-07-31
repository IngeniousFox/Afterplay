import { createContext, useContext, useEffect, useRef } from 'react';
import type { TvButton } from './gamepad';

// Los contratos de entrada del modo TV que las PANTALLAS consumen: botones
// contextuales y leyenda. En fichero propio (sin componentes) por la regla
// de Fast Refresh — BigPictureLayout provee estos contextos, las pantallas
// los usan vía los hooks de aquí.

// ── Botones contextuales ──────────────────────────────────────────────────
// Las pantallas registran qué hacen X/Y/LB/RB/LT/RT (y opcionalmente B) con
// useTvButtons; los paneles que se abren encima registran los suyos y GANAN
// (pila, el último manda). A/Start/direcciones no pasan por aquí: son del
// motor de foco y del menú, iguales en toda la app.
export type TvContextButton = Exclude<TvButton, 'a' | 'start'>;
export type TvButtonHandlers = Partial<Record<TvContextButton, () => void>>;
export type HandlersRef = { current: TvButtonHandlers };

// La base de los paneles MODALES (menú Start, panel de sesión, selector de
// estado, OSK): registran no-ops para todo lo contextual, de modo que sus
// botones no atraviesen el velo y actúen sobre la pantalla de debajo (Y
// abriendo el OSK con el menú puesto, LB/RB ciclando filtros invisibles...).
// Cada panel extiende esta base con lo que SÍ maneja: {...TV_MODAL_SWALLOW,
// b: onClose}.
const swallow = (): void => {};
export const TV_MODAL_SWALLOW: TvButtonHandlers = {
  b: swallow,
  x: swallow,
  y: swallow,
  lb: swallow,
  rb: swallow,
  lt: swallow,
  rt: swallow,
  view: swallow,
};

export const TvButtonsContext = createContext<((ref: HandlersRef) => () => void) | null>(null);

export const useTvButtons = (handlers: TvButtonHandlers): void => {
  const register = useContext(TvButtonsContext);
  const handlersRef = useRef(handlers);
  // En efecto y no durante el render (react-hooks/refs): el mando dispara
  // siempre después del commit, así que el ref está fresco cuando importa.
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!register) return;
    return register(handlersRef);
  }, [register]);
};

// ── Leyenda de botones ────────────────────────────────────────────────────
// El pie fijo que hace innecesario cualquier manual (BIG-PICTURE.md §6). La
// base (seleccionar/atrás/menú) es de la casa; cada pantalla añade sus
// extras con useTvLegend.
//
// Las pistas declaran la ACCIÓN, no el glifo: "y → Search". El glifo lo pone
// la leyenda según el dispositivo que hablara último (Ⓨ con mando, F con
// teclado) — ver inputDevice.ts y los mapas del layout. 'lbrb'/'ltrt' son
// los pares compuestos ("LB·RB Filtro") que siempre van juntos.
export type TvHintAction = TvContextButton | 'a' | 'start' | 'lbrb' | 'ltrt';
export type TvHint = { action: TvHintAction; label: string };

export const TvLegendContext = createContext<((hints: TvHint[]) => () => void) | null>(null);

export const useTvLegend = (hints: TvHint[]): void => {
  const register = useContext(TvLegendContext);
  // La leyenda es presentación pura: basta la del último render montado.
  const hintsKey = JSON.stringify(hints);

  useEffect(() => {
    if (!register) return;
    return register(JSON.parse(hintsKey) as TvHint[]);
  }, [register, hintsKey]);
};
