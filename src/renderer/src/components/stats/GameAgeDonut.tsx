import { cn } from '../../lib/utils';
import { useMemo, useState } from 'react';
import { AMBER } from '../../lib/colors';
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
    shortLabel: 'NEW',
    description: (referenceYear) => `released in ${referenceYear}`,
    color: '#2fdc7e',
    matches: (age) => age <= 0,
  },
  {
    key: 'recent',
    label: '1–5 years',
    shortLabel: 'RECENT',
    description: () => '1 to 5 years old',
    color: '#85a3d6',
    matches: (age) => age >= 1 && age <= 5,
  },
  {
    key: 'modern',
    label: '5–10 years',
    shortLabel: 'MODERN',
    description: () => '5 to 10 years old',
    color: AMBER,
    matches: (age) => age > 5 && age <= 10,
  },
  {
    key: 'classic',
    label: '10+ years',
    shortLabel: 'CLASSIC',
    description: () => 'over 10 years old',
    color: '#7c86c8',
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
    <StatCard className="afterplay-age-card relative overflow-hidden [background:radial-gradient(circle_at_18%_115%,_rgba(124,_134,_200,_0.08),_transparent_31%),_var(--card)]">
      <div
        className={cn(
          'afterplay-age-accent relative',
          "[&::before]:content-[''] [&::before]:absolute [&::before]:-top-40 [&::before]:-left-32.5 [&::before]:w-105",
          '[&::before]:h-105 [&::before]:rounded-[50%] [&::before]:pointer-events-none',
          '[&::before]:[background:var(--age-accent)] [&::before]:opacity-[0.055] [&::before]:[filter:blur(55px)]',
          '[&::before]:[transition:background-color_320ms_ease]',
        )}
        style={{ '--age-accent': active.color } as React.CSSProperties}
      >
        <div className="afterplay-age-header flex items-start justify-between gap-4 relative z-1">
          <div>
            <div className="text-[14px] font-bold text-foreground">Playtime by game age</div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              Where your time lands across generations
            </div>
          </div>
          {totalHours > 0 && (
            <div
              className={cn(
                'afterplay-age-total grid grid-cols-[auto_auto] gap-y-0.5 gap-x-2 min-w-29.5 py-[7px] px-[9px] rounded-[9px]',
                '[border:1px_solid_rgba(255,_255,_255,_0.065)] [background:rgba(255,_255,_255,_0.018)]',
              )}
            >
              <span className="text-white/45 text-[10px] font-black tracking-[0.12em] uppercase col-[1/3]">
                DATED PLAYTIME
              </span>
              <strong className="text-foreground text-[12px] font-[850]">
                {formatHours(totalHours)}
              </strong>
              <small className="[align-self:end] text-muted-foreground text-[11px] text-right">
                across {pluralize(datedCount, 'game')}
              </small>
            </div>
          )}
        </div>

        {totalHours <= 0 ? (
          <StatCardEmpty>Nothing tracked yet.</StatCardEmpty>
        ) : (
          <div
            className={cn(
              'afterplay-age-stage relative z-1 grid grid-cols-[minmax(250px,_0.72fr)_minmax(0,_1.65fr)] gap-7 items-center',
              'mt-2',
              '[@media(max-width:_1040px)]:grid-cols-1 [@media(max-width:_1040px)]:gap-3',
            )}
          >
            <div className="afterplay-age-orbit-wrap relative w-59 h-59 my-0 mx-auto">
              <div
                className={cn(
                  'afterplay-age-orbit-glow absolute [inset:38px] rounded-[50%] [background:var(--age-accent)] opacity-[0.075]',
                  '[filter:blur(25px)] [transition:background-color_320ms_ease]',
                )}
              />
              <svg
                className={cn(
                  'afterplay-age-orbit relative z-1 block overflow-visible origin-center',
                  'animate-[afterplay-age-orbit-in_720ms_cubic-bezier(0.22,_1,_0.36,_1)_backwards]',
                  'motion-reduce:animate-none motion-reduce:transition-none',
                )}
                width={SIZE}
                height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                role="img"
                aria-label={`Game age distribution. ${active.label}: ${activePercent}%`}
              >
                <defs>
                  <filter id="afterplay-age-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3.2" />
                  </filter>
                </defs>
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={105}
                  fill="none"
                  stroke="rgba(255,255,255,.12)"
                  strokeWidth={1}
                  strokeDasharray="1 7"
                  strokeLinecap="round"
                />
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke="rgba(255,255,255,.045)"
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
                      <g key={slice.key}>
                        {isActive && (
                          <circle
                            cx={CENTER}
                            cy={CENTER}
                            r={RADIUS}
                            fill="none"
                            stroke={slice.color}
                            strokeWidth={STROKE + 9}
                            strokeDasharray={`${visibleLength} ${CIRCUMFERENCE}`}
                            strokeDashoffset={dashOffset}
                            opacity={0.2}
                            filter="url(#afterplay-age-glow)"
                          />
                        )}
                        <circle
                          cx={CENTER}
                          cy={CENTER}
                          r={RADIUS}
                          fill="none"
                          stroke={slice.color}
                          strokeWidth={isActive ? STROKE + 4 : STROKE}
                          strokeDasharray={`${visibleLength} ${CIRCUMFERENCE}`}
                          strokeDashoffset={dashOffset}
                          strokeLinecap="butt"
                          opacity={isActive ? 1 : 0.42}
                          className={cn(
                            'afterplay-age-slice cursor-pointer',
                            '[transition:opacity_220ms_ease,_stroke-width_300ms_cubic-bezier(0.22,_1,_0.36,_1),_filter_220ms_ease]',
                            '[&:hover]:[filter:brightness(1.12)]',
                            'motion-reduce:animate-none motion-reduce:transition-none',
                          )}
                          data-age-slice={slice.key}
                          onMouseEnter={() => setHoveredKey(slice.key)}
                          onMouseLeave={() => setHoveredKey(null)}
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>

              <div
                className={cn(
                  'afterplay-age-core absolute z-2 top-1/2 left-1/2 flex w-29.5 h-29.5 flex-col items-center justify-center',
                  'rounded-[50%] pointer-events-none',
                  '[border:1px_solid_color-mix(in_srgb,_var(--age-accent)_20%,_rgba(255,_255,_255,_0.06))]',
                  '[background:rgba(12,_15,_13,_0.88)]',
                  '[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.04),_0_13px_32px_rgba(0,_0,_0,_0.34)]',
                  '[transform:translate(-50%,_-50%)] [transition:border-color_280ms_ease]',
                )}
              >
                <span className="text-white/45 text-[10px] font-black tracking-[0.12em]">
                  SHARE OF TIME
                </span>
                <strong className="mt-0.75 text-(--age-accent) text-[36px] font-black tracking-[-0.05em] leading-none [transition:color_280ms_ease]">
                  {activePercent}%
                </strong>
                <small className="mt-1 text-white/[0.7] text-[10px] font-black tracking-[0.1em]">
                  {active.shortLabel}
                </small>
              </div>
            </div>

            <div className="afterplay-age-story min-w-0">
              <div
                className={cn(
                  'afterplay-age-focus flex items-center justify-between gap-5 min-h-19.5 py-[11px] px-[13px] rounded-[11px]',
                  '[&_>_div_>_span]:text-white/45 [&_>_div_>_span]:text-[10px] [&_>_div_>_span]:font-black',
                  '[&_>_div_>_span]:tracking-[0.12em] [&_>_div_>_span]:uppercase',
                  '[border:1px_solid_color-mix(in_srgb,_var(--age-accent)_19%,_rgba(255,_255,_255,_0.055))]',
                  '[background:linear-gradient(_120deg,_color-mix(in_srgb,_var(--age-accent)_8%,_transparent),_rgba(255,_255,_255,_0.014)_)]',
                  '[transition:border-color_260ms_ease,_background-color_260ms_ease]',
                  '[&_>_div_>_strong]:block [&_>_div_>_strong]:mt-0.5 [&_>_div_>_strong]:text-(--age-accent)',
                  '[&_>_div_>_strong]:text-[17px] [&_>_div_>_strong]:font-black [&_>_div_>_strong]:tracking-[-0.02em]',
                  '[&_>_div_>_strong]:[transition:color_280ms_ease]',
                  '[&_p]:max-w-115 [&_p]:mt-0.75 [&_p]:text-muted-foreground [&_p]:text-[11.5px] [&_p]:leading-[1.45]',
                )}
              >
                <div>
                  <span>ACTIVE ERA</span>
                  <strong>{active.label}</strong>
                  <p>
                    {activePercent}% of your {year === 'all' ? 'all-time' : year} hours went to
                    games {active.description(referenceYear)}.
                  </p>
                </div>
                <div
                  className={cn(
                    'afterplay-age-focus-numbers flex-none text-right',
                    '[&_strong]:block',
                    '[&_span]:block',
                    '[&_strong]:text-foreground! [&_strong]:text-[18px]! [&_strong]:font-black! [&_strong]:whitespace-nowrap',
                    '[&_span]:mt-0.5 [&_span]:text-muted-foreground [&_span]:text-[11px]',
                  )}
                >
                  <strong>{formatHours(active.hours)}</strong>
                  <span>{pluralize(active.gameCount, 'game')}</span>
                </div>
              </div>

              <div className="afterplay-age-eras grid grid-cols-2 gap-[7px] mt-2">
                {slices.map((slice) => {
                  const isActive = slice.key === active.key;
                  return (
                    <button
                      key={slice.key}
                      type="button"
                      className={cn(
                        'afterplay-age-era relative grid grid-cols-[minmax(0,_1fr)_auto] gap-2 overflow-hidden min-h-14.5 pt-[9px]',
                        'pr-[11px] pb-3 pl-3.5 rounded-[10px] outline-none text-left [border:1px_solid_rgba(255,_255,_255,_0.055)]',
                        'text-inherit [background:rgba(255,_255,_255,_0.015)]',
                        '[transition:border-color_220ms_ease,_background-color_220ms_ease,_box-shadow_240ms_ease,_transform_280ms_cubic-bezier(0.22,_1,_0.36,_1)]',
                        "[&[data-active='true']_.afterplay-age-era-stripe]:opacity-[1]",
                        "[&[data-active='true']_.afterplay-age-era-track_i]:opacity-[1]",
                        "[&[data-active='true']_.afterplay-age-era-copy_strong]:text-foreground",
                        'motion-reduce:animate-none motion-reduce:transition-none',
                        "[&:is(:hover,:focus-visible,[data-active='true'])]:[border-color:color-mix(in_srgb,_var(--era-accent)_30%,_rgba(255,_255,_255,_0.06))]",
                        "[&:is(:hover,:focus-visible,[data-active='true'])]:[background:color-mix(in_srgb,_var(--era-accent)_7%,_rgba(255,_255,_255,_0.015))]",
                        "[&:is(:hover,:focus-visible,[data-active='true'])]:[box-shadow:0_8px_20px_rgba(0,_0,_0,_0.14)]",
                        "[&:is(:hover,:focus-visible,[data-active='true'])]:[transform:translateY(-2px)]",
                      )}
                      data-active={isActive ? 'true' : 'false'}
                      aria-pressed={isActive}
                      style={
                        {
                          '--era-accent': slice.color,
                          '--era-share': `${slice.fraction * 100}%`,
                        } as React.CSSProperties
                      }
                      onMouseEnter={() => setHoveredKey(slice.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      onFocus={() => setHoveredKey(slice.key)}
                      onBlur={() => setHoveredKey(null)}
                    >
                      <span className="afterplay-age-era-stripe absolute top-[9px] bottom-[11px] left-0 w-[3px] rounded-[0_99px_99px_0] [background:var(--era-accent)] opacity-[0.55]" />
                      <span className="afterplay-age-era-copy">
                        <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-white/[0.72] text-[11.5px] font-[750]">
                          {slice.label}
                        </strong>
                        <small className="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.75 text-muted-foreground text-[11px]">
                          {formatHours(slice.hours)} · {pluralize(slice.gameCount, 'game')}
                        </small>
                      </span>
                      <span className="afterplay-age-era-percent text-[16px] font-black leading-none text-(--era-accent) [tab-size:2]">
                        {Math.round(slice.fraction * 100)}%
                      </span>
                      <span
                        className={cn(
                          'afterplay-age-era-track absolute right-2.5 bottom-1.5 left-3.5 h-0.5 overflow-hidden rounded-[99px]',
                          '[background:rgba(255,_255,_255,_0.055)]',
                        )}
                      >
                        <i className="block w-[var(--era-share)] h-full rounded-[inherit] [background:var(--era-accent)] [box-shadow:0_0_8px_color-mix(in_srgb,_var(--era-accent)_35%,_transparent)] opacity-[0.62] origin-left animate-[afterplay-grow-x_650ms_cubic-bezier(0.22,_1,_0.36,_1)_backwards] motion-reduce:animate-none motion-reduce:transition-none" />
                      </span>
                    </button>
                  );
                })}
              </div>

              {unknownCount > 0 && (
                <div className="afterplay-age-unknown mt-[7px] text-[11px] text-right text-white/45">
                  {pluralize(unknownCount, 'game')} without a release year stays outside the orbit.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </StatCard>
  );
};
