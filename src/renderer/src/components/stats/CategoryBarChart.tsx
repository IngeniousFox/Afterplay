import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { StatCard } from './StatCard';

export type CategoryBar = { label: string; value: number };

type CategoryBarChartProps = {
  title: string;
  subtitle: string;
  Icon: LucideIcon;
  // Texto de la cabecera derecha — varía en FORMA entre los tres charts que
  // comparten este componente (un total con la ventana de tiempo en Hours/
  // Spent per month, un "X is your day" condicional en When do you play?),
  // así que no es un simple string: recibe el pico ya calculado (por si el
  // caller lo necesita, como WhenDoYouPlayChart) sin tener que recalcularlo
  // por su cuenta.
  headerRight?: (peakIndex: number, peakValue: number) => React.ReactNode;
  bars: CategoryBar[];
  formatValue: (value: number) => string;
  barGradient: string;
  labelColor: string;
  glowColor: string;
  // max-w-8 (meses, 12 barras) o max-w-9 (días, 7 barras) — el resto de la
  // geometría y el panel de lectura activa es igual en los tres.
  maxBarWidthClass?: string;
};

const BAR_AREA_PX = 122;

// Barras con pista de fondo, pico persistente y panel de lectura al pasar el
// ratón — compartido por Hours per month, Spent per month y When do you
// play?, que eran la misma card con solo el color/formato/nº de barras
// distintos. Cada caller sigue resolviendo SU PROPIA regla de ventana de
// tiempo y bucketing (año vs "últimos 12 meses", isManual, día de la
// semana…) antes de pasar aquí los {label, value} ya listos.
export const CategoryBarChart = ({
  title,
  subtitle,
  Icon,
  headerRight,
  bars,
  formatValue,
  barGradient,
  labelColor,
  glowColor,
  maxBarWidthClass = 'max-w-8',
}: CategoryBarChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxValue = Math.max(0, ...bars.map((bar) => bar.value));
  const peakIndex = maxValue > 0 ? bars.findIndex((bar) => bar.value === maxValue) : -1;
  const activeIndex = hoveredIndex ?? peakIndex;
  const activeBar = activeIndex >= 0 ? bars[activeIndex] : undefined;
  const totalValue = bars.reduce((sum, bar) => sum + bar.value, 0);
  const activeShare =
    activeBar !== undefined && totalValue > 0
      ? Math.round((activeBar.value / totalValue) * 100)
      : 0;
  // Sin div envolvente cuando no hay nada que enseñar (ej. WhenDoYouPlayChart
  // sin ningún día jugado todavía) — igual que el `peakIndex >= 0 && (...)`
  // que tenía cada chart antes de compartir este componente.
  const headerRightContent = headerRight?.(peakIndex, maxValue);

  return (
    <StatCard
      className={cn(
        'afterplay-category-card flex h-full flex-col relative overflow-hidden',
        "after:content-[''] after:absolute after:top-0 after:left-5.5 after:w-14.5 after:h-px after:pointer-events-none",
        'after:[background:linear-gradient(90deg,transparent,var(--chart-accent,#2fdc7e),transparent)] after:opacity-50',
      )}
      style={
        {
          '--chart-accent': labelColor,
          '--chart-glow': glowColor,
        } as CSSProperties
      }
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
          <Icon size={15} />
        </span>
        <div className="afterplay-chart-heading-copy min-w-0">
          <strong className="block text-foreground text-[14px] font-[850] leading-[1.2] whitespace-normal">
            {title}
          </strong>
          <small className="block mt-0.75 text-muted-foreground text-[11.5px] leading-[1.2] whitespace-normal">
            {subtitle}
          </small>
        </div>
        {headerRightContent != null && (
          <div
            className={cn(
              'afterplay-chart-total min-w-17.5 text-right [&_strong]:block [&_strong]:text-foreground [&_strong]:text-[12px]',
              '[&_strong]:font-[850] [&_strong]:leading-[1.2] [&_strong]:tabular-nums [&_small]:block [&_small]:mt-0.75',
              '[&_small]:text-white/45 [&_small]:text-[11px] [&_small]:font-[650] [&_small]:leading-[1.2]',
              '[&_em]:text-[color:var(--session-accent,var(--chart-accent,#2fdc7e))] [&_em]:not-italic [&_em]:font-extrabold',
            )}
          >
            {headerRightContent}
          </div>
        )}
      </div>

      <div
        className={cn(
          'afterplay-category-focus flex min-h-[49px] items-center justify-between gap-4 mt-[13px] py-2 px-[11px]',
          'rounded-[10px] border',
          'border-[color-mix(in_srgb,var(--chart-accent,var(--session-accent,#2fdc7e))_18%,rgba(255,255,255,0.05))]',
          '[background:linear-gradient(115deg,color-mix(in_srgb,var(--chart-accent,var(--session-accent,#2fdc7e))_7%,transparent),rgba(255,255,255,0.012))]',
          '[&_>_div:last-child]:flex-none [&_>_div:last-child]:text-right',
          '[&_>_div:last-child_strong]:text-[color:var(--chart-accent,var(--session-accent,#2fdc7e))]',
        )}
        aria-live="polite"
      >
        {activeBar ? (
          <>
            <div>
              <span className="block text-white/45 text-[11px] font-black tracking-[0.14em] leading-[1]">
                {hoveredIndex === null ? 'PEAK' : 'INSPECTING'}
              </span>
              <strong className="block mt-1 text-foreground text-[13px] font-[850] leading-[1.05] tabular-nums">
                {activeBar.label}
              </strong>
            </div>
            <div>
              <strong className="block mt-1 text-foreground text-[13px] font-[850] leading-[1.05] tabular-nums">
                {formatValue(activeBar.value)}
              </strong>
              <small className="block mt-0.75 text-white/45 text-[11px] font-semibold leading-[1.05]">
                {activeShare}% of this view
              </small>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="block text-white/45 text-[11px] font-black tracking-[0.14em] leading-[1]">
                NO ACTIVITY
              </span>
              <strong className="block mt-1 text-foreground text-[13px] font-[850] leading-[1.05] tabular-nums">
                —
              </strong>
            </div>
            <small className="block mt-0.75 text-white/45 text-[11px] font-semibold leading-[1.05]">
              Nothing tracked in this view
            </small>
          </>
        )}
      </div>

      <div
        className="afterplay-category-stage relative flex flex-none items-stretch gap-[9px] mt-3 border-b border-b-[rgba(255,255,255,0.075)]"
        style={{ height: BAR_AREA_PX }}
      >
        <span
          className="afterplay-category-grid absolute -z-1 inset-0 grid grid-rows-[repeat(3,_1fr)] pointer-events-none"
          aria-hidden="true"
        >
          <i className="border-t border-dashed border-t-[rgba(255,255,255,0.035)]" />
          <i className="border-t border-dashed border-t-[rgba(255,255,255,0.035)]" />
          <i className="border-t border-dashed border-t-[rgba(255,255,255,0.035)]" />
        </span>
        {bars.map((bar, index) => {
          const isHovered = hoveredIndex === index;
          const isActive = activeIndex === index;
          const fillPct =
            maxValue > 0 && bar.value > 0 ? Math.max(3, (bar.value / maxValue) * 100) : 0;

          return (
            <div
              key={index}
              tabIndex={bar.value > 0 ? 0 : -1}
              role="group"
              aria-label={`${bar.label}, ${formatValue(bar.value)}${totalValue > 0 ? `, ${Math.round((bar.value / totalValue) * 100)}% of this view` : ''}`}
              data-active={isActive}
              onMouseEnter={() => {
                if (bar.value > 0) setHoveredIndex(index);
              }}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              className={cn(
                'afterplay-category-column relative min-w-0 h-full flex-1 rounded-[7px_7px_0_0] outline-none',
                '[transition:opacity_180ms_ease,transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
                '[&.is-active]:[transform:translateY(-2px)] [&.is-dimmed]:opacity-43',
                'focus-visible:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--chart-accent,var(--session-accent,#2fdc7e))_45%,transparent)]',
                'motion-reduce:animate-none motion-reduce:transition-none',
                isActive ? 'is-active' : '',
                hoveredIndex !== null && !isHovered ? 'is-dimmed' : '',
                bar.value === 0 ? 'is-empty' : '',
              )}
            >
              <span
                className={cn(
                  'afterplay-category-track absolute bottom-0 left-1/2 w-[74%] h-full rounded-[6px_6px_3px_3px]',
                  '[transform:translateX(-50%)] border border-white/[0.025] border-b-0',
                  '[background:linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.018))]',
                  maxBarWidthClass,
                )}
              />
              {bar.value > 0 && (
                <span
                  className={cn(
                    'afterplay-category-fill absolute bottom-0 left-1/2 w-[74%] h-[var(--bar-height)] min-h-[3px] overflow-hidden',
                    'rounded-[6px_6px_3px_3px] [transform:translateX(-50%)] origin-bottom',
                    'animate-[afterplay-category-rise_620ms_cubic-bezier(0.22,1,0.36,1)_var(--bar-delay)_backwards]',
                    '[transition:filter_180ms_ease,box-shadow_200ms_ease] [background:var(--bar-gradient)]',
                    "after:content-[''] after:absolute after:inset-0 after:pointer-events-none",
                    'after:[background:linear-gradient(90deg,rgba(255,255,255,0.09),transparent_36%_72%,rgba(0,0,0,0.08))]',
                    '[.afterplay-category-column.is-active_&]:[filter:saturate(1.06)_brightness(1.07)]',
                    '[.afterplay-category-column.is-active_&]:[box-shadow:0_0_11px_var(--chart-glow)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                    maxBarWidthClass,
                  )}
                  style={
                    {
                      '--bar-height': `${fillPct}%`,
                      '--bar-gradient': barGradient,
                      '--bar-delay': `${index * 45}ms`,
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

      <div className="afterplay-category-axis flex gap-[9px] mt-[7px]">
        {bars.map((bar, index) => (
          <div
            key={index}
            className={cn(
              activeIndex === index ? 'is-active' : '',
              'min-w-0 flex-1 text-white/45 text-[11px] font-semibold leading-[1.25] text-center',
              'whitespace-normal break-words [transition:color_180ms_ease,font-weight_180ms_ease]',
              '[&.is-active]:text-[color:var(--chart-accent,var(--session-accent,#2fdc7e))] [&.is-active]:font-[850]',
            )}
          >
            {bar.label}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
