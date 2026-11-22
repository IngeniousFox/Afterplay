import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiFailure, addToPlan, searchGames } from '../../api';
import type { IgdbSearchResult } from '../../api';
import { Cover } from '../Cover';
import { cn } from '../../lib/cn';
import { fieldClass, iconButtonClass } from '../../lib/styles';

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const message = (text: React.ReactNode): React.JSX.Element => (
    <p className="py-16 text-center text-body text-dust">{text}</p>
  );

  // En un portal: un `fixed` dentro de un bloque con transform no cubre la
  // pantalla.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a game to your plan"
      className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-cabinet"
    >
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dust"
          />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a game"
            aria-label="Search for a game"
            type="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className={cn(fieldClass, 'pl-9')}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cn(iconButtonClass, 'border border-line-strong text-bone')}
        >
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {debounced.length < 2 ? (
          message('Type at least two letters.')
        ) : results.isPending ? (
          <div className="flex justify-center py-16" role="status" aria-label="Searching">
            <Loader2 size={22} className="animate-spin text-phosphor" />
          </div>
        ) : results.isError ? (
          message(
            // Los códigos de IGDB traen su frase ("abre Afterplay en tu PC una
            // vez", "IGDB no responde"); el resto, el genérico.
            results.error instanceof ApiFailure &&
              ['igdb_not_configured', 'igdb_unavailable', 'session_expired', 'timeout'].includes(
                results.error.code,
              )
              ? results.error.message
              : "Couldn't reach the game catalog.",
          )
        ) : results.data.length === 0 ? (
          message(<>Nothing found for “{debounced}”.</>)
        ) : (
          <ul className="flex flex-col gap-2">
            {results.data.map((game) => {
              const done = added.has(game.igdbId);
              const busy = add.isPending && add.variables?.igdbId === game.igdbId;
              return (
                <li
                  key={game.igdbId}
                  className={cn(
                    'flex items-center gap-3 rounded-md border border-line bg-panel p-2',
                    game.owned && 'bg-transparent',
                  )}
                >
                  <Cover
                    url={game.coverUrl}
                    title={game.title}
                    className={cn('w-11', game.owned && 'opacity-50')}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'line-clamp-2 text-body font-semibold',
                        game.owned ? 'text-dust' : 'text-bone',
                      )}
                    >
                      {game.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-dust tabular-nums">
                      {game.releaseYear !== null && <span>{game.releaseYear}</span>}
                      {game.owned && (
                        <span
                          className={cn(
                            'font-semibold',
                            game.owned === 'plan' ? 'text-tube' : 'text-bone',
                          )}
                        >
                          {game.owned === 'plan' ? 'Already planned' : 'In your library'}
                        </span>
                      )}
                      {done && <span className="font-semibold text-tube">Added to your plan</span>}
                    </div>
                  </div>
                  {game.owned ? (
                    <span className="flex size-11 shrink-0 items-center justify-center text-dust/60">
                      <Check size={16} aria-hidden="true" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={done || busy}
                      onClick={() => add.mutate(game)}
                      aria-label={done ? 'Added' : `Add ${game.title} to your plan`}
                      aria-busy={busy}
                      className={cn(
                        iconButtonClass,
                        'border',
                        done
                          ? 'border-tube/50 bg-tube/12 text-tube disabled:opacity-100'
                          : 'border-line-strong bg-raised text-bone',
                      )}
                    >
                      {busy ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : done ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={18} />
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {add.isError && (
          <p role="alert" className="mt-3 text-center text-small text-live">
            {add.error instanceof ApiFailure ? add.error.message : "Couldn't add that one."}
          </p>
        )}
      </div>

      <div className="flex-none border-t border-line px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+14px)]">
        <p className="text-small text-dust">
          Games you add show up in your plan right away. Your PC fills in the times and store data
          the next time it syncs.
        </p>
      </div>
    </div>,
    document.body,
  );
};
