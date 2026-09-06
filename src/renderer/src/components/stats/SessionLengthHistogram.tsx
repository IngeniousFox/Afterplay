import { cn } from '../../lib/utils';
import { TimerReset } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { formatHours, pluralize } from '../../lib/format';
import { hasMeasuredDuration } from '../../lib/sessionStats';
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
  variant?: 'compact' | 'overview';
};

// Límite superior de cada tramo en segundos (el último es abierto).
const BUCKETS: { label: string; maxSec: number }[] = [
  { label: '<30m', maxSec: 30 * 60 },
  { label: '30m–1h', maxSec: 60 * 60 },
  { label: '1–2h', maxSec: 2 * 3600 },
  { label: '2–4h', maxSec: 4 * 3600 },
  { label: '4h+', maxSec: Infinity },
];

const PROFILE_LABELS = [
  { eyebrow: 'SHORT BURSTS', title: 'Drop in, make progress' },
  { eyebrow: 'QUICK SESSIONS', title: 'A tidy hour at a time' },
  { eyebrow: 'BALANCED', title: 'Room to settle in' },
  { eyebrow: 'DEEP SESSIONS', title: 'Long-form play' },
  { eyebrow: 'MARATHON MODE', title: 'You commit to the run' },
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
  sessions,
  year,
  variant = 'compact',
}: SessionLengthHistogramProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { counts, durations, total, peakIndex } = useMemo(() => {
    const counts = BUCKETS.map(() => 0);
    const durations: number[] = [];
    for (const session of sessions) {
      if (!hasMeasuredDuration(session)) continue;
      if (year !== 'all' && session.startedAt.getFullYear() !== year) continue;
      const seconds = session.durationSec ?? 0;
      durations.push(seconds);
      const bucketIndex = BUCKETS.findIndex((bucket) => seconds < bucket.maxSec);
      counts[bucketIndex >= 0 ? bucketIndex : BUCKETS.length - 1] += 1;
    }
    durations.sort((a, b) => a - b);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(0, ...counts);
    const peakIndex = maxCount > 0 ? counts.findIndex((count) => count === maxCount) : -1;
    return { counts, durations, total, peakIndex };
  }, [sessions, year]);

  const maxCount = Math.max(1, ...counts);
  const activeIndex = hoveredIndex ?? peakIndex;
  const activeCount = activeIndex >= 0 ? counts[activeIndex] : 0;
  const activeShare = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  const middle = Math.floor(durations.length / 2);
  const medianSeconds = durations.length
    ? durations.length % 2 === 0
      ? (durations[middle - 1] + durations[middle]) / 2
      : durations[middle]
    : 0;
  const longestSeconds = durations.at(-1) ?? 0;
  const underHour = durations.filter((seconds) => seconds < 3600).length;
  const underHourShare = total > 0 ? Math.round((underHour / total) * 100) : 0;
  const profile = PROFILE_LABELS[Math.max(0, peakIndex)];

  return (
    <StatCard
      className={cn(
        'afterplay-session-length-card relative overflow-hidden',
        "after:content-[''] after:absolute after:top-0 after:left-5.5 after:w-14.5 after:h-px after:pointer-events-none",
        'after:[background:linear-gradient(90deg,transparent,var(--session-accent),transparent)] after:opacity-50',
        '[--chart-accent:var(--session-accent)]',
        variant === 'overview' ? 'is-overview' : 'is-compact',
        'flex h-full flex-col',
      )}
      style={{ '--session-accent': '#2fdc7e' } as CSSProperties}
    >
      <div className="afterplay-chart-heading grid grid-cols-[32px_minmax(0,_1fr)_auto] items-center gap-2.5 min-w-0">
        <span
          className={cn(
            'afterplay-chart-heading-icon flex w-8 h-8 items-center justify-center rounded-[9px] border',
            'border-[color-mix(in_srgb,var(--chart-accent,#2fdc7e)_22%,transparent)]',
            'text-[color:var(--chart-accent,#2fdc7e)]',
            'bg-[color-mix(in_srgb,var(--chart-accent,#2fdc7e)_7%,rgba(255,255,255,0.01))]',
            '[.afterplay-category-card_&]:[transition:color_200ms_ease,border-color_200ms_ease,transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
            '[.afterplay-category-card:hover_&]:border-[color-mix(in_srgb,var(--chart-accent)_38%,transparent)]',
            '[.afterplay-category-card:hover_&]:[transform:translateY(-1px)_rotate(-3deg)]',
            'motion-reduce:animate-none motion-reduce:transition-none',
          )}
        >
          <TimerReset size={15} />
        </span>
        <div className="afterplay-chart-heading-copy min-w-0">
          <strong className="block text-foreground text-[14px] font-[850] leading-[1.2] whitespace-normal">
            Session length
          </strong>
          <small className="block mt-0.75 text-muted-foreground text-[11.5px] leading-[1.2] whitespace-normal">
            How long you tend to stay
          </small>
        </div>
        {total > 0 && peakIndex >= 0 && (
          <div className="afterplay-chart-total min-w-17.5 text-right">
            <strong className="block text-foreground text-[12px] font-[850] leading-[1.2] tabular-nums">
              {pluralize(total, 'session')}
            </strong>
            <small className="block mt-0.75 text-white/45 text-[11px] font-[650] leading-[1.2]">
              usually{' '}
              <em
                className={cn(
                  'text-[color:var(--session-accent,var(--chart-accent,#2fdc7e))]',
                  'not-italic font-extrabold',
                )}
              >
                {BUCKETS[peakIndex].label}
              </em>
            </small>
          </div>
        )}
      </div>

      {total === 0 ? (
        <StatCardEmpty>No tracked sessions yet.</StatCardEmpty>
      ) : (
        <>
          <div
            className={cn(
              'afterplay-session-focus flex min-h-[49px] items-center justify-between gap-4 mt-[13px] py-2 px-[11px]',
              'rounded-[10px] border',
              'border-[color-mix(in_srgb,var(--chart-accent,var(--session-accent,#2fdc7e))_18%,rgba(255,255,255,0.05))]',
              '[background:linear-gradient(115deg,color-mix(in_srgb,var(--chart-accent,var(--session-accent,#2fdc7e))_7%,transparent),rgba(255,255,255,0.012))]',
              '[--chart-accent:var(--session-accent)] [&_>_div:last-child]:flex-none [&_>_div:last-child]:text-right',
              '[&_>_div:last-child_strong]:text-[color:var(--chart-accent,var(--session-accent,#2fdc7e))]',
            )}
            aria-live="polite"
          >
            <div>
              <span className="block text-white/45 text-[11px] font-black tracking-[0.08em] leading-[1]">
                {hoveredIndex === null ? profile.eyebrow : 'INSPECTING'}
              </span>
              <strong className="block mt-1 text-foreground text-[13px] font-[850] leading-[1.05] tabular-nums">
                {hoveredIndex === null ? profile.title : BUCKETS[activeIndex].label}
              </strong>
            </div>
            <div>
              <strong className="block mt-1 text-foreground text-[13px] font-[850] leading-[1.05] tabular-nums">
                {activeCount}
              </strong>
              <small className="block mt-0.75 text-white/45 text-[11px] font-semibold leading-[1.05]">
                {activeShare}% of sessions
              </small>
            </div>
          </div>

          <div className="afterplay-session-chart-body flex min-h-41 flex-1 flex-col justify-center [.afterplay-session-length-card.is-overview_&]:min-h-47.5">
            <div
              className={cn(
                'afterplay-session-stage relative flex flex-none items-stretch gap-[9px] mt-2 w-full h-34 border-b',
                'border-b-[rgba(255,255,255,0.075)]',
                '[.afterplay-session-length-card.is-overview_&]:h-37.5 [.afterplay-session-length-card.is-overview_&]:max-h-37.5',
              )}
            >
              <span
                className="afterplay-session-grid absolute -z-1 inset-0 grid grid-rows-[repeat(3,_1fr)] pointer-events-none"
                aria-hidden="true"
              >
                <i className="border-t border-dashed border-t-[rgba(255,255,255,0.035)]" />
                <i className="border-t border-dashed border-t-[rgba(255,255,255,0.035)]" />
                <i className="border-t border-dashed border-t-[rgba(255,255,255,0.035)]" />
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
                      'afterplay-session-column relative min-w-0 h-full flex-1 rounded-[7px_7px_0_0] outline-none',
                      '[transition:opacity_180ms_ease,transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
                      '[&.is-active]:[transform:translateY(-2px)] [&.is-dimmed]:opacity-43',
                      'focus-visible:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--chart-accent,var(--session-accent,#2fdc7e))_45%,transparent)]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                      isActive ? 'is-active' : '',
                      isDimmed ? 'is-dimmed' : '',
                      count === 0 ? 'is-empty' : '',
                    )}
                    onMouseEnter={() => {
                      if (count > 0) setHoveredIndex(index);
                    }}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(index)}
                    onBlur={() => setHoveredIndex(null)}
                  >
                    <span
                      className={cn(
                        'afterplay-session-track absolute bottom-0 left-1/2 w-[min(66%,_48px)] h-full rounded-[6px_6px_3px_3px]',
                        '[transform:translateX(-50%)] border border-white/[0.025] border-b-0',
                        '[background:linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.018))]',
                      )}
                    />
                    {count > 0 && (
                      <span
                        className={cn(
                          'afterplay-session-fill absolute bottom-0 left-1/2 w-[min(66%,_48px)] h-[var(--bar-height)] min-h-[3px]',
                          'overflow-hidden rounded-[6px_6px_3px_3px] [transform:translateX(-50%)] origin-bottom',
                          'animate-[afterplay-category-rise_620ms_cubic-bezier(0.22,1,0.36,1)_var(--bar-delay)_backwards]',
                          '[transition:filter_180ms_ease,box-shadow_200ms_ease] [background:linear-gradient(180deg,#35df84,#218f58)]',
                          "after:content-[''] after:absolute after:inset-0 after:pointer-events-none",
                          'after:[background:linear-gradient(90deg,rgba(255,255,255,0.09),transparent_36%_72%,rgba(0,0,0,0.08))]',
                          '[.afterplay-session-column.is-active_&]:[filter:saturate(1.05)_brightness(1.06)]',
                          '[.afterplay-session-column.is-active_&]:[box-shadow:0_0_11px_rgba(47,220,126,0.17)]',
                          'motion-reduce:animate-none motion-reduce:transition-none',
                        )}
                        style={
                          {
                            '--bar-height': `${fillPct}%`,
                            '--bar-delay': `${index * 55}ms`,
                          } as CSSProperties
                        }
                      >
                        <i className="absolute z-1 top-0 right-1.25 left-1.25 h-px bg-white/38 opacity-50" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="afterplay-session-axis flex gap-[9px] mt-[7px]">
              {BUCKETS.map((bucket, index) => (
                <div
                  key={bucket.label}
                  className={cn(
                    activeIndex === index ? 'is-active' : '',
                    'min-w-0 flex-1 text-white/45 text-[11px] font-semibold leading-[1.25] text-center',
                    'whitespace-normal break-words [transition:color_180ms_ease,font-weight_180ms_ease]',
                    '[&.is-active]:text-[color:var(--chart-accent,var(--session-accent,#2fdc7e))] [&.is-active]:font-[850]',
                  )}
                >
                  {bucket.label}
                </div>
              ))}
            </div>
          </div>

          {variant === 'overview' && (
            <div className="afterplay-session-insights grid grid-cols-3 gap-[7px] mt-3 pt-[11px] border-t border-t-[rgba(255,255,255,0.055)]">
              <div className="min-w-0 px-1.25 py-2 border border-white/[0.055] rounded-[8px] bg-white/[0.018]">
                <span className="block min-h-7 whitespace-normal text-white/45 text-[11px] leading-[1.25] font-bold tracking-[0.02em]">
                  MEDIAN
                </span>
                <strong className="block overflow-hidden text-ellipsis whitespace-nowrap mt-1.25 text-foreground text-[12px] font-[850] tabular-nums">
                  {formatHours(medianSeconds / 3600)}
                </strong>
              </div>
              <div className="min-w-0 px-1.25 py-2 border border-white/[0.055] rounded-[8px] bg-white/[0.018]">
                <span className="block min-h-7 whitespace-normal text-white/45 text-[11px] leading-[1.25] font-bold tracking-[0.02em]">
                  UNDER 1 HOUR
                </span>
                <strong className="block overflow-hidden text-ellipsis whitespace-nowrap mt-1.25 text-foreground text-[12px] font-[850] tabular-nums">
                  {underHourShare}%
                </strong>
              </div>
              <div className="min-w-0 px-1.25 py-2 border border-white/[0.055] rounded-[8px] bg-white/[0.018]">
                <span className="block min-h-7 whitespace-normal text-white/45 text-[11px] leading-[1.25] font-bold tracking-[0.02em]">
                  LONGEST
                </span>
                <strong className="block overflow-hidden text-ellipsis whitespace-nowrap mt-1.25 text-foreground text-[12px] font-[850] tabular-nums">
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
