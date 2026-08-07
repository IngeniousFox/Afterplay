import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PlannedGameItem } from '../../../../shared/types';
import { useReorderUpNext } from '../../hooks/games';
import { FlipList } from './FlipList';
import { PlanRow } from './PlanRow';

// LA ESTANTERÍA REORDENABLE de Up next (PLAN-TO-PLAY.md §2.2 — el "reordenar
// arrastrando es v2, solo si hace falta" hizo falta).
//
// Sin librería de drag & drop, a propósito. El HTML5 nativo (draggable) pinta
// una foto fantasma del elemento y no deja animar nada; una librería entera
// para UNA lista de un puñado de filas es peso sin causa. Con pointer events
// el gesto completo son ~100 líneas y cada detalle queda en casa:
//
//  · La fila agarrada SIGUE al puntero (translateY), ligeramente crecida e
//    inclinada — está "en la mano", fuera de la estantería.
//  · Los vecinos SE APARTAN deslizándose (transition en transform) en cuanto
//    el centro de la agarrada cruza el suyo — se ve el hueco donde va a caer
//    ANTES de soltar, que es lo que hace el gesto legible.
//  · Al soltar, la fila PLANEA hasta su hueco (transición hasta el offset
//    exacto del sitio nuevo) y solo entonces se consolida el orden — como los
//    datos optimistas quedan idénticos a lo que se está viendo, el frame del
//    cambio de verdad no mueve ni un píxel.
//
// La geometría se congela en una FOTO al agarrar (tops/heights medidos del
// DOM): durante el gesto todo se calcula contra ella, nunca contra el layout
// vivo — que está lleno de transforms en marcha y daría medidas mentirosas.

// El gap-2 del contenedor. Si cambia la clase, cambia esto.
const GAP = 8;
const SETTLE_MS = 220;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

// Autoscroll: franja de los bordes del scroller que arrastra la página, y lo
// máximo que se desplaza en un frame estando pegado al borde de todo.
const EDGE_PX = 72;
const MAX_SCROLL_PER_FRAME = 16;

type Snapshot = { tops: number[]; heights: number[] };

// A qué offset aterriza la fila `index` si se suelta en el slot `target`: la
// suma de los vecinos que quedarían por encima, medidos en la foto original.
// Es la geometría de la lista YA REORDENADA — por eso salta el propio index.
const topForTarget = (snap: Snapshot, index: number, target: number): number => {
  let top = 0;
  let placed = 0;
  for (let j = 0; j < snap.heights.length && placed < target; j++) {
    if (j === index) continue;
    top += snap.heights[j] + GAP;
    placed++;
  }
  return top;
};

// El scroller que hay que mover para que el arrastre pueda salir de la parte
// visible. Se busca en caliente (y no se cablea por prop) porque la lista no
// tiene por qué saber quién la envuelve: hoy es el contenedor de Plan to play.
const findScroller = (element: HTMLElement | null): HTMLElement | null => {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
};

// El translateY que un elemento lleva puesto AHORA MISMO (transición a medio
// camino incluida) — la misma lectura que hace FlipList, por el mismo motivo.
const translateYOf = (element: Element | null): number => {
  if (!element) return 0;
  const raw = getComputedStyle(element).transform;
  if (!raw || raw === 'none') return 0;
  return new DOMMatrixReadOnly(raw).m42;
};

type Drag = {
  id: number;
  index: number;
  pointerStartY: number;
  dy: number;
  // Dónde caería si se soltara ahora — lo que decide qué vecinos se apartan.
  target: number;
  // true = ya se soltó y la fila está planeando hacia su hueco.
  settling: boolean;
  // El scrollTop del contenedor al agarrar. La foto de geometría es RELATIVA
  // a la lista, y el puntero es relativo al viewport: si la página se
  // desplaza a mitad de gesto (el autoscroll lo hace a propósito), las dos
  // escalas dejan de coincidir y la fila se queda atrás. La diferencia contra
  // esta marca es lo que las vuelve a alinear.
  scrollStart: number;
  // La foto de geometría del momento de agarrar. VIAJA EN EL ESTADO y no en
  // una ref a propósito: el render la necesita (styleOf calcula los
  // desplazamientos con ella) y leer refs durante el render está prohibido —
  // el compilador de React lo señala, y con razón. Congelada aquí es además
  // exactamente lo que se quiere: inmutable durante todo el gesto.
  snap: Snapshot;
};

