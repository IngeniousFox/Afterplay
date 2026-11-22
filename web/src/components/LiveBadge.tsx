import { useLiveSeconds } from '../hooks/useLiveSeconds';
import { cn } from '../lib/cn';
import { formatElapsed } from '../lib/format';
import { LiveDot } from './Figure';
import { GlowText } from './fx/GlowText';
import { Odometer } from './fx/Ticker';

// "Esto está pasando ahora mismo": el punto rojo de Fósforo con su palabra.
export const LiveBadge = ({ label = 'Live' }: { label?: string }): React.JSX.Element => (
  <span className="inline-flex items-center gap-1.5 text-micro font-semibold text-live">
    <LiveDot />
    {label}
  </span>
);

// El cronómetro de una sesión viva: bloom de fósforo que respira (GlowText) y
// los dígitos que cambian cayendo como un marcador (Odometer). El textContent
// sigue siendo el tiempo tal cual ("1:23:45").
export const LiveTimer = ({
  since,
  className = 'font-display text-[28px] leading-none font-bold text-phosphor',
}: {
  since: number;
  className?: string;
}): React.JSX.Element => {
  const seconds = useLiveSeconds(since);
  return (
    <GlowText breathe role="timer" className={cn(className, 'tabular-nums')}>
      <Odometer value={formatElapsed(seconds)} />
    </GlowText>
  );
};
