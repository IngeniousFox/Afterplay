import { cn } from '../../lib/utils';
import { Flame } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { AMBER } from '../../lib/colors';
import { pluralize } from '../../lib/format';
import { currentStreak, longestStreak, playedDayKeys } from '../../lib/streaks';
import { StatCard } from './StatCard';
import type { Year } from './YearPicker';

type StreakSession = { startedAt: Date; isManual: boolean };

type StreakCardProps = {
  sessions: StreakSession[];
  year: Year;
};

// Racha de días jugados (estilo resumen anual de Steam). En "All Time" el
// número grande es la racha ACTUAL (lo que está en juego ahora mismo) y,
// filtrando por un año, la mejor racha de ese año. El aro no convierte la
// racha en una meta: solo da escala comparándola con el récord personal.
export const StreakCard = ({ sessions, year }: StreakCardProps): React.JSX.Element => {
  const dayKeys = useMemo(() => playedDayKeys(sessions), [sessions]);
  const isAllTime = year === 'all';
  const mainValue = isAllTime ? currentStreak(dayKeys) : longestStreak(dayKeys, year);
  const longestEver = longestStreak(dayKeys);
  const recordValue = Math.max(1, longestEver, mainValue);
  const progress = Math.min(1, mainValue / recordValue);
  const progressPercent = Math.round(progress * 100);
  const gapToRecord = Math.max(0, longestEver - mainValue);
  const hasStreak = mainValue > 0;

  const statusLabel = !hasStreak ? 'READY' : isAllTime ? 'CURRENT RUN' : `${year} BEST`;
  const supportingCopy = !hasStreak
    ? isAllTime
      ? 'Your next played day starts a new run.'
      : `No multi-day run recorded in ${year}.`
    : gapToRecord > 0
      ? `${pluralize(gapToRecord, 'day')} shy of your all-time best`
      : isAllTime
        ? 'This run matches your personal best'
        : 'Your strongest recorded run';

  return (
    <StatCard
      className={cn(
        'afterplay-streak-card flex h-full flex-col relative overflow-hidden',
        "after:content-[''] after:absolute after:top-0 after:left-5.5 after:w-14.5 after:h-px after:pointer-events-none",
        'after:[background:linear-gradient(90deg,transparent,var(--streak-accent),transparent)] after:opacity-50',
        '[--chart-accent:var(--streak-accent)]',
        hasStreak ? '' : 'is-empty',
      )}
      style={
        {
          '--streak-accent': AMBER,
          '--streak-progress': `${progress * 360}deg`,
        } as CSSProperties
      }
    >
      <div className="afterplay-chart-heading grid grid-cols-[32px_minmax(0,_1fr)_auto] items-center gap-2.5 min-w-0">
        <span
          className={cn(
            'afterplay-chart-heading-icon flex w-8 h-8 items-center justify-center rounded-[9px] border',
            'border-[color-mix(in_srgb,var(--chart-accent,#2fdc7e)_22%,transparent)]',
            'text-[color:var(--chart-accent,#2fdc7e)]',
            'bg-[color-mix(in_srgb,var(--chart-accent,#2fdc7e)_7%,rgba(255,255,255,0.01))]',
            '[.afterplay-category-card_&]:[transition:color_200ms_ease,border-color_200ms_ease,transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
            '[.afterplay-category-card:hover_&]:border-[color-mix(in_srgb,var(--chart-accent)_38%,transparent)]',
            '[.afterplay-category-card:hover_&]:[transform:translateY(-1px)_rotate(-3deg)]',
            'motion-reduce:animate-none motion-reduce:transition-none',
          )}
        >
          <Flame size={15} />
        </span>
        <div className="afterplay-chart-heading-copy min-w-0">
          <strong className="block text-foreground text-[14px] font-[850] leading-[1.2] whitespace-normal">
            Daily streak
          </strong>
          <small className="block mt-0.75 text-muted-foreground text-[11.5px] leading-[1.2] whitespace-normal">
            {isAllTime ? 'The rhythm you are carrying now' : `Your strongest run in ${year}`}
          </small>
        </div>
        <span
          className={cn(
            'afterplay-streak-status inline-flex items-center gap-1.5 py-[5px] px-[7px] rounded-[99px] text-[11px] font-black',
            'tracking-[0.09em] whitespace-nowrap border border-[color-mix(in_srgb,var(--streak-accent)_25%,transparent)]',
            'text-[color:var(--streak-accent)]',
            'bg-[color-mix(in_srgb,var(--streak-accent)_7%,transparent)]',
            '[.afterplay-streak-card.is-empty_&]:text-white/45 [.afterplay-streak-card.is-empty_&]:border-white/9',
            '[.afterplay-streak-card.is-empty_&]:bg-white/[0.025]',
          )}
        >
          <i
            className={cn(
              'w-1.25 h-1.25 rounded-full bg-current',
              '[box-shadow:0_0_6px_color-mix(in_srgb,var(--streak-accent)_35%,transparent)]',
            )}
            aria-hidden="true"
          />
          {statusLabel}
        </span>
      </div>

      <div className="afterplay-streak-stage flex min-h-39.5 flex-1 flex-wrap items-center justify-center gap-[17px] pt-[13px] px-[3px] pb-[11px]">
        <div
          className={cn(
            'afterplay-streak-orbit relative flex w-28.5 h-28.5 flex-none items-center justify-center p-[7px] rounded-[50%]',
            '[background:conic-gradient(var(--streak-accent)_0deg_var(--streak-progress),rgba(255,255,255,0.055)_var(--streak-progress)_360deg)]',
            '[box-shadow:0_10px_25px_rgba(0,0,0,0.2),0_0_13px_color-mix(in_srgb,var(--streak-accent)_11%,transparent)]',
            '[transition:box-shadow_240ms_ease,transform_320ms_cubic-bezier(0.22,1,0.36,1)]',
            "before:content-[''] before:absolute before:-inset-1.75 before:rounded-full before:opacity-32",
            'before:[background:repeating-conic-gradient(from_-1deg,rgba(255,255,255,0.28)_0deg_1deg,transparent_1deg_15deg)]',
            'before:[mask:radial-gradient(circle,transparent_68%,#000_69%_71%,transparent_72%)]',
            '[.afterplay-streak-card:hover_&]:[box-shadow:0_12px_28px_rgba(0,0,0,0.24),0_0_15px_color-mix(in_srgb,var(--streak-accent)_15%,transparent)]',
            '[.afterplay-streak-card:hover_&]:[transform:translateY(-2px)_rotate(-1deg)]',
            'motion-reduce:animate-none motion-reduce:transition-none',
          )}
          aria-hidden="true"
        >
          <div
            className={cn(
              'afterplay-streak-orbit-inner flex w-full h-full flex-col items-center justify-center rounded-[50%] border',
              'border-white/[0.055]',
              'text-[color:var(--streak-accent)]',
              '[background:radial-gradient(circle_at_50%_34%,color-mix(in_srgb,var(--streak-accent)_9%,transparent),transparent_43%),#101310]',
              '[box-shadow:inset_0_0_18px_rgba(0,0,0,0.28)]',
            )}
          >
            <Flame size={20} fill={hasStreak ? AMBER : 'none'} />
            <strong className="mt-0.5 text-foreground text-[34px] font-[950] leading-[0.92] tracking-[-0.05em] tabular-nums">
              {mainValue}
            </strong>
            <small className="mt-1.25 text-white/45 text-[11px] font-extrabold tracking-[0.1em] uppercase">
              {mainValue === 1 ? 'day' : 'days'}
            </small>
          </div>
        </div>

        <div className="afterplay-streak-story min-w-32 flex-1">
          <span
            className={cn(
              'text-[color:var(--streak-accent)]',
              'text-[11px] font-black tracking-[0.08em]',
            )}
          >
            {isAllTime ? 'CURRENT STREAK' : 'LONGEST RUN'}
          </span>
          <strong className="block mt-1.25 text-foreground text-[15px] font-[850] leading-[1.15]">
            {hasStreak
              ? isAllTime
                ? 'Keep the flame moving'
                : `${year} had momentum`
              : 'A fresh run'}
          </strong>
          <small className="block mt-1.25 text-muted-foreground text-[11px] leading-[1.35]">
            {supportingCopy}
          </small>
          <div className="afterplay-streak-progress mt-[13px]">
            <span className="block h-1 overflow-hidden rounded-[99px] bg-white/[0.055]">
              <i
                className={cn(
                  'block h-full rounded-[inherit]',
                  '[background:linear-gradient(90deg,color-mix(in_srgb,var(--streak-accent)_46%,transparent),var(--streak-accent))]',
                  'origin-left animate-[afterplay-grow-x_680ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
                  'motion-reduce:animate-none motion-reduce:transition-none',
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </span>
            <em className="block mt-1.25 text-white/45 text-[11px] not-italic font-bold text-right">
              {progressPercent}% of record
            </em>
          </div>
        </div>
      </div>

      <div className="afterplay-streak-footer grid grid-cols-2 gap-[9px] pt-2.5 border-t border-t-[rgba(255,255,255,0.055)]">
        <div className="min-w-0 p-[7px_9px] border border-white/[0.055] rounded-[8px] bg-white/[0.018]">
          <span className="block min-h-7 whitespace-normal text-white/45 text-[11px] leading-[1.25] font-bold tracking-[0.04em]">
            LONGEST EVER
          </span>
          <strong
            className={cn(
              'block whitespace-normal mt-1 text-foreground text-[11px] font-extrabold',
              'tabular-nums',
            )}
          >
            {pluralize(longestEver, 'day')}
          </strong>
        </div>
        <div className="min-w-0 p-[7px_9px] border border-white/[0.055] rounded-[8px] bg-white/[0.018]">
          <span className="block min-h-7 whitespace-normal text-white/45 text-[11px] leading-[1.25] font-bold tracking-[0.04em]">
            {gapToRecord > 0 ? 'TO MATCH IT' : 'STATUS'}
          </span>
          <strong
            className={cn(
              'block whitespace-normal mt-1 text-foreground text-[11px] font-extrabold',
              'tabular-nums',
            )}
          >
            {gapToRecord > 0
              ? pluralize(gapToRecord, 'day')
              : hasStreak
                ? 'Record pace'
                : 'Ready to start'}
          </strong>
        </div>
      </div>
    </StatCard>
  );
};
