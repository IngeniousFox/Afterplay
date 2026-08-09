import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MailboxGameSource } from '../../../../src/shared/planMailbox';
import { ApiFailure, enqueuePlan, searchGames } from '../../api';
import type { SearchResult } from '../../api';
import { Cover } from '../Cover';
import { STEAM_BLUE } from '../../lib/ratings';
import { BLUE } from '../../lib/status';

// Panel de alta: buscar en IGDB y encolar.
//
// Es una hoja a pantalla completa y no un modal centrado: en un móvil, un
// buscador con teclado abierto necesita todo el alto que haya, y un modal
// flotante deja el listado en una rendija de 200px.

// Cuánto se espera desde la última tecla antes de preguntarle a IGDB. Sin
// esto, escribir "hollow knight" son trece búsquedas de las que doce no
// interesan a nadie — y cada una es una petición del Worker contra una API
// ajena con cuota.
const DEBOUNCE_MS = 350;

// Clave estable de un resultado, venga de donde venga. Los dos catálogos
// numeran por su cuenta, así que un igdbId y un appid pueden coincidir sin
// tener nada que ver — usar el número pelado como key de React mezclaría dos
// juegos distintos.
const sourceKey = (source: MailboxGameSource): string =>
  'igdbId' in source ? `igdb:${source.igdbId}` : `steam:${source.steamAppId}`;

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
  // Los que ya has mandado en ESTA sesión del panel: el botón se queda en
  // "hecho" en vez de volver a estar disponible, que invitaría a encolar el
  // mismo juego tres veces sin enterarte.
  const [queued, setQueued] = useState<Set<string>>(new Set());
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
    mutationFn: (game: SearchResult) =>
      enqueuePlan({
        type: 'add',
        source: game.source,
        title: game.title,
        coverUrl: game.coverUrl,
        note: null,
      }),
    onSuccess: (_data, game) => {
      setQueued((previous) => new Set(previous).add(sourceKey(game.source)));
      // Que el fantasma aparezca en el Plan al cerrar, sin recargar.
      void queryClient.invalidateQueries({ queryKey: ['plan-pending'] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0b0a]">
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
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-white/14"
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
            Couldn&apos;t reach the game catalog.
          </p>
        ) : results.data.length === 0 ? (
          <p className="py-16 text-center text-[12.5px] text-muted-foreground">
            Nothing found for “{debounced}”.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {results.data.map((game) => {
              const key = sourceKey(game.source);
              const done = queued.has(key);
              const busy =
                add.isPending && add.variables && sourceKey(add.variables.source) === key;
              const fromSteam = 'steamAppId' in game.source;
              return (
                <div
                  key={key}
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
                        <span className="text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                          {game.releaseYear}
                        </span>
                      )}
                      {/* Lo que ya tienes se dice AQUÍ y no al fallar: el
                          UNIQUE de games.igdbId lo rechazaría igualmente, pero
                          en la máquina del escritorio y sin nadie mirando. */}
                      {/* Los que solo están en Steam se marcan: su ficha va a
                          ser más pobre (sin tiempos de HowLongToBeat, sin
                          notas de crítica) hasta que IGDB los catalogue, y
                          entonces el escritorio adopta la de IGDB solo. */}
                      {fromSteam && !game.owned && (
                        <span
                          className="text-[10px] font-bold tracking-wide"
                          style={{ color: STEAM_BLUE }}
                        >
                          VIA STEAM
                        </span>
                      )}
                      {game.owned && (
                        <span
                          className="text-[10px] font-bold tracking-wide"
                          style={{
                            color: game.owned === 'library' ? 'var(--muted-foreground)' : BLUE,
                          }}
                        >
                          {game.owned === 'plan'
                            ? 'ALREADY PLANNED'
                            : game.owned === 'queued'
                              ? 'ALREADY QUEUED'
                              : 'IN YOUR LIBRARY'}
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
                      aria-label={done ? 'Queued' : `Add ${game.title} to your plan`}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-full border"
                      style={
                        done
                          ? { borderColor: `${BLUE}4d`, background: `${BLUE}1f`, color: BLUE }
                          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.04)' }
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
            {add.error instanceof ApiFailure ? add.error.message : "Couldn't queue that one."}
          </p>
        )}
      </div>

      <div className="flex-none border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)]">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Games you add are queued and completed the next time you open Afterplay on your PC —
          that&apos;s where the covers, times and store data get resolved.
        </p>
      </div>
    </div>
  );
};
