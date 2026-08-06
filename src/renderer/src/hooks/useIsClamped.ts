import { useLayoutEffect, useRef, useState } from 'react';

// Detecta si un bloque con `line-clamp` activo está RECORTANDO texto de
// verdad — la señal para decidir si un "Show more"/"Read more" tiene sentido
// o si es un botón sin trabajo que hacer (petición explícita: si el texto ya
// cabe entero, no debe haber ni botón ni interacción).
//
// El truco es el estándar en Chromium: en un bloque `-webkit-line-clamp`,
// `scrollHeight` sigue siendo el alto NATURAL del contenido (el que ocuparía
// sin recortar) aunque lo que se PINTE esté cortado a N líneas —
// `clientHeight` es el alto visible, ya recortado. Si no coinciden, hay más
// texto del que se ve.
//
// El elemento que se mide es un CLON invisible, siempre clamped, y no el
// texto visible del componente — así la respuesta no depende de si el
// usuario ya lo tiene expandido (donde el propio texto visible deja de
// llevar la clase line-clamp y la comparación daría siempre "no hay
// recorte", aunque expandirlo fuera precisamente lo que hizo falta).
//
// Se re-mide con ResizeObserver, no solo al montar: el ancho disponible
// cambia con la ventana (las filas del Plan son flexibles) y un texto que
// cabía a 900px puede dejar de caber a 700px.
//
// UN observer COMPARTIDO por todas las instancias, no uno por hook: la cola
// del Plan monta cientos de filas y cada una usaba el suyo — cientos de
// objetos que el navegador tiene que crear, registrar y vigilar por separado.
// Un solo ResizeObserver con cientos de elementos observados es mucho más
// barato que cientos con uno cada uno, y además agrupa todos los avisos de un
// mismo cambio de tamaño en una única entrega. El mapa elemento → callback es
// lo que reparte cada aviso a su dueño.
const callbacks = new WeakMap<Element, () => void>();
let shared: ResizeObserver | null = null;

const observer = (): ResizeObserver => {
  shared ??= new ResizeObserver((entries) => {
    for (const entry of entries) callbacks.get(entry.target)?.();
  });
  return shared;
};

export const useIsClamped = <T extends HTMLElement = HTMLElement>(): [
  React.RefObject<T | null>,
  boolean,
] => {
  const ref = useRef<T | null>(null);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // La comparación se hace ANTES de tocar el estado: setClamped con el
    // mismo valor que ya tiene no repinta (React lo corta), pero llamarlo en
    // cada aviso de resize de cientos de filas es trabajo que no hace falta.
    const measure = (): void => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();

    callbacks.set(element, measure);
    observer().observe(element);
    return () => {
      observer().unobserve(element);
      callbacks.delete(element);
    };
  }, []);

  return [ref, clamped];
};
