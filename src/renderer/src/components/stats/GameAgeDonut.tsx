import { cn } from '../../lib/utils';
import { useMemo, useState } from 'react';
import { formatHours, pluralize } from '../../lib/format';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import type { Year } from './YearPicker';

export type AgeEntry = { hours: number; releaseYear: number | null };

type GameAgeDonutProps = {
  entries: AgeEntry[];
  year: Year;
};

const SIZE = 236;
const CENTER = SIZE / 2;
const RADIUS = 82;
const STROKE = 27;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SLICE_GAP = 3.5;

type Bucket = {
  key: string;
  label: string;
  shortLabel: string;
  description: (referenceYear: number) => string;
  color: string;
  matches: (age: number) => boolean;
};

const BUCKETS: Bucket[] = [
  {
    key: 'new',
    label: 'New releases',
    shortLabel: 'new',
    description: (referenceYear) => `released in ${referenceYear}`,
    color: 'var(--color-phosphor)',
    matches: (age) => age <= 0,
  },
  {
    key: 'recent',
    label: '1–5 years',
    shortLabel: 'recent',
    description: () => '1 to 5 years old',
    color: 'color-mix(in srgb, var(--color-phosphor) 74%, var(--color-panel))',
    matches: (age) => age >= 1 && age <= 5,
  },
  {
    key: 'modern',
    label: '5–10 years',
    shortLabel: 'modern',
    description: () => '5 to 10 years old',
    color: 'color-mix(in srgb, var(--color-phosphor) 52%, var(--color-panel))',
    matches: (age) => age > 5 && age <= 10,
  },
  {
    key: 'classic',
    label: '10+ years',
    shortLabel: 'classic',
    description: () => 'over 10 years old',
    color: 'color-mix(in srgb, var(--color-phosphor) 32%, var(--color-panel))',
    matches: (age) => age > 10,
  },
];

