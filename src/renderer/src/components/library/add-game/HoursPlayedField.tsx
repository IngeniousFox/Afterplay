import { Clock } from 'lucide-react';
import { NumberInput } from '../../ui/number-input';

const GREEN = '#2fdc7e';

// Mismo campo "HOURS PLAYED · outside the app" que se repite en
// PlayedBeforePanel, ManualPlaythroughsField, EndlessSection e
// IterationSection — antes una label + NumberInput sueltos, ahora en el
// mismo lenguaje de "tile" teñida que ya usan las StatTile de GameCard y
// las MeasureTile del detalle. El input vive en su propio hueco oscuro
// dentro de la tile (no flotando transparente sobre el tinte) — así se ve
// de un vistazo que es un campo editable, no un dato de solo lectura.
// Acepta las mismas props que NumberInput (compatible con register() y con
// Controller) para poder sustituir el input sin tocar el sitio que lo usa.
export const HoursPlayedField = (props: React.ComponentProps<'input'>): React.JSX.Element => (
  <div
    className="flex-1 rounded-[9px] border px-3 py-2"
    style={{ borderColor: `${GREEN}2e`, background: `${GREEN}0f` }}
  >
    <div className="text-[9.5px] font-bold tracking-[.11em]" style={{ color: `${GREEN}c4` }}>
      HOURS PLAYED{' '}
      <span className="font-medium tracking-normal normal-case opacity-80">· outside the app</span>
    </div>
    <div
      className="mt-1 flex items-center gap-1.5 rounded-[7px] border px-2.25 py-1.5"
      style={{ borderColor: `${GREEN}26`, background: 'rgba(0,0,0,.22)' }}
    >
      <Clock size={13} className="flex-none" style={{ color: `${GREEN}99` }} />
      <NumberInput
        {...props}
        min={0}
        placeholder="e.g. 42"
        className="w-full bg-transparent text-[15px] font-extrabold tabular-nums outline-none placeholder:font-medium placeholder:text-muted-foreground/40"
        style={{ color: GREEN }}
      />
      <span className="flex-none text-[11px] font-bold" style={{ color: `${GREEN}80` }}>
        h
      </span>
    </div>
  </div>
);
