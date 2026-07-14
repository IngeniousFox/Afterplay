import { ImageUp } from 'lucide-react';
import { CoverThumb } from './CoverThumb';
import { fieldLabelClass } from './styles';
import type { CoverPickerTarget } from './CoverPicker';

type ImagesFieldProps = {
  coverUrl: string | null;
  heroUrl: string | null;
  onPick: (target: CoverPickerTarget) => void;
};

// Preview + disparador del CoverPicker (SPEC 4.6) — carátula vertical y hero
// horizontal, cada una con su propio "Change" al pasar el ratón. Puramente
// presentacional: quien lo usa (AddGameModal, EditGameModal) decide de
// dónde sale cada URL (form field, fallback al resultado de búsqueda,
// valor ya guardado del juego...).
export const ImagesField = ({ coverUrl, heroUrl, onPick }: ImagesFieldProps): React.JSX.Element => {
  return (
    <div>
      <div className={fieldLabelClass}>COVER & HERO IMAGE</div>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => onPick('cover')}
          className="group relative h-24 w-17.5 flex-none overflow-hidden rounded-lg border border-input bg-muted"
        >
          <CoverThumb url={coverUrl} type="covers" alt="" className="h-full w-full object-cover" />
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
