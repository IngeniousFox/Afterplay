import type { TimeFormat } from '../../../../shared/types';
import { accentGradientStyle } from '../../lib/styles';

type TimeFormatSliderProps = {
  value: TimeFormat;
  onChange: (value: TimeFormat) => void;
};

// Slider de dos posiciones (12h/24h) para el modal de Ajustes — a
// diferencia de CheckboxRow (una casilla on/off), aquí hay dos opciones
// mutuamente excluyentes con una pastilla que se desliza entre ambas.
export const TimeFormatSlider = ({ value, onChange }: TimeFormatSliderProps): React.JSX.Element => {
  const is24h = value === '24h';

  return (
    <div className="relative flex h-8 w-31 flex-none rounded-full border border-input bg-white/[0.03] p-0.5">
      <div
        // transform y no left: animar `left` corre en el hilo principal
        // (layout + paint en cada frame de los 200ms); translateX corre en el
        // compositor. Posiciones idénticas a las de antes: left fijo en 2px y
        // el destino era calc(50% - 2px) sobre los 122px de padding box del
        // contenedor (w-31 = 124px menos 1px de borde por lado) = 59px, o sea
        // un desplazamiento de 59 - 2 = 57px. Si cambia w-31, recalcula.
        className="absolute top-0.5 bottom-0.5 left-0.5 w-15 rounded-full transition-transform duration-200 ease-out"
        style={{
          transform: is24h ? 'translateX(57px)' : 'translateX(0)',
          background: accentGradientStyle.background,
        }}
      />
      <button
        type="button"
        onClick={() => onChange('12h')}
        className="relative z-1 flex-1 rounded-full text-[12px] font-bold transition-colors"
        style={{ color: is24h ? 'var(--muted-foreground)' : '#08120c' }}
      >
        12h
      </button>
      <button
        type="button"
        onClick={() => onChange('24h')}
        className="relative z-1 flex-1 rounded-full text-[12px] font-bold transition-colors"
        style={{ color: is24h ? '#08120c' : 'var(--muted-foreground)' }}
      >
        24h
      </button>
    </div>
  );
};
