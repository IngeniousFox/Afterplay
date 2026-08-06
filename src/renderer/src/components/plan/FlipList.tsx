import { useLayoutEffect, useRef } from 'react';

const DURATION = 380;
const EASE = 'cubic-bezier(.22,1,.36,1)';

type Key = number | string;
type Point = { left: number; top: number };

// Lo que se guarda de cada fila en cada pasada: su posición de LAYOUT (sin
// transforms, la de verdad) y el transform que llevaba puesto al medir. Las
// dos hacen falta: el layout dice si algo SE MOVIÓ; el shift dice desde dónde
// se estaba VIENDO — que no es lo mismo cuando hay una animación en vuelo.
type Measured = { layout: Point; shift: Point };

// El translate de un transform computado. DOMMatrix se come igual un 'none',
// un translate() o el matrix() interpolado de una transición a medio camino —
// que es exactamente el caso que hay que saber leer.
const readTranslate = (element: Element): Point => {
  const raw = getComputedStyle(element).transform;
  if (!raw || raw === 'none') return { left: 0, top: 0 };
  const matrix = new DOMMatrixReadOnly(raw);
  return { left: matrix.m41, top: matrix.m42 };
};

type FlipListProps<T> = {
  items: T[];
  keyOf: (item: T) => Key;
  renderItem: (item: T) => React.ReactNode;
  className?: string;
  // Apagado, SIGUE midiendo pero no anima. Lo necesita Up next mientras se
  // arrastra: ahí quien mueve las filas es la mano, y un FLIP activo se
  // pelearía con ella.
  enabled?: boolean;
  // Up next mide la geometría de su arrastre contra este contenedor: al
  // pasar a envolver sus filas, FlipList es quien lo pinta, así que se lo
  // presta. Callback y no RefObject: mutar una ref ajena está prohibido por
  // el compilador de React (con razón — es de quien la creó).
  containerRef?: React.RefCallback<HTMLDivElement | null>;
};

// Reordena SIN parpadeo cuando el layout de los items cambia por una causa
// externa — las lentes de la cola, un pin que quita o mete una fila, una
// sección que aparece encima. Técnica FLIP (First/Last/Invert/Play), versión
// mínima y sin librería.
//
// La parte DELICADA, aprendida de un bug visible ("las filas se recolocan y
// al final no se ha movido nada"): NUNCA medir posiciones visuales a secas.
// getBoundingClientRect incluye los transforms, y aquí hay transforms en
// vuelo todo el rato — los del propio FLIP (380ms) y los del arrastre de Up
// next. Un re-render cualquiera a mitad de animación (el refetch tras la
// mutation llega SIEMPRE en esa ventana) medía la posición interpolada, la
// tomaba por un movimiento real, y "corregía" la fila re-invirtiéndola al
// lado espejo de su destino: un bandazo que terminaba exactamente donde
// había empezado. Por eso cada pasada separa las dos verdades:
//
//   layout = rect − transforms propios − rect del contenedor
//     → si el layout no cambió, NO SE TOCA NADA: la transición en vuelo
//       termina en paz. Esto por sí solo mata el bandazo.
//   shift = los transforms que llevaba al medir
//     → si el layout SÍ cambió, se anima desde donde la fila se estaba
//       VIENDO (layout viejo + shift viejo), no desde donde el layout viejo
//       dice que estaba. Es lo que hace continuo el traspaso del arrastre:
//       al soltar, el orden nuevo aterriza con delta ≈ 0 y no hay doble
//       viaje.
//
// Medir RELATIVO AL CONTENEDOR (y no al viewport) es lo que permite anidar
// FlipLists: cuando el de secciones desliza la cola entera, el de dentro ve
// moverse a la vez su contenedor y sus filas — diferencia cero, no reacciona.
//
// Se mide el CONTENIDO (primer hijo) y no el envoltorio: los transforms de un
// consumidor (el arrastre pone los suyos en su propio div interior) mueven el
// contenido sin mover la caja del envoltorio, y la posición que cuenta es la
// visible.
export const FlipList = <T,>({
  items,
  keyOf,
  renderItem,
  className,
  enabled = true,
  containerRef,
}: FlipListProps<T>): React.JSX.Element => {
  const container = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<Key, HTMLDivElement>());
  const previous = useRef(new Map<Key, Measured>());

  // Sin deps: tiene que volver a medir tras CUALQUIER render que pueda haber
  // movido el DOM. Cuando nada cambió, la pasada es una comparación de
  // números — barata.
  useLayoutEffect(() => {
    const containerRect = container.current?.getBoundingClientRect();
    const next = new Map<Key, Measured>();
    if (!containerRect) {
      previous.current = next;
      return;
    }

    // PRIMERO medir todo, DESPUÉS animar: aplicar un transform a mitad de
    // medición contaminaría las medidas de las filas siguientes.
    const containerShift = readTranslate(container.current as Element);
    for (const [key, element] of elements.current) {
      const target = (element.firstElementChild as HTMLElement | null) ?? element;
      const rect = target.getBoundingClientRect();
      const wrapperShift = readTranslate(element);
      const targetShift = target === element ? { left: 0, top: 0 } : readTranslate(target);
      const shift = {
        left: wrapperShift.left + targetShift.left,
        top: wrapperShift.top + targetShift.top,
      };
      next.set(key, {
        layout: {
          // El shift del contenedor también se resta: si un FlipList EXTERNO
          // está deslizando este bloque entero, su transform llega hasta aquí
          // por herencia — al contenedor y a las filas por igual — y ya se
          // cancela en la resta del rect; lo que no puede es colarse como
          // shift propio de las filas.
          left: rect.left - containerRect.left - (shift.left - containerShift.left),
          top: rect.top - containerRect.top - (shift.top - containerShift.top),
        },
        shift,
      });
    }

    if (enabled) {
      for (const [key, element] of elements.current) {
        const before = previous.current.get(key);
        const now = next.get(key);
        // Recién montada: entra donde le toca (su animación de llegada, si
        // la trae, es suya).
        if (!before || !now) continue;

        const layoutDx = before.layout.left - now.layout.left;
        const layoutDy = before.layout.top - now.layout.top;
        // El layout no cambió: fuera las manos. Aquí es donde antes se
        // fabricaba el bandazo.
        if (Math.abs(layoutDx) < 0.5 && Math.abs(layoutDy) < 0.5) continue;

        // Invertir desde donde se estaba VIENDO, no desde el layout viejo.
        const dx = layoutDx + before.shift.left;
        const dy = layoutDy + before.shift.top;
        element.style.transition = 'none';
        element.style.transform = `translate(${dx}px, ${dy}px)`;
        // Reflow forzado: sin leer una métrica de por medio, el navegador
        // funde "sin transición en el sitio viejo" y "con transición en el
        // nuevo" en un solo estilo y no anima nada.
        element.getBoundingClientRect();
        requestAnimationFrame(() => {
          element.style.transition = `transform ${DURATION}ms ${EASE}`;
          element.style.transform = '';
        });
      }
    }

    previous.current = next;
  });

  return (
    <div
      ref={(element) => {
        container.current = element;
        containerRef?.(element);
      }}
      className={className}
    >
      {items.map((item) => {
        const key = keyOf(item);
        return (
          <div
            key={key}
            ref={(element) => {
              if (element) elements.current.set(key, element);
              else elements.current.delete(key);
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
};
