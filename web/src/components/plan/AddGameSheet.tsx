import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, addToPlan, searchGames } from '../../api';
import type { IgdbSearchResult } from '../../api';
import { Cover } from '../Cover';
import { BLUE } from '../../lib/status';

// Panel de alta: buscar en IGDB y añadir al Plan. El hub crea el juego al
// instante con lo que da la búsqueda (§13.3); el resto lo completa un PC.
//
// Es una hoja a pantalla completa y no un modal centrado: en un móvil, un
// buscador con teclado abierto necesita todo el alto que haya, y un modal
// flotante deja el listado en una rendija de 200px.

// Cuánto se espera desde la última tecla antes de preguntarle a IGDB. Sin
// esto, escribir "hollow knight" son trece búsquedas de las que doce no
// interesan a nadie — y cada una es una petición del Worker contra una API
// ajena con cuota.
const DEBOUNCE_MS = 350;

const useDebounced = (value: string, ms: number): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
};

export const AddGameSheet = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  // Los que ya has añadido en ESTA sesión del panel: el botón se queda en
  // "hecho" en vez de volver a estar disponible. El hub rechazaría el duplicado
  // igualmente, pero así ni se intenta.
  const [added, setAdded] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchGames(debounced),
    // Menos de dos letras no es una búsqueda, es el principio de una.
    enabled: debounced.length >= 2,
  });

  const add = useMutation({
    mutationFn: (game: IgdbSearchResult) => addToPlan(game),
    onSuccess: (_data, game) => {
      setAdded((previous) => new Set(previous).add(game.igdbId));
      // Que el juego aparezca en el Plan al cerrar, sin recargar.
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cabinet">
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a game"
            type="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full rounded-xl border border-border bg-card py-2.5 pr-3 pl-9 text-[14px] font-semibold outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-line-strong"
        >
          <X size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {debounced.length < 2 ? (
          <p className="py-16 text-center text-[12.5px] text-muted-foreground">
            Type at least two letters.
          </p>
        ) : results.isPending ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : results.isError ? (
          <p className="py-16 text-center text-[12.5px] text-muted-foreground">
            {/* Los códigos de IGDB traen su frase ("abre Afterplay en tu PC una
                vez", "IGDB no responde"); el resto, el genérico. */}
            {results.error instanceof ApiFailure &&
            ['igdb_not_configured', 'igdb_unavailable', 'session_expired', 'timeout'].includes(
              results.error.code,
            )
              ? results.error.message
              : "Couldn't reach the game catalog."}
          </p>
        ) : results.data.length === 0 ? (
          <p className="py-16 text-center text-[12.5px] text-muted-foreground">
            Nothing found for “{debounced}”.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {results.data.map((game) => {
              const done = added.has(game.igdbId);
              const busy = add.isPending && add.variables?.igdbId === game.igdbId;
              return (
                <div
                  key={game.igdbId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
                >
                  <Cover
                    url={game.coverUrl}
                    title={game.title}
                    className={`w-10 ${game.owned ? 'opacity-50' : ''}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[13px] font-bold ${game.owned ? 'text-muted-foreground' : ''}`}
                    >
                      {game.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      {game.releaseYear !== null && (
                        <span className="text-micro font-semibold text-muted-foreground tabular-nums">
                          {game.releaseYear}
                        </span>
                      )}
                      {game.owned && (
                        <span
                          className="text-micro font-bold tracking-wide"
                          style={{
                            color: game.owned === 'library' ? 'var(--muted-foreground)' : BLUE,
                          }}
                        >
                          {game.owned === 'plan' ? 'ALREADY PLANNED' : 'IN YOUR LIBRARY'}
                        </span>
                      )}
                    </div>
                  </div>
                  {game.owned ? (
                    <span className="flex h-9 w-9 flex-none items-center justify-center text-muted-foreground/40">
                      <Check size={15} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={done || busy}
                      onClick={() => add.mutate(game)}
                      aria-label={done ? 'Added' : `Add ${game.title} to your plan`}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-full border"
                      style={
                        done
                          ? { borderColor: `${BLUE}4d`, background: `${BLUE}1f`, color: BLUE }
                          : { borderColor: 'var(--border)', background: 'rgba(233,228,216,.04)' }
                      }
                    >
                      {busy ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : done ? (
                        <Check size={15} />
                      ) : (
                        <Plus size={16} />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {add.isError && (
          <p className="mt-3 text-center text-[11.5px] text-destructive">
            {add.error instanceof ApiFailure ? add.error.message : "Couldn't add that one."}
          </p>
        )}
      </div>

      <div className="flex-none border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)]">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Games you add show up in your plan right away. Your PC fills in the times and store data
          the next time it syncs.
        </p>
      </div>
    </div>
  );
};
