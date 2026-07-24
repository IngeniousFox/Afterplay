import { useState } from 'react';
import { StatCard } from './StatCard';

export type CategoryBar = { label: string; value: number };

type CategoryBarChartProps = {
  title: string;
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
  // geometría (altura del área, hueco para la etiqueta) es igual en los tres.
  maxBarWidthClass?: string;
};

const BAR_AREA_PX = 150;
// Hueco reservado por encima de la barra más alta para su etiqueta de valor.
const LABEL_SPACE_PX = 20;

// Barras con pista de fondo a altura completa + etiqueta en el pico y bajo
// el ratón — compartido por Hours per month, Spent per month y When do you
// play?, que eran la misma card con solo el color/formato/nº de barras
// distintos. Cada caller sigue resolviendo SU PROPIA regla de ventana de
// tiempo y bucketing (año vs "últimos 12 meses", isManual, día de la
// semana…) antes de pasar aquí los {label, value} ya listos.
export const CategoryBarChart = ({
  title,
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
  // Sin div envolvente cuando no hay nada que enseñar (ej. WhenDoYouPlayChart
  // sin ningún día jugado todavía) — igual que el `peakIndex >= 0 && (...)`
  // que tenía cada chart antes de compartir este componente.
  const headerRightContent = headerRight?.(peakIndex, maxValue);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4.5 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">{title}</div>
        {headerRightContent != null && (
          <div className="text-[11.5px] text-muted-foreground">{headerRightContent}</div>
        )}
      </div>

      <div className="flex flex-1 items-end gap-1.5" style={{ minHeight: BAR_AREA_PX }}>
        {bars.map((bar, index) => {
          const isHovered = hoveredIndex === index;
          // La etiqueta del pico está SIEMPRE (si se apagara al pasar el
          // ratón por otras barras, iría parpadeando durante el barrido) y
          // la de la barra bajo el ratón se suma a ella.
          const showLabel = bar.value > 0 && (isHovered || index === peakIndex);
          const barPx =
            maxValue > 0 && bar.value > 0
              ? Math.max(4, (bar.value / maxValue) * (BAR_AREA_PX - LABEL_SPACE_PX))
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
                className={`absolute inset-x-0 bottom-0 mx-auto w-full ${maxBarWidthClass} rounded-[6px]`}
                style={{
                  height: BAR_AREA_PX - LABEL_SPACE_PX,
                  background: isHovered ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)',
                }}
              />
              {showLabel && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-bold whitespace-nowrap tabular-nums"
                  style={{
                    bottom: barPx + 5,
                    color: isHovered ? 'var(--foreground)' : labelColor,
                  }}
                >
                  {formatValue(bar.value)}
                </span>
              )}
              <div
                className={`relative w-full ${maxBarWidthClass} rounded-[6px] transition-[filter]`}
                style={{
                  height: barPx,
                  background: barGradient,
                  filter:
                    hoveredIndex !== null && !isHovered ? 'saturate(.45) brightness(.7)' : 'none',
                  boxShadow: isHovered ? `0 0 18px ${glowColor}` : 'none',
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5 border-t border-white/5 pt-1.75">
        {bars.map((bar, index) => (
          <div
            key={index}
            className="flex-1 text-center text-[10px]"
            style={{
              color: hoveredIndex === index ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontWeight: hoveredIndex === index ? 700 : 400,
            }}
          >
            {bar.label}
          </div>
        ))}
      </div>
    </StatCard>
  );
};
