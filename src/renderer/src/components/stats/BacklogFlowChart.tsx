import { cn } from '../../lib/utils';
import { useCallback, useMemo, useState } from 'react';
import type { StateEventSummary } from '../../../../shared/types';
import { monthKey } from '../../lib/dateMath';
import { floatingPanelClass } from '../../lib/styles';
import { chartGroup, chartPaused, drawLine, useInView } from '../fx/chart';
import { markBloomClass, tooltipPopClass } from './chartMotion';
import { ChartHeading, StatCard } from './StatCard';
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

// Tres series (stats-pace.png): altas en Phosphor, Plan en Tube y
// completados en el verde del estado Beaten.
const LIBRARY_COLOR = 'var(--color-phosphor)';
const PLAN_COLOR = 'var(--color-tube)';
const COMPLETED_COLOR = 'var(--color-st-beaten)';

const INITIAL_WIDTH = 720;
const HEIGHT = 258;
const PAD_LEFT = 128;
const PAD_RIGHT = 18;
const PAD_TOP = 12;
const LANE_HEIGHT = 60;
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
  // Las tres líneas se dibujan (y su relleno se funde) la primera vez que la
  // gráfica entra en vista; no se repite al cambiar de año.
  const { observe, inView } = useInView();
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
  const tooltipTranslate = hoverPercent < 24 ? '0' : hoverPercent > 80 ? '-100%' : '-50%';

  return (
    <StatCard className="afterplay-backlog-flow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <ChartHeading
            title="Backlog flow"
            subtitle={
              <span className="afterplay-backlog-scale-note rounded-sm border border-line-strong px-1.5 py-0.5 text-micro text-dust">
                Own scale · each lane
              </span>
            }
          />
          <div className="mt-1 text-small text-dust">
            Games entering and leaving, recorded growth without one total flattening the others
          </div>
        </div>
        {last && (
          <div className="afterplay-backlog-flow-legend flex items-stretch gap-5">
            {LINES.map((line) => {
              const isDimmed = activeSeries !== null && activeSeries !== line.key;
              return (
                <div
                  key={line.key}
                  className={cn(
                    'afterplay-backlog-flow-stat flex items-center gap-2 rounded-sm px-1.5 py-1',
                    'transition-[opacity,background-color] duration-150 hover:bg-raised motion-reduce:transition-none',
                  )}
                  style={{ opacity: isDimmed ? 0.38 : 1 }}
                  onMouseEnter={() => setActiveSeries(line.key)}
                  onMouseLeave={() => setActiveSeries(null)}
                >
                  <span
                    className="h-0.5 w-4 flex-none rounded-full"
                    style={{ background: line.color }}
                  />
                  <div>
                    <small className="block text-micro whitespace-nowrap text-dust">
                      {line.label}
                    </small>
                    <strong className="block font-display text-[22px] leading-none font-bold text-bone tabular-nums">
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
          ref={observe}
          data-inview={inView || undefined}
          className={cn(
            'afterplay-backlog-chart-shell relative mt-4 overflow-hidden px-1 pt-2 pb-0.5',
            chartGroup,
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
                  <stop offset="0%" stopColor={line.color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={line.color} stopOpacity={0.01} />
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
                    rx={2}
                    fill="var(--color-inset)"
                    fillOpacity={0.5}
                    stroke="var(--color-line)"
                  />
                  <line
                    x1={PAD_LEFT}
                    x2={WIDTH - PAD_RIGHT}
                    y1={yAt(lineIndex, total / 2, total)}
                    y2={yAt(lineIndex, total / 2, total)}
                    stroke="var(--color-line)"
                    strokeDasharray="2 5"
                  />

                  <text x={5} y={top + 20} fill="var(--color-bone)" fontSize={13} fontWeight={600}>
                    {line.label}
                  </text>
                  <text x={5} y={top + 37} fill="var(--color-dust)" fontSize={12.5}>
                    {line.context.split('\n').map((part, index) => (
                      <tspan key={part} x={5} dy={index === 0 ? 0 : 15}>
                        {part}
                      </tspan>
                    ))}
                  </text>

                  <path
                    d={areaPath(line, lineIndex)}
                    fill={`url(#afterplay-flow-${line.key})`}
                    className={cn(
                      'afterplay-backlog-area [transition:opacity_220ms_ease] motion-reduce:transition-none',
                      'animate-[fade-in_700ms_var(--ease-out)_backwards]',
                      chartPaused,
                    )}
                    style={{
                      opacity: isDimmed ? 0.04 : 1,
                      animationDelay: `${lineIndex * 90 + 380}ms`,
                    }}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={6}
                    opacity={isDimmed ? 0 : 0.13}
                    filter="url(#afterplay-flow-glow)"
                    pathLength={1}
                    className={drawLine}
                    style={{ animationDelay: `${lineIndex * 90}ms` }}
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
                      'afterplay-backlog-line',
                      '[transition:opacity_200ms_ease,stroke-width_200ms_ease]',
                      'motion-reduce:transition-none',
                      drawLine,
                    )}
                    data-flow-series={line.key}
                    style={{
                      opacity: isDimmed ? 0.2 : 1,
                      animationDelay: `${lineIndex * 90}ms`,
                    }}
                  />

                  {bulkAdd && (
                    <g
                      className={cn(
                        'afterplay-backlog-batch-marker pointer-events-none',
                        'animate-[afterplay-flow-batch-in_480ms_ease-out_backwards]',
                        chartPaused,
                      )}
                      style={{ animationDelay: `${lineIndex * 90 + 620}ms` }}
                    >
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
                        fontSize={12.5}
                        fontWeight={600}
                        textAnchor={batchOnRight ? 'end' : 'start'}
                      >
                        +{bulkAdd.value} bulk add
                      </text>
                    </g>
                  )}

                  <g
                    className={cn('animate-[fade-in_240ms_var(--ease-out)_backwards]', chartPaused)}
                    style={{ animationDelay: `${lineIndex * 90 + 760}ms` }}
                  >
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
                      r={3.5}
                      fill={line.color}
                      stroke="var(--color-panel)"
                      strokeWidth={1.5}
                    />
                  </g>
                </g>
              );
            })}

            {[...labelIndexes].map((index) => (
              <text
                key={`label-${points[index].key}`}
                x={xAt(index)}
                y={HEIGHT - 7}
                fill="var(--color-dust)"
                fontSize={12.5}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
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
                  stroke="var(--color-line-hover)"
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
                      r={4}
                      fill="var(--color-panel)"
                      stroke={line.color}
                      strokeWidth={2}
                      className={markBloomClass}
                      style={{ color: line.color }}
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
                'afterplay-backlog-tooltip pointer-events-none absolute top-2 z-10 w-48 rounded-md border',
                tooltipPopClass,
                'origin-top',
                floatingPanelClass,
                'px-3 py-2.5 text-micro',
              )}
              style={{ left: `${hoverPercent}%`, translate: tooltipTranslate }}
            >
              <div className="mb-1.5 font-semibold text-bone">
                {monthLabel(points[hoveredIndex].key)}
              </div>
              {LINES.map((line) => {
                const value = line.valueOf(points[hoveredIndex]);
                const total = line.valueOf(last);
                const progress = total > 0 ? Math.round((value / total) * 100) : 0;
                return (
                  <div key={line.key} className="flex items-center justify-between gap-4 py-0.25">
                    <span className="flex items-center gap-1.5 text-dust">
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
