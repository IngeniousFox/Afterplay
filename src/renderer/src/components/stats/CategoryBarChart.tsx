import { cn } from '../../lib/utils';
import { type CSSProperties, useState } from 'react';
import { chartGroup, growY, useInView } from '../fx/chart';
import { ChartHeading, StatCard } from './StatCard';
import { barValueClass, barValueStyle } from './chartMotion';

export type CategoryBar = { label: string; value: number };

type CategoryBarChartProps = {
  title: string;
  subtitle: string;
  // Texto de la cabecera derecha — varía en FORMA entre los charts que
  // comparten este componente (un total con la ventana de tiempo en Hours/
  // Spent per month, un "X is your day" condicional en When do you play?),
  // así que recibe el pico ya calculado.
  headerRight?: (peakIndex: number, peakValue: number) => React.ReactNode;
  bars: CategoryBar[];
  formatValue: (value: number) => string;
  // Color de la serie: Phosphor para horas (la serie principal), Tube para
  // euros (la secundaria) y el color del juego en su página.
  accent?: string;
  // max-w-8 (meses, 12 barras) o max-w-9 (días, 7 barras).
  maxBarWidthClass?: string;
};

const BAR_AREA_PX = 140;

// Barras con pico persistente y lectura al pasar el ratón — compartido por
// Hours per month, Spent per month y When do you play?. Fósforo: la serie a
// media intensidad y la barra activa (el pico, o la que estás mirando) a
// opacidad total con su valor encima en Bone.
export const CategoryBarChart = ({
  title,
  subtitle,
  headerRight,
  bars,
  formatValue,
  accent = 'var(--color-phosphor)',
  maxBarWidthClass = 'max-w-8',
}: CategoryBarChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Las barras crecen desde la base, escalonadas, la primera vez que la
  // gráfica entra en vista (fx/chart). Cambiar de año ya no las repite.
  const { observe, inView } = useInView();

  const maxValue = Math.max(0, ...bars.map((bar) => bar.value));
  const peakIndex = maxValue > 0 ? bars.findIndex((bar) => bar.value === maxValue) : -1;
  const activeIndex = hoveredIndex ?? peakIndex;
  const activeBar = activeIndex >= 0 ? bars[activeIndex] : undefined;
  const totalValue = bars.reduce((sum, bar) => sum + bar.value, 0);
  const activeShare =
    activeBar !== undefined && totalValue > 0
      ? Math.round((activeBar.value / totalValue) * 100)
      : 0;
  const headerRightContent = headerRight?.(peakIndex, maxValue);

  return (
    <StatCard
      className="afterplay-category-card relative flex h-full flex-col overflow-hidden"
      style={{ '--chart-accent': accent } as CSSProperties}
    >
      <ChartHeading title={title} subtitle={subtitle} right={headerRightContent} />

      <div
        className={cn(
          'afterplay-category-focus mt-3 flex min-h-10 items-end justify-between gap-4 border-b border-line pb-2.5',
          '[&>div:last-child]:flex-none [&>div:last-child]:text-right',
        )}
        aria-live="polite"
      >
        {activeBar ? (
          <>
            <div>
              <span className="block text-micro font-semibold text-dust">
                {hoveredIndex === null ? 'Peak' : 'Inspecting'}
              </span>
              <strong className="block text-small font-semibold text-bone tabular-nums">
                {activeBar.label}
              </strong>
            </div>
            <div>
              <strong className="block font-display text-[20px] leading-none font-bold text-(--chart-accent) tabular-nums">
                {formatValue(activeBar.value)}
              </strong>
              <small className="mt-0.5 block text-micro text-dust">
                {activeShare}% of this view
              </small>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="block text-micro font-semibold text-dust">No activity</span>
              <strong className="block text-small font-semibold text-bone">—</strong>
            </div>
            <small className="block text-micro text-dust">Nothing tracked in this view</small>
          </>
        )}
      </div>

      <div
        ref={observe}
        data-inview={inView || undefined}
        className={cn(
          'afterplay-category-stage relative mt-7 flex flex-none items-stretch gap-2 border-b border-line-strong',
          chartGroup,
        )}
        style={{ height: BAR_AREA_PX }}
      >
        <span
          className="afterplay-category-grid pointer-events-none absolute inset-0 -z-1 grid grid-rows-[repeat(3,_1fr)]"
          aria-hidden="true"
        >
          <i className="border-t border-line" />
          <i className="border-t border-line" />
          <i className="border-t border-line" />
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
              style={{ '--bar-height': `${fillPct}%` } as CSSProperties}
              onMouseEnter={() => {
                if (bar.value > 0) setHoveredIndex(index);
              }}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              className={cn(
                'afterplay-category-column relative h-full min-w-0 flex-1 rounded-t-sm outline-hidden',
                'transition-[background-color,opacity] duration-150 hover:bg-raised/60',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
                '[&.is-dimmed]:opacity-60',
                isActive ? 'is-active' : '',
                hoveredIndex !== null && !isHovered ? 'is-dimmed' : '',
                bar.value === 0 ? 'is-empty' : '',
              )}
            >
              {bar.value > 0 && (
                <span
                  className={cn(
                    'afterplay-category-fill absolute bottom-0 left-1/2 h-(--bar-height) min-h-0.75 w-[74%] -translate-x-1/2',
                    'rounded-t-[2px]',
                    'bg-[color-mix(in_srgb,var(--chart-accent)_55%,transparent)]',
                    growY,
                    'transition-[background-color,box-shadow] duration-150',
                    '[.afterplay-category-column.is-active_&]:bg-(--chart-accent)',
                    // Bloom de fósforo en la barra que estás mirando.
                    '[.afterplay-category-column.is-active_&]:shadow-[0_0_14px_color-mix(in_srgb,var(--chart-accent)_55%,transparent),0_0_3px_var(--chart-accent)]',
                    'motion-reduce:transition-none',
                    maxBarWidthClass,
                  )}
                  style={{ animationDelay: `${index * 40}ms` }}
                />
              )}
              {bar.value > 0 && isActive && (
                <span
                  className={cn(
                    'text-micro font-semibold whitespace-nowrap text-bone tabular-nums',
                    barValueClass,
                  )}
                  style={barValueStyle(index, 40)}
                >
                  {formatValue(bar.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="afterplay-category-axis mt-2 flex gap-2">
        {bars.map((bar, index) => (
          <div
            key={index}
            className={cn(
              activeIndex === index ? 'is-active' : '',
              'min-w-0 flex-1 text-center text-micro break-words whitespace-normal text-dust',
              '[&.is-active]:font-semibold [&.is-active]:text-bone',
            )}
          >
            {bar.label}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