// La edad se mide contra el año filtrado (qué edad tenía el juego CUANDO lo
// jugaste) y contra el año actual en All Time. Las horas, no el número de
// títulos, deciden el tamaño de cada era.
export const GameAgeDonut = ({ entries, year }: GameAgeDonutProps): React.JSX.Element => {
  const referenceYear = year === 'all' ? new Date().getFullYear() : year;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const { slices, biggest, totalHours, unknownCount, datedCount } = useMemo(() => {
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
      datedCount: dated.length,
      unknownCount: played.length - dated.length,
    };
  }, [entries, referenceYear]);

  const active = slices.find((slice) => slice.key === hoveredKey) ?? biggest;
  const activePercent = Math.round(active.fraction * 100);
  const visibleSlices = slices.filter((slice) => slice.fraction > 0);

  return (
    <StatCard className="afterplay-age-card relative flex h-full flex-col overflow-hidden">
      <div
        className="afterplay-age-accent relative flex flex-1 flex-col"
        style={{ '--age-accent': active.color } as React.CSSProperties}
      >
        <div className="afterplay-age-header flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div>
            <div className="text-[16px] leading-tight font-semibold text-bone">
              Playtime by game age
            </div>
            <div className="text-small text-dust">Age when you played it</div>
          </div>
          {totalHours > 0 && (
            <div className="afterplay-age-total text-right">
              <span className="block text-micro text-dust">Dated playtime</span>
              <strong className="mr-1 font-display text-[20px] leading-none font-bold text-bone tabular-nums">
                {formatHours(totalHours)}
              </strong>
              <small className="text-micro text-dust">across {pluralize(datedCount, 'game')}</small>
            </div>
          )}
        </div>

        {totalHours <= 0 ? (
          <div className="mt-4">
            <StatCardEmpty>Nothing tracked yet.</StatCardEmpty>
          </div>
        ) : (
          <div className="afterplay-age-stage mt-3 flex flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-6">
              <div className="afterplay-age-orbit-wrap relative mx-auto size-59 flex-none">
                <svg
                  className={cn(
                    'afterplay-age-orbit relative z-1 block origin-center overflow-visible',
                    'animate-[afterplay-age-orbit-in_600ms_var(--ease-out)_backwards]',
                    'motion-reduce:animate-none',
                  )}
                  width={SIZE}
                  height={SIZE}
                  viewBox={`0 0 ${SIZE} ${SIZE}`}
                  role="img"
                  aria-label={`Game age distribution. ${active.label}: ${activePercent}%`}
                >
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                    fill="none"
                    stroke="var(--color-raised)"
                    strokeWidth={STROKE}
                  />
                  <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                    {visibleSlices.map((slice) => {
                      const isActive = slice.key === active.key;
                      // Flat ends stay inside each sector, including very small shares.
                      // A single era fills the entire ring without an artificial seam.
                      const sectorLength = slice.fraction * CIRCUMFERENCE;
                      const gap =
                        visibleSlices.length === 1 ? 0 : Math.min(SLICE_GAP, sectorLength / 4);
                      const visibleLength = sectorLength - gap;
                      const dashOffset = -(slice.offset * CIRCUMFERENCE + gap / 2);
                      return (
                        <circle
                          key={slice.key}
                          cx={CENTER}
                          cy={CENTER}
                          r={RADIUS}
                          fill="none"
                          stroke={slice.color}
                          strokeWidth={isActive ? STROKE + 4 : STROKE}
                          strokeDasharray={`${visibleLength} ${CIRCUMFERENCE}`}
                          strokeDashoffset={dashOffset}
                          strokeLinecap="butt"
                          className={cn(
                            'afterplay-age-slice cursor-pointer',
                            'transition-[stroke-width,filter] duration-200 hover:brightness-110',
                            'motion-reduce:transition-none',
                          )}
                          data-age-slice={slice.key}
                          onMouseEnter={() => setHoveredKey(slice.key)}
                          onMouseLeave={() => setHoveredKey(null)}
                        />
                      );
                    })}
                  </g>
                </svg>

                <div className="afterplay-age-core pointer-events-none absolute top-1/2 left-1/2 z-2 flex size-29.5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full">
                  <span className="text-micro text-dust">Share of time</span>
                  <strong className="font-display text-[40px] leading-none font-bold text-bone tabular-nums">
                    {activePercent}%
                  </strong>
                  <small className="mt-0.5 text-micro text-dust">{active.shortLabel}</small>
                </div>
              </div>

              <div className="afterplay-age-eras flex min-w-55 flex-1 flex-col">
                {slices.map((slice) => {
                  const isActive = slice.key === active.key;
                  return (
                    <button
                      key={slice.key}
                      type="button"
                      className={cn(
                        'afterplay-age-era grid grid-cols-[12px_minmax(0,1fr)_auto_44px] items-center gap-3 rounded-sm border-b border-line px-1.5 py-2 text-left last:border-b-0',
                        'transition-colors duration-150 outline-hidden hover:bg-raised',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
                        "data-[active='true']:bg-raised",
                      )}
                      data-active={isActive ? 'true' : 'false'}
                      aria-pressed={isActive}
                      onMouseEnter={() => setHoveredKey(slice.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      onFocus={() => setHoveredKey(slice.key)}
                      onBlur={() => setHoveredKey(null)}
                    >
                      <span
                        className="afterplay-age-era-stripe size-3 rounded-[2px]"
                        style={{ background: slice.color }}
                      />
                      <span className="afterplay-age-era-copy min-w-0">
                        <strong className="block text-body font-semibold text-bone">
                          {slice.label}
                        </strong>
                        <small className="block text-micro text-dust">
                          {pluralize(slice.gameCount, 'game')}
                        </small>
                      </span>
                      <span className="font-display text-[24px] leading-none font-bold text-bone tabular-nums">
                        {formatHours(slice.hours)}
                      </span>
                      <span className="afterplay-age-era-percent text-right text-micro text-dust tabular-nums">
                        {Math.round(slice.fraction * 100)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="afterplay-age-focus mt-auto border-t border-line pt-3">
              <div>
                <span className="block text-micro text-dust">Active era</span>
                <strong className="block text-body font-semibold text-bone">{active.label}</strong>
                <p className="text-small text-dust">
                  {activePercent}% of your {year === 'all' ? 'all-time' : year} hours went to games{' '}
                  {active.description(referenceYear)}.
                </p>
              </div>
            </div>

            {unknownCount > 0 && (
              <div className="afterplay-age-unknown mt-1.5 text-micro text-dust">
                {pluralize(unknownCount, 'game')} without a release year stays outside the ring.
              </div>
            )}
          </div>
        )}
      </div>
    </StatCard>
  );
};
