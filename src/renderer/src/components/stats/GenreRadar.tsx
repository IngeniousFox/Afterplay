import { cn } from '../../lib/utils';
import { useState } from 'react';
import { formatHours } from '../../lib/format';
import { GENRE_AXES } from '../../lib/genreAxes';
import { StatCard } from './StatCard';

type GenreRadarProps = {
  // Minutos jugados por eje — ya sumados fuera (Stats.tsx/GameStats.tsx),
  // respetando el filtro de año activo.
  minutesByAxis: Record<string, number>;
};

const VIEW_WIDTH = 220;
const VIEW_HEIGHT = 214;
const CENTER_X = 110;
const CENTER_Y = 107;
const OUTER_RADIUS = 71;
const LABEL_RADIUS = 91;
const HIT_RADIUS = 103;
const RING_FRACTIONS = [0.25, 0.5, 0.75, 1];

const AXIS_COLORS: Record<(typeof GENRE_AXES)[number], string> = {
  RPG: '#2fdc7e',
  Action: '#e3b24a',
  Adventure: '#85a3d6',
  Strategy: '#c28bd8',
  Sim: '#65d3d1',
  Puzzle: '#e88d9b',
};

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
      color: AXIS_COLORS[axis],
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
  const activeColor = activeEntry?.color ?? '#2fdc7e';

  return (
    <StatCard className="afterplay-genre-card flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[14px] font-bold text-foreground">Genre Spread</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            Playtime by primary genre
          </div>
        </div>
        {dominantIndex !== null && (
          <div className="afterplay-genre-dominant flex flex-col items-end gap-px">
            <span className="text-white/45 text-[11px] font-black tracking-[0.14em] uppercase">
              Dominant
            </span>
            <strong
              className="text-[12px] font-[850]"
              style={{ color: entries[dominantIndex].color }}
            >
              {entries[dominantIndex].axis}
            </strong>
          </div>
        )}
      </div>

      <div className="afterplay-genre-body mt-3.5 flex flex-1 flex-wrap items-center justify-center gap-3">
        <div className="afterplay-genre-radar relative w-55 flex-none">
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="block h-auto w-full"
            role="img"
            aria-label={
              dominantIndex === null
                ? 'No genre playtime yet'
                : `${entries[dominantIndex].axis} is the dominant genre at ${entries[dominantIndex].share}%`
            }
          >
            <defs>
              <radialGradient
                id="genre-radar-fill"
                gradientUnits="userSpaceOnUse"
                cx={CENTER_X}
                cy={CENTER_Y}
                r={OUTER_RADIUS}
              >
                <stop offset="0%" stopColor={activeColor} stopOpacity={0.38} />
                <stop offset="100%" stopColor={activeColor} stopOpacity={0.07} />
              </radialGradient>
              <filter id="genre-radar-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>

            {[1, 0.5].map((outer) => {
              const inner = outer - 0.25;
              return (
                <path
                  key={outer}
                  d={`M ${ringPoints(outer, axes.length).replaceAll(' ', ' L ')} Z M ${ringPoints(inner, axes.length).replaceAll(' ', ' L ')} Z`}
                  fill="rgba(255,255,255,.022)"
                  fillRule="evenodd"
                />
              );
            })}

            {RING_FRACTIONS.map((fraction) => (
              <polygon
                key={fraction}
                points={ringPoints(fraction, axes.length)}
                fill="none"
                stroke="rgba(255,255,255,.085)"
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
                  stroke={isActive ? entry.color : 'rgba(255,255,255,.075)'}
                  strokeWidth={isActive ? 1.8 : 1}
                  opacity={hoveredIndex !== null && !isActive ? 0.5 : 1}
                  className={cn(
                    'afterplay-genre-spoke',
                    '[transition:opacity_180ms_ease,stroke_180ms_ease,fill_180ms_ease,r_220ms_cubic-bezier(0.22,1,0.36,1)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                />
              );
            })}

            <g
              key={polygonPoints}
              className="afterplay-genre-shape animate-in fade-in-0 zoom-in-75 duration-500"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <polygon
                points={polygonPoints}
                fill="none"
                stroke={activeColor}
                strokeWidth={6}
                opacity={0.2}
                filter="url(#genre-radar-glow)"
              />
              <polygon
                points={polygonPoints}
                fill="url(#genre-radar-fill)"
                stroke="rgba(234,255,243,.74)"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
              {dataPoints.map((point, index) => {
                const entry = entries[index];
                const isActive = activeIndex === index;
                return (
                  <circle
                    key={entry.axis}
                    cx={point[0]}
                    cy={point[1]}
                    r={isActive ? 4.5 : 3}
                    fill={entry.color}
                    stroke="rgba(10,12,11,.92)"
                    strokeWidth={1.5}
                    className={cn(
                      'afterplay-genre-point',
                      '[transition:opacity_180ms_ease,stroke_180ms_ease,fill_180ms_ease,r_220ms_cubic-bezier(0.22,1,0.36,1)]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                  />
                );
              })}
            </g>

            {entries.map((entry) => {
              const [x, y] = pointAt(entry.index, LABEL_RADIUS, axes.length);
              const isActive = activeIndex === entry.index;
              return (
                <text
                  key={entry.axis}
                  x={x}
                  y={y}
                  fill={isActive ? entry.color : 'var(--muted-foreground)'}
                  fontSize={11}
                  fontWeight={isActive ? 750 : 500}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily="-apple-system,sans-serif"
                  className={cn(
                    'afterplay-genre-label',
                    '[transition:opacity_180ms_ease,stroke_180ms_ease,fill_180ms_ease,r_220ms_cubic-bezier(0.22,1,0.36,1)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                >
                  {entry.axis}
                </text>
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

          <div
            className={cn(
              'afterplay-genre-core absolute top-1/2 left-1/2 flex w-[37px] h-[37px] items-center justify-center rounded-[50%]',
              'text-[11px] font-black pointer-events-none border border-white/10 text-white/85 bg-[rgba(11,14,12,0.88)]',
              '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.06),0_7px_18px_rgba(0,0,0,0.36)] [transform:translate(-50%,-50%)]',
            )}
            aria-hidden="true"
          >
            <span>{activeEntry?.share ?? 0}%</span>
          </div>
        </div>

        <div className="afterplay-genre-profile min-w-30 flex-1 basis-30">
          <div
            className={cn(
              'afterplay-genre-focus relative overflow-hidden py-2.5 px-[11px] rounded-[10px] border',
              'border-[color-mix(in_srgb,var(--genre-accent)_22%,rgba(255,255,255,0.06))]',
              '[background:linear-gradient(135deg,color-mix(in_srgb,var(--genre-accent)_11%,transparent),rgba(255,255,255,0.018))]',
              '[transition:border-color_200ms_ease,background-color_200ms_ease]',
              "after:content-[''] after:absolute after:-right-5.5 after:-bottom-6.75 after:w-15.5 after:h-15.5",
              'after:rounded-full after:bg-[var(--genre-accent)] after:opacity-8 after:[filter:blur(10px)]',
            )}
            style={{ '--genre-accent': activeColor } as React.CSSProperties}
          >
            <span className="text-white/45 text-[11px] font-black tracking-[0.14em] uppercase">
              {hoveredIndex === null ? 'Your centre' : 'Inspecting'}
            </span>
            <strong
              className={cn(
                'relative z-1 block mt-0.75 overflow-hidden',
                'text-[color:var(--genre-accent)]',
                'text-[15px] font-black tracking-[-0.02em] text-ellipsis whitespace-nowrap',
              )}
            >
              {activeEntry?.axis ?? 'No signal'}
            </strong>
            <small className="relative z-1 block mt-0.5 text-muted-foreground text-[11px]">
              {activeEntry ? formatHours(activeEntry.minutes / 60) : '0h'} played
            </small>
          </div>

          <div className="mt-2.5 flex flex-col gap-1.5">
            {rankedEntries.map((entry) => {
              const isActive = activeIndex === entry.index;
              return (
                <div
                  key={entry.axis}
                  className={cn(
                    'afterplay-genre-row py-0.5 px-px rounded-[5px] text-[11px] font-[650] text-white/45',
                    '[transition:color_180ms_ease,opacity_180ms_ease,transform_220ms_cubic-bezier(0.22,1,0.36,1)]',
                    '[&.afterplay-genre-row--active]:text-foreground [&.afterplay-genre-row--active]:[transform:translateX(2px)]',
                    '[&.afterplay-genre-row--active_strong]:text-[color:var(--genre-accent)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                    isActive ? 'afterplay-genre-row--active' : '',
                  )}
                  style={{ '--genre-accent': entry.color } as React.CSSProperties}
                  onMouseEnter={() => setHoveredIndex(entry.index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{entry.axis}</span>
                    <strong className="text-white/50 text-[11px] font-[850] [tab-size:2]">
                      {entry.share}%
                    </strong>
                  </div>
                  <div
                    className={cn(
                      'afterplay-genre-track h-0.5 mt-[3px] overflow-hidden rounded-[99px] bg-white/[0.055]',
                      '[.afterplay-genre-row--active_&_span]:opacity-100',
                    )}
                  >
                    <span
                      className={cn(
                        'block h-full rounded-[inherit] bg-[var(--genre-accent)]',
                        '[box-shadow:0_0_8px_color-mix(in_srgb,var(--genre-accent)_32%,transparent)] opacity-50',
                        '[transition:width_520ms_cubic-bezier(0.22,1,0.36,1),opacity_180ms_ease]',
                        'motion-reduce:animate-none motion-reduce:transition-none',
                      )}
                      style={{ width: `${Math.max(entry.minutes > 0 ? 5 : 0, entry.share)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </StatCard>
  );
};
