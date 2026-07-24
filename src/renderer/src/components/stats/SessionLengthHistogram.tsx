import { useMemo, useState } from 'react';
import { pluralize } from '../../lib/format';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import type { Year } from './YearPicker';

type HistogramSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

type SessionLengthHistogramProps = {
  sessions: HistogramSession[];
  year: Year;
};

// Límite superior de cada tramo en segundos (el último es abierto).
const BUCKETS: { label: string; maxSec: number }[] = [
  { label: '<30m', maxSec: 30 * 60 },
  { label: '30m–1h', maxSec: 60 * 60 },
  { label: '1–2h', maxSec: 2 * 3600 },
  { label: '2–4h', maxSec: 4 * 3600 },
  { label: '4h+', maxSec: Infinity },
];

// Alto MÍNIMO del área de barras, no fijo — esta card comparte fila con
// You vs HowLongToBeat, cuya altura crece con el nº de datos (hasta 6 filas,
// ~330px). Antes las barras se calculaban sobre un presupuesto fijo de
// 150px anclado abajo, así que en una fila estirada más alta se veía un
// hueco enorme por encima. Ahora la pista y las barras usan porcentajes
// del alto REAL disponible (min-height solo entra como suelo, no como
// techo), así que siempre llenan lo que la grid les da.
const BAR_AREA_MIN_PX = 130;
const LABEL_SPACE_PX = 20;

// ¿Maratones o ratitos? — cuántas sesiones caen en cada tramo de duración,
// como barras verticales (mismo lenguaje que Hours per month / When do you
// play: pista de fondo, degradado verde, etiqueta en el pico y bajo el
// ratón — aquí con el % del total al lado). Mismas reglas de datos que el
// resto de gráficos de sesiones: solo trackeadas de verdad y cerradas.
// "All Time" = histórico completo (es un perfil, no actividad reciente).
export const SessionLengthHistogram = ({
  sessions,
  year,
}: SessionLengthHistogramProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { counts, total, peakIndex } = useMemo(() => {
    const counts = BUCKETS.map(() => 0);
    for (const session of sessions) {
      if (session.isManual || session.endedAt === null) continue;
      if (year !== 'all' && session.startedAt.getFullYear() !== year) continue;
      const seconds = session.durationSec ?? 0;
      const bucketIndex = BUCKETS.findIndex((bucket) => seconds < bucket.maxSec);
      counts[bucketIndex >= 0 ? bucketIndex : BUCKETS.length - 1] += 1;
    }
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(0, ...counts);
    const peakIndex = maxCount > 0 ? counts.findIndex((count) => count === maxCount) : -1;
    return { counts, total, peakIndex };
  }, [sessions, year]);

  const maxCount = Math.max(1, ...counts);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4.5 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Session length</div>
        {total > 0 && peakIndex >= 0 && (
          <div className="text-[11.5px] text-muted-foreground">
            {pluralize(total, 'session')} · usually{' '}
            <span className="font-semibold text-primary">{BUCKETS[peakIndex].label}</span>
          </div>
        )}
      </div>

      {total === 0 ? (
        <StatCardEmpty>No tracked sessions yet.</StatCardEmpty>
      ) : (
        <>
          {/* pt-5 reserva el hueco de la etiqueta arriba (LABEL_SPACE_PX);
              el resto del alto disponible (el que sea) lo llenan las
              columnas al 100%, y dentro de cada una la pista y la barra van
              en porcentaje de ESE alto — nada de presupuesto fijo. */}
          <div
            className="flex flex-1 items-stretch gap-2 pt-5"
            style={{ minHeight: BAR_AREA_MIN_PX + LABEL_SPACE_PX }}
          >
            {BUCKETS.map((bucket, index) => {
              const count = counts[index];
              const isHovered = hoveredIndex === index;
              const showLabel = count > 0 && (isHovered || index === peakIndex);
              const fillPct = count > 0 ? Math.max(0.03, count / maxCount) * 100 : 0;

              return (
                <div
                  key={bucket.label}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="relative flex-1"
                >
                  <div
                    className="absolute inset-0 mx-auto w-full max-w-12 rounded-[6px]"
                    style={{
                      background: isHovered ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)',
                    }}
                  />
                  {showLabel && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-bold whitespace-nowrap tabular-nums"
                      style={{
                        bottom: `calc(${fillPct}% + 5px)`,
                        color: isHovered ? 'var(--foreground)' : '#2fdc7e',
                      }}
                    >
                      {count} · {Math.round((count / total) * 100)}%
                    </span>
                  )}
                  <div
                    className="absolute right-0 bottom-0 left-0 mx-auto w-full max-w-12 rounded-[6px] transition-[height,filter]"
                    style={{
                      height: `${fillPct}%`,
                      background: 'linear-gradient(180deg,var(--ac),var(--ac2))',
                      filter:
                        hoveredIndex !== null && !isHovered
                          ? 'saturate(.45) brightness(.7)'
                          : 'none',
                      boxShadow: isHovered ? '0 0 18px rgba(47,220,126,.35)' : 'none',
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex gap-2 border-t border-white/5 pt-1.75">
            {BUCKETS.map((bucket, index) => (
              <div
                key={bucket.label}
                className="flex-1 text-center text-[10px] whitespace-nowrap"
                style={{
                  color: hoveredIndex === index ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontWeight: hoveredIndex === index ? 700 : 400,
                }}
              >
                {bucket.label}
              </div>
            ))}
          </div>
        </>
      )}
    </StatCard>
  );
};
