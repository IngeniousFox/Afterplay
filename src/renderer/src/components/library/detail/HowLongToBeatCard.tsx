import { Info } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { formatHours } from '../../../lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';

type HowLongToBeatCardProps = {
  game: GameDetail;
  // El marcador compara contra el playthrough elegido en el dropdown de al
  // lado (GameDetail resuelve cuál es y pasa sus horas aquí) — para un
  // endless no hay playthroughs que comparar entre sí, así que ahí siempre
  // son las horas totales del juego.
  markerHours: number;
  markerScope: 'playthrough' | 'total';
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
export const HowLongToBeatCard = ({
  game,
  markerHours,
  markerScope,
}: HowLongToBeatCardProps): React.JSX.Element | null => {
  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;
  if (main === 0 && extra === 0 && completionist === 0) return null;

  // Escala la barra al mayor de los tres datos que SÍ conocemos — no siempre
  // a completionist. HLTB no siempre trae los tres tiempos; un dato que
  // falta llega como 0 igual que uno genuinamente 0, y si fuera justo
  // completionist el que falta (el caso más común: main+extra sí, 100% no),
  // escalar contra él da un denominador falso de 1h — los segmentos se
  // salen del 100% (el bug real: nada de verde, marcador siempre al borde).
  // Con el mayor de los tres, main+extra suman como mucho 100% y el
  // marcador cae donde toca de verdad.
  const scale = Math.max(main, extra, completionist, 1);
  const segMain = (main / scale) * 100;
  const segExtra = (Math.max(0, extra - main) / scale) * 100;
  const segComp = (Math.max(0, completionist - extra) / scale) * 100;
  const markerPct = Math.max(0, Math.min(100, (markerHours / scale) * 100));

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="text-[13.5px] font-bold text-foreground">How long to beat</div>
      <div className="mt-0.5 mb-6.5 flex items-center gap-1.25 text-xs text-muted-foreground">
        {markerScope === 'playthrough' ? (
          <>
            <span>Marker shows this playthrough&apos;s hours</span>
            <Tooltip>
              <TooltipTrigger>
                <Info size={12} />
              </TooltipTrigger>
              <TooltipContent>
                Switch playthroughs in the dropdown below to see how each one compares to these
                times.
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <span>Marker shows what you&apos;ve played</span>
        )}
      </div>

      <div className="relative mb-4.5">
        <div
          className="absolute -top-5 -translate-x-1/2 rounded-md border border-input px-1.5 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap text-foreground tabular-nums shadow-[0_4px_10px_rgba(0,0,0,.4)]"
          style={{ left: `${markerPct}%`, background: '#1d211f' }}
        >
          {formatHours(markerHours)}
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
