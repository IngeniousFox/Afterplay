import { cn } from '../../lib/utils';
import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { formatHours } from '../../lib/format';
import { hasMeasuredDuration } from '../../lib/sessionStats';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';

type DaypartSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  // Hace falta para descartarlas: una fila manual con precisión de mes o año
  // se guarda a las 00:00 del día 1, así que su "hora de arranque" es relleno
  // — ver el filtro de abajo.
  isManual: boolean;
};

type TimeOfDayCardProps = {
  sessions: DaypartSession[];
};

// Franja por hora de ARRANQUE de la sesión — suficiente para el perfil (una
// sesión que cruza medianoche cuenta entera en su franja de inicio, como en
// el resto de gráficos, que agrupan por startedAt).
const DAYPARTS: {
  label: string;
  range: string;
  fromHour: number;
  toHour: number;
  color: string;
  Icon: LucideIcon;
}[] = [
  { label: 'Morning', range: '06–12', fromHour: 6, toHour: 12, color: '#e3b24a', Icon: Sunrise },
  {
    label: 'Afternoon',
    range: '12–18',
    fromHour: 12,
    toHour: 18,
    color: '#2fdc7e',
    Icon: Sun,
  },
  {
    label: 'Evening',
    range: '18–24',
    fromHour: 18,
    toHour: 24,
    color: '#85a3d6',
    Icon: Sunset,
  },
  { label: 'Night', range: '00–06', fromHour: 0, toHour: 6, color: '#7c86c8', Icon: Moon },
];

const DIAL_SIZE = 158;
const DIAL_STROKE = 20;
const DIAL_RADIUS = 58;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;

