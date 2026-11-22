import { useEffect, useLayoutEffect, useRef } from 'react';
import type { GameListItem } from '../../../../shared/types';
import type { GameId } from '../../../../shared/entityIds';
import { GameCard } from './GameCard';

// La rejilla de portadas de Library.
//
// ENTRADA ESCALONADA POR PANTALLA, no por lista: justo antes del primer
// pintado se mide qué tarjetas caen dentro del viewport —da igual a qué altura
// esté restaurado el scroll— y solo ESAS reciben la onda, ordenadas por
// posición visual. Al resto se les apaga la animación. Así la cascada se ve
// siempre, su coste no depende del tamaño de la biblioteca, y quien hace
// scroll durante la entrada encuentra tarjetas ya asentadas.
//
// Una vez repartida, las tarjetas que monten después (filtrar, buscar) entran
// sin animación: lo que el teclado repite no se anima (README-sistema,
// principio 8).
//
// TECLADO: cada portada es un botón; las flechas mueven el foco por la
// rejilla (izquierda/derecha de una en una, arriba/abajo de fila en fila),
// Inicio y Fin van a la primera y a la última.
const INTRO_STEP_MS = 26;
const INTRO_STAGGER_CAP = 18;
const INTRO_DONE_MS = 240 + INTRO_STEP_MS * INTRO_STAGGER_CAP;

type GameGridProps = {
  games: GameListItem[];
  onSelectGame: (id: GameId) => void;
  selectedId?: GameId | null;
};

const columnsOf = (grid: HTMLElement): number =>
  getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;

export const GameGrid = ({
  games,
  onSelectGame,
  selectedId = null,
}: GameGridProps): React.JSX.Element => {
  const gridRef = useRef<HTMLUListElement | null>(null);
  // La escalera se reparte UNA vez por montaje, no en cada refetch.
  const dealt = useRef(false);

  // Sin deps a propósito: en el primer arranque la rejilla monta vacía y las
  // tarjetas llegan en un render posterior. useLayoutEffect para que las
  // escrituras aterricen antes del primer pintado.
  useLayoutEffect(() => {
    if (dealt.current) return;
    const grid = gridRef.current;
    if (!grid || grid.children.length === 0) return;
    dealt.current = true;

    // Lecturas primero, escrituras después: sin reflow por tarjeta.
    const viewportHeight = window.innerHeight;
    const measured = [...grid.children].map((element) => ({
      element: element as HTMLElement,
      rect: element.getBoundingClientRect(),
    }));
    const visible = measured
      .filter(({ rect }) => rect.bottom > 0 && rect.top < viewportHeight)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    for (const [order, { element }] of visible.entries()) {
      element.style.animationDelay = `${Math.min(order, INTRO_STAGGER_CAP) * INTRO_STEP_MS}ms`;
    }
    for (const { element, rect } of measured) {
      if (rect.bottom <= 0 || rect.top >= viewportHeight) element.style.animation = 'none';
    }
  });

  // Terminada la entrada, las tarjetas nuevas ya no animan.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (gridRef.current) gridRef.current.dataset.settled = 'true';
    }, INTRO_DONE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Al volver de una ficha, el foco vuelve a la portada que se abrió (sin
  // mover el scroll: de eso se encarga la memoria de scroll de Library).
  const focusedSelection = useRef(false);
  useEffect(() => {
    if (focusedSelection.current || selectedId === null) return;
    const card = gridRef.current?.querySelector<HTMLElement>(`[data-game-card="${selectedId}"]`);
    if (!card) return;
    focusedSelection.current = true;
    card.focus({ preventScroll: true });
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = [...grid.querySelectorAll<HTMLElement>('[data-game-card]')];
    const index = cards.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const columns = columnsOf(grid);
    const target =
      event.key === 'ArrowRight'
        ? index + 1
        : event.key === 'ArrowLeft'
          ? index - 1
          : event.key === 'ArrowDown'
            ? index + columns
            : event.key === 'ArrowUp'
              ? index - columns
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? cards.length - 1
                  : null;
    if (target === null) return;
    event.preventDefault();
    const next = cards[Math.max(0, Math.min(cards.length - 1, target))];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  };

  return (
    <ul
      ref={gridRef}
      aria-label="Games"
      data-testid="library-grid"
      onKeyDown={onKeyDown}
      className="group/grid grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6"
    >
      {games.map((game) => (
        <li key={game.id} className="animate-screen-in group-data-[settled=true]/grid:animate-none">
          <GameCard
            game={game}
            selected={game.id === selectedId}
            onSelect={() => onSelectGame(game.id)}
          />
        </li>
      ))}
    </ul>
  );
};
