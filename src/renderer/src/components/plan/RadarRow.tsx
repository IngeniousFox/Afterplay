import { Gamepad2, Radar, Sparkles, X } from 'lucide-react';
import type { IgdbSearchResult, RadarGame } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { DAY_MS, startOfDayMs } from '../../lib/dateMath';
import { VIOLET } from '../../lib/colors';
import { ReleaseBadge } from './ReleaseBadge';

// Cuánto tiempo un descubrimiento sigue siendo "nuevo". Una semana: el radar
// corre una vez por semana, así que esto marca exactamente lo que apareció
// desde la última vez que miraste.
const NEW_FOR_DAYS = 7;

type RadarRowProps = {
  game: RadarGame;
  onAdd: (game: IgdbSearchResult) => void;
  onDismiss: () => void;
};

// La fila de un DESCUBRIMIENTO del radar (PLAN-TO-PLAY.md §4.3): una entrega
// anunciada de una saga tuya que ni siquiera tienes.
//
// Se parece a una fila del Plan pero NO es una: este juego no está en tu
// biblioteca ni en tu lista, es una noticia. De ahí las tres diferencias
// deliberadas — el borde punteado (no es tuyo todavía), "de la saga X" en vez
// de tus datos de decisión (no hay horas jugadas ni notas que enseñar de algo
// que no existe), y el gesto de descartar, que una fila tuya no necesita.
export const RadarRow = ({ game, onAdd, onDismiss }: RadarRowProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const isNew =
    (startOfDayMs(new Date()) - startOfDayMs(game.discoveredAt)) / DAY_MS <= NEW_FOR_DAYS;

  return (
    <div
      onClick={() =>
        onAdd({
          igdbId: game.igdbId,
          title: game.title,
          coverUrl: game.coverUrl,
          releaseYear: game.releaseYear,
          platforms: [],
          genres: [],
          summary: null,
        })
      }
      className="group relative flex cursor-pointer gap-4 rounded-[15px] border border-dashed p-3.5 transition-[border-color,background-color] duration-150 hover:bg-white/[0.04]"
      style={{ borderColor: `${VIOLET}3d`, background: `${VIOLET}08` }}
    >
      <div className="relative h-32 w-24 flex-none overflow-hidden rounded-[10px] border border-white/10 bg-muted shadow-[0_8px_22px_rgba(0,0,0,.45)]">
        {coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt={game.title}
            className="h-full w-full object-cover brightness-90"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 size={22} strokeWidth={1.5} className="text-muted-foreground/40" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14.5px] leading-tight font-extrabold text-foreground">
              {game.title}
            </span>
            {isNew && (
              <span
                className="flex flex-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.08em]"
                style={{ color: VIOLET, background: `${VIOLET}24` }}
              >
                <Sparkles size={9} />
                NEW
              </span>
            )}
          </div>
          <div className="flex flex-none items-center gap-2">
            <ReleaseBadge game={game} />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
              title="Not interested — hide this one"
              aria-label="Dismiss"
              className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 opacity-0 transition-[opacity,background-color,border-color] duration-150 group-hover:opacity-100 hover:border-input hover:bg-white/[0.06] hover:text-foreground focus-visible:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex flex-none items-center gap-1.25 rounded-lg border px-2 py-0.75 text-[11.5px] font-semibold"
            style={{ color: VIOLET, borderColor: `${VIOLET}3d`, background: `${VIOLET}14` }}
          >
            <Radar size={11} className="flex-none" />
            {game.collectionName
              ? `From the ${game.collectionName} series`
              : 'From one of your sagas'}
          </span>
        </div>

        <div className="mt-1.75 text-[11.5px] leading-relaxed text-muted-foreground">
          You don&apos;t have this one — click to add it to your plan or your library.
        </div>
      </div>
    </div>
  );
};
