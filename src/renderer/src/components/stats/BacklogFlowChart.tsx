import { cn } from '../../lib/utils';
import { useCallback, useMemo, useState } from 'react';
import type { StateEventSummary } from '../../../../shared/types';
import { monthKey } from '../../lib/dateMath';
import { floatingPanelClass } from '../../lib/styles';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import type { Year } from './YearPicker';

type FlowGame = { addedAt: Date };
type FlowPoint = { key: number; library: number; planned: number; completed: number };
type FlowSeriesKey = 'library' | 'planned' | 'completed';
type FlowLine = {
  key: FlowSeriesKey;
  label: string;
  shortLabel: string;
  context: string;
  color: string;
  valueOf: (point: FlowPoint) => number;
};

type BacklogFlowChartProps = {
  games: FlowGame[];
  // Los juegos que AHORA MISMO viven en Plan to Play — su propia línea,
  // separada de la biblioteca real.
  plannedGames: FlowGame[];
  stateEvents: StateEventSummary[];
  year: Year;
};

const LIBRARY_COLOR = '#2fdc7e';
const PLAN_COLOR = '#85a3d6';
const COMPLETED_COLOR = '#e3b24a';

const INITIAL_WIDTH = 720;
const HEIGHT = 246;
const PAD_LEFT = 116;
const PAD_RIGHT = 18;
const PAD_TOP = 12;
const LANE_HEIGHT = 56;
const LANE_GAP = 15;

const LINES: FlowLine[] = [
  {
    key: 'library',
    label: 'Library',
    shortLabel: 'in library',
    context: 'recorded entries',
    color: LIBRARY_COLOR,
    valueOf: (point) => point.library,
  },
  {
    key: 'planned',
    label: 'Plan to play',
    shortLabel: 'planned',
    context: 'current queue\nby date added',
    color: PLAN_COLOR,
    valueOf: (point) => point.planned,
  },
  {
    key: 'completed',
    label: 'Completed',
    shortLabel: 'completed',
    context: 'completion events',
    color: COMPLETED_COLOR,
    valueOf: (point) => point.completed,
  },
];

const monthLabel = (key: number): string =>
  new Date(Math.floor(key / 12), key % 12, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  });

const countByMonth = (dates: number[]): Map<number, number> => {
  const map = new Map<number, number>();
  for (const key of dates) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
};

