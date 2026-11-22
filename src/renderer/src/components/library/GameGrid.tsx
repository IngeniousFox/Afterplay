import { useEffect, useRef } from 'react';
import type { GameListItem } from '../../../../shared/types';
import type { GameId } from '../../../../shared/entityIds';
import { useStagger } from '../fx/useStagger';
import { GameCard } from './GameCard';

// La rejilla de portadas de Library.
//
// ENTRADA ESCALONADA POR PANTALLA, no por lista (components/fx/Stagger):
// justo antes del primer pintado se mide qué tarjetas caen dentro del
// viewport —da igual a qué altura esté restaurado el scroll— y solo ESAS
// reciben la onda (un pop), ordenadas por posición visual. El resto aparece
// ya asentado. Así la cascada se ve siempre, su coste no depende del tamaño
// de la biblioteca (331 juegos: se animan las ~30 visibles) y quien hace
// scroll durante la entrada encuentra tarjetas ya asentadas.
//
// Se reparte otra vez al cambiar de FILTRO (`dealKey`), no al escribir en el
// buscador: lo que el teclado repite no se anima (README-sistema,
// principio 8).
//
// TECLADO: cada portada es un botón; las flechas mueven el foco por la
// rejilla (izquierda/derecha de una en una, arriba/abajo de fila en fila),
// Inicio y Fin van a la primera y a la última.
const INTRO_STEP_MS = 26;
const INTRO_STAGGER_CAP = 18;

type GameGridProps = {
  games: GameListItem[];
  onSelectGame: (id: GameId) => void;
  selectedId?: GameId | null;
  // Cambia → la entrada escalonada se repite (un filtro nuevo).
  dealKey?: string;
};

const columnsOf = (grid: HTMLElement): number =>
  getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;

export const GameGrid = ({
  games,
  onSelectGame,
  selectedId = null,
  dealKey = '',
}: GameGridProps): React.JSX.Element => {
  const gridRef = useStagger<HTMLUListElement>({
    variant: 'pop',
    step: INTRO_STEP_MS,
    max: INTRO_STAGGER_CAP,
    duration: 260,
    replayKey: dealKey,
  });
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
      className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6"
    >
      {games.map((game) => (
        <li key={game.id}>
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
