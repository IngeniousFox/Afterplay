import { useMemo, useState } from 'react';
import { formatHours, pluralize } from '../../lib/format';
import type { Year } from './YearPicker';

export type AgeEntry = { hours: number; releaseYear: number | null };

type GameAgeDonutProps = {
  entries: AgeEntry[];
  year: Year;
};

const SIZE = 190;
const STROKE = 30;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// La porción activa engorda su trazo en +4 al pasar el ratón — sin este
// margen extra, ese trazo más grueso se sale justo del viewBox (que mide lo
// mismo que el círculo en reposo) y se ve cortado. El SVG crece este margen
// por cada lado; el círculo en sí (RADIUS) no cambia, solo su lienzo.
const HOVER_STROKE_EXTRA = 4;
const SVG_SIZE = SIZE + HOVER_STROKE_EXTRA * 2;

type Bucket = {
  key: string;
  label: string;
  // Para el texto destacado del lado derecho ("...went to games <desc>").
  description: (referenceYear: number) => string;
  color: string;
  matches: (age: number) => boolean;
};

const BUCKETS: Bucket[] = [
  {
    key: 'new',
    label: 'New releases',
    description: (referenceYear) => `released in ${referenceYear}`,
    color: '#2fdc7e',
    matches: (age) => age <= 0,
  },
  {
    key: 'recent',
    label: '1–5 years',
    description: () => '1 to 5 years old',
    color: '#85a3d6',
    matches: (age) => age >= 1 && age <= 5,
  },
  {
    key: 'modern',
    label: '5–10 years',
    description: () => '5 to 10 years old',
    color: '#e3b24a',
    matches: (age) => age > 5 && age <= 10,
  },
  {
    key: 'classic',
    label: '10+ years',
    description: () => 'over 10 years old',
    color: '#7c86c8',
    matches: (age) => age > 10,
  },
];

