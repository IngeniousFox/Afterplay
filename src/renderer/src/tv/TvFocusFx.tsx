import { useEffect, useRef } from 'react';
import { useTvFocusContext } from './focusContext';
import { findTvFocused, playTvTrail, publishTvFocusGlow, tvRingRect } from './focusFx';
import { TV_TRAIL_ROW_JUMP } from './styles';

// El observador de los efectos de foco (focusFx.ts). Se monta una vez en el
// layout, DENTRO del TvFocusProvider, y solo mira: cuando el foco cambia,
// publica el punto para las motas del fondo y, si el salto es de fila dentro
// de la misma capa, lanza la estela. No pinta nada ni toca el motor.
//
// useEffect (no layout): corre después de los useLayoutEffect de todos los
// focusables del commit, que son los que ponen la marca data-tv-fx-focus.
export const TvFocusFx = (): null => {
  const { focusedId, activeLayer } = useTvFocusContext();
  const previous = useRef<{ element: HTMLElement; layer: string } | null>(null);

  useEffect(() => {
    const element = findTvFocused();
    const before = previous.current;
    previous.current = element ? { element, layer: activeLayer } : null;
    publishTvFocusGlow(element);
    if (!element) return undefined;

    if (
      before &&
      before.layer === activeLayer &&
      before.element !== element &&
      before.element.isConnected
    ) {
      const from = tvRingRect(before.element);
      const to = tvRingRect(element);
      const jump = Math.abs(to.top + to.height / 2 - (from.top + from.height / 2));
      if (jump > TV_TRAIL_ROW_JUMP * Math.min(from.height, to.height)) playTvTrail(from, element);
    }

    // Otra vez cuando el scroll suave del motor se haya asentado: las motas
    // van al sitio donde de verdad se queda la portada.
    const settle = setTimeout(() => publishTvFocusGlow(element), 450);
    return () => clearTimeout(settle);
  }, [focusedId, activeLayer]);

  useEffect(() => () => publishTvFocusGlow(null), []);

  return null;
};
