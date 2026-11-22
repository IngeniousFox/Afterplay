import { cn } from '../../lib/utils';
import { useState } from 'react';
import { formatHours } from '../../lib/format';
import { GENRE_AXES } from '../../lib/genreAxes';
import { ChartHeading, StatCard } from './StatCard';

type GenreRadarProps = {
  // Minutos jugados por eje — ya sumados fuera (Stats.tsx), respetando el
  // filtro de año activo.
  minutesByAxis: Record<string, number>;
};

// SVG a escala 1:1 (se pinta a su tamaño en píxeles): los rótulos de los ejes
// se leen a 13 px y las horas a 12,5 px, sin depender del ancho de la card.
const VIEW_WIDTH = 330;
const VIEW_HEIGHT = 290;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = VIEW_HEIGHT / 2;
const OUTER_RADIUS = 88;
const LABEL_RADIUS = 116;
const HIT_RADIUS = 130;
const RING_FRACTIONS = [0.25, 0.5, 0.75, 1];

const angleOf = (index: number, axisCount: number): number =>
  -Math.PI / 2 + (index * 2 * Math.PI) / axisCount;

const polar = (angle: number, radius: number): [number, number] => [
  CENTER_X + Math.cos(angle) * radius,
  CENTER_Y + Math.sin(angle) * radius,
];

const pointAt = (index: number, radius: number, axisCount: number): [number, number] =>
  polar(angleOf(index, axisCount), radius);

const ringPoints = (fraction: number, axisCount: number): string =>
  Array.from({ length: axisCount }, (_, index) =>
    pointAt(index, OUTER_RADIUS * fraction, axisCount).join(','),
  ).join(' ');

