import { Clock } from 'lucide-react';
import { NumberInput } from '../../ui/number-input';
import { fieldLabelClass } from './styles';

// Mismo campo "Hours played · outside the app" que se repite en
// PlayedBeforePanel, ManualPlaythroughsField, EndlessSection e
// IterationSection. Un solo marco: el propio NumberInput (Inset, borde Edge,
// foco Phosphor con halo), con el icono y la unidad dentro como adornos. Antes
// era una tile teñida con un hueco con borde y, dentro, el input con el suyo:
// tres marcos y colores en línea (GREEN con alfa) en vez de tokens.
// Acepta las mismas props que NumberInput (compatible con register() y con
// Controller) para poder sustituir el input sin tocar el sitio que lo usa.
export const HoursPlayedField = (props: React.ComponentProps<'input'>): React.JSX.Element => (
  <div className="min-w-0 flex-1">
    <div className={fieldLabelClass}>
      Hours played <span className="font-medium">· outside the app</span>
    </div>
    <div className="relative">
      <Clock
        aria-hidden
        size={13}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-phosphor/70"
      />
      <NumberInput
        aria-label="Hours played outside the app"
        {...props}
        min={0}
        placeholder="e.g. 42"
        className="w-full py-2 pr-7 pl-8.5 text-[15px] font-extrabold text-phosphor placeholder:font-medium placeholder:text-dust/60"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-micro font-bold text-phosphor/60"
      >
        h
      </span>
    </div>
  </div>
);
