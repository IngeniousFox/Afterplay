import { ArrowRight, Gamepad2, Search, X } from 'lucide-react';
import { useState } from 'react';
import type { IgdbSearchResult } from '../../../../../shared/types';
import { revealClass, revealStyle } from '../../../lib/styles';
import { CoverThumb } from './CoverThumb';

type SearchStepProps = {
  query: string;
  onQueryChange: (query: string) => void;
  isLoading: boolean;
  results: IgdbSearchResult[] | undefined;
  onSelect: (result: IgdbSearchResult) => void;
};

// Cuántos géneros se pintan como chip antes de cortar — con más, la fila se
// convierte en un muro de píldoras y tapa al resto de la información.
const MAX_GENRES = 2;

// 72×100. Antes 56×74 sobre una fuente cover_small (90×128), que ya se
// quedaba corta en pantallas HiDPI; ahora la búsqueda pide cover_big
// (264×374, ver igdb/api.ts) y sobra resolución hasta el doble de este
// tamaño. Sin nada superpuesto encima: la carátula se ve entera, que es
// media gracia de reconocer un juego de un vistazo.
const CoverFrame = ({ url }: { url: string | null }): React.JSX.Element => (
  <div className="h-25 w-18 flex-none overflow-hidden rounded-[8px] border border-border bg-muted">
    <CoverThumb
      url={url}
      alt=""
      className="h-full w-full scale-100 object-cover transition-transform duration-300 group-hover/result:scale-108"
    />
  </div>
);

