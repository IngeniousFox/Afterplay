import { useLayoutEffect, useRef } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { GameCard } from './GameCard';

// La entrada escalonada de la parrilla — en CADA visita a la pantalla, como
// las secciones de Stats (petición explícita: una entrada que solo corre a
// veces hace que el resto de veces los juegos aparezcan de golpe).
//
// El comentario histórico de GameListScreen tenía razón en los dos peligros
// de escalonar por índice ABSOLUTO sobre cientos de juegos: la onda tarda
// segundos en recorrer la lista, y al volver de una ficha con el scroll
// restaurado a media altura, todas las tarjetas visibles (índices altos)
// esperarían el tope del retraso a la vez — parrilla en blanco y luego todo
// de golpe, lo contrario de una entrada bonita.
//
// La solución es repartir la escalera POR PANTALLA, no por lista: justo
// antes del primer pintado se mide qué tarjetas caen dentro del viewport —
// da igual a qué altura esté restaurado el scroll — y solo ESAS reciben la
// onda (ordenadas por posición visual, fila a fila). Al resto se les apaga
// la animación directamente. Consecuencias:
//
//  · La cascada se ve SIEMPRE, entres por primera vez o vuelvas de una ficha
//    a media lista — porque se calcula sobre lo que hay delante de los ojos.
//  · El coste no depende del tamaño de la biblioteca: solo animan las
//    ~20-30 tarjetas visibles; las otras trescientas ni corren animación ni
//    ganan capa de composición. Una pasada de medición al montar (lecturas
//    primero, escrituras después: sin thrashing de layout) y ya.
//  · Quien haga scroll durante la entrada encuentra tarjetas ya asentadas,
//    no una onda persiguiéndole lista abajo.
const INTRO_STEP_MS = 26;
const INTRO_STAGGER_CAP = 18;

type GameGridProps = {
  games: GameListItem[];
  onSelectGame: (id: number) => void;
};

// SPEC 10.6 — auto-fill con mínimo 196px por card y 20px de gap.
export const GameGrid = ({ games, onSelectGame }: GameGridProps): React.JSX.Element => {
  const gridRef = useRef<HTMLDivElement | null>(null);
  // La escalera se reparte UNA vez por montaje — no en cada refetch: un
  // cambio de datos a mitad de sesión no es "entrar en la pantalla".
  const dealt = useRef(false);

  // Sin deps a propósito: en el primer arranque de la app la parrilla monta
  // VACÍA (la query aún resolviendo) y las tarjetas llegan en un render
  // posterior — el efecto corre tras cada render hasta que hay tarjetas que
  // repartir, y a partir de ahí es un return inmediato. useLayoutEffect y no
  // useEffect: las escrituras tienen que aterrizar ANTES del primer pintado,
  // o el fotograma inicial enseñaría todas las tarjetas arrancando su
  // animación con retraso cero.
  useLayoutEffect(() => {
    if (dealt.current) return;
    const grid = gridRef.current;
    if (!grid || grid.children.length === 0) return;
    dealt.current = true;

    // Lecturas primero, escrituras después: intercalarlas fuerza un reflow
    // por tarjeta (escribes un estilo, la siguiente lectura recalcula
    // layout) — con cientos de tarjetas eso sí se nota al entrar.
    const viewportHeight = window.innerHeight;
    const measured = [...grid.children].map((element) => ({
      element: element as HTMLElement,
      rect: element.getBoundingClientRect(),
    }));

    const visible = measured
      .filter(({ rect }) => rect.bottom > 0 && rect.top < viewportHeight)
      // Por posición VISUAL (fila y, dentro de ella, columna), no por índice
      // del array: es lo que hace que la onda recorra la pantalla de arriba
      // a abajo también cuando el scroll restaurado te deja en mitad de la
      // lista.
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    for (const [order, { element }] of visible.entries()) {
      element.style.animationDelay = `${Math.min(order, INTRO_STAGGER_CAP) * INTRO_STEP_MS}ms`;
    }
    for (const { element, rect } of measured) {
      if (rect.bottom <= 0 || rect.top >= viewportHeight) element.style.animation = 'none';
    }
  });

  return (
    <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-5">
      {games.map((game) => (
        // Las clases de entrada van puestas de serie en TODAS; el efecto de
        // arriba decide antes del primer pintado quién la corre con qué
        // retraso y a quién se le apaga. Bonus gratis: una tarjeta que se
        // monta MÁS TARDE (un alta nueva llegando por refetch) no pasa por el
        // reparto y entra con su animación a retraso cero — un fade-in suave
        // en el sitio donde aparece.
        <div
          key={game.id}
          className="animate-in duration-400 fill-mode-backwards fade-in-0 zoom-in-97 slide-in-from-bottom-2"
        >
          <GameCard game={game} onSelect={() => onSelectGame(game.id)} />
        </div>
      ))}
    </div>
  );
};
