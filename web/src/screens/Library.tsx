import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLibrary } from '../api';
import type { LibraryGame, StateType } from '../api';
import { Cover } from '../components/Cover';
import { Figure, Led } from '../components/Figure';
import { LiveBadge } from '../components/LiveBadge';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { cn } from '../lib/cn';
import { formatHours, pluralize } from '../lib/format';
import { statusOf } from '../lib/status';
import {
  fieldClass,
  iconButtonClass,
  revealClass,
  revealDelay,
  rowLinkClass,
  statusTextClass,
} from '../lib/styles';

// La búsqueda es LOCAL, sobre la lista entera que ya está en memoria.
//
// Es una decisión de producto, no una pereza: buscar contra el servidor a cada
// tecla es latencia por pulsación, y en un tren con mala cobertura eso se
// siente roto. La lista completa va ligera a propósito (ver LibraryGame en
// worker/src/api-types.ts: sin géneros, sin HLTB, sin arte grande), así que
// cabe de sobra y a cambio la búsqueda es instantánea aunque se caiga la red.
// Los filtros por estado son lo mismo: un recorte en memoria de esa lista.
const matches = (game: LibraryGame, query: string): boolean =>
  game.title.toLowerCase().includes(query);

type FilterKey = 'all' | 'playing' | 'beaten' | 'unplayed' | 'resting' | 'dropped';

const FILTERS: {
  key: FilterKey;
  label: string;
  led: StateType | null;
  states?: (StateType | null)[];
}[] = [
  { key: 'all', label: 'All', led: null },
  { key: 'playing', label: 'Playing', led: 'started', states: ['started'] },
  { key: 'beaten', label: 'Beaten', led: 'completed', states: ['completed'] },
  { key: 'unplayed', label: 'Unplayed', led: null, states: [null, 'plan_to_play'] },
  { key: 'resting', label: 'Resting', led: 'resting', states: ['resting', 'on_hold'] },
  { key: 'dropped', label: 'Dropped', led: 'dropped', states: ['dropped'] },
];

const GameRow = ({ game, order }: { game: LibraryGame; order: number }): React.JSX.Element => {
  const status = statusOf(game.currentState);

  return (
    <li className="border-b border-line">
      <Link
        to={`/game/${game.id}`}
        // Cascada de entrada topada a las primeras filas: con 333 juegos, un
        // escalonado sin tope dejaría la última entrando segundos después.
        className={cn(rowLinkClass, revealClass)}
        style={revealDelay(order, 22, 14)}
      >
        <Cover url={game.coverUrl} title={game.title} className="w-11" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-body font-semibold text-bone">{game.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-small">
            {game.isLive ? (
              <LiveBadge label="Playing now" />
            ) : (
              <>
                <Led state={game.currentState} />
                <span className={statusTextClass(game.currentState)}>{status.label}</span>
              </>
            )}
          </div>
        </div>
        {game.totalHours > 0 && (
          <Figure
            value={formatHours(game.totalHours)}
            className="shrink-0 text-[26px] leading-none text-bone"
          />
        )}
      </Link>
    </li>
  );
};

export const Library = (): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const library = useQuery({ queryKey: ['library'], queryFn: fetchLibrary });

  const counts = useMemo(() => {
    const result = {} as Record<FilterKey, number>;
    for (const option of FILTERS) {
      result[option.key] = option.states
        ? (library.data ?? []).filter((game) => option.states?.includes(game.currentState)).length
        : (library.data?.length ?? 0);
    }
    return result;
  }, [library.data]);

  const filtered = useMemo(() => {
    if (!library.data) return [];
    const needle = query.trim().toLowerCase();
    const states = FILTERS.find((option) => option.key === filter)?.states;
    return library.data.filter(
      (game) =>
        (!states || states.includes(game.currentState)) && (!needle || matches(game, needle)),
    );
  }, [library.data, query, filter]);

  const header = (
    <PageHeader
      title="Library"
      aside={library.data ? pluralize(library.data.length, 'game') : undefined}
    />
  );

  const search = (
    <div className="relative">
      <Search
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dust"
      />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search your library"
        aria-label="Search your library"
        // type="search" para que el teclado del móvil traiga la tecla de
        // buscar; autoCorrect fuera porque los títulos de juego no son
        // palabras y el corrector los destroza.
        type="search"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        className={cn(fieldClass, 'pr-11 pl-9 [&::-webkit-search-cancel-button]:hidden')}
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          aria-label="Clear search"
          className={cn(iconButtonClass, 'absolute top-0 right-0')}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );

  if (library.isPending)
    return (
      <div className="px-4">
        {header}
        {search}
        <Loading label="Reading your library" />
      </div>
    );
  if (library.isError)
    return (
      <div className="px-4">
        {header}
        <ErrorState error={library.error} onRetry={() => library.refetch()} />
      </div>
    );

  return (
    <div className="px-4 pb-6">
      {header}
      {search}

      {/* Filtros por estado: fila que se desliza en horizontal. Cada chip
          mide 36 px a la vista y 44 de diana (el ::after amplía la zona). */}
      <div className="-mx-4 mt-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div role="group" aria-label="Filter by status" className="flex w-max gap-2 py-1">
          {FILTERS.filter((option) => option.key === 'all' || counts[option.key] > 0).map(
            (option) => {
              const active = filter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(option.key)}
                  className={cn(
                    'relative inline-flex h-9 items-center gap-2 rounded-sm border px-3 text-small font-medium',
                    'transition-[transform,scale,background-color,border-color,color] duration-150 active:scale-[.96] motion-reduce:active:scale-100',
                    'after:absolute after:-inset-y-1 after:inset-x-0',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
                    active
                      ? 'border-phosphor bg-phosphor-tint text-bone'
                      : 'border-line-strong bg-panel text-dust',
                  )}
                >
                  {option.key !== 'all' && <Led state={option.led} />}
                  {option.label}
                  <span className="text-micro text-dust tabular-nums">{counts[option.key]}</span>
                </button>
              );
            },
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState>
          {query ? <>Nothing matches “{query}”.</> : 'No games with this status.'}
        </EmptyState>
      ) : (
        // key sobre la consulta y el filtro: al cambiar, la lista se remonta
        // y la cascada vuelve a lanzarse, así se ve que ha cambiado.
        <ul key={`${filter}:${query}`} className="mt-2 border-t border-line">
          {filtered.map((game, index) => (
            <GameRow key={game.id} game={game} order={index} />
          ))}
        </ul>
      )}
    </div>
  );
};
