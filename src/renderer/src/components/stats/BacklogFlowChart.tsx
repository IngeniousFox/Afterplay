import { useMemo, useState } from 'react';
import type { StateEventSummary } from '../../../../shared/types';
import { floatingPanelClass } from '../../lib/styles';
import { StatCard } from './StatCard';
import type { Year } from './YearPicker';

type FlowGame = { addedAt: Date };

type BacklogFlowChartProps = {
  games: FlowGame[];
  // Los juegos que AHORA MISMO viven en Plan to Play — su propia línea,
  // separada de la biblioteca real.
  plannedGames: FlowGame[];
  stateEvents: StateEventSummary[];
  year: Year;
};

// Verde de acento para la biblioteca real, azul del Plan para los planeados
// y ámbar de Beaten para completados — mismos significados de color que el
// resto de la app.
const LIBRARY_COLOR = '#2fdc7e';
const PLAN_COLOR = '#85a3d6';
const COMPLETED_COLOR = '#e3b24a';

const WIDTH = 600;
const HEIGHT = 190;
const PAD_LEFT = 10;
const PAD_RIGHT = 46;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

const monthKey = (date: Date): number => date.getFullYear() * 12 + date.getMonth();

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

// ¿Tu backlog crece o encoge? — tres líneas acumuladas mes a mes: juegos
// añadidos a la BIBLIOTECA (addedAt de los no planeados), juegos que siguen
// en Plan to Play, y playthroughs completados. En "All Time" el rango va del
// primer mes con actividad hasta hoy (los completados manuales del pasado
// pueden estirarlo años atrás — correcto, son parte de tu historia); con un
// año concreto, sus 12 meses con los contadores arrancando de cero (lo
// añadido/planeado/completado ESE año).
export const BacklogFlowChart = ({
  games,
  plannedGames,
  stateEvents,
  year,
}: BacklogFlowChartProps): React.JSX.Element => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { points, maxValue } = useMemo(() => {
    const libraryKeys = games.map((game) => monthKey(game.addedAt));
    const plannedKeys = plannedGames.map((game) => monthKey(game.addedAt));
    const completedKeys = stateEvents
      .filter((event) => event.type === 'completed')
      .map((event) => monthKey(event.occurredAt));

    let firstKey: number;
    let lastKey: number;
    if (year === 'all') {
      const allKeys = [...libraryKeys, ...plannedKeys, ...completedKeys];
      if (allKeys.length === 0) return { points: [], maxValue: 1 };
      firstKey = Math.min(...allKeys);
      lastKey = monthKey(new Date());
    } else {
      firstKey = year * 12;
      lastKey = year * 12 + 11;
    }

    const libraryByKey = countByMonth(libraryKeys);
    const plannedByKey = countByMonth(plannedKeys);
    const completedByKey = countByMonth(completedKeys);

    // Con año concreto, los acumulados arrancan de cero: se cuenta lo que
    // pasó ESE año, no el tamaño histórico de la biblioteca.
    let library = 0;
    let planned = 0;
    let completed = 0;
    const points: { key: number; library: number; planned: number; completed: number }[] = [];
    for (let key = firstKey; key <= lastKey; key++) {
      library += libraryByKey.get(key) ?? 0;
      planned += plannedByKey.get(key) ?? 0;
      completed += completedByKey.get(key) ?? 0;
      points.push({ key, library, planned, completed });
    }

    const maxValue = Math.max(
      1,
      ...points.map((point) => Math.max(point.library, point.planned, point.completed)),
    );
    return { points, maxValue };
  }, [games, plannedGames, stateEvents, year]);

  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xAt = (index: number): number =>
    PAD_LEFT + (points.length > 1 ? (index / (points.length - 1)) * innerWidth : innerWidth / 2);
  const yAt = (value: number): number => PAD_TOP + innerHeight - (value / maxValue) * innerHeight;

  const lines: { label: string; color: string; valueOf: (p: (typeof points)[number]) => number }[] =
    [
      { label: 'Library', color: LIBRARY_COLOR, valueOf: (p) => p.library },
      { label: 'Plan to play', color: PLAN_COLOR, valueOf: (p) => p.planned },
      { label: 'Completed', color: COMPLETED_COLOR, valueOf: (p) => p.completed },
    ];

  const last = points[points.length - 1];

  // Como mucho ~6 rótulos de mes repartidos — con años de historia no caben
  // los 12+ de cada mes.
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <StatCard>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Backlog flow</div>
        <div className="flex items-center gap-3.5 text-[11.5px] text-muted-foreground">
          {lines.map((line) => (
            <span key={line.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: line.color }} />
              {line.label}
            </span>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing to chart yet.</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
            {/* Rejilla horizontal tenue en cuartos, como los anillos del radar. */}
            {[0.25, 0.5, 0.75, 1].map((fraction) => (
              <line
                key={fraction}
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={yAt(maxValue * fraction)}
                y2={yAt(maxValue * fraction)}
                stroke="rgba(255,255,255,.06)"
                strokeWidth={1}
              />
            ))}

            {lines.map((line) => (
              <polyline
                key={line.label}
                points={points.map((point, i) => `${xAt(i)},${yAt(line.valueOf(point))}`).join(' ')}
                fill="none"
                stroke={line.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}

            {last &&
              lines.map((line) => (
                <g key={`end-${line.label}`}>
                  <circle
                    cx={xAt(points.length - 1)}
                    cy={yAt(line.valueOf(last))}
                    r={3}
                    fill={line.color}
                  />
                  <text
                    x={xAt(points.length - 1) + 7}
                    y={yAt(line.valueOf(last)) + 3.5}
                    fill={line.color}
                    fontSize={11}
                    fontWeight={700}
                    fontFamily="-apple-system,sans-serif"
                  >
                    {line.valueOf(last)}
                  </text>
                </g>
              ))}

            {points.map((point, i) =>
              i % labelStep === 0 ? (
                <text
                  key={`label-${point.key}`}
                  x={xAt(i)}
                  y={HEIGHT - 7}
                  fill="var(--muted-foreground)"
                  fontSize={9.5}
                  textAnchor="middle"
                  fontFamily="-apple-system,sans-serif"
                >
                  {monthLabel(point.key)}
                </text>
              ) : null,
            )}

            {hoveredIndex !== null && (
              <line
                x1={xAt(hoveredIndex)}
                x2={xAt(hoveredIndex)}
                y1={PAD_TOP}
                y2={HEIGHT - PAD_BOTTOM}
                stroke="rgba(255,255,255,.22)"
                strokeWidth={1}
              />
            )}

            {/* Franjas de hover invisibles, una por mes, encima de todo. */}
            {points.map((point, i) => {
              const step = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
              return (
                <rect
                  key={`hit-${point.key}`}
                  x={xAt(i) - step / 2}
                  y={0}
                  width={step}
                  height={HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              );
            })}
          </svg>

          {hoveredIndex !== null && points[hoveredIndex] && (
            <div
              className={`pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 -translate-y-1 rounded-[9px] border ${floatingPanelClass} px-2.75 py-1.75 text-[11.5px]`}
              style={{ left: `${(xAt(hoveredIndex) / WIDTH) * 100}%` }}
            >
              <div className="font-bold text-foreground">
                {monthLabel(points[hoveredIndex].key)}
              </div>
              <div style={{ color: LIBRARY_COLOR }}>{points[hoveredIndex].library} in library</div>
              <div style={{ color: PLAN_COLOR }}>{points[hoveredIndex].planned} planned</div>
              <div style={{ color: COMPLETED_COLOR }}>
                {points[hoveredIndex].completed} completed
              </div>
            </div>
          )}
        </div>
      )}
    </StatCard>
  );
};
