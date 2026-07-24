import { ImageUp } from 'lucide-react';
import { NumberInput } from '../../ui/number-input';
import { CoverThumb } from './CoverThumb';
import { fieldLabelClass, textInputClass, textInputFocusClass } from './styles';
import type { CoverPickerTarget } from './CoverPicker';

type ImagesFieldProps = {
  coverUrl: string | null;
  heroUrl: string | null;
  onPick: (target: CoverPickerTarget) => void;
  // Editable a mano — null = el backend/CoverPicker lo resuelven por
  // nombre+año, como siempre. onChange recibe null si se borra el campo.
  steamGridDbId: number | null;
  onSteamGridDbIdChange: (id: number | null) => void;
};

// Preview + disparador del CoverPicker (SPEC 4.6) — carátula vertical y hero
// horizontal, cada una con su propio "Change" al pasar el ratón, más el id
// de SteamGridDB debajo (si el auto-match falla o se quiere forzar uno
// concreto, cambiarlo aquí hace que "Change cover/hero" busque fotos de ESE
// id). Puramente presentacional: quien lo usa (AddGameModal, ChangeCoverModal)
// decide de dónde sale cada valor.
export const ImagesField = ({
  coverUrl,
  heroUrl,
  onPick,
  steamGridDbId,
  onSteamGridDbIdChange,
}: ImagesFieldProps): React.JSX.Element => {
  return (
    <div>
      <div className={fieldLabelClass}>COVER & HERO IMAGE</div>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => onPick('cover')}
          className="group relative h-24 w-17.5 flex-none overflow-hidden rounded-lg border border-input bg-muted transition-colors duration-150 hover:border-primary/45"
        >
          <CoverThumb
            url={coverUrl}
            type="covers"
            alt=""
            className="h-full w-full scale-100 object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-[11px] font-semibold text-white opacity-0 transition-opacity duration-150 group-hover:bg-black/55 group-hover:opacity-100">
            Change
          </div>
        </button>

        <button
          type="button"
          onClick={() => onPick('hero')}
          className="group relative h-24 flex-1 overflow-hidden rounded-lg border border-input bg-muted transition-colors duration-150 hover:border-primary/45"
        >
          {heroUrl ? (
            <CoverThumb
              url={heroUrl}
              type="heroes"
              alt=""
              className="h-full w-full scale-100 object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageUp size={16} />
              <span className="text-[11.5px]">No hero image</span>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-[11px] font-semibold text-white opacity-0 transition-opacity duration-150 group-hover:bg-black/55 group-hover:opacity-100">
            {heroUrl ? 'Change' : 'Choose hero'}
          </div>
        </button>
      </div>

      <div className="mt-2.5">
        <div className={fieldLabelClass}>
          STEAMGRIDDB ID{' '}
          <span className="font-medium tracking-normal normal-case">
            · optional, overrides auto-match
          </span>
        </div>
        <NumberInput
          value={steamGridDbId ?? ''}
          min={0}
          step="1"
          placeholder="e.g. 5219 — from steamgriddb.com/game/5219"
          onChange={(event) => {
            const raw = event.target.value.trim();
            onSteamGridDbIdChange(raw === '' ? null : Number(raw));
          }}
          className={`${textInputClass} ${textInputFocusClass}`}
        />
      </div>
    </div>
  );
};