// Estilo resumen anual de Steam: de los juegos tocados en la ventana activa,
// qué parte de tus HORAS fue a juegos nuevos (del propio año) frente a
// juegos de 1-5 / 5-10 / 10+ años. La edad se mide contra el año filtrado
// ("¿era nuevo CUANDO lo jugaste ese año?"); en All Time, contra el año
// actual. La leyenda enseña además cuántos juegos caen en cada franja.
export const GameAgeDonut = ({ entries, year }: GameAgeDonutProps): React.JSX.Element => {
  const referenceYear = year === 'all' ? new Date().getFullYear() : year;
  // Franja bajo el ratón (porción del donut o fila del desglose) — null =
  // ninguna, el destacado vuelve a la mayor.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const { slices, biggest, totalHours, unknownCount } = useMemo(() => {
    const played = entries.filter((entry) => entry.hours > 0);
    const dated = played.filter((entry) => entry.releaseYear !== null);

    const totals = BUCKETS.map((bucket) => {
      const bucketEntries = dated.filter((entry) =>
        bucket.matches(referenceYear - (entry.releaseYear as number)),
      );
      return {
        ...bucket,
        hours: bucketEntries.reduce((sum, entry) => sum + entry.hours, 0),
        gameCount: bucketEntries.length,
      };
    });

    const totalHours = totals.reduce((sum, bucket) => sum + bucket.hours, 0);

    // Cada porción arranca donde acaban las anteriores (suma de fracciones
    // previas) — sin acumulador mutable, que el compilador de React prohíbe
    // dentro de un render.
    const fractions = totals.map((bucket) => (totalHours > 0 ? bucket.hours / totalHours : 0));
    const slices = totals.map((bucket, index) => ({
      ...bucket,
      fraction: fractions[index],
      offset: fractions.slice(0, index).reduce((sum, fraction) => sum + fraction, 0),
    }));

    const biggest = slices.reduce(
      (best, slice) => (slice.hours > best.hours ? slice : best),
      slices[0],
    );

    return {
      slices,
      biggest,
      totalHours,
      unknownCount: played.length - dated.length,
    };
  }, [entries, referenceYear]);

  return (
    <div className="rounded-[14px] border border-border bg-card px-5.5 py-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Playtime by game age</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {slices.map((slice) => (
            <div key={slice.key} className="flex items-center gap-1.75 text-[11.5px]">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: slice.color }} />
              <span className="font-semibold text-foreground">{slice.label}</span>
              <span className="text-muted-foreground">· {pluralize(slice.gameCount, 'game')}</span>
            </div>
          ))}
        </div>
      </div>

      {totalHours <= 0 ? (
        <p className="text-xs text-muted-foreground">Nothing tracked yet.</p>
      ) : (
        (() => {
          const active = slices.find((slice) => slice.key === hoveredKey) ?? biggest;
          return (
            <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-5">
              <svg width={SVG_SIZE} height={SVG_SIZE} viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
                <g transform={`rotate(-90 ${SVG_SIZE / 2} ${SVG_SIZE / 2})`}>
                  {slices
                    .filter((slice) => slice.fraction > 0)
                    .map((slice) => (
                      <circle
                        key={slice.key}
                        cx={SVG_SIZE / 2}
                        cy={SVG_SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke={slice.color}
                        strokeWidth={
                          slice.key === active.key ? STROKE + HOVER_STROKE_EXTRA : STROKE
                        }
                        strokeDasharray={`${slice.fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                        strokeDashoffset={-slice.offset * CIRCUMFERENCE}
                        opacity={slice.key === active.key ? 1 : 0.45}
                        className="cursor-pointer transition-opacity"
                        onMouseEnter={() => setHoveredKey(slice.key)}
                        onMouseLeave={() => setHoveredKey(null)}
                      />
                    ))}
                </g>
              </svg>

              <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
                <div className="max-w-70 min-w-55">
                  <div
                    className="text-[40px] font-extrabold tracking-[-.01em] tabular-nums"
                    style={{ color: active.color }}
                  >
                    {Math.round(active.fraction * 100)} %
                  </div>
                  <div className="mt-0.5 text-[15px] font-bold text-foreground">{active.label}</div>
                  <div className="mt-1.25 text-[12.5px] leading-relaxed text-muted-foreground">
                    The share of your {year === 'all' ? 'all-time' : year} hours that went to games{' '}
                    {active.description(referenceYear)}.
                  </div>
                  {unknownCount > 0 && (
                    <div className="mt-2.5 text-[11px] text-muted-foreground/70">
                      {pluralize(unknownCount, 'game')} without a release year not counted.
                    </div>
                  )}
                </div>

                {/* Desglose completo — el % de TODAS las franjas a la vista,
                    no solo la destacada; pasar el ratón por una fila (o por
                    su porción del donut) la lleva al destacado grande. */}
                <div className="min-w-55">
                  {slices.map((slice) => {
                    const isActive = slice.key === active.key;
                    return (
                      <div
                        key={slice.key}
                        onMouseEnter={() => setHoveredKey(slice.key)}
                        onMouseLeave={() => setHoveredKey(null)}
                        className="flex cursor-default items-center gap-2.5 rounded-[8px] px-2.5 py-1.75"
                        style={isActive ? { background: 'rgba(255,255,255,.05)' } : undefined}
                      >
                        <span
                          className="h-2.5 w-2.5 flex-none rounded-[3px]"
                          style={{ background: slice.color }}
                        />
                        <span
                          className={`w-27 flex-none text-[12.5px] ${isActive ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground'}`}
                        >
                          {slice.label}
                        </span>
                        <span
                          className="w-13 flex-none text-right text-[13px] font-bold tabular-nums"
                          style={{ color: slice.color }}
                        >
                          {Math.round(slice.fraction * 100)} %
                        </span>
                        <span className="flex-none pl-2 text-[11.5px] text-muted-foreground tabular-nums">
                          {formatHours(slice.hours)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
};
