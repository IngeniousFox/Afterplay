import { useLiveSeconds } from '../hooks/useLiveSeconds';
import { formatElapsed } from '../lib/format';

// El distintivo LIVE del escritorio, mismo aro verde y mismo latido del punto
// (SPEC 10.5). Es la única pieza de la interfaz que se mueve sola, y a
// propósito: significa "esto está pasando ahora mismo".
export const LiveBadge = (): React.JSX.Element => (
  <span
    className="inline-flex items-center gap-1.25 rounded-[7px] border px-2 py-0.75"
    style={{
      background: 'rgba(8,20,13,.78)',
      borderColor: 'rgba(47,220,126,.55)',
      animation: 'afterplay-pulse-badge 2.4s infinite',
    }}
  >
    <span
      className="h-1.5 w-1.5 rounded-full bg-primary"
      style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
    />
    <span className="text-[9.5px] font-extrabold tracking-widest text-primary">LIVE</span>
  </span>
);

export const LiveTimer = ({ since }: { since: number }): React.JSX.Element => {
  const seconds = useLiveSeconds(since);
  return (
    <span className="text-[13px] font-bold text-primary tabular-nums">
      {formatElapsed(seconds)}
    </span>
  );
};
