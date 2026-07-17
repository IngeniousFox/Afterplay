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

type HoursByMonthChartProps = {
  sessions: ChartSession[];
  year: Year;
};

const BAR_AREA_PX = 150;
// Hueco reservado por encima de la barra más alta para su etiqueta de valor.
const LABEL_SPACE_PX = 20;

const monthKey = (year: number, month: number): number => year * 12 + month;

// Horas jugadas por mes, 12 barras hechas a mano. Misma regla de ventana que
// el Activity heatmap: "All Time" = los últimos 12 meses terminando en el
// actual (actividad reciente, no toda la vida apelotonada), un año concreto
// = sus 12 meses de enero a diciembre. Y mismos datos que el heatmap: solo
// sesiones trackeadas de verdad (isManual false) y cerradas.
//
// Cada mes tiene una "pista" tenue de fondo a altura completa (mismo color
// que las celdas vacías del heatmap) — así los meses a cero también tienen
// presencia y la escala del gráfico se lee de un vistazo. La etiqueta de
// valor solo se pinta en el mes pico y en el que está bajo el ratón, que
// además se resalta (como el donut de edad): con 12 etiquetas fijas no se
// veía nada más que números flotando.
export const HoursByMonthChart = ({
  sessions,
  year,
}: HoursByMonthChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { months, maxSeconds, totalSeconds, peakIndex } = useMemo(() => {
    const now = new Date();
    const firstMonth =
      year === 'all' ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : new Date(year, 0, 1);

    const secondsByKey = new Map<number, number>();
    for (const session of sessions) {
      if (session.isManual || session.endedAt === null) continue;
      const key = monthKey(session.startedAt.getFullYear(), session.startedAt.getMonth());
      secondsByKey.set(key, (secondsByKey.get(key) ?? 0) + (session.durationSec ?? 0));
    }

    const months = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
      return {
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        seconds: secondsByKey.get(monthKey(date.getFullYear(), date.getMonth())) ?? 0,
      };
    });

    const maxSeconds = Math.max(0, ...months.map((month) => month.seconds));
    const totalSeconds = months.reduce((sum, month) => sum + month.seconds, 0);
    const peakIndex = maxSeconds > 0 ? months.findIndex((m) => m.seconds === maxSeconds) : -1;

    return { months, maxSeconds, totalSeconds, peakIndex };
  }, [sessions, year]);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4.5 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Hours per month</div>
        <div className="text-[11.5px] text-muted-foreground">
          {formatHours(totalSeconds / 3600)}{' '}
          {year === 'all' ? 'in the last 12 months' : `in ${year}`}
        </div>
      </div>

      <div className="flex flex-1 items-end gap-1.5" style={{ minHeight: BAR_AREA_PX }}>
        {months.map((month, index) => {
          const isHovered = hoveredIndex === index;
          // La etiqueta del pico está SIEMPRE (si se apagara al pasar el
          // ratón por otras barras, iría parpadeando durante el barrido) y
          // la del mes bajo el ratón se suma a ella.
          const showLabel = month.seconds > 0 && (isHovered || index === peakIndex);
          const barPx =
            maxSeconds > 0 && month.seconds > 0
              ? Math.max(4, (month.seconds / maxSeconds) * (BAR_AREA_PX - LABEL_SPACE_PX))
              : 0;

          return (
            <div
              key={index}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="relative flex h-full flex-1 items-end justify-center"
            >
              {/* Pista de fondo a altura completa — mismo blanco tenue que
                  las celdas vacías del heatmap. */}
              <div
                className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-8 rounded-[6px]"
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
                  {formatHours(month.seconds / 3600)}
                </span>
              )}
              <div
                className="relative w-full max-w-8 rounded-[6px] transition-[filter]"
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
        {months.map((month, index) => (
          <div
            key={index}
            className="flex-1 text-center text-[10px]"
            style={{
              color: hoveredIndex === index ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontWeight: hoveredIndex === index ? 700 : 400,
            }}
          >
            {month.label}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
