import { GENRE_AXES } from '../../lib/genreAxes';
import { StatCard } from './StatCard';

type GenreRadarProps = {
  // Minutos jugados por eje — ya sumados fuera (Stats.tsx/GameStats.tsx),
  // respetando el filtro de año activo.
  minutesByAxis: Record<string, number>;
};

// Misma geometría exacta que el prototipo (Backlog.html, radarEl) — centro,
// radio y viewBox calcados para que el polígono de fondo y los ejes caigan
// donde el diseño los puso.
const CENTER_X = 110;
const CENTER_Y = 104;
const OUTER_RADIUS = 78;
const RING_FRACTIONS = [0.25, 0.5, 0.75, 1];

const pointAt = (index: number, radius: number, axisCount: number): [number, number] => {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axisCount;
  return [CENTER_X + Math.cos(angle) * radius, CENTER_Y + Math.sin(angle) * radius];
};

export const GenreRadar = ({ minutesByAxis }: GenreRadarProps): React.JSX.Element => {
  const axes = GENRE_AXES;
  const max = Math.max(1, ...axes.map((axis) => minutesByAxis[axis] ?? 0));
  const dataPoints = axes.map((axis, i) =>
    pointAt(i, OUTER_RADIUS * ((minutesByAxis[axis] ?? 0) / max), axes.length),
  );

  return (
    // flex column + h-full: esta card vive en una grid junto a TopPlayedList
    // (Stats.tsx), que suele salir más alta (hasta 5 filas) — la grid
    // estira el div exterior a esa altura, pero sin esto el título y el SVG
    // se quedaban apilados con su alto natural y todo el sobrante quedaba
    // como hueco suelto DEBAJO, empujando el hexágono hacia arriba en vez de
    // quedar centrado en el alto real de la card.
    <StatCard title="Genre Spread" titleClassName="mb-2" className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center">
        <svg width={220} height={208} viewBox="0 0 220 208">
          {RING_FRACTIONS.map((fraction) => (
            <polygon
              key={fraction}
              points={axes
                .map((_, i) => pointAt(i, OUTER_RADIUS * fraction, axes.length).join(','))
                .join(' ')}
              fill="none"
              stroke="rgba(255,255,255,.08)"
              strokeWidth={1}
            />
          ))}
          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, OUTER_RADIUS, axes.length);
            return (
              <line
                key={axis}
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={x}
                y2={y}
                stroke="rgba(255,255,255,.07)"
                strokeWidth={1}
              />
            );
          })}
          <polygon
            points={dataPoints.map((point) => point.join(',')).join(' ')}
            fill="rgba(47,220,126,.18)"
            stroke="#2fdc7e"
            strokeWidth={2}
          />
          {dataPoints.map((point, i) => (
            <circle key={axes[i]} cx={point[0]} cy={point[1]} r={2.6} fill="#2fdc7e" />
          ))}
          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, OUTER_RADIUS + 15, axes.length);
            return (
              <text
                key={axis}
                x={x}
                y={y}
                fill="var(--muted-foreground)"
                fontSize={10}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="-apple-system,sans-serif"
              >
                {axis}
              </text>
            );
          })}
        </svg>
      </div>
    </StatCard>
  );
};
