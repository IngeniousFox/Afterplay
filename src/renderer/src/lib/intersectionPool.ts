// El pool de IntersectionObserver que comparten las superficies que reaccionan
// a "esto está cerca de verse": useNearViewport (montar/desmontar carátulas) y
// useOffscreenAnimation (pausar/reanudar animaciones).
//
// Vive aquí porque estaba ESCRITO DOS VECES, byte a byte, en esos dos hooks —
// mismas WeakMaps, mismo notify, mismo observerFor, idénticos salvo la
// constante del margen— y las copias ya habían empezado a separarse: la
// limpieza de useOffscreenAnimation ganó su "vuelta al estado seguro" y la de
// useNearViewport no. Esa diferencia concreta es política de cada hook y sigue
// en cada hook; lo que no puede volver a divergir por descuido es la
// FONTANERÍA, que es lo único que se mudó aquí.
//
// Una fábrica y no un pool global: el rootMargin forma parte de la identidad
// del observador (uno no puede medir con dos márgenes a la vez), así que cada
// política se queda con su pool. Lo compartido es el código y la regla de "un
// observador por scroller", no los observadores.

// El scroller real del elemento como root, no siempre el viewport: rootMargin
// solo ensancha el rectángulo del ROOT, y estas superficies viven en columnas
// con scroll propio — con el viewport de root, el margen no protegería el
// borde del scroller, que es por donde salen de la vista.
const scrollerOf = (element: Element): Element | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
};

export type ViewportPool = {
  // Devuelve la limpieza: dejar de observar y soltar la callback. La firma es
  // la que necesitan las ref-callbacks de React 19, que devuelven su propia
  // limpieza en vez de que el hook lleve la cuenta con un useRef.
  observe: (node: Element, onChange: (intersecting: boolean) => void) => () => void;
};

export const createViewportPool = (rootMarginPx: number): ViewportPool => {
  // UN observador por scroller, compartido por todos los nodos que cuelgan de
  // él. Uno por fila serían cientos de observadores midiendo exactamente el
  // mismo rectángulo — justo el coste que esto viene a quitar.
  const byRoot = new WeakMap<Element, IntersectionObserver>();
  let viewportObserver: IntersectionObserver | null = null;
  // Por pool y no global: el mismo nodo puede estar observado por dos
  // políticas a la vez (una GameCard mira su carátula Y su badge LIVE) y cada
  // una tiene que recibir su propio aviso.
  const callbacks = new WeakMap<Element, (intersecting: boolean) => void>();

  const notify = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
  };

  const observerFor = (root: Element | null): IntersectionObserver => {
    const options = { root, rootMargin: `${rootMarginPx}px 0px` };
    if (!root) {
      viewportObserver ??= new IntersectionObserver(notify, options);
      return viewportObserver;
    }
    let observer = byRoot.get(root);
    if (!observer) {
      observer = new IntersectionObserver(notify, options);
      byRoot.set(root, observer);
    }
    return observer;
  };

  return {
    observe: (node, onChange) => {
      const observer = observerFor(scrollerOf(node));
      callbacks.set(node, onChange);
      observer.observe(node);
      return () => {
        observer.unobserve(node);
        callbacks.delete(node);
      };
    },
  };
};