// Tres acumulados honestos y comparables por forma, no por altura. Biblioteca
// y Plan to Play se reconstruyen con addedAt; Completed sí procede de eventos.
// Cada carril usa su propia escala para que una colección grande no aplaste al
// resto ni obligue a aplicar una escala logarítmica difícil de interpretar.
export const BacklogFlowChart = ({
  games,
  plannedGames,
  stateEvents,
  year,
}: BacklogFlowChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeSeries, setActiveSeries] = useState<FlowSeriesKey | null>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  // Keep SVG units equal to screen pixels so labels do not shrink with the card.
  const measureChart = useCallback((node: SVGSVGElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const WIDTH = width;

  const points = useMemo(() => {
    const libraryKeys = games.map((game) => monthKey(game.addedAt));
    const plannedKeys = plannedGames.map((game) => monthKey(game.addedAt));
    const completedKeys = stateEvents
      .filter((event) => event.type === 'completed')
      .map((event) => monthKey(event.occurredAt));

    let firstKey: number;
    let lastKey: number;
    if (year === 'all') {
      const allKeys = [...libraryKeys, ...plannedKeys, ...completedKeys];
      if (allKeys.length === 0) return [];
      // Un mes vacío inicial hace visible el primer alta masiva en vez de
      // dibujar la serie ya pegada al techo desde el borde izquierdo.
      firstKey = Math.min(...allKeys) - 1;
      lastKey = Math.max(monthKey(new Date()), ...allKeys);
    } else {
      firstKey = year * 12;
      lastKey = year * 12 + 11;
    }

    const libraryByKey = countByMonth(libraryKeys);
    const plannedByKey = countByMonth(plannedKeys);
    const completedByKey = countByMonth(completedKeys);

    let library = 0;
    let planned = 0;
    let completed = 0;
    const result: FlowPoint[] = [];
    for (let key = firstKey; key <= lastKey; key++) {
      library += libraryByKey.get(key) ?? 0;
      planned += plannedByKey.get(key) ?? 0;
      completed += completedByKey.get(key) ?? 0;
      result.push({ key, library, planned, completed });
    }
    return result;
  }, [games, plannedGames, stateEvents, year]);

  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const xAt = (index: number): number =>
    PAD_LEFT + (points.length > 1 ? (index / (points.length - 1)) * innerWidth : innerWidth / 2);
  const laneTop = (lineIndex: number): number => PAD_TOP + lineIndex * (LANE_HEIGHT + LANE_GAP);
  const laneBaseline = (lineIndex: number): number => laneTop(lineIndex) + LANE_HEIGHT - 6;
  const yAt = (lineIndex: number, value: number, maximum: number): number => {
    const usableHeight = LANE_HEIGHT - 12;
    return laneBaseline(lineIndex) - (value / Math.max(1, maximum)) * usableHeight;
  };

  const stepPath = (line: FlowLine, lineIndex: number): string => {
    if (points.length === 0) return '';
    const maximum = line.valueOf(points[points.length - 1]);
    let path = `M ${xAt(0)} ${yAt(lineIndex, line.valueOf(points[0]), maximum)}`;
    for (let index = 1; index < points.length; index++) {
      path += ` H ${xAt(index)} V ${yAt(lineIndex, line.valueOf(points[index]), maximum)}`;
    }
    return path;
  };

  const areaPath = (line: FlowLine, lineIndex: number): string => {
    if (points.length === 0) return '';
    const baseline = laneBaseline(lineIndex);
    return `${stepPath(line, lineIndex)} L ${xAt(points.length - 1)} ${baseline} L ${xAt(0)} ${baseline} Z`;
  };

  const last = points[points.length - 1];
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const labelIndexes = new Set<number>();
  for (let index = 0; index < points.length; index += labelStep) labelIndexes.add(index);
  if (points.length > 0) labelIndexes.add(points.length - 1);

  const bulkAdds = LINES.map((line) => {
    if (!last) return null;
    const total = line.valueOf(last);
    let largest = 0;
    let largestIndex = 0;
    for (let index = 0; index < points.length; index++) {
      const previous = index === 0 ? 0 : line.valueOf(points[index - 1]);
      const addition = line.valueOf(points[index]) - previous;
      if (addition > largest) {
        largest = addition;
        largestIndex = index;
      }
    }
    const threshold = Math.max(10, Math.ceil(total * 0.35));
    return largest >= threshold ? { index: largestIndex, value: largest } : null;
  });

  const hoverPercent =
    hoveredIndex === null ? 0 : Math.round((xAt(hoveredIndex) / WIDTH) * 10_000) / 100;
  const tooltipTransform =
    hoverPercent < 24
      ? 'translateX(0)'
      : hoverPercent > 80
        ? 'translateX(-100%)'
        : 'translateX(-50%)';

  return (
    <StatCard className="afterplay-backlog-flow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[14px] font-bold text-foreground">Backlog flow</div>
            <span
              className={cn(
                'afterplay-backlog-scale-note py-[3px] px-1.5 rounded-[99px] text-[11px] font-extrabold tracking-[0.09em]',
                'leading-none border border-[rgba(133,163,214,0.16)] bg-[rgba(133,163,214,0.06)]',
                'text-[color:rgba(178,199,234,0.78)]',
              )}
            >
              OWN SCALE · EACH LANE
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            Recorded growth without one total flattening the others
          </div>
        </div>
        {last && (
          <div className="afterplay-backlog-flow-legend flex items-stretch gap-[7px]">
            {LINES.map((line) => {
              const isDimmed = activeSeries !== null && activeSeries !== line.key;
              return (
                <div
                  key={line.key}
                  className={cn(
                    'afterplay-backlog-flow-stat flex min-w-18.5 items-center gap-[7px] py-1.5 px-2 rounded-[8px] border',
                    'border-white/6 bg-white/[0.018]',
                    '[transition:opacity_180ms_ease,border-color_180ms_ease,background-color_180ms_ease,transform_220ms_cubic-bezier(0.22,1,0.36,1)]',
                    'hover:border-white/12 hover:bg-white/[0.035] hover:[transform:translateY(-1px)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                  style={{ opacity: isDimmed ? 0.38 : 1 }}
                  onMouseEnter={() => setActiveSeries(line.key)}
                  onMouseLeave={() => setActiveSeries(null)}
                >
                  <span
                    className="w-1.5 h-5.5 flex-none rounded-[99px] opacity-80"
                    style={{ background: line.color }}
                  />
                  <div>
                    <small className="block leading-[1] text-muted-foreground text-[11px] whitespace-nowrap">
                      {line.label}
                    </small>
                    <strong
                      className="block leading-[1] mt-1 text-[13px] font-black"
                      style={{ color: line.color }}
                    >
                      {line.valueOf(last)}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {points.length === 0 ? (
        <StatCardEmpty>Nothing to chart yet.</StatCardEmpty>
      ) : (
        <div
          className={cn(
            'afterplay-backlog-chart-shell relative mt-4 overflow-hidden pt-[7px] px-2 pb-0.5 rounded-[12px] border',
            'border-white/[0.055]',
            '[background:radial-gradient(circle_at_82%_0%,rgba(47,220,126,0.045),transparent_31%),rgba(0,0,0,0.08)]',
          )}
          onMouseLeave={() => {
            setHoveredIndex(null);
            setActiveSeries(null);
          }}
        >
          <svg
            ref={measureChart}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block w-full"
            role="img"
            aria-label="Library, planned and completed timelines, each using an independent scale"
          >
            <defs>
              {LINES.map((line) => (
                <linearGradient
                  key={line.key}
                  id={`afterplay-flow-${line.key}`}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={line.color} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={line.color} stopOpacity={0.015} />
                </linearGradient>
              ))}
              <filter id="afterplay-flow-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.6" />
              </filter>
            </defs>

            {LINES.map((line, lineIndex) => {
              const top = laneTop(lineIndex);
              const baseline = laneBaseline(lineIndex);
              const total = line.valueOf(last);
              const isDimmed = activeSeries !== null && activeSeries !== line.key;
              const path = stepPath(line, lineIndex);
              const bulkAdd = bulkAdds[lineIndex];
              const batchX = bulkAdd ? xAt(bulkAdd.index) : 0;
              const batchOnRight = batchX > WIDTH - 118;

              return (
                <g key={line.key} data-flow-lane={line.key}>
                  <rect
                    x={PAD_LEFT}
                    y={top}
                    width={innerWidth}
                    height={LANE_HEIGHT}
                    rx={9}
                    fill="rgba(255,255,255,.013)"
                    stroke="rgba(255,255,255,.045)"
                  />
                  <line
                    x1={PAD_LEFT}
                    x2={WIDTH - PAD_RIGHT}
                    y1={yAt(lineIndex, total / 2, total)}
                    y2={yAt(lineIndex, total / 2, total)}
                    stroke="rgba(255,255,255,.045)"
                    strokeDasharray="2 5"
                  />

                  <text
                    x={5}
                    y={top + 20}
                    fill={line.color}
                    fontSize={11}
                    fontWeight={800}
                    fontFamily="-apple-system,sans-serif"
                  >
                    {line.label}
                  </text>
                  <text
                    x={5}
                    y={top + 37}
                    fill="var(--muted-foreground)"
                    opacity={0.7}
                    fontSize={11}
                    fontFamily="-apple-system,sans-serif"
                  >
                    {line.context.split('\n').map((part, index) => (
                      <tspan key={part} x={5} dy={index === 0 ? 0 : 13}>
                        {part}
                      </tspan>
                    ))}
                  </text>

                  <path
                    d={areaPath(line, lineIndex)}
                    fill={`url(#afterplay-flow-${line.key})`}
                    className="afterplay-backlog-area [transition:opacity_220ms_ease] animate-[afterplay-fade-in_700ms_ease-out_backwards] motion-reduce:animate-none motion-reduce:transition-none"
                    style={{ opacity: isDimmed ? 0.04 : 1 }}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={6}
                    opacity={isDimmed ? 0 : 0.13}
                    filter="url(#afterplay-flow-glow)"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={2.25}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    pathLength={1}
                    className={cn(
                      'afterplay-backlog-line [stroke-dasharray:1] [stroke-dashoffset:0]',
                      '[transition:opacity_200ms_ease,stroke-width_200ms_ease]',
                      'animate-[afterplay-flow-line-in_900ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    data-flow-series={line.key}
                    style={{
                      opacity: isDimmed ? 0.2 : 1,
                      animationDelay: `${lineIndex * 90}ms`,
                    }}
                  />

                  {bulkAdd && (
                    <g className="afterplay-backlog-batch-marker pointer-events-none animate-[afterplay-flow-batch-in_480ms_520ms_ease-out_backwards] motion-reduce:animate-none motion-reduce:transition-none">
                      <line
                        x1={batchX}
                        x2={batchX}
                        y1={top + 6}
                        y2={baseline}
                        stroke={line.color}
                        strokeWidth={1}
                        strokeDasharray="2 3"
                        opacity={0.5}
                      />
                      <text
                        x={batchX + (batchOnRight ? -7 : 7)}
                        y={baseline - 7}
                        fill={line.color}
                        fontSize={11}
                        fontWeight={800}
                        textAnchor={batchOnRight ? 'end' : 'start'}
                        fontFamily="-apple-system,sans-serif"
                      >
                        +{bulkAdd.value} bulk add
                      </text>
                    </g>
                  )}

                  <circle
                    cx={xAt(points.length - 1)}
                    cy={yAt(lineIndex, total, total)}
                    r={6.5}
                    fill={line.color}
                    opacity={0.12}
                  />
                  <circle
                    cx={xAt(points.length - 1)}
                    cy={yAt(lineIndex, total, total)}
                    r={3}
                    fill={line.color}
                    stroke="#0d100e"
                    strokeWidth={1.5}
                  />
                </g>
              );
            })}

            {[...labelIndexes].map((index) => (
              <text
                key={`label-${points[index].key}`}
                x={xAt(index)}
                y={HEIGHT - 7}
                fill="var(--muted-foreground)"
                fontSize={11}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                fontFamily="-apple-system,sans-serif"
              >
                {monthLabel(points[index].key)}
              </text>
            ))}

            {hoveredIndex !== null && (
              <g>
                <line
                  x1={xAt(hoveredIndex)}
                  x2={xAt(hoveredIndex)}
                  y1={PAD_TOP}
                  y2={laneBaseline(LINES.length - 1)}
                  stroke="rgba(255,255,255,.24)"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
                {LINES.map((line, lineIndex) => {
                  const total = line.valueOf(last);
                  return (
                    <circle
                      key={`hover-${line.key}`}
                      cx={xAt(hoveredIndex)}
                      cy={yAt(lineIndex, line.valueOf(points[hoveredIndex]), total)}
                      r={3.5}
                      fill="#0d100e"
                      stroke={line.color}
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}

            {points.map((point, index) => {
              const left = index === 0 ? PAD_LEFT : (xAt(index - 1) + xAt(index)) / 2;
              const right =
                index === points.length - 1 ? WIDTH - PAD_RIGHT : (xAt(index) + xAt(index + 1)) / 2;
              return (
                <rect
                  key={`hit-${point.key}`}
                  x={left}
                  y={PAD_TOP}
                  width={Math.max(1, right - left)}
                  height={laneBaseline(LINES.length - 1) - PAD_TOP}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIndex(index)}
                />
              );
            })}
          </svg>

          {hoveredIndex !== null && points[hoveredIndex] && (
            <div
              className={cn(
                'afterplay-backlog-tooltip pointer-events-none absolute top-2 z-10 w-48 rounded-[10px] border',
                '[box-shadow:0_14px_34px_rgba(0,0,0,0.42)] animate-[afterplay-fade-in_130ms_ease-out]',
                'motion-reduce:animate-none motion-reduce:transition-none',
                floatingPanelClass,
                'px-3 py-2.5 text-[11px]',
              )}
              style={{ left: `${hoverPercent}%`, transform: tooltipTransform }}
            >
              <div className="mb-1.5 font-bold text-foreground">
                {monthLabel(points[hoveredIndex].key)}
              </div>
              {LINES.map((line) => {
                const value = line.valueOf(points[hoveredIndex]);
                const total = line.valueOf(last);
                const progress = total > 0 ? Math.round((value / total) * 100) : 0;
                return (
                  <div key={line.key} className="flex items-center justify-between gap-4 py-0.25">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <i className="h-1.5 w-1.5 rounded-full" style={{ background: line.color }} />
                      {line.shortLabel}
                    </span>
                    <strong className="tabular-nums" style={{ color: line.color }}>
                      {value} <small className="font-medium opacity-65">· {progress}%</small>
                    </strong>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </StatCard>
  );
};
