import { useMemo, useState } from 'react';
import { formatHours } from '../../lib/format';
import { StatCard } from './StatCard';
import type { Year } from './YearPicker';

type ChartSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

type WhenDoYouPlayChartProps = {
  sessions: ChartSession[];
  year: Year;
  // GameStats reusa esta card para UN juego ("When do you play it?") — el
  // título por defecto es el de la página global.
  title?: string;
};

const BAR_AREA_PX = 150;
const LABEL_SPACE_PX = 20;

// Lunes primero, como el heatmap (SPEC: etiquetas Mon/Wed/Fri) — getDay()
// de JS empieza en domingo, de ahí el (getDay()+6)%7 de abajo.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ¿Qué días de la semana juegas? — 7 barras con las horas totales por día,
// mismas reglas de datos que el heatmap y Hours per month: solo sesiones
// trackeadas de verdad (isManual false) y cerradas. "All Time" aquí es el
// histórico completo (es un perfil de costumbres, no una ventana de
// actividad reciente); un año concreto, solo ese año.
export const WhenDoYouPlayChart = ({
  sessions,
  year,
  title = 'When do you play?',
}: WhenDoYouPlayChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { days, maxSeconds, peakIndex } = useMemo(() => {
    const secondsByDay = Array.from({ length: 7 }, () => 0);
    for (const session of sessions) {
      if (session.isManual || session.endedAt === null) continue;
      if (year !== 'all' && session.startedAt.getFullYear() !== year) continue;
      const dayIndex = (session.startedAt.getDay() + 6) % 7;
      secondsByDay[dayIndex] += session.durationSec ?? 0;
    }

    const days = DAY_LABELS.map((label, index) => ({ label, seconds: secondsByDay[index] }));
    const maxSeconds = Math.max(0, ...secondsByDay);
    const peakIndex = maxSeconds > 0 ? secondsByDay.findIndex((s) => s === maxSeconds) : -1;

    return { days, maxSeconds, peakIndex };
  }, [sessions, year]);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4.5 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">{title}</div>
        {peakIndex >= 0 && (
          <div className="text-[11.5px] text-muted-foreground">
            {DAY_LABELS[peakIndex]} is your day
          </div>
        )}
      </div>

      <div className="flex flex-1 items-end gap-1.5" style={{ minHeight: BAR_AREA_PX }}>
        {days.map((day, index) => {
          const isHovered = hoveredIndex === index;
          const showLabel = day.seconds > 0 && (isHovered || index === peakIndex);
          const barPx =
            maxSeconds > 0 && day.seconds > 0
              ? Math.max(4, (day.seconds / maxSeconds) * (BAR_AREA_PX - LABEL_SPACE_PX))
              : 0;

          return (
            <div
              key={day.label}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="relative flex h-full flex-1 items-end justify-center"
            >
              <div
                className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-9 rounded-[6px]"
                style={{
                  height: BAR_AREA_PX - LABEL_SPACE_PX,
                  background: isHovered ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)',
                }}
              />
              {showLabel && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-bold whitespace-nowrap tabular-nums"
                  style={{ bottom: barPx + 5, color: isHovered ? 'var(--foreground)' : '#2fdc7e' }}
                >
                  {formatHours(day.seconds / 3600)}
                </span>
              )}
              <div
                className="relative w-full max-w-9 rounded-[6px] transition-[filter]"
                style={{
                  height: barPx,
                  background: 'linear-gradient(180deg,var(--ac),var(--ac2))',
                  filter:
                    hoveredIndex !== null && !isHovered ? 'saturate(.45) brightness(.7)' : 'none',
                  boxShadow: isHovered ? '0 0 18px rgba(47,220,126,.35)' : 'none',
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5 border-t border-white/5 pt-1.75">
        {days.map((day, index) => (
          <div
            key={day.label}
            className="flex-1 text-center text-[10px]"
            style={{
              color: hoveredIndex === index ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontWeight: hoveredIndex === index ? 700 : 400,
            }}
          >
            {day.label}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