type UpNextListProps = {
  games: PlannedGameItem[];
  onSelect: (id: number) => void;
  onUnpin: (id: number) => void;
  // El juego que ACABA de aterrizar aquí por un pin — su fila entra con la
  // animación de llegada (ver PlanRow.landing).
  highlightId?: number | null;
};

export const UpNextList = ({
  games,
  onSelect,
  onUnpin,
  highlightId,
}: UpNextListProps): React.JSX.Element => {
  const reorder = useReorderUpNext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<number, HTMLDivElement>());
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lo que necesita el autoscroll para seguir trabajando entre pointermove:
  // mientras estás quieto pegado al borde no llega ningún evento, así que el
  // bucle de frames tiene que poder recalcular la posición él solo.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pointerYRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Espejo en ref del estado de arrastre: los manejadores de pointer leen y
  // escriben SIEMPRE la ref (verdad inmediata, sin esperar al render) y el
  // estado solo existe para repintar. Sin el espejo, meter la lógica en
  // updaters funcionales era la alternativa — y un updater con setTimeout
  // dentro es impuro (StrictMode los ejecuta dos veces en dev, y habrían
  // salido dos timers y dos mutations por gesto).
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const applyDrag = (next: Drag | null): void => {
    dragRef.current = next;
    setDrag(next);
  };

  // Armada al soltar con reordenación, consumida por FlipList justo antes de
  // animar (ver consumeMute en FlipList — ahí está el porqué completo del
  // silencio del aterrizaje). Ref a propósito: se arma desde el timeout del
  // planeo y no debe provocar ningún render por sí misma.
  const muteFlipOnce = useRef(false);

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current ?? undefined);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Rects RELATIVOS al contenedor de la lista, y no offsetTop — el bug del
  // "vuelo" al soltar salió de aquí. offsetTop se mide contra el offsetParent
  // (el ancestro POSICIONADO más cercano), y en la pantalla real ese ancestro
  // queda muy por encima de la lista: los tops llegaban inflados por todo lo
  // que hay arriba (cabecera, deuda, horizonte). Las comparaciones entre
  // ellos no lo notaban (mismo desfase en todos), pero la cuenta del
  // aterrizaje mezcla esos tops con newTop (construido desde 0, escala
  // local) — y la fila planeaba hacia ARRIBA exactamente ese desfase antes
  // de aparecer en su sitio. Con las dos medidas contra el mismo origen, el
  // aterrizaje cae al píxel.
  //
  // Y a cada rect se le RESTAN los transforms en vuelo (el propio y el del
  // envoltorio de FlipList, donde este pone los suyos): "la foto se toma sin
  // transforms activos" era mentira en el caso real de soltar una fila y
  // volver a agarrarla al momento — el FLIP de otras filas (un pin llegando,
  // un rollback) podía seguir animando, y una foto tomada a mitad de ese
  // vuelo daba tops visuales, no de layout. Con los tops mentirosos, el
  // clamp y los huecos de targetOf dejaban de casar y el primer puesto se
  // volvía inalcanzable A VECES — exactamente la clase de bug intermitente
  // que no se puede reproducir a voluntad. Se mide layout, no pantalla.
  const takeSnapshot = (): Snapshot => {
    const containerTop = containerRef.current?.getBoundingClientRect().top ?? 0;
    return {
      tops: games.map((game) => {
        const element = itemRefs.current.get(game.id);
        if (!element) return 0;
        return (
          element.getBoundingClientRect().top -
          containerTop -
          translateYOf(element) -
          translateYOf(element.parentElement)
        );
      }),
      heights: games.map(
        (game) => itemRefs.current.get(game.id)?.getBoundingClientRect().height ?? 0,
      ),
    };
  };

  // Dónde caería la fila agarrada: el slot cuyo hueco está MÁS CERCA de donde
  // la estás sujetando. No se compara contra los vecinos, se compara contra
  // los aterrizajes posibles — que es exactamente lo que handleUp va a usar
  // luego, así que la vista previa y el destino real no pueden discrepar.
  //
  // La versión anterior contaba vecinos con el centro por encima del centro de
  // la agarrada, y ahí estaba el bug de "no puedo llevar el segundo al primer
  // sitio": el clamp sujeta la fila al borde de la lista, y desde el borde el
  // centro de la agarrada solo pasa del centro del vecino si la agarrada NO es
  // más alta que él. Con dos filas de distinto alto (una nota, un título de
  // dos líneas) el primer puesto era literalmente inalcanzable, y el último lo
  // mismo por el otro extremo — el remiendo del empate por dirección tapaba
  // solo el caso de las alturas exactamente iguales.
  //
  // Comparando huecos no hay borde inalcanzable: en el tope del clamp la fila
  // está EXACTAMENTE sobre el hueco 0, distancia cero, así que gana siempre.
  // O(n²) sobre un puñado de fijados, que es lo que cabe en Up next.
  const targetOf = (snap: Snapshot, index: number, dy: number): number => {
    const top = snap.tops[index] + dy;
    let best = index;
    let bestDistance = Infinity;
    for (let target = 0; target < snap.heights.length; target++) {
      const distance = Math.abs(topForTarget(snap, index, target) - top);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = target;
      }
    }
    return best;
  };

  // El estado del gesto para una posición del puntero. Sale de handleMove
  // porque el autoscroll también lo necesita: con el dedo QUIETO en el borde
  // no llega ningún pointermove, y aun así la fila tiene que seguir subiendo
  // por la lista mientras la página se desplaza debajo.
  const applyPointer = (clientY: number): void => {
    const current = dragRef.current;
    if (!current || current.settling) return;
    const { snap, index } = current;

    // La fila no puede salirse de la estantería: se sujeta a los bordes de
    // la lista, que es lo que hace el gesto sentirse "encarrilado".
    const last = snap.heights.length - 1;
    const total = snap.tops[last] + snap.heights[last];
    const scrolled = (scrollerRef.current?.scrollTop ?? 0) - current.scrollStart;
    const raw = clientY - current.pointerStartY + scrolled;
    const dy = Math.max(
      -snap.tops[index],
      Math.min(raw, total - snap.heights[index] - snap.tops[index]),
    );
    applyDrag({ ...current, dy, target: targetOf(snap, index, dy) });
  };

  // Un frame de autoscroll. Con el puntero capturado el navegador no desplaza
  // nada por su cuenta —ni rueda, ni arrastre al borde—, así que en una lista
  // más alta que la ventana la mitad de los destinos quedaban fuera de alcance:
  // el gesto se acababa donde se acababa lo visible. La velocidad crece con lo
  // metido que estés en la franja del borde, para poder afinar cerca de ella.
  const autoScrollStep = (): void => {
    rafRef.current = requestAnimationFrame(autoScrollStep);
    const current = dragRef.current;
    const scroller = scrollerRef.current;
    if (!current || current.settling || !scroller) return;

    const rect = scroller.getBoundingClientRect();
    const above = rect.top + EDGE_PX - pointerYRef.current;
    const below = pointerYRef.current - (rect.bottom - EDGE_PX);
    const push = above > 0 ? -Math.min(above, EDGE_PX) : below > 0 ? Math.min(below, EDGE_PX) : 0;
    if (push === 0) return;

    const before = scroller.scrollTop;
    scroller.scrollTop = before + (push / EDGE_PX) * MAX_SCROLL_PER_FRAME;
    // Si el scroller ya estaba al tope no se ha movido nada y recalcular sería
    // un render por frame para dejarlo todo igual.
    if (scroller.scrollTop !== before) applyPointer(pointerYRef.current);
  };

  const stopAutoScroll = (): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const handleDown =
    (index: number) =>
    (event: React.PointerEvent): void => {
      if (dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        // La captura es lo que mantiene el gesto vivo aunque el puntero se
        // salga del asa (que se sale siempre: el asa mide 20px).
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        // Un pointerId sintético (tests) no se puede capturar — el arrastre
        // funciona igual mientras los eventos lleguen al elemento.
      }
      scrollerRef.current = findScroller(containerRef.current);
      pointerYRef.current = event.clientY;
      applyDrag({
        id: games[index].id,
        index,
        pointerStartY: event.clientY,
        dy: 0,
        target: index,
        settling: false,
        scrollStart: scrollerRef.current?.scrollTop ?? 0,
        snap: takeSnapshot(),
      });
      stopAutoScroll();
      rafRef.current = requestAnimationFrame(autoScrollStep);
    };

  const handleMove =
    (index: number) =>
    (event: React.PointerEvent): void => {
      const current = dragRef.current;
      if (!current || current.settling || current.index !== index) return;
      pointerYRef.current = event.clientY;
      applyPointer(event.clientY);
    };

  const handleUp = (index: number) => (): void => {
    const current = dragRef.current;
    if (!current || current.settling || current.index !== index) return;
    const { snap } = current;
    stopAutoScroll();

    // El offset EXACTO del hueco de destino, el mismo que ya eligió targetOf.
    // Es a donde la fila planea.
    const newTop = topForTarget(snap, current.index, current.target);
    applyDrag({ ...current, dy: newTop - snap.tops[current.index], settling: true });

    settleTimer.current = setTimeout(() => {
      // La mutation (optimista) y el fin del gesto en el MISMO tick: React
      // agrupa los dos cambios en un render, así que los transforms
      // desaparecen exactamente cuando el orden de datos ya es el visual —
      // cero salto, que es toda la gracia del aterrizaje.
      if (current.target !== current.index) {
        muteFlipOnce.current = true;
        const ids = games.map((game) => game.id).filter((id) => id !== current.id);
        ids.splice(current.target, 0, current.id);
        reorder.mutate(ids);
      }
      applyDrag(null);
    }, SETTLE_MS);
  };

  // Los transforms del gesto. La agarrada sigue al puntero sin transición
  // (pegada a la mano); los demás SÍ transicionan — su deslizamiento al
  // apartarse ES la animación.
  const styleOf = (index: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    const { snap } = drag;

    if (index === drag.index) {
      return {
        transform: drag.settling
          ? `translateY(${drag.dy}px)`
          : `translateY(${drag.dy}px) scale(1.02) rotate(.4deg)`,
        zIndex: 30,
        position: 'relative',
        transition: drag.settling ? `transform ${SETTLE_MS}ms ${EASE}` : 'none',
        boxShadow: '0 18px 44px rgba(0,0,0,.55)',
        borderRadius: 15,
      };
    }

    const shift = snap.heights[drag.index] + GAP;
    let offset = 0;
    if (drag.target < drag.index && index >= drag.target && index < drag.index) offset = shift;
    else if (drag.target > drag.index && index > drag.index && index <= drag.target)
      offset = -shift;
    return { transform: `translateY(${offset}px)`, transition: `transform ${SETTLE_MS}ms ${EASE}` };
  };

  // El índice se resuelve por id y no por la posición del map: FlipList es
  // quien recorre `games` ahora, y los manejadores del arrastre necesitan el
  // índice DENTRO de la lista ordenada, no el que le toque al envoltorio.
  const indexOf = (id: number): number => games.findIndex((game) => game.id === id);

  return (
    // FLIP alrededor de las filas para que soltar un juego de Up next no haga
    // SALTAR a los de abajo: se deslizan a su sitio nuevo, igual que hace la
    // cola con las lentes. Apagado mientras se arrastra — ahí mandan los
    // transforms del gesto (ver el comentario de `enabled` en FlipList).
    <FlipList
      items={games}
      keyOf={(game) => game.id}
      enabled={drag === null}
      consumeMute={() => {
        const muted = muteFlipOnce.current;
        muteFlipOnce.current = false;
        return muted;
      }}
      className="flex flex-col gap-2"
      containerRef={(element) => {
        containerRef.current = element;
      }}
      renderItem={(game) => {
        const index = indexOf(game.id);
        return (
          <div
            ref={(element) => {
              if (element) itemRefs.current.set(game.id, element);
              else itemRefs.current.delete(game.id);
            }}
            style={styleOf(index)}
          >
            <PlanRow
              game={game}
              pinned
              landing={highlightId === game.id}
              onSelect={() => onSelect(game.id)}
              onTogglePin={() => onUnpin(game.id)}
              reorder={
                games.length > 1
                  ? {
                      onPointerDown: handleDown(index),
                      onPointerMove: handleMove(index),
                      onPointerUp: handleUp(index),
                      dragging: drag?.id === game.id && !drag.settling,
                    }
                  : undefined
              }
            />
          </div>
        );
      }}
    />
  );
};
