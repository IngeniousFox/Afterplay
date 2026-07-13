import { ImageUp } from 'lucide-react';
import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { IgdbSearchResult } from '../../../../../shared/types';
import { useIgdbDetails } from '../../../hooks/igdb';
import { CoverThumb } from './CoverThumb';
import { fieldLabelClass } from './styles';
import type { AddGameFormValues } from './types';
import type { CoverPickerTarget } from './CoverPicker';

type ImagesFieldProps = {
  selected: IgdbSearchResult;
  onPick: (target: CoverPickerTarget) => void;
};

// Preview + disparador del CoverPicker (SPEC 4.6) — carátula vertical y hero
// horizontal, cada una con su propio "Change" al pasar el ratón. La
// carátula cae de vuelta al resultado de búsqueda mientras no haya
// elección propia; el hero no tiene ese fallback (la búsqueda no lo trae),
// así que en cuanto llega el detalle de IGDB se rellena solo con su primera
// candidata — sin esto se guardaría heroUrl null salvo que el usuario
// entrara al picker a mano, y la mayoría de juegos sí tienen artwork.
export const ImagesField = ({ selected, onPick }: ImagesFieldProps): React.JSX.Element => {
  const { control, setValue } = useFormContext<AddGameFormValues>();
  const coverUrl = useWatch({ control, name: 'coverUrl' });
  const heroUrl = useWatch({ control, name: 'heroUrl' });
  const detail = useIgdbDetails(selected.igdbId);

  useEffect(() => {
    if (heroUrl === null && detail.data?.heroes[0]) {
      setValue('heroUrl', detail.data.heroes[0]);
    }
  }, [heroUrl, detail.data, setValue]);

  return (
    <div>
      <div className={fieldLabelClass}>COVER & HERO IMAGE</div>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => onPick('cover')}
          className="group relative h-24 w-17.5 flex-none overflow-hidden rounded-lg border border-input bg-muted"
        >
          <CoverThumb
            url={coverUrl ?? selected.coverUrl}
            type="covers"
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-[11px] font-semibold text-white opacity-0 group-hover:bg-black/55 group-hover:opacity-100">
            Change
          </div>
        </button>

        <button
          type="button"
          onClick={() => onPick('hero')}
          className="group relative h-24 flex-1 overflow-hidden rounded-lg border border-input bg-muted"
        >
          {heroUrl ? (
            <CoverThumb url={heroUrl} type="heroes" alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageUp size={16} />
              <span className="text-[11.5px]">No hero image</span>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-[11px] font-semibold text-white opacity-0 group-hover:bg-black/55 group-hover:opacity-100">
            {heroUrl ? 'Change' : 'Choose hero'}
          </div>
        </button>
      </div>
    </div>
  );
};
