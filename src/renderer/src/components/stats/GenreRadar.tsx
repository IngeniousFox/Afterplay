import { useState } from 'react';
import { formatHours } from '../../lib/format';
import { GENRE_AXES } from '../../lib/genreAxes';
import { floatingPanelClass } from '../../lib/styles';
import { StatCard } from './StatCard';

type GenreRadarProps = {
  // Minutos jugados por eje — ya sumados fuera (Stats.tsx/GameStats.tsx),
  // respetando el filtro de año activo.
  minutesByAxis: Record<string, number>;
};

// Geometría ampliada respecto al prototipo (Backlog.html usaba 220×208/r78)
// — el hexágono se quedaba pequeño en la card. El viewBox coincide 1:1 con
// los píxeles renderizados a propósito: el tooltip flotante se posiciona con
// estas mismas coordenadas, y cualquier escala rompería ese anclaje.
const CENTER_X = 125;
const CENTER_Y = 112;
const OUTER_RADIUS = 88;
const RING_FRACTIONS = [0.25, 0.5, 0.75, 1];
// Hasta dónde llega la cuña de hover de cada eje — más allá de la etiqueta,
// para que el radio entero (centro → punto → texto) sea zona de hover, no
// solo un punto suelto entre medias.
const HIT_RADIUS = 112;

const angleOf = (index: number, axisCount: number): number =>
  -Math.PI / 2 + (index * 2 * Math.PI) / axisCount;

const polar = (angle: number, radius: number): [number, number] => [
  CENTER_X + Math.cos(angle) * radius,
  CENTER_Y + Math.sin(angle) * radius,
];

const pointAt = (index: number, radius: number, axisCount: number): [number, number] =>
  polar(angleOf(index, axisCount), radius);

const ringPoints = (fraction: number, axisCount: number): string =>
  Array.from({ length: axisCount }, (_, i) =>
    pointAt(i, OUTER_RADIUS * fraction, axisCount).join(','),
  ).join(' ');

