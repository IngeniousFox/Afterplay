import { useCallback, useState } from 'react';

// UN IntersectionObserver para toda la PWA (el documento es el único
// scroller que importa aquí), con un callback por nodo. Uno por elemento
// serían docenas de observadores midiendo lo mismo.
type Listener = (intersecting: boolean) => void;

const listeners = new Map<Element, Listener>();
let observer: IntersectionObserver | null = null;

const shared = (): IntersectionObserver | null => {
  if (typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    },
    // Un poco de margen: lo que está a punto de entrar ya cuenta como dentro.
    { rootMargin: '48px 0px' },
  );
  return observer;
};

const watch = (node: Element, listener: Listener): (() => void) => {
  const io = shared();
  if (!io) {
    listener(true);
    return () => {};
  }
  listeners.set(node, listener);
  io.observe(node);
  return () => {
    listeners.delete(node);
    io.unobserve(node);
  };
};

// Pausa un bucle CSS fuera de la vista. Nace corriendo: un elemento recién
// montado nunca se ve congelado, y el observador lo pausa un frame después
// si está lejos.
export const useOffscreenPause = (): {
  observe: (node: Element | null) => (() => void) | undefined;
  playState: 'paused' | undefined;
} => {
  const [visible, setVisible] = useState(true);
  const observe = useCallback((node: Element | null) => {
    if (!node) return undefined;
    const stop = watch(node, setVisible);
    return () => {
      stop();
      setVisible(true);
    };
  }, []);
  return { observe, playState: visible ? undefined : 'paused' };
};

// La primera vez que algo entra en la vista (medidores y barras que se
// rellenan). Una sola vez: al volver a pasar ya está lleno.
export const useInView = (): {
  observe: (node: Element | null) => (() => void) | undefined;
  inView: boolean;
} => {
  const [inView, setInView] = useState(false);
  const observe = useCallback((node: Element | null) => {
    if (!node) return undefined;
    let stop: (() => void) | null = null;
    stop = watch(node, (intersecting) => {
      if (!intersecting) return;
      setInView(true);
      stop?.();
      stop = null;
    });
    return () => stop?.();
  }, []);
  return { observe, inView };
};
