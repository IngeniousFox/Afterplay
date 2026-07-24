import { ChevronDown, ImageUp } from 'lucide-react';
import { useState } from 'react';
import { expandClass } from '../../../lib/styles';
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
  // SIEMPRE plegado al abrir, tenga id o no: es un escape para cuando el
  // auto-match por nombre+año falla, no algo que se toque a diario. Un juego
  // ya añadido casi siempre trae id resuelto, así que abrirlo por tener valor
  // significaba en la práctica no plegarlo nunca en "Change cover". Y no se
  // esconde nada: con el grupo cerrado, la propia cabecera enseña el id.
  const [idOpen, setIdOpen] = useState(false);

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
        {/* Mismo lenguaje de grupo plegable que las cabeceras de la columna de
            biblioteca: chevron que gira, etiqueta y nada más. */}
        <button
          type="button"
          onClick={() => setIdOpen((current) => !current)}
          className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-[.05em] text-muted-foreground transition-colors duration-150 select-none hover:text-foreground"
        >
          <ChevronDown
            size={12}
            className="transition-transform duration-150"
            style={idOpen ? undefined : { transform: 'rotate(-90deg)' }}
          />
          <span>STEAMGRIDDB ID</span>
          {/* Con el grupo cerrado y un id puesto, el valor se ve igualmente —
              si no, parecería que no hay nada configurado ahí debajo. */}
          {!idOpen && steamGridDbId !== null && (
            <span className="font-medium tracking-normal text-foreground">{steamGridDbId}</span>
          )}
        </button>

        {idOpen && (
          <div className={`mt-1.75 ${expandClass}`}>
            <div className={fieldLabelClass}>
              <span className="font-medium tracking-normal normal-case">
                Optional — overrides the automatic match by name and year.
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
        )}
      </div>
    </div>
  );
};
