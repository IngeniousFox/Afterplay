import { Gamepad2, Radar, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IgdbSearchResult, RadarGame } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { DAY_MS, startOfDayMs } from '../../lib/dateMath';
import { focusRing, iconButtonClass } from '../shell/controls';
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
// de tus datos de decisión, y el gesto de descartar.
export const RadarRow = ({ game, onAdd, onDismiss }: RadarRowProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const isNew =
    (startOfDayMs(new Date()) - startOfDayMs(game.discoveredAt)) / DAY_MS <= NEW_FOR_DAYS;

  const add = (): void =>
    onAdd({
      igdbId: game.igdbId,
      title: game.title,
      coverUrl: game.coverUrl,
      releaseYear: game.releaseYear,
      platforms: [],
      genres: [],
      summary: null,
    });

  return (
    <div
      onClick={add}
      className="group/radar relative flex cursor-pointer items-stretch gap-3.5 rounded-md border border-dashed border-line-strong bg-transparent py-3 pr-3 pl-3.5 transition-[border-color,background-color] duration-150 ease-out hover:border-line-hover hover:bg-panel"
    >
      <div className="relative h-24 w-18 flex-none overflow-hidden rounded-sm border border-line bg-raised">
        {coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt={game.title}
            className="h-full w-full object-cover brightness-90"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 aria-hidden size={22} strokeWidth={1.5} className="text-dust/50" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              add();
            }}
            className={cn(
              'min-w-0 rounded-xs text-left text-lead font-semibold text-bone hover:underline underline-offset-2',
              focusRing,
            )}
          >
            {game.title}
          </button>
          {isNew && (
            <span className="flex flex-none items-center gap-1 self-center rounded-sm bg-tube/12 px-1.5 py-px text-micro font-semibold text-tube">
              <Sparkles aria-hidden size={11} />
              New
            </span>
          )}
          <ReleaseBadge game={game} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex flex-none items-center gap-1 rounded-sm border border-st-resting/30 bg-st-resting/8 px-1.5 py-0.5 text-micro font-medium text-st-resting">
            <Radar aria-hidden size={11} className="flex-none" />
            {game.collectionName
              ? `From the ${game.collectionName} series`
              : 'From one of your sagas'}
          </span>
        </div>

        <p className="mt-1.5 text-small text-dust">
          You don&apos;t have this one — click to add it to your plan or your library.
        </p>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        title="Not interested — hide this one"
        aria-label="Dismiss"
        className={cn(
          iconButtonClass,
          'size-7.5 self-start opacity-0 group-hover/radar:opacity-100 focus-visible:opacity-100',
        )}
      >
        <X aria-hidden size={15} />
      </button>
    </div>
  );
};
