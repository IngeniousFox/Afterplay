import { Clock } from 'lucide-react';
import type { IgdbSearchResult } from '../../../../../shared/types';
import { useHltbTimes } from '../../../hooks/hltb';
import { formatHours } from '../../../lib/format';
import { InfoChip } from '../detail/InfoChip';
import { CoverThumb } from './CoverThumb';

type SelectedGameSummaryProps = {
  selected: IgdbSearchResult;
  // El hero elegido (o el auto-rellenado por AddGameImagesField) — de fondo,
  // tras un velo oscuro: la ficha deja de ser una caja gris y pasa a ser
  // "el juego". Nullable: hasta que IGDB responde no hay hero, y la ficha
  // aguanta igual con su fondo plano.
  heroUrl?: string | null;
  // Sin esto no hay botón "Change" — el paso de un Plan to Play a la
  // biblioteca abre este mismo modal con el juego YA fijado, y ahí cambiar
  // de juego no tiene sentido.
  onChangeSelection?: () => void;
};

const MAX_GENRES = 3;

export const SelectedGameSummary = ({
  selected,
  heroUrl = null,
  onChangeSelection,
}: SelectedGameSummaryProps): React.JSX.Element => {
  const hltb = useHltbTimes(selected.title, selected.releaseYear);
  const hltbMainLabel =
    hltb.data?.hltbMain !== null && hltb.data?.hltbMain !== undefined
      ? formatHours(hltb.data.hltbMain)
      : null;

  return (
    <div className="relative mt-3.5 animate-in overflow-hidden rounded-xl border border-input bg-white/[0.03] fade-in-0 zoom-in-95 duration-300">
      {heroUrl && (
        <>
          <CoverThumb
            url={heroUrl}
            type="heroes"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Velo de izquierda (opaco, donde vive el texto) a derecha (el
              hero respira) — mismo truco que la cabecera del detalle. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(18,20,19,.97) 0%, rgba(18,20,19,.92) 40%, rgba(18,20,19,.55) 100%)',
            }}
          />
        </>
      )}

      <div className="relative flex items-center gap-3.5 p-3.5">
        <div className="h-21 w-15.5 flex-none overflow-hidden rounded-lg border border-white/15 bg-muted shadow-[0_8px_20px_rgba(0,0,0,.45)]">
          <CoverThumb url={selected.coverUrl} alt="" className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[16px] font-extrabold text-foreground">
              {selected.title}
            </span>
            {selected.releaseYear !== null && (
              <span className="flex-none text-[12px] font-semibold text-muted-foreground tabular-nums">
                {selected.releaseYear}
              </span>
            )}
          </div>

          {selected.genres.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.25">
              {selected.genres.slice(0, MAX_GENRES).map((genre) => (
                <InfoChip key={genre}>{genre}</InfoChip>
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock size={12} className="flex-none" />
            <span>
              HowLongToBeat ·{' '}
              <span className="font-semibold text-foreground">{hltbMainLabel ?? '—'}</span> main
              story
            </span>
          </div>
        </div>

        {onChangeSelection && (
          <button
            type="button"
            onClick={onChangeSelection}
            className="flex-none rounded-lg border border-white/15 bg-black/30 px-3 py-1.75 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:bg-black/50"
          >
            Change
          </button>
        )}
      </div>
    </div>
  );
};
