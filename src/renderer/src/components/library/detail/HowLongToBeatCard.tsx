import type { GameDetail } from '../../../../../shared/types';
import { formatHours } from '../../../lib/format';

type HowLongToBeatCardProps = {
  game: GameDetail;
};

const StatBox = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}): React.JSX.Element => (
  <div className="flex-1 rounded-[10px] border border-border bg-white/[0.02] px-1 py-2.75 text-center">
    <div className="mb-1.75 flex items-center justify-center gap-1.25">
      <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: color }} />
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
    </div>
    <div className="text-sm font-extrabold tabular-nums">{value}</div>
  </div>
);

// SPEC 10.7 / prototipo — barra de 3 tramos (main/main+extra/100%) +
// marcador vertical blanco con etiqueta mostrando las horas propias como
// posición relativa al total "100%" (completionist).
export const HowLongToBeatCard = ({ game }: HowLongToBeatCardProps): React.JSX.Element | null => {
  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;
  if (main === 0 && extra === 0 && completionist === 0) return null;

  const comp = Math.max(1, completionist);
  const segMain = (main / comp) * 100;
  const segExtra = (Math.max(0, extra - main) / comp) * 100;
  const segComp = (Math.max(0, completionist - extra) / comp) * 100;
  const markerPct = Math.max(0, Math.min(100, (game.totalHours / comp) * 100));

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="text-[13.5px] font-bold text-foreground">How long to beat</div>
      <div className="mt-0.5 mb-6.5 text-xs text-muted-foreground">
        Marker shows what you&apos;ve played
      </div>

      <div className="relative mb-4.5">
        <div
          className="absolute -top-5 -translate-x-1/2 rounded-md border border-input px-1.5 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap text-foreground tabular-nums shadow-[0_4px_10px_rgba(0,0,0,.4)]"
          style={{ left: `${markerPct}%`, background: '#1d211f' }}
        >
          {formatHours(game.totalHours)}
        </div>
        <div
          className="absolute -top-0.75 -translate-x-1/2 rounded-sm bg-white"
          style={{
            left: `${markerPct}%`,
            width: 3,
            height: 18,
            boxShadow: '0 0 0 2px rgba(13,15,14,.85)',
          }}
        />
        <div className="flex h-3 overflow-hidden rounded-md bg-white/5">
          <div style={{ width: `${segMain}%`, background: '#2bb6a6' }} />
          <div style={{ width: `${segExtra}%`, background: '#3f7fe0' }} />
          <div style={{ width: `${segComp}%`, background: '#2fdc7e' }} />
        </div>
      </div>

      <div className="flex gap-2">
        <StatBox color="#2bb6a6" label="Main story" value={formatHours(main)} />
        <StatBox color="#3f7fe0" label="Main + extra" value={formatHours(extra)} />
        <StatBox color="#2fdc7e" label="100%" value={formatHours(completionist)} />
      </div>
    </div>
  );
};
