import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLibrary } from '../api';
import type { LibraryGame } from '../api';
import { Cover } from '../components/Cover';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { formatHours, pluralize } from '../lib/format';
import { statusOf } from '../lib/status';

// La búsqueda es LOCAL, sobre la lista entera que ya está en memoria.
//
// Es una decisión de producto, no una pereza: buscar contra el servidor a cada
// tecla es latencia por pulsación, y en un tren con mala cobertura eso se
// siente roto. La lista completa va ligera a propósito (ver LibraryGame en
// worker/src/api-types.ts: sin géneros, sin HLTB, sin arte grande), así que
// cabe de sobra y a cambio la búsqueda es instantánea aunque se caiga la red.
const matches = (game: LibraryGame, query: string): boolean =>
  game.title.toLowerCase().includes(query);

const GameTile = ({ game, order }: { game: LibraryGame; order: number }): React.JSX.Element => {
  const status = statusOf(game.currentState);

  return (
    <Link
      to={`/game/${game.id}`}
      className="afterplay-reveal flex flex-col gap-1.5"
      // Cascada de entrada, como el revealClass del escritorio. El retraso se
      // topa a las ~24 primeras: con 333 juegos, un escalonado sin tope
      // dejaría la última carátula entrando veinte segundos después de abrir
      // la pantalla. Las de más abajo ni se ven al entrar, así que aparecen ya
      // puestas y nadie lo nota.
      style={{ animationDelay: `${Math.min(order, 23) * 22}ms` }}
    >
      <div className="relative">
        <Cover url={game.coverUrl} title={game.title} />
        {game.isLive && (
          <span
            className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary"
            style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
          />
        )}
        {/* La firma de color del estado al pie de la carátula — el mismo
            remate que las cards del escritorio y del Journey. */}
        <div
          className="absolute inset-x-0 bottom-0 h-0.75 rounded-b-[13px]"
          style={{ background: status.color }}
        />
      </div>
      <div className="line-clamp-2 text-[11.5px] leading-tight font-bold">{game.title}</div>
      {game.totalHours > 0 && (
        <div className="text-[10.5px] font-semibold text-muted-foreground tabular-nums">
          {formatHours(game.totalHours)}
        </div>
      )}
    </Link>
  );
};

export const Library = (): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const library = useQuery({ queryKey: ['library'], queryFn: fetchLibrary });

  const filtered = useMemo(() => {
    if (!library.data) return [];
    const needle = query.trim().toLowerCase();
    return needle ? library.data.filter((game) => matches(game, needle)) : library.data;
  }, [library.data, query]);

  if (library.isPending) return <Loading label="Reading your library" />;
  if (library.isError)
    return <ErrorState error={library.error} onRetry={() => library.refetch()} />;

  return (
    <div className="px-4 pt-4">
      <div className="relative mb-4">
        <Search
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your library"
          // type="search" para que el teclado del móvil traiga la tecla de
          // buscar; autoCorrect fuera porque los títulos de juego no son
          // palabras y el corrector los destroza.
          type="search"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-9 text-[14px] font-semibold outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="mb-3 text-[10px] font-bold tracking-[.13em] text-muted-foreground uppercase">
        {pluralize(filtered.length, 'game')}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Nothing matches “{query}”.</EmptyState>
      ) : (
        // key sobre la consulta de búsqueda: al filtrar, la parrilla se
        // remonta y la cascada vuelve a lanzarse — el mismo recurso que usa
        // Stats al cambiar de año. Sin él, filtrar reordena las carátulas en
        // silencio y no se ve que la lista ha cambiado.
        <div key={query} className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4">
          {filtered.map((game, index) => (
            <GameTile key={game.id} game={game} order={index} />
          ))}
        </div>
      )}
    </div>
  );
};