// Paso de búsqueda IGDB del modal de Add Game — el resto del modal (ficha
// elegida, playthrough, gasto…) se queda tal cual. Rediseño: además del
// repaso visual, dos mejoras de fondo — se pinta el `summary` que IGDB ya
// devolvía y la app tiraba a la basura (clave para distinguir juegos con el
// mismo nombre), y la lista se puede recorrer con el teclado sin soltar el
// buscador.
export const SearchStep = ({
  query,
  onQueryChange,
  isLoading,
  results,
  onSelect,
}: SearchStepProps): React.JSX.Element => {
  // Índice resaltado por TECLADO — a propósito separado del :hover del ratón
  // (que se queda en CSS puro): si el hover moviera este índice, el
  // scrollIntoView de abajo pelearía con el scroll del propio usuario.
  const [highlighted, setHighlighted] = useState(-1);
  // Cambiar la búsqueda descarta el resaltado anterior (apuntaría a un juego
  // que ya no está en la lista) — ajuste durante el render, sin useEffect,
  // como el resto de la app.
  const [seenQuery, setSeenQuery] = useState(query);
  if (query !== seenQuery) {
    setSeenQuery(query);
    setHighlighted(-1);
  }

  const trimmed = query.trim();
  const hasResults = results !== undefined && results.length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!results || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => Math.min(results.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && highlighted >= 0) {
      event.preventDefault();
      onSelect(results[highlighted]);
    }
  };

  return (
    <>
      {/* group + focus-within: el brillo del foco tiene que envolver también
          al icono y al botón de limpiar, no solo al campo de texto. */}
      <div className="group/search relative">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-primary"
        />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search a game… (e.g. Sekiro)"
          className="w-full rounded-[10px] border border-input bg-white/[0.03] py-2.75 pr-9.5 pl-9.5 text-sm text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-primary/45 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(47,220,126,.12)]"
        />
        {trimmed !== '' && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2.75 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-white/8 hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {hasResults && (
        <div className="mt-3.5 flex items-center justify-between px-0.5">
          <span className="text-[11px] font-bold tracking-[.11em] text-muted-foreground">
            {results.length} {results.length === 1 ? 'RESULT' : 'RESULTS'}
          </span>
          <span className="text-[10.5px] text-muted-foreground/60">↑ ↓ to browse · ↵ to pick</span>
        </div>
      )}

      <div className="mt-2.5 flex flex-col gap-2">
        {isLoading && trimmed ? (
          Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex animate-pulse items-center gap-3.25 rounded-[11px] border border-border p-2.75"
            >
              {/* Mismo tamaño que CoverFrame, para que al llegar los
                  resultados la fila no cambie de alto ni dé el salto. */}
              <div className="h-25 w-18 flex-none rounded-[8px] bg-white/[0.06]" />
              <div className="flex-1">
                <div className="h-3.5 w-2/3 rounded bg-white/[0.06]" />
                <div className="mt-2 h-3 w-1/3 rounded bg-white/[0.05]" />
                <div className="mt-2.5 h-2.5 w-full rounded bg-white/[0.04]" />
                <div className="mt-1.5 h-2.5 w-4/5 rounded bg-white/[0.04]" />
              </div>
            </div>
          ))
        ) : trimmed === '' ? (
          // Antes esto era un hueco en blanco: el modal abría sin decir nada
          // hasta que escribías. Ahora explica de dónde salen los resultados.
          <div className="flex flex-col items-center gap-2.5 px-4 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04]">
              <Gamepad2 size={20} strokeWidth={1.5} className="text-muted-foreground/50" />
            </div>
            <p className="text-[13px] font-semibold text-foreground">Find a game to add</p>
            <p className="max-w-64 text-[12px] text-muted-foreground">
              Type a title and pick it from the IGDB catalog — cover, genres and release year come
              filled in.
            </p>
          </div>
        ) : results?.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.04]">
              <Search size={18} strokeWidth={1.5} className="text-muted-foreground/50" />
            </div>
            <p className="text-[13px] text-muted-foreground">
              No games found in the catalog — try another title.
            </p>
          </div>
        ) : (
          // Sin key artificial por búsqueda: cada tecleo trae igdbId
          // distintos, así que React ya monta filas nuevas por su cuenta —
          // eso solo ya relanza animate-in, sin necesitar un key de más.
          results?.map((result, index) => {
            const isHighlighted = index === highlighted;
            return (
              <button
                key={result.igdbId}
                type="button"
                onClick={() => onSelect(result)}
                // block:'nearest' es idempotente (no hace nada si la fila ya
                // se ve entera), así que vale con llamarlo al pintar la fila
                // resaltada — sin efectos ni refs que mantener.
                ref={isHighlighted ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={`group/result flex items-start gap-3.25 rounded-[11px] border p-2.75 text-left transition-[transform,border-color,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-white/[0.05] hover:shadow-[0_8px_20px_rgba(0,0,0,.35)] ${
                  isHighlighted
                    ? 'border-primary/45 bg-white/[0.06] shadow-[0_8px_20px_rgba(0,0,0,.35)]'
                    : 'border-border bg-white/[0.02]'
                } ${revealClass}`}
                style={revealStyle(Math.min(index, 6))}
              >
                <CoverFrame url={result.coverUrl} />

                <div className="min-w-0 flex-1 py-0.5">
                  {/* Título + año en la misma línea, como los nombra todo el
                      mundo ("Doom (2016)"). El año va flex-none y el título
                      truncate: por largo que sea el nombre, el año —el dato
                      que distingue un original de su remake— nunca se pierde
                      en los puntos suspensivos. */}
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-bold text-foreground">
                      {result.title}
                    </span>
                    {result.releaseYear !== null && (
                      <span className="flex-none text-[12px] font-semibold text-muted-foreground/80 tabular-nums">
                        {result.releaseYear}
                      </span>
                    )}
                  </div>

                  <div className="mt-1.25 flex flex-wrap items-center gap-1.25">
                    {result.genres.slice(0, MAX_GENRES).map((genre) => (
                      <span
                        key={genre}
                        className="rounded-md border border-input bg-white/[0.04] px-1.75 py-0.5 text-[10px] font-semibold text-muted-foreground"
                      >
                        {genre}
                      </span>
                    ))}
                    {result.platforms.length > 0 && (
                      <span className="truncate text-[10.5px] text-muted-foreground/70">
                        {result.platforms.slice(0, 3).join(' · ')}
                      </span>
                    )}
                  </div>

                  {/* El summary ya venía de IGDB y no se pintaba en ninguna
                      parte — es justo lo que desempata entre dos juegos del
                      mismo nombre (remakes, colecciones, spin-offs). */}
                  {result.summary && (
                    <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground/75">
                      {result.summary}
                    </p>
                  )}
                </div>

                <ArrowRight
                  size={15}
                  className={`mt-1 flex-none transition-[transform,color] duration-150 group-hover/result:translate-x-0.75 group-hover/result:text-primary ${
                    isHighlighted ? 'translate-x-0.75 text-primary' : 'text-muted-foreground'
                  }`}
                />
              </button>
            );
          })
        )}
      </div>
    </>
  );
};
