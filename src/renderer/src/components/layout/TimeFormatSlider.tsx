import { useState } from 'react';
import type { TimeFormat } from '../../../../shared/types';
import { SegmentedControl } from '../ui/segmented-control';

type TimeFormatSliderProps = {
  value: TimeFormat;
  onChange: (value: TimeFormat) => void;
};

const OPTIONS = [
  { value: '12h', label: '12 h' },
  { value: '24h', label: '24 h' },
] as const;

// El formato de hora de Ajustes → General: control segmentado 12 h / 24 h y,
// al lado, la hora de ahora escrita como quedará (estados-ajustes-general.png).
// La muestra es la de cuando se abrió la sección: no necesita correr.
export const TimeFormatSlider = ({ value, onChange }: TimeFormatSliderProps): React.JSX.Element => {
  const [now] = useState(() => new Date());
  const sample = now.toLocaleTimeString(value === '12h' ? 'en-US' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: value === '12h',
  });

  return (
    <div className="flex items-center gap-3">
      <SegmentedControl
        aria-label="Time format"
        value={value}
        options={OPTIONS}
        onChange={onChange}
      />
      <span className="w-17 text-small text-dust tabular-nums">{sample}</span>
    </div>
  );
};
