import { useState } from 'react';
import { formatHours } from '../../lib/format';
import { StatCard } from './StatCard';

type DaypartSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
};

type TimeOfDayCardProps = {
  sessions: DaypartSession[];
};

// Franja por hora de ARRANQUE de la sesión — suficiente para el perfil (una
// sesión que cruza medianoche cuenta entera en su franja de inicio, como en
// el resto de gráficos, que agrupan por startedAt).
const DAYPARTS: { label: string; fromHour: number; toHour: number; color: string }[] = [
  { label: 'Morning', fromHour: 6, toHour: 12, color: '#e3b24a' },
  { label: 'Afternoon', fromHour: 12, toHour: 18, color: '#2fdc7e' },
  { label: 'Evening', fromHour: 18, toHour: 24, color: '#85a3d6' },
  { label: 'Night', fromHour: 0, toHour: 6, color: '#7c86c8' },
];

// ¿A qué hora del día juegas ESTO? — barra apilada de proporciones (mismo
// lenguaje que Status Breakdown) con las horas repartidas en Morning/
// Afternoon/Evening/Night, hover sincronizado entre tramo y fila.
export const TimeOfDayCard = ({ sessions }: TimeOfDayCardProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const seconds = DAYPARTS.map(() => 0);
  for (const session of sessions) {
    if (session.endedAt === null) continue;
    const hour = session.startedAt.getHours();
    const index = DAYPARTS.findIndex((part) => hour >= part.fromHour && hour < part.toHour);
    if (index >= 0) seconds[index] += session.durationSec ?? 0;
  }
  const total = seconds.reduce((sum, value) => sum + value, 0);
  const peakIndex = total > 0 ? seconds.indexOf(Math.max(...seconds)) : null;

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Time of day</div>
        {peakIndex !== null && (
          <div className="text-[11.5px] text-muted-foreground">
            mostly{' '}
            <span className="font-semibold" style={{ color: DAYPARTS[peakIndex].color }}>
              {DAYPARTS[peakIndex].label.toLowerCase()}
            </span>
          </div>
        )}
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground">No tracked sessions yet.</p>
      ) : (
        <>
          <div className="mb-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {DAYPARTS.map(
              (part, index) =>
                seconds[index] > 0 && (
                  <div
                    key={part.label}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className="transition-[width,opacity] duration-500"
                    style={{
                      width: `${(seconds[index] / total) * 100}%`,
                      background: part.color,
                      opacity: hoveredIndex !== null && hoveredIndex !== index ? 0.35 : 1,
                    }}
                  />
                ),
            )}
          </div>

          <div className="flex flex-1 flex-col justify-center gap-3">
            {DAYPARTS.map((part, index) => {
              const isDimmed = hoveredIndex !== null && hoveredIndex !== index;
              return (
                <div
                  key={part.label}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="flex items-center gap-2.5 transition-opacity duration-200"
                  style={{ opacity: isDimmed ? 0.45 : seconds[index] === 0 ? 0.5 : 1 }}
                >
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-[3px]"
                    style={{ background: part.color }}
                  />
                  <span className="text-[13px] font-semibold" style={{ color: part.color }}>
                    {part.label}
                  </span>
                  <span className="ml-auto text-[13px] font-bold text-foreground tabular-nums">
                    {formatHours(seconds[index] / 3600)}
                  </span>
                  <span className="w-9 flex-none text-right text-[11px] text-muted-foreground tabular-nums">
                    {Math.round((seconds[index] / total) * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </StatCard>
  );
};
