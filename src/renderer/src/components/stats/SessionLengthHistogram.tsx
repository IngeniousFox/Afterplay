import { cn } from '../../lib/utils';
import { type CSSProperties, useMemo, useState } from 'react';
import { formatHours, pluralize } from '../../lib/format';
import { lengthSummaryFor, type SessionStats } from '../../../../shared/domain/sessionStats';
import { chartGroup, growY, useInView } from '../fx/chart';
import { barValueClass, barValueStyle } from './chartMotion';
import { ChartHeading, StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import type { Year } from './YearPicker';

type SessionLengthHistogramProps = {
  // El resumen de duraciones (shared/domain/sessionStats): el de la biblioteca
  // viene del main (F-41) y el de un juego se arma con las sesiones de ese juego.
  stats: Pick<SessionStats, 'lengthAll' | 'lengthByYear'>;
  year: Year;
  variant?: 'compact' | 'overview';
};

// Los tramos: sus límites (en segundos, el último es abierto) son
// SESSION_LENGTH_LIMITS_SEC de shared/domain/sessionStats, que es quien reparte
// las sesiones en ellos.
const BUCKETS: { label: string }[] = [
  { label: '<30m' },
  { label: '30m–1h' },
  { label: '1–2h' },
  { label: '2–4h' },
  { label: '4h+' },
];

const PROFILE_LABELS = [
  { eyebrow: 'Short bursts', title: 'Drop in, make progress' },
  { eyebrow: 'Quick sessions', title: 'A tidy hour at a time' },
  { eyebrow: 'Balanced', title: 'Room to settle in' },
  { eyebrow: 'Deep sessions', title: 'Long-form play' },
  { eyebrow: 'Marathon mode', title: 'You commit to the run' },
] as const;

// ¿Maratones o ratitos? — cuántas sesiones caen en cada tramo de duración,
// como barras verticales (mismo lenguaje que Hours per month / When do you
// play: pista de fondo, degradado verde y lectura interactiva del pico).
// En Stats global el trazado queda limitado aunque el HLTB vecino crezca;
// ese alto adicional se usa para mediana, peso de sesiones cortas y máxima.
// Mismas reglas de datos que el
// resto de gráficos de sesiones: solo medidas y cerradas.
// "All Time" = histórico completo (es un perfil, no actividad reciente).
export const SessionLengthHistogram = ({
  stats,
  year,
  variant = 'compact',
}: SessionLengthHistogramProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // El histograma crece desde la base la primera vez que entra en vista.
  const { observe, inView } = useInView();

  const { counts, total, peakIndex, medianSeconds, longestSeconds, underHour } = useMemo(() => {
    const { counts, total, medianSec, longestSec, underHour } = lengthSummaryFor(stats, year);
    const maxCount = Math.max(0, ...counts);
    const peakIndex = maxCount > 0 ? counts.findIndex((count) => count === maxCount) : -1;
    return {
      counts,
      total,
      peakIndex,
      medianSeconds: medianSec,
      longestSeconds: longestSec,
      underHour,
    };
  }, [stats, year]);

  const maxCount = Math.max(1, ...counts);
  const activeIndex = hoveredIndex ?? peakIndex;
  const activeCount = activeIndex >= 0 ? counts[activeIndex] : 0;
  const activeShare = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  const underHourShare = total > 0 ? Math.round((underHour / total) * 100) : 0;
  const profile = PROFILE_LABELS[Math.max(0, peakIndex)];

  return (
    <StatCard
      className={cn(
        'afterplay-session-length-card relative overflow-hidden',
        variant === 'overview' ? 'is-overview' : 'is-compact',
        'flex h-full flex-col',
      )}
    >
      <ChartHeading
        title="Session length"
        subtitle="How long you tend to stay"
        right={
          total > 0 && peakIndex >= 0 ? (
            <>
              <strong>{pluralize(total, 'session')}</strong>
              <small>
                usually <em>{BUCKETS[peakIndex].label}</em>
              </small>
            </>
          ) : undefined
        }
      />

      {total === 0 ? (
        <div className="mt-4">
          <StatCardEmpty>No tracked sessions yet.</StatCardEmpty>
        </div>
      ) : (
        <>
          <div
            className={cn(
              'afterplay-session-focus mt-3 flex min-h-10 items-end justify-between gap-4 border-b border-line pb-2.5',
              '[&>div:last-child]:flex-none [&>div:last-child]:text-right',
            )}
            aria-live="polite"
          >
            <div>
              <span className="block text-micro font-semibold text-dust">
                {hoveredIndex === null ? profile.eyebrow : 'Inspecting'}
              </span>
              <strong className="block text-small font-semibold text-bone tabular-nums">
                {hoveredIndex === null ? profile.title : BUCKETS[activeIndex].label}
              </strong>
            </div>
            <div>
              <strong className="block font-display text-[20px] leading-none font-bold text-phosphor tabular-nums">
                {activeCount}
              </strong>
              <small className="mt-0.5 block text-micro text-dust">
                {activeShare}% of sessions
              </small>
            </div>
          </div>

          <div className="afterplay-session-chart-body flex min-h-41 flex-1 flex-col justify-center [.afterplay-session-length-card.is-overview_&]:min-h-47.5">
            <div
              ref={observe}
              data-inview={inView || undefined}
              className={cn(
                chartGroup,
                'afterplay-session-stage relative mt-6 flex h-34 w-full flex-none items-stretch gap-2 border-b border-line-strong',
                '[.afterplay-session-length-card.is-overview_&]:h-37.5 [.afterplay-session-length-card.is-overview_&]:max-h-37.5',
              )}
            >
              <span
                className="afterplay-session-grid absolute -z-1 inset-0 grid grid-rows-[repeat(3,_1fr)] pointer-events-none"
                aria-hidden="true"
              >
                <i className="border-t border-line" />
                <i className="border-t border-line" />
                <i className="border-t border-line" />
              </span>
              {BUCKETS.map((bucket, index) => {
                const count = counts[index];
                const isActive = activeIndex === index;
                const isDimmed = hoveredIndex !== null && hoveredIndex !== index;
                const fillPct = count > 0 ? Math.max(3, (count / maxCount) * 100) : 0;

                return (
                  <div
                    key={bucket.label}
                    tabIndex={count > 0 ? 0 : -1}
                    role="group"
                    aria-label={`${bucket.label}, ${pluralize(count, 'session')}, ${Math.round((count / total) * 100)}% of sessions`}
                    className={cn(
                      'afterplay-session-column relative h-full min-w-0 flex-1 rounded-t-sm outline-hidden',
                      'transition-[background-color,opacity] duration-150 hover:bg-raised/60 [&.is-dimmed]:opacity-60',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
                      isActive ? 'is-active' : '',
                      isDimmed ? 'is-dimmed' : '',
                      count === 0 ? 'is-empty' : '',
                    )}
                    style={{ '--bar-height': `${fillPct}%` } as CSSProperties}
                    onMouseEnter={() => {
                      if (count > 0) setHoveredIndex(index);
                    }}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(index)}
                    onBlur={() => setHoveredIndex(null)}
                  >
                    {count > 0 && (
                      <span
                        className={cn(
                          'afterplay-session-fill absolute bottom-0 left-1/2 h-(--bar-height) min-h-0.75 w-[min(66%,_48px)] -translate-x-1/2',
                          'rounded-t-[2px] bg-phosphor/55',
                          growY,
                          'transition-[background-color,box-shadow] duration-150',
                          '[.afterplay-session-column.is-active_&]:bg-phosphor',
                          '[.afterplay-session-column.is-active_&]:shadow-[0_0_14px_rgb(255_179_71/0.55),0_0_3px_var(--color-phosphor)]',
                          'motion-reduce:transition-none',
                        )}
                        style={{ animationDelay: `${index * 55}ms` }}
                      />
                    )}
                    {count > 0 && isActive && (
                      <span
                        className={cn(
                          'text-micro font-semibold text-bone tabular-nums',
                          barValueClass,
                        )}
                        style={barValueStyle(index, 55)}
                      >
                        {count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="afterplay-session-axis mt-2 flex gap-2">
              {BUCKETS.map((bucket, index) => (
                <div
                  key={bucket.label}
                  className={cn(
                    activeIndex === index ? 'is-active' : '',
                    'min-w-0 flex-1 text-center text-micro break-words whitespace-normal text-dust',
                    '[&.is-active]:font-semibold [&.is-active]:text-bone',
                  )}
                >
                  {bucket.label}
                </div>
              ))}
            </div>
          </div>

          {variant === 'overview' && (
            <div className="afterplay-session-insights mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <span className="block text-small whitespace-normal text-dust">Median</span>
                <strong className="mt-0.5 block font-display text-[22px] leading-none font-bold whitespace-nowrap text-bone tabular-nums">
                  {formatHours(medianSeconds / 3600)}
                </strong>
              </div>
              <div className="min-w-0">
                <span className="block text-small whitespace-normal text-dust">Under an hour</span>
                <strong className="mt-0.5 block font-display text-[22px] leading-none font-bold whitespace-nowrap text-bone tabular-nums">
                  {underHourShare}%
                </strong>
              </div>
              <div className="min-w-0">
                <span className="block text-small whitespace-normal text-dust">Longest</span>
                <strong className="mt-0.5 block font-display text-[22px] leading-none font-bold whitespace-nowrap text-bone tabular-nums">
                  {formatHours(longestSeconds / 3600)}
                </strong>
              </div>
            </div>
          )}
        </>
      )}
    </StatCard>
  );
};
