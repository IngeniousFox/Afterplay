import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { CornerDownLeft, LayoutGrid, Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from './cn';
import type { GameListItem } from '../../../../shared/types';
import { useGames, usePlannedGames } from '../../hooks/games';
import { formatHours } from '../../lib/format';
import { filterByTitle } from '../../lib/search';
import { GameCover } from '../GameCover';
import { statusKeyOf as gameStatusKey } from '../../lib/gameFilters';
import { STATUS_META } from '../../lib/gameStatus';
import { StatusLed } from '../library/statusLed';
import { buttonSize, kbdClass, secondaryButtonClass } from './controls';

// LA PALETA DE CTRL K (concepto: sistema-controles-botones.png y
// estados-vacios.png, "Search with no results").
//
// Saltar a un juego desde cualquier pantalla. Filtra con filterByTitle, el
// mismo colador que usaban las columnas de navegación (acentos y puntuación
// plegados), sobre la biblioteca y el Plan.
//
// En Stats y en Sessions hace además lo que hacía su columna: elegir un juego
// FILTRA esa pantalla (?game=), con una fila "All games" para volver al
// conjunto. Ctrl+Enter abre la ficha también ahí.
//
// Sin animación de entrada: es algo que el teclado abre una y otra vez
// (README-sistema, principio 8).

const RECENT_COUNT = 8;
const RESULT_LIMIT = 40;

type Scope = 'stats' | 'sessions' | null;

type Item =
  | { kind: 'all'; key: string }
  | { kind: 'game'; key: string; game: GameListItem }
  | { kind: 'plan'; key: string; game: GameListItem };

const SCOPE_LABEL: Record<Exclude<Scope, null>, string> = {
  stats: 'Stats',
  sessions: 'Sessions',
};

const byLastPlayed = (a: GameListItem, b: GameListItem): number =>
  (b.lastPlayedAt?.getTime() ?? -Infinity) - (a.lastPlayedAt?.getTime() ?? -Infinity);

export const CommandPalette = ({
  open,
  onOpenChange,
  onAddGame,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddGame: () => void;
}): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Popup
          initialFocus={inputRef}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(640px,calc(100vw-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-line bg-overlay text-bone shadow-modal outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Jump to a game</DialogPrimitive.Title>
          <PaletteBody
            inputRef={inputRef}
            onClose={() => onOpenChange(false)}
            onAddGame={() => {
              onOpenChange(false);
              onAddGame();
            }}
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

const PaletteBody = ({
  inputRef,
  onClose,
  onAddGame,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onAddGame: () => void;
}): React.JSX.Element => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const scope: Scope =
    pathname === '/stats' ? 'stats' : pathname === '/sessions' ? 'sessions' : null;
  const { data: games = [] } = useGames();
  const { data: planned = [] } = usePlannedGames();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const trimmed = query.trim();
  const items: Item[] = [];
  if (scope && trimmed === '') items.push({ kind: 'all', key: 'all' });
  if (trimmed === '') {
    for (const game of [...games].sort(byLastPlayed).slice(0, RECENT_COUNT)) {
      items.push({ kind: 'game', key: `g${game.id}`, game });
    }
  } else {
    for (const game of filterByTitle(games, trimmed)) {
      items.push({ kind: 'game', key: `g${game.id}`, game });
    }
    // Los planeados no tienen sesiones ni estadísticas: en Stats y Sessions
    // la paleta no los ofrece, igual que no los ofrecía su columna.
    if (!scope) {
      for (const game of filterByTitle(planned, trimmed)) {
        items.push({ kind: 'plan', key: `p${game.id}`, game });
      }
    }
  }
  const shown = items.slice(0, RESULT_LIMIT);
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

  const choose = (item: Item, openPage: boolean): void => {
    onClose();
    if (item.kind === 'plan') {
      navigate(`/plan/${item.game.id}`);
    } else if (item.kind === 'all') {
      if (scope) navigate(`/${scope}`);
    } else if (scope && !openPage) {
      navigate(`/${scope}?game=${item.game.id}`);
    } else {
      navigate(`/games/${item.game.id}`);
    }
  };

  const move = (delta: 1 | -1): void => {
    if (shown.length === 0) return;
    const next = (activeIndex + delta + shown.length) % shown.length;
    setActive(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const optionId = (index: number): string => `palette-option-${index}`;

  return (
    <>
      <div className="flex flex-none items-center gap-3 border-b border-line px-4.5">
        <Search aria-hidden size={18} className="flex-none text-phosphor" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const item = shown[activeIndex];
              if (item) choose(item, event.ctrlKey || event.metaKey);
            }
          }}
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={shown.length > 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          placeholder={scope ? `Filter ${SCOPE_LABEL[scope]} by game…` : 'Jump to a game…'}
          className="h-14 min-w-0 flex-1 bg-transparent text-lead text-bone outline-none placeholder:text-dust"
        />
        <kbd className={kbdClass}>Esc</kbd>
      </div>

      {shown.length === 0 ? (
        <div className="px-5.5 py-5">
          <p className="text-body font-semibold text-bone">
            {games.length === 0 && planned.length === 0
              ? 'Your library is empty.'
              : `No games match “${trimmed}”.`}
          </p>
          <p className="mt-1 text-small text-dust">
            Check the spelling, or add the game to your library.
          </p>
          <button
            type="button"
            onClick={onAddGame}
            className={cn(secondaryButtonClass, buttonSize.md, 'mt-4')}
          >
            <Plus aria-hidden size={15} />
            Add a game…
          </button>
        </div>
      ) : (
        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label={trimmed === '' ? 'Recently played' : 'Matching games'}
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {trimmed === '' && (
            <div className="px-3 pt-1.5 pb-1 text-micro font-semibold text-dust">
              Recently played
            </div>
          )}
          {shown.map((item, index) => (
            <PaletteRow
              key={item.key}
              id={optionId(index)}
              index={index}
              item={item}
              active={index === activeIndex}
              scope={scope}
              onHover={() => setActive(index)}
              onChoose={(openPage) => choose(item, openPage)}
            />
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4.5 py-2.5 text-micro text-dust">
          <span>
            <kbd className={kbdClass}>↑</kbd> <kbd className={kbdClass}>↓</kbd> to move
          </span>
          <span>
            <kbd className={kbdClass}>Enter</kbd>{' '}
            {scope ? `to show in ${SCOPE_LABEL[scope]}` : 'to open'}
          </span>
          {scope && (
            <span>
              <kbd className={kbdClass}>Ctrl Enter</kbd> to open the game page
            </span>
          )}
        </div>
      )}
    </>
  );
};

const PaletteRow = ({
  id,
  index,
  item,
  active,
  scope,
  onHover,
  onChoose,
}: {
  id: string;
  index: number;
  item: Item;
  active: boolean;
  scope: Scope;
  onHover: () => void;
  onChoose: (openPage: boolean) => void;
}): React.JSX.Element => (
  <div
    id={id}
    data-index={index}
    role="option"
    aria-selected={active}
    onMouseMove={active ? undefined : onHover}
    onClick={(event) => onChoose(event.ctrlKey || event.metaKey)}
    className={cn(
      'relative flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-3 py-1.5',
      active &&
        'bg-phosphor-tint before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-phosphor',
    )}
  >
    {item.kind === 'all' ? (
      <>
        <span className="flex h-10 w-7.5 flex-none items-center justify-center rounded-xs bg-raised">
          <LayoutGrid aria-hidden size={15} className="text-dust" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-bone">All games</span>
          <span className="block text-micro text-dust">
            Clear the game filter in {scope ? SCOPE_LABEL[scope] : 'this screen'}
          </span>
        </span>
      </>
    ) : (
      <>
        <GameCover
          url={item.game.coverUrl}
          className="h-10 w-7.5 flex-none overflow-hidden rounded-xs bg-raised"
          iconSize={12}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-bone">{item.game.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-micro text-dust">
            {item.kind === 'plan' ? (
              <>
                <StatusLed status="plan" />
                Plan to play
              </>
            ) : (
              <>
                <StatusLed status={gameStatusKey(item.game)} />
                {STATUS_META[gameStatusKey(item.game)].label}
                {item.game.totalHours > 0 && <span>· {formatHours(item.game.totalHours)}</span>}
              </>
            )}
          </span>
        </span>
      </>
    )}
    {active && <CornerDownLeft aria-hidden size={14} className="flex-none text-dust" />}
  </div>
);