// Match the game-age ring: proportional sectors with flat ends and a quiet center.
export const TimeOfDayCard = ({ sessions }: TimeOfDayCardProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const seconds = DAYPARTS.map(() => 0);
  for (const session of sessions) {
    // Solo tiempo MEDIDO (SPEC 8.1 regla 1, hasMeasuredDuration cubre también
    // las abiertas, que aún no tienen duración). Sin este filtro una fila
    // manual con precisión de año metía sus 60h enteras en "Night" —la hora
    // 00:00 del 1 de enero que se guarda cuando no hay hora— y la card
    // declaraba "mostly night" contradiciendo a sus vecinas de la misma
    // pantalla, que sí filtran.
    if (!hasMeasuredDuration(session)) continue;
    const hour = session.startedAt.getHours();
    const index = DAYPARTS.findIndex((part) => hour >= part.fromHour && hour < part.toHour);
    if (index >= 0) seconds[index] += session.durationSec ?? 0;
  }
  const total = seconds.reduce((sum, value) => sum + value, 0);
  const peakIndex = total > 0 ? seconds.indexOf(Math.max(...seconds)) : null;
  const activeIndex = hoveredIndex ?? peakIndex;
  const visibleCount = seconds.filter((value) => value > 0).length;

  const arcs = DAYPARTS.map((part, index) => {
    const share = total > 0 ? seconds[index] / total : 0;
    const fullLength = share * DIAL_CIRCUMFERENCE;
    const gap = visibleCount === 1 ? 0 : Math.min(3.5, fullLength / 4);
    const offset =
      total > 0
        ? (seconds.slice(0, index).reduce((sum, value) => sum + value, 0) / total) *
          DIAL_CIRCUMFERENCE
        : 0;
    return {
      ...part,
      share,
      length: fullLength - gap,
      offset: offset + gap / 2,
    };
  });

  return (
    <StatCard
      className={cn(
        'afterplay-game-time-of-day',
        'relative flex h-full flex-col overflow-hidden',
        '[background:radial-gradient(circle_at_50%_31%,rgba(133,163,214,0.035),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(124,134,200,0.025),transparent_35%),var(--card)]!',
        'before:absolute before:top-[0] before:right-[13%] before:left-[13%] before:h-[1px]',
        'before:[background:linear-gradient(90deg,transparent,rgba(133,163,214,0.34),transparent)]',
        "before:content-[''] before:opacity-[0.35]",
        '[@media(760px<width<=1040px)]:grid! [@media(760px<width<=1040px)]:grid-cols-[190px_minmax(0,1fr)]',
        '[@media(760px<width<=1040px)]:items-center [@media(760px<width<=1040px)]:gap-x-[20px]',
        '[@media(760px<width<=1040px)]:[&>.afterplay-game-card-heading]:col-span-full',
        '[@media(width<=760px)]:flex! [@media(width<=760px)]:grid-cols-[190px_minmax(0,1fr)]',
        '[@media(width<=760px)]:items-center [@media(width<=760px)]:gap-x-[20px]',
        '[@media(width<=760px)]:[&>.afterplay-game-card-heading]:col-span-full',
      )}
    >
      <div className="afterplay-game-card-heading mb-4.25 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-foreground">Time of day</span>
          <small className="text-[11.5px] text-white/[0.42]">
            Your playtime across the cycle of a day
          </small>
        </div>
        {peakIndex !== null && (
          <strong
            className={cn(
              'afterplay-game-daypart-peak',
              'rounded-[99px] px-2 py-1.25 text-[10px] font-black tracking-[0.065em] whitespace-nowrap',
              'text-(--daypart-color)',
              '[--daypart-color:var(--primary)] border',
              'border-[color-mix(in_srgb,var(--daypart-color)_26%,transparent)]',
              'bg-[color-mix(in_srgb,var(--daypart-color)_7%,transparent)]',
            )}
            style={{ '--daypart-color': DAYPARTS[peakIndex].color } as CSSProperties}
          >
            MOSTLY {DAYPARTS[peakIndex].label.toUpperCase()}
          </strong>
        )}
      </div>

      {total === 0 ? (
        <StatCardEmpty>No tracked sessions yet.</StatCardEmpty>
      ) : (
        <>
          <div className="afterplay-game-daypart-stage [@media(760px<width<=1040px)]:mt-[0] [@media(width<=760px)]:mt-[0] -mt-0.75 grid min-h-41.5 place-items-center">
            <div
              className={cn(
                'afterplay-game-daypart-dial',
                'relative grid size-41.5 place-items-center',
                '[&_svg]:filter-[drop-shadow(0_5px_10px_rgba(0,0,0,0.18))]',
              )}
            >
              <svg
                className="overflow-visible origin-center animate-[afterplay-age-orbit-in_720ms_cubic-bezier(0.22,1,0.36,1)_backwards] motion-reduce:animate-none"
                width={DIAL_SIZE}
                height={DIAL_SIZE}
                viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
                role="img"
                aria-label={`Time of day distribution. ${DAYPARTS[activeIndex ?? 0].label}: ${Math.round((seconds[activeIndex ?? 0] / total) * 100)}%`}
              >
                <circle
                  cx={DIAL_SIZE / 2}
                  cy={DIAL_SIZE / 2}
                  r={74}
                  fill="none"
                  stroke="rgba(255,255,255,.12)"
                  strokeWidth={1}
                  strokeDasharray="1 7"
                  strokeLinecap="round"
                />
                <circle
                  className="afterplay-game-daypart-track stroke-white/[0.045]"
                  cx={DIAL_SIZE / 2}
                  cy={DIAL_SIZE / 2}
                  r={DIAL_RADIUS}
                  fill="none"
                  strokeWidth={DIAL_STROKE}
                />
                <g transform={`rotate(-90 ${DIAL_SIZE / 2} ${DIAL_SIZE / 2})`}>
                  {arcs.map((arc, index) => {
                    // Empty periods have no segment; tiny shares keep their true size.
                    if (arc.share === 0) return null;

                    return (
                      <circle
                        key={arc.label}
                        data-daypart={arc.label.toLowerCase()}
                        className={cn(
                          'afterplay-game-daypart-arc',
                          'cursor-pointer',
                          '[&.is-active]:filter-[drop-shadow(0_0_3px_color-mix(in_srgb,var(--daypart-color)_38%,transparent))_brightness(1.035)]',
                          '[&.is-active]:stroke-[24px]',
                          '[transition:opacity_180ms_ease,filter_220ms_ease,stroke-width_250ms_cubic-bezier(0.22,1,0.36,1)]',
                          'motion-reduce:animate-none motion-reduce:transition-none',
                          activeIndex === index ? 'is-active' : '',
                        )}
                        cx={DIAL_SIZE / 2}
                        cy={DIAL_SIZE / 2}
                        r={DIAL_RADIUS}
                        fill="none"
                        stroke={arc.color}
                        strokeWidth={DIAL_STROKE}
                        strokeLinecap="butt"
                        strokeDasharray={`${arc.length} ${DIAL_CIRCUMFERENCE - arc.length}`}
                        strokeDashoffset={-arc.offset}
                        style={
                          {
                            '--daypart-color': arc.color,
                            opacity: activeIndex === index ? 1 : 0.42,
                          } as CSSProperties
                        }
                        onMouseEnter={() => setHoveredIndex(index)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      />
                    );
                  })}
                </g>
              </svg>
              <span
                className={cn(
                  'afterplay-game-daypart-center',
                  'pointer-events-none absolute flex size-20 flex-col items-center justify-center rounded-full',
                  'border border-[color-mix(in_srgb,var(--daypart-color)_20%,rgba(255,255,255,0.06))]',
                  'bg-[rgba(12,15,13,0.88)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_20px_rgba(0,0,0,0.34)]',
                  '[&_strong]:[transition:color_180ms_ease]',
                  'motion-reduce:[&_strong]:animate-none motion-reduce:[&_strong]:transition-none',
                )}
                style={{ '--daypart-color': DAYPARTS[activeIndex ?? 0].color } as CSSProperties}
              >
                <strong
                  className="text-[29px] leading-none font-[950] tracking-[-0.05em]"
                  style={{ color: DAYPARTS[activeIndex ?? 0].color }}
                >
                  {Math.round((seconds[activeIndex ?? 0] / total) * 100)}%
                </strong>
                <small className="mt-1.25 text-[10px] font-black tracking-[0.1em] text-white/70">
                  {DAYPARTS[activeIndex ?? 0].label.toUpperCase()}
                </small>
              </span>
            </div>
          </div>

          <div className="afterplay-game-daypart-grid [@media(760px<width<=1040px)]:mt-[0] [@media(width<=760px)]:mt-[0] mt-2 grid grid-cols-2 gap-2">
            {DAYPARTS.map((part, index) => {
              const isDimmed = hoveredIndex !== null && hoveredIndex !== index;
              return (
                <div
                  key={part.label}
                  data-daypart={part.label.toLowerCase()}
                  data-seconds={seconds[index]}
                  tabIndex={0}
                  role="group"
                  aria-label={`${part.label}, ${formatHours(seconds[index] / 3600)}, ${Math.round((seconds[index] / total) * 100)}%`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onFocus={() => setHoveredIndex(index)}
                  onBlur={() => setHoveredIndex(null)}
                  className={cn(
                    'afterplay-game-daypart',
                    'grid min-w-0 grid-cols-[30px_minmax(0,_1fr)] grid-rows-[auto_auto] items-center gap-2 rounded-[9px]',
                    'p-2.25',
                    '[--daypart-color:var(--primary)] border border-white/[0.05] outline-none bg-white/[0.018]',
                    '[&.is-active]:border-[color-mix(in_srgb,var(--daypart-color)_28%,rgba(255,255,255,0.04))]',
                    '[&.is-active]:bg-[color-mix(in_srgb,var(--daypart-color)_7%,rgba(255,255,255,0.015))]',
                    '[&.is-active]:transform-[translateY(-2px)]',
                    '[&:is(:hover,:focus-visible)]:border-[color-mix(in_srgb,var(--daypart-color)_28%,rgba(255,255,255,0.04))]',
                    '[&:is(:hover,:focus-visible)]:bg-[color-mix(in_srgb,var(--daypart-color)_7%,rgba(255,255,255,0.015))]',
                    '[&:is(:hover,:focus-visible)]:transform-[translateY(-2px)]',
                    '[transition:opacity_180ms_ease,transform_240ms_cubic-bezier(0.22,1,0.36,1),border-color_180ms_ease,background-color_180ms_ease]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                    activeIndex === index ? 'is-active' : '',
                  )}
                  style={
                    {
                      '--daypart-color': part.color,
                      opacity: isDimmed ? 0.5 : seconds[index] === 0 ? 0.68 : 1,
                    } as CSSProperties
                  }
                >
                  <span
                    className={cn(
                      'afterplay-game-daypart-icon',
                      'row-[1/3] flex size-7.5 items-center justify-center rounded-[8px] text-(--daypart-color)',
                      'border border-[color-mix(in_srgb,var(--daypart-color)_25%,transparent)]',
                      'bg-[color-mix(in_srgb,var(--daypart-color)_8%,transparent)]',
                    )}
                  >
                    <part.Icon size={13} />
                  </span>
                  <span className="afterplay-game-daypart-copy flex min-w-0 flex-col">
                    <strong className="overflow-hidden text-[11.5px] font-extrabold text-ellipsis text-foreground">
                      {part.label}
                    </strong>
                    <small className="text-[11px] font-semibold tracking-[0.04em] text-white/50">
                      {part.range}
                    </small>
                  </span>
                  <span className="afterplay-game-daypart-value col-start-2 text-[11.5px] font-[850] whitespace-nowrap text-(--daypart-color)">
                    {formatHours(seconds[index] / 3600)}
                  </span>
                  <span className="afterplay-game-daypart-pct [clip:rect(0_0_0_0)] [clip-path:inset(50%)] absolute size-0.25 overflow-hidden whitespace-nowrap">
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
