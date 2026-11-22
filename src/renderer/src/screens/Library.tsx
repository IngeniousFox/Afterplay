import { RefreshCw, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { GameId } from '../../../shared/entityIds';
import { GameGrid } from '../components/library/GameGrid';
import { LibraryOnboarding } from '../components/library/LibraryOnboarding';
import { GameFilterPanel } from '../components/layout/GameFilterPanel';
import { ScanBeam } from '../components/fx/Backdrop';
import { GlowText } from '../components/fx/GlowText';
import { Ticker } from '../components/fx/Ticker';
import {
  buttonSize,
  focusRing,
  iconButtonClass,
  secondaryButtonClass,
  textLinkClass,
} from '../components/shell/controls';
import { useShell } from '../components/shell/shellContext';
import { useGames } from '../hooks/games';
import { useScrollMemory } from '../hooks/useScrollMemory';
import {
  applyFilters,
  availableGenres,
  countActiveFilters,
  statusKeyOf,
  type FilterGroup,
  type FlagKey,
  type SortKey,
} from '../lib/gameFilters';
import type { StatusKey } from '../lib/gameStatus';
import { filterByTitle } from '../lib/search';

// LIBRARY A PANTALLA COMPLETA (Fósforo, library.png).
//
// Filtros a la izquierda, la cifra grande de juegos arriba y la rejilla de
// portadas. Hace todo lo que hacía la antigua columna de juegos: buscar por
// título, filtrar, contar, dejar seleccionado el último juego abierto y
// navegar a su ficha. La vista (búsqueda, filtros, selección) vive en el
// armazón para sobrevivir a la ficha (ver shellContext).
//
// Movimiento (components/fx): la cifra grande cuenta hasta su valor (desde
// la anterior al filtrar), la rejilla entra escalonada al cargar y al cambiar
// de filtro, las portadas se inclinan con el ratón y la biblioteca vacía está
// en modo «attract», como una recreativa esperando moneda.

const GROUPS: FilterGroup[] = ['status', 'flags', 'playtime', 'era', 'genre'];
const FLAGS: FlagKey[] = ['endless', 'emulated'];
const SORTS: SortKey[] = [
  'last-played',
  'title',
  'hours-desc',
  'hours-asc',
  'added-desc',
  'release-desc',
];
const NO_COUNTS: Record<StatusKey, number> = {
  playing: 0,
  beaten: 0,
  dropped: 0,
  on_hold: 0,
  resting: 0,
  unplayed: 0,
  plan: 0,
};

export const Library = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { library, updateLibrary } = useShell();
  const { data: games = [], isLoading, isError, refetch } = useGames();
  const { attachRef, onScroll } = useScrollMemory<HTMLDivElement>('library');
  const { search, filters } = library;

  const searched = filterByTitle(games, search);
  const visible = applyFilters(searched, filters);
  // Recuento por estado con todo lo demás aplicado (búsqueda y el resto de
  // grupos): lo que saldría al marcar ese estado.
  const statusCounts = { ...NO_COUNTS };
  for (const game of applyFilters(searched, { ...filters, statuses: [] })) {
    statusCounts[statusKeyOf(game)] += 1;
  }
  const empty = !isLoading && !isError && games.length === 0;
  const narrowed = search.trim() !== '' || countActiveFilters(filters) > 0;

  const openGame = (id: GameId): void => {
    updateLibrary({ lastOpenedId: id });
    navigate(`/games/${id}`);
  };
  const clearAll = (): void =>
    updateLibrary({
      search: '',
      filters: { ...filters, statuses: [], genres: [], playtime: [], eras: [], flags: [] },
    });

  return (
    <div className="flex h-full">
      <GameFilterPanel
        filters={filters}
        onChange={(next) => updateLibrary({ filters: next })}
        groups={GROUPS}
        flags={FLAGS}
        sorts={SORTS}
        genres={availableGenres(games)}
        statusCounts={statusCounts}
        shown={visible.length}
        total={games.length}
        disabled={empty}
      />

      <div ref={attachRef} onScroll={onScroll} className="min-w-0 flex-1 overflow-y-auto">
        <div className="px-7 pt-5 pb-12">
          <h1 className="sr-only">Library</h1>
          <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <p className="flex items-baseline gap-3" aria-live="polite">
              {isLoading ? (
                <span className="font-display text-stat font-bold text-bone tabular-nums">–</span>
              ) : (
                <Ticker
                  value={visible.length}
                  from="previous"
                  duration={520}
                  className={cn(
                    'font-display text-stat font-bold tabular-nums',
                    empty ? 'text-phosphor' : 'text-bone',
                  )}
                />
              )}
              <span className="font-display text-title font-semibold text-dust">
                {narrowed && !empty
                  ? `of ${games.length} ${games.length === 1 ? 'game' : 'games'}`
                  : visible.length === 1
                    ? 'game'
                    : 'games'}
              </span>
            </p>

            {!empty && (
              <div className="relative w-72 max-w-full">
                <Search
                  aria-hidden
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dust"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => updateLibrary({ search: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && search !== '') {
                      event.preventDefault();
                      updateLibrary({ search: '' });
                    }
                  }}
                  aria-label="Filter the library by title"
                  placeholder="Filter by title…"
                  className="h-8.5 w-full rounded-sm border border-edge bg-inset pr-9 pl-9 text-body text-bone outline-hidden placeholder:text-dust focus:border-phosphor focus:shadow-focus-field [&::-webkit-search-cancel-button]:hidden"
                />
                {search !== '' && (
                  <button
                    type="button"
                    onClick={() => updateLibrary({ search: '' })}
                    aria-label="Clear search"
                    title="Clear search"
                    className={cn(iconButtonClass, 'absolute top-0 right-0 size-8.5')}
                  >
                    <X aria-hidden size={14} />
                  </button>
                )}
              </div>
            )}
          </header>

          {isLoading ? (
            <p className="text-body text-dust">Loading your library…</p>
          ) : isError ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-live">
                Something went wrong loading your library. Try again in a moment.
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className={cn(secondaryButtonClass, buttonSize.md)}
              >
                <RefreshCw aria-hidden size={14} />
                Try again
              </button>
            </div>
          ) : empty ? (
            <EmptyLibrary />
          ) : visible.length === 0 ? (
            <div className="rounded-md border border-line bg-panel px-6 py-8">
              <p className="text-body font-semibold text-bone">
                {search.trim() !== ''
                  ? `No games match “${search.trim()}”${countActiveFilters(filters) > 0 ? ' with these filters' : ''}.`
                  : 'No games match these filters.'}
              </p>
              <p className="mt-1 text-small text-dust">
                Check the spelling, or{' '}
                <button type="button" onClick={clearAll} className={textLinkClass}>
                  clear the search and filters
                </button>
                .
              </p>
            </div>
          ) : (
            <GameGrid
              games={visible}
              onSelectGame={openGame}
              selectedId={library.lastOpenedId}
              // Un filtro u orden nuevo reparte la entrada otra vez; escribir
              // en el buscador, no.
              dealKey={JSON.stringify(filters)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// Primer arranque, en modo «attract» de recreativa: la rejilla fantasma de
// borde punteado se desvanece hacia abajo y un testigo ámbar la recorre
// casilla a casilla; la primera es el "+" que abre el alta, con un «Insert
// game» que parpadea, y un haz barre el conjunto. Encima, los tres pasos.
// Reduced motion: todo quieto (el "+" sigue resaltado).
const ATTRACT_TILES = 7;
const ATTRACT_STEP_MS = 2400 / (ATTRACT_TILES + 1);

const EmptyLibrary = (): React.JSX.Element => {
  const { openAddGame } = useShell();
  return (
    <div className="relative">
      <div className="relative grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 mask-b-from-0% mask-b-to-100% opacity-80">
        <button
          type="button"
          onClick={openAddGame}
          aria-label="Add game"
          title="Add game"
          className={cn(
            'flex aspect-3/4 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-phosphor/50 bg-phosphor/5 text-phosphor transition-colors duration-150 hover:bg-phosphor/10',
            focusRing,
          )}
        >
          <GlowText className="font-display text-title">+</GlowText>
          <span
            aria-hidden
            className="animate-blink text-small font-semibold motion-reduce:animate-none"
            // Cuatro parpadeos y se queda encendido: un texto que parpadea
            // sin fin pasa de molestia a barrera (WCAG 2.2.2).
            style={{ animationIterationCount: 4 }}
          >
            Insert game
          </span>
        </button>
        {Array.from({ length: ATTRACT_TILES }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className="aspect-3/4 animate-attract rounded-sm border border-dashed border-line-strong motion-reduce:animate-none"
            style={{ animationDelay: `${(index + 1) * ATTRACT_STEP_MS}ms` }}
          />
        ))}
        <ScanBeam every={6} className="rounded-sm" />
      </div>
      <div className="relative -mt-40">
        <LibraryOnboarding />
      </div>
    </div>
  );
};
