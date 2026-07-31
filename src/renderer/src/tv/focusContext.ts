import { createContext, useContext, useEffect, useId, useRef } from 'react';
import type { TvDirection } from './gamepad';
import { pointerMovedRecently } from './inputDevice';
import { tvSound } from './sound';

// La mitad SIN componentes del motor de foco (regla de Fast Refresh):
// contratos, contextos y los hooks que consumen las pantallas. La otra mitad
// — TvFocusProvider y TvFocusLayer — vive en focus.tsx, que es quien provee
// estos contextos. La doctrina completa del motor está comentada allí.

export type FocusEntry = {
  id: string;
  element: HTMLElement;
  layer: string;
  autoFocus: boolean;
  onSelect?: () => void;
};

export type TvFocusApi = {
  register: (entry: FocusEntry) => () => void;
  // scroll:false para el foco por RATÓN (hover): perseguir el puntero con
  // scrollIntoView marearía la pantalla entera a cada pasada del cursor.
  // Devuelve si el foco cambió de verdad (para que el hover suene solo
  // cuando mueve algo).
  focusId: (id: string, options?: { scroll?: boolean }) => boolean;
  // Lectura fresca (ref) para decisiones dentro de efectos, sin arrastrar el
  // estado como dependencia.
  getFocusedId: () => string | null;
  // Devuelve si el foco SE MOVIÓ: el layout lo usa para el gesto de borde
  // (izquierda contra el límite de la pantalla = abrir el menú). repeat =
  // eco de mantener pulsado → scroll instantáneo en vez de smooth.
  move: (dir: TvDirection, repeat?: boolean) => boolean;
  select: () => void;
  // ¿Está mandando la capa raíz (ningún panel encima)? — el gesto de borde
  // solo vale a pantalla abierta.
  isRootActive: () => boolean;
  pushLayer: (key: string) => void;
  popLayer: (key: string) => void;
};

export type TvFocusContextValue = TvFocusApi & {
  focusedId: string | null;
  activeLayer: string;
};

export const TvFocusContext = createContext<TvFocusContextValue | null>(null);
// La capa a la que pertenecen los focusables de este subárbol. 'root' fuera
// de cualquier panel.
export const TvLayerContext = createContext<string>('root');

export const useTvFocusContext = (): TvFocusContextValue => {
  const value = useContext(TvFocusContext);
  if (!value) throw new Error('hook de foco TV usado fuera de <TvFocusProvider>');
  return value;
};

// Un elemento navegable. Devuelve el ref para colgar del nodo y si está
// enfocado ahora mismo (para pintarse).
export const useTvFocusable = ({
  onSelect,
  autoFocus = false,
  disabled = false,
}: {
  onSelect?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
}): { ref: (element: HTMLElement | null) => void; focused: boolean } => {
  const context = useTvFocusContext();
  const layer = useContext(TvLayerContext);
  const id = useId();
  const elementRef = useRef<HTMLElement | null>(null);
  // onSelect fresco sin re-registrar en cada render — asentado en efecto
  // (react-hooks/refs): el select del mando llega siempre post-commit.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    const element = elementRef.current;
    if (disabled || !element) return;
    const unregister = context.register({
      id,
      element,
      layer,
      autoFocus,
      // Sin handler no se registra NI el wrapper: un focusable de solo
      // lectura (las filas de sesión) no debe sonar el confirmar con A —
      // select() mira entry.onSelect para decidir si hay acción de verdad.
      onSelect: onSelect ? () => onSelectRef.current?.() : undefined,
    });
    // EL RATÓN ES CIUDADANO DE PRIMERA: pasar el cursor por encima mueve el
    // foco del motor — así el hover de toda la app TV es EL MISMO estado
    // visual que el foco del mando, gratis y sin duplicar estilos. Sin
    // scroll: perseguir al puntero marearía la pantalla. Y SOLO si el
    // puntero se movió de verdad hace un instante: los enter fantasma que
    // Blink dispara cuando el layout se desliza bajo un cursor quieto (el
    // scroll del propio D-pad) no pueden robarle el foco al mando.
    const onPointerEnter = (): void => {
      if (!pointerMovedRecently()) return;
      // El mismo tick que el D-pad, y solo si el hover MOVIÓ el foco — el
      // ratón habla el mismo idioma sonoro que el mando.
      if (context.focusId(id, { scroll: false })) tvSound.move();
    };
    element.addEventListener('pointerenter', onPointerEnter);
    // El autoFocus inmediato solo si su capa ya es la activa Y no hay nada
    // enfocado todavía: es "foco inicial", no "róbame el foco" — sin la
    // segunda condición, refiltrar una parrilla hacía que el nuevo primer
    // tile le quitara el foco al filtro que acababas de pulsar.
    if (autoFocus && context.activeLayer === layer && context.getFocusedId() === null) {
      context.focusId(id);
    }
    return () => {
      element.removeEventListener('pointerenter', onPointerEnter);
      unregister();
    };
    // context.activeLayer fuera a propósito: re-registrar por cambio de capa
    // activa desharía el registro en mitad de un panel abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.register, context.focusId, context.getFocusedId, id, layer, autoFocus, disabled]);

  return {
    ref: (element) => {
      elementRef.current = element;
    },
    focused: context.focusedId === id && context.activeLayer === layer,
  };
};

// Acciones para el layout (quien enchufa el mando): mover/seleccionar sobre
// la capa activa.
export const useTvFocusActions = (): {
  move: (dir: TvDirection, repeat?: boolean) => boolean;
  select: () => void;
  isRootActive: () => boolean;
} => {
  const context = useTvFocusContext();
  return { move: context.move, select: context.select, isRootActive: context.isRootActive };
};

// ¿Es la capa de ESTE subárbol la que manda ahora mismo? Lo usan los paneles
// con listeners globales propios (el OSK y su keydown de captura) para
// callarse cuando otro panel se les pone encima.
export const useTvLayerIsActive = (): boolean => {
  const context = useTvFocusContext();
  const layer = useContext(TvLayerContext);
  return context.activeLayer === layer;
};