export const GenreRadar = ({ minutesByAxis }: GenreRadarProps): React.JSX.Element => {
  const axes = GENRE_AXES;
  const max = Math.max(1, ...axes.map((axis) => minutesByAxis[axis] ?? 0));
  const totalMinutes = axes.reduce((sum, axis) => sum + (minutesByAxis[axis] ?? 0), 0);
  const dataPoints = axes.map((axis, i) =>
    pointAt(i, OUTER_RADIUS * ((minutesByAxis[axis] ?? 0) / max), axes.length),
  );
  const polygonPoints = dataPoints.map((point) => point.join(',')).join(' ');
  // El eje dominante — su etiqueta se pinta en verde y la cabecera lo
  // resume ("mostly RPG") sin tener que pasar el ratón por nada.
  const dominantIndex =
    totalMinutes > 0
      ? axes.reduce(
          (best, axis, i) =>
            (minutesByAxis[axis] ?? 0) > (minutesByAxis[axes[best]] ?? 0) ? i : best,
          0,
        )
      : null;
  // Índice del eje bajo el ratón, no el nombre — dos ejes nunca comparten
  // texto, pero el índice evita cualquier duda al mirar dataPoints[i].
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    // flex column + h-full: esta card vive en una grid junto a Status
    // Breakdown (Stats.tsx), que suele salir más alta — la grid estira el
    // div exterior a esa altura, pero sin esto el título y el SVG se
    // quedaban apilados con su alto natural y todo el sobrante quedaba como
    // hueco suelto DEBAJO, empujando el hexágono hacia arriba en vez de
    // quedar centrado en el alto real de la card.
    <StatCard className="flex h-full flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Genre Spread</div>
        {dominantIndex !== null && (
          <div className="text-[11.5px] text-muted-foreground">
            mostly <span className="font-semibold text-primary">{axes[dominantIndex]}</span>
          </div>
        )}
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        <svg width={250} height={224} viewBox="0 0 250 224">
          <defs>
            {/* Relleno del polígono: verde que se apaga hacia el borde — en
                coordenadas absolutas (userSpaceOnUse) para que el degradado
                nazca SIEMPRE del centro del radar, no del bbox del polígono
                (que baila con los datos). */}
            <radialGradient
              id="genre-radar-fill"
              gradientUnits="userSpaceOnUse"
              cx={CENTER_X}
              cy={CENTER_Y}
              r={OUTER_RADIUS}
            >
              <stop offset="0%" stopColor="rgba(47,220,126,.42)" />
              <stop offset="100%" stopColor="rgba(47,220,126,.06)" />
            </radialGradient>
            <filter id="genre-radar-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>

          {/* Bandas alternas de profundidad (borde exterior y anillo medio),
              dibujadas como par-de-hexágonos con evenodd para rellenar SOLO
              la corona entre los dos radios. */}
          {[
            [1, 0.75],
            [0.5, 0.25],
          ].map(([outer, inner]) => (
            <path
              key={`band-${outer}`}
              d={`M ${ringPoints(outer, axes.length).replaceAll(' ', ' L ')} Z M ${ringPoints(inner, axes.length).replaceAll(' ', ' L ')} Z`}
              fill="rgba(255,255,255,.022)"
              fillRule="evenodd"
            />
          ))}

          {RING_FRACTIONS.map((fraction) => (
            <polygon
              key={fraction}
              points={ringPoints(fraction, axes.length)}
              fill="none"
              stroke="rgba(255,255,255,.08)"
              strokeWidth={1}
            />
          ))}
          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, OUTER_RADIUS, axes.length);
            const isHovered = hoveredIndex === i;
            return (
              <line
                key={axis}
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={x}
                y2={y}
                stroke={isHovered ? 'rgba(47,220,126,.45)' : 'rgba(255,255,255,.07)'}
                strokeWidth={isHovered ? 1.5 : 1}
              />
            );
          })}

          {/* key con los datos: al cambiar el filtro de año, el polígono se
              remonta y vuelve a entrar con el zoom+fade (mismo truco que la
              paginación de Completed). transformBox fill-box para que el
              scale de la animación gire sobre el propio polígono — sin eso,
              los transforms de SVG usan la esquina 0,0 del lienzo. */}
          <g
            key={polygonPoints}
            className="animate-in fade-in-0 zoom-in-75 duration-500"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            {/* El mismo contorno desenfocado detrás = halo de neón sutil. */}
            <polygon
              points={polygonPoints}
              fill="none"
              stroke="#2fdc7e"
              strokeWidth={5}
              opacity={0.3}
              filter="url(#genre-radar-glow)"
            />
            <polygon
              points={polygonPoints}
              fill="url(#genre-radar-fill)"
              stroke="#2fdc7e"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {dataPoints.map((point, i) => (
              <circle
                key={axes[i]}
                cx={point[0]}
                cy={point[1]}
                r={hoveredIndex === i ? 4.5 : 3}
                fill="#2fdc7e"
                stroke="rgba(15,17,16,.9)"
                strokeWidth={1.5}
                style={{ transition: 'r 100ms' }}
              />
            ))}
          </g>

          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, OUTER_RADIUS + 16, axes.length);
            const isHovered = hoveredIndex === i;
            const isDominant = dominantIndex === i;
            return (
              <text
                key={axis}
                x={x}
                y={y}
                fill={
                  isHovered
                    ? 'var(--foreground)'
                    : isDominant
                      ? '#2fdc7e'
                      : 'var(--muted-foreground)'
                }
                fontSize={10.5}
                fontWeight={isHovered || isDominant ? 700 : 400}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="-apple-system,sans-serif"
              >
                {axis}
              </text>
            );
          })}

          {/* Áreas de hover invisibles, por encima del resto — una cuña por
              eje, del centro hacia fuera (pasado el punto Y la etiqueta):
              todo el radio es zona de hover. Cada cuña llega hasta la mitad
              de camino angular al eje vecino, así que se reparten el círculo
              entero sin solaparse. */}
          {axes.map((axis, i) => {
            const halfAngle = Math.PI / axes.length;
            const angle = angleOf(i, axes.length);
            const [startX, startY] = polar(angle - halfAngle, HIT_RADIUS);
            const [endX, endY] = polar(angle + halfAngle, HIT_RADIUS);
            return (
              <path
                key={`hit-${axis}`}
                d={`M ${CENTER_X},${CENTER_Y} L ${startX},${startY} A ${HIT_RADIUS} ${HIT_RADIUS} 0 0 1 ${endX},${endY} Z`}
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {hoveredIndex !== null &&
          (() => {
            const axis = axes[hoveredIndex];
            const [x, y] = pointAt(hoveredIndex, OUTER_RADIUS + 16, axes.length);
            const minutes = minutesByAxis[axis] ?? 0;
            const share = totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0;
            return (
              <div
                className={`pointer-events-none absolute z-10 w-max max-w-40 -translate-x-1/2 -translate-y-full rounded-[9px] border ${floatingPanelClass} px-2.75 py-1.75 text-center text-[11.5px]`}
                style={{ left: x, top: y - 12 }}
              >
                <div className="font-bold text-foreground">{axis}</div>
                <div className="text-muted-foreground">
                  {minutes > 0 ? (
                    <>
                      {formatHours(minutes / 60)}
                      <span className="text-primary"> · {share}%</span>
                    </>
                  ) : (
                    'No hours yet'
                  )}
                </div>
              </div>
            );
          })()}
      </div>
    </StatCard>
  );
};
