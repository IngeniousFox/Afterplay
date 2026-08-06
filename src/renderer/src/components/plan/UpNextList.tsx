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

type Snapshot = { tops: number[]; heights: number[] };

type Drag = {
  id: number;
  index: number;
  pointerStartY: number;
  dy: number;
  // Dónde caería si se soltara ahora — lo que decide qué vecinos se apartan.
  target: number;
  // true = ya se soltó y la fila está planeando hacia su hueco.
  settling: boolean;
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

  useEffect(() => () => clearTimeout(settleTimer.current ?? undefined), []);

  // Rects RELATIVOS al contenedor de la lista, y no offsetTop — el bug del
  // "vuelo" al soltar salió de aquí. offsetTop se mide contra el offsetParent
  // (el ancestro POSICIONADO más cercano), y en la pantalla real ese ancestro
  // queda muy por encima de la lista: los tops llegaban inflados por todo lo
  // que hay arriba (cabecera, deuda, horizonte). Las comparaciones entre
  // ellos no lo notaban (mismo desfase en todos), pero la cuenta del
  // aterrizaje mezcla esos tops con newTop (construido desde 0, escala
  // local) — y la fila planeaba hacia ARRIBA exactamente ese desfase antes
  // de aparecer en su sitio. Con las dos medidas contra el mismo origen, el
  // aterrizaje cae al píxel. La foto se toma al agarrar, sin transforms
  // activos, así que los rects son limpios.
  const takeSnapshot = (): Snapshot => {
    const containerTop = containerRef.current?.getBoundingClientRect().top ?? 0;
    return {
      tops: games.map((game) => {
        const element = itemRefs.current.get(game.id);
        return element ? element.getBoundingClientRect().top - containerTop : 0;
      }),
      heights: games.map(
        (game) => itemRefs.current.get(game.id)?.getBoundingClientRect().height ?? 0,
      ),
    };
  };

  // Dónde caería la fila agarrada: cuántos vecinos tienen su centro (en la
  // foto original) por encima del centro actual de la agarrada. Comparar
  // centros y no bordes es lo que hace el intercambio simétrico — un vecino
  // se aparta justo cuando lo has cruzado hasta la mitad, subas o bajes.
  //
  // El empate se resuelve A FAVOR de la dirección del arrastre, y no es un
  // detalle teórico: con filas de la misma altura, el tope del clamp deja el
  // centro de la agarrada EXACTAMENTE sobre el centro del vecino del borde
  // (comprobado arrastrando: con `<` a secas, empujar hasta el fondo se
  // quedaba clavado en la penúltima posición por mucho que tiraras).
  const targetOf = (snap: Snapshot, index: number, dy: number): number => {
    const center = snap.tops[index] + snap.heights[index] / 2 + dy;
    let target = 0;
    for (let j = 0; j < games.length; j++) {
      if (j === index) continue;
      const other = snap.tops[j] + snap.heights[j] / 2;
      if (other < center || (dy > 0 && other === center)) target++;
    }
    return target;
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
      applyDrag({
        id: games[index].id,
        index,
        pointerStartY: event.clientY,
        dy: 0,
        target: index,
        settling: false,
        snap: takeSnapshot(),
      });
    };

  const handleMove =
    (index: number) =>
    (event: React.PointerEvent): void => {
      const current = dragRef.current;
      if (!current || current.settling || current.index !== index) return;
      const { snap } = current;

      // La fila no puede salirse de la estantería: se sujeta a los bordes de
      // la lista, que es lo que hace el gesto sentirse "encarrilado".
      const last = games.length - 1;
      const total = snap.tops[last] + snap.heights[last];
      const raw = event.clientY - current.pointerStartY;
      const dy = Math.max(
        -snap.tops[index],
        Math.min(raw, total - snap.heights[index] - snap.tops[index]),
      );
      applyDrag({ ...current, dy, target: targetOf(snap, index, dy) });
    };

  const handleUp = (index: number) => (): void => {
    const current = dragRef.current;
    if (!current || current.settling || current.index !== index) return;
    const { snap } = current;

    // El offset EXACTO del hueco de destino: la suma de los vecinos que
    // quedarán por encima, en la foto original. Es a donde la fila planea.
    let newTop = 0;
    let placed = 0;
    for (let j = 0; j < games.length && placed < current.target; j++) {
      if (j === current.index) continue;
      newTop += snap.heights[j] + GAP;
      placed++;
    }
    applyDrag({ ...current, dy: newTop - snap.tops[current.index], settling: true });

    settleTimer.current = setTimeout(() => {
      // La mutation (optimista) y el fin del gesto en el MISMO tick: React
      // agrupa los dos cambios en un render, así que los transforms
      // desaparecen exactamente cuando el orden de datos ya es el visual —
      // cero salto, que es toda la gracia del aterrizaje.
      if (current.target !== current.index) {
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