// Radar de géneros (Fósforo): 6 ejes, polígono Phosphor al 20 % con borde
// Phosphor; cada eje lleva su nombre y sus horas. Al pasar por un eje se
// resalta su vértice y la lectura de abajo pasa a "Inspecting".
export const GenreRadar = ({ minutesByAxis }: GenreRadarProps): React.JSX.Element => {
  const axes = GENRE_AXES;
  const maxMinutes = Math.max(1, ...axes.map((axis) => minutesByAxis[axis] ?? 0));
  const totalMinutes = axes.reduce((sum, axis) => sum + (minutesByAxis[axis] ?? 0), 0);
  const entries = axes.map((axis, index) => {
    const minutes = minutesByAxis[axis] ?? 0;
    return {
      axis,
      index,
      minutes,
      share: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
    };
  });
  const rankedEntries = [...entries].sort((a, b) => b.minutes - a.minutes || a.index - b.index);
  const dominantIndex = totalMinutes > 0 ? rankedEntries[0].index : null;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIndex = hoveredIndex ?? dominantIndex;
  const activeEntry = activeIndex === null ? null : entries[activeIndex];

  const dataPoints = entries.map((entry) =>
    pointAt(entry.index, OUTER_RADIUS * (entry.minutes / maxMinutes), axes.length),
  );
  const polygonPoints = dataPoints.map((point) => point.join(',')).join(' ');

  return (
    <StatCard className="afterplay-genre-card flex h-full flex-col overflow-hidden">
      <ChartHeading title="Genre spread" right="Hours by main genre" />

      <div className="afterplay-genre-body mt-2 flex flex-1 flex-col items-center justify-center">
        <div className="afterplay-genre-radar relative max-w-full">
          <svg
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="block h-auto max-w-full overflow-visible"
            role="img"
            aria-label={
              dominantIndex === null
                ? 'No genre playtime yet'
                : `${entries[dominantIndex].axis} is the dominant genre at ${entries[dominantIndex].share}%`
            }
          >
            {RING_FRACTIONS.map((fraction) => (
              <polygon
                key={fraction}
                points={ringPoints(fraction, axes.length)}
                fill="none"
                stroke="var(--color-line-strong)"
                strokeWidth={1}
              />
            ))}

            {entries.map((entry) => {
              const [x, y] = pointAt(entry.index, OUTER_RADIUS, axes.length);
              const isActive = activeIndex === entry.index;
              return (
                <line
                  key={entry.axis}
                  x1={CENTER_X}
                  y1={CENTER_Y}
                  x2={x}
                  y2={y}
                  stroke={isActive ? 'var(--color-phosphor)' : 'var(--color-line)'}
                  strokeWidth={isActive ? 1.5 : 1}
                  className="afterplay-genre-spoke transition-[stroke] duration-150 motion-reduce:transition-none"
                />
              );
            })}

            <g
              key={polygonPoints}
              className="afterplay-genre-shape animate-in duration-500 fade-in-0 zoom-in-75 motion-reduce:animate-none"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <polygon
                points={polygonPoints}
                fill="var(--color-phosphor)"
                fillOpacity={0.2}
                stroke="var(--color-phosphor)"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
              {dataPoints.map((point, index) => {
                const isActive = activeIndex === index;
                return (
                  <circle
                    key={entries[index].axis}
                    cx={point[0]}
                    cy={point[1]}
                    r={isActive ? 5 : 3.5}
                    fill={isActive ? 'var(--color-phosphor)' : 'var(--color-panel)'}
                    stroke="var(--color-phosphor)"
                    strokeWidth={1.5}
                    className="afterplay-genre-point transition-[r,fill] duration-150 motion-reduce:transition-none"
                  />
                );
              })}
            </g>

            {entries.map((entry) => {
              const [x, y] = pointAt(entry.index, LABEL_RADIUS, axes.length);
              const isActive = activeIndex === entry.index;
              const anchor = Math.abs(x - CENTER_X) < 4 ? 'middle' : x > CENTER_X ? 'start' : 'end';
              const shiftX = anchor === 'start' ? -14 : anchor === 'end' ? 14 : 0;
              return (
                <g
                  key={entry.axis}
                  className={cn(
                    'afterplay-genre-row',
                    isActive ? 'afterplay-genre-row--active' : '',
                  )}
                  onMouseEnter={() => setHoveredIndex(entry.index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <text
                    x={x + shiftX}
                    y={y - 7}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    fill={isActive ? 'var(--color-phosphor)' : 'var(--color-bone)'}
                    fontSize={13}
                    fontWeight={600}
                    className="afterplay-genre-label transition-[fill] duration-150"
                  >
                    {entry.axis}
                  </text>
                  <text
                    x={x + shiftX}
                    y={y + 9}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    fill="var(--color-dust)"
                    fontSize={12.5}
                    className="tabular-nums"
                  >
                    {formatHours(entry.minutes / 60)}
                  </text>
                </g>
              );
            })}

            {entries.map((entry) => {
              const halfAngle = Math.PI / axes.length;
              const angle = angleOf(entry.index, axes.length);
              const [startX, startY] = polar(angle - halfAngle, HIT_RADIUS);
              const [endX, endY] = polar(angle + halfAngle, HIT_RADIUS);
              return (
                <path
                  key={`hit-${entry.axis}`}
                  d={`M ${CENTER_X},${CENTER_Y} L ${startX},${startY} A ${HIT_RADIUS} ${HIT_RADIUS} 0 0 1 ${endX},${endY} Z`}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIndex(entry.index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              );
            })}
          </svg>
        </div>

        <div
          className="afterplay-genre-focus mt-2 flex w-full items-baseline justify-between gap-3 border-t border-line pt-2.5"
          aria-live="polite"
        >
          <span className="text-small text-dust">
            {hoveredIndex === null ? 'Your centre' : 'Inspecting'}{' '}
            <strong className="font-semibold text-bone">{activeEntry?.axis ?? 'No signal'}</strong>
          </span>
          <span className="text-small text-dust tabular-nums">
            {activeEntry ? formatHours(activeEntry.minutes / 60) : '0h'} played ·{' '}
            <strong className="font-semibold text-phosphor">{activeEntry?.share ?? 0}%</strong>
          </span>
        </div>
      </div>
    </StatCard>
  );
};
