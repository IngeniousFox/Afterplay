import { useLiveSeconds } from '../hooks/useLiveSeconds';
import { formatElapsed } from '../lib/format';
import { LiveDot } from './Figure';

// "Esto está pasando ahora mismo": el punto rojo de Fósforo con su palabra.
// Es la única pieza de la interfaz que se mueve sola, y a propósito.
export const LiveBadge = ({ label = 'Live' }: { label?: string }): React.JSX.Element => (
  <span className="inline-flex items-center gap-1.5 text-micro font-semibold text-live">
    <LiveDot />
    {label}
  </span>
);

export const LiveTimer = ({
  since,
  className = 'font-display text-[28px] leading-none font-bold text-phosphor',
}: {
  since: number;
  className?: string;
}): React.JSX.Element => {
  const seconds = useLiveSeconds(since);
  return (
    <span role="timer" className={`${className} tabular-nums`}>
      {formatElapsed(seconds)}
    </span>
  );
};
