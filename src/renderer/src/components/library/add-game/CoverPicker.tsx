import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import type { ImageCacheType } from '../../../../../shared/types';
import { useIgdbDetails } from '../../../hooks/igdb';
import { useSgdbImages } from '../../../hooks/sgdb';
import { cn } from '../../../lib/utils';
import { CoverThumb } from './CoverThumb';
import { fieldLabelClass } from './styles';

export type CoverPickerTarget = 'cover' | 'hero';

type CoverPickerProps = {
  target: CoverPickerTarget;
  igdbId: number;
  title: string;
  releaseYear: number | null;
  onSelect: (url: string) => void;
  onCancel: () => void;
};

const TARGET_LABEL: Record<CoverPickerTarget, string> = { cover: 'cover', hero: 'hero image' };
const CACHE_TYPE: Record<CoverPickerTarget, ImageCacheType> = { cover: 'covers', hero: 'heroes' };
const GRID_CLASS: Record<CoverPickerTarget, string> = {
  cover: 'grid grid-cols-4 gap-2.5',
  hero: 'grid grid-cols-2 gap-2.5',
};
const TILE_CLASS: Record<CoverPickerTarget, string> = {
  cover: 'aspect-[3/4]',
  hero: 'aspect-video',
};

// Vista del modal de añadir/editar juego (SPEC 4.6) — mismo modal, cambia
// de contenido por estado, no se apila encima. Junta candidatas de IGDB
// (detail.covers/heroes, ya trae al menos una porque el juego se resolvió al
// buscar) y de SteamGridDB (grids/heroes, puede tardar más y puede no tener
// nada para el juego — sin error, solo se queda sin esa sección).
export const CoverPicker = ({
  target,
  igdbId,
  title,
  releaseYear,
  onSelect,
  onCancel,
}: CoverPickerProps): React.JSX.Element => {
  const detail = useIgdbDetails(igdbId);
  const sgdb = useSgdbImages({ title, releaseYear });

  const candidates = useMemo(() => {
    const fromIgdb = target === 'cover' ? (detail.data?.covers ?? []) : (detail.data?.heroes ?? []);
    const fromSgdb =
      target === 'cover'
        ? (sgdb.data?.grids.map((candidate) => candidate.url) ?? [])
        : (sgdb.data?.heroes.map((candidate) => candidate.url) ?? []);
    return Array.from(new Set([...fromIgdb, ...fromSgdb]));
  }, [target, detail.data, sgdb.data]);

  const cacheType = CACHE_TYPE[target];
  const isInitialLoading = detail.isLoading;
  const isFetchingMore = sgdb.isLoading;
  const skeletonCount = target === 'cover' ? 8 : 4;

  return (
    <div>
      <button
        type="button"
        onClick={onCancel}
        className="mb-3.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <div className={fieldLabelClass}>CHOOSE {TARGET_LABEL[target].toUpperCase()}</div>

      {isInitialLoading ? (
        <div className={cn('mt-2', GRID_CLASS[target])}>
          {Array.from({ length: skeletonCount }, (_, index) => (
            <div
              key={index}
              className={cn('animate-pulse rounded-lg bg-white/[0.06]', TILE_CLASS[target])}
            />
          ))}
        </div>
      ) : candidates.length === 0 && !isFetchingMore ? (
        <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
          No images found for this game.
        </div>
      ) : (
        <div className={cn('mt-2', GRID_CLASS[target])}>
          {candidates.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => onSelect(url)}
              className={cn(
                'overflow-hidden rounded-lg border border-input bg-muted hover:border-[#2fdc7e]',
                TILE_CLASS[target],
              )}
            >
              <CoverThumb
                url={url}
                type={cacheType}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
          {isFetchingMore && (
            <div
              className={cn(
                'flex animate-pulse items-center justify-center rounded-lg border border-dashed border-input px-2 text-center text-[11px] text-muted-foreground',
                TILE_CLASS[target],
              )}
            >
              Loading more from SteamGridDB…
            </div>
          )}
        </div>
      )}
    </div>
  );
};
