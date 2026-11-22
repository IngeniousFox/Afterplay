import { cn } from '../../lib/utils';
import { useMemo } from 'react';
import { pluralize } from '../../lib/format';
import { playedDayKeysOf, type SessionStats } from '../../../../shared/domain/sessionStats';
import { currentStreak, longestStreak } from '../../../../shared/domain/streaks';
import { ChartHeading, StatCard } from './StatCard';
import type { Year } from './YearPicker';

type StreakCardProps = {
  stats: Pick<SessionStats, 'days'>;
  year: Year;
};

// Racha de días jugados (estilo resumen anual de Steam). En "All Time" el
// número grande es la racha ACTUAL (lo que está en juego ahora mismo) y,
// filtrando por un año, la mejor racha de ese año. Las marcas no convierten
// la racha en una meta: solo dan escala comparándola con el récord personal.
export const StreakCard = ({ stats, year }: StreakCardProps): React.JSX.Element => {
  const dayKeys = useMemo(() => playedDayKeysOf(stats), [stats]);
  const isAllTime = year === 'all';
  const mainValue = isAllTime ? currentStreak(dayKeys) : longestStreak(dayKeys, year);
  const longestEver = longestStreak(dayKeys);
  const recordValue = Math.max(1, longestEver, mainValue);
  const progress = Math.min(1, mainValue / recordValue);
  const progressPercent = Math.round(progress * 100);
  const gapToRecord = Math.max(0, longestEver - mainValue);
  const hasStreak = mainValue > 0;

  const statusLabel = !hasStreak ? 'Ready' : isAllTime ? 'Current run' : `${year} best`;
  const supportingCopy = !hasStreak
    ? isAllTime
      ? 'Your next played day starts a new run.'
      : `No multi-day run recorded in ${year}.`
    : gapToRecord > 0
      ? `${pluralize(gapToRecord, 'day')} shy of your all-time best`
      : isAllTime
        ? 'This run matches your personal best'
        : 'Your strongest recorded run';

  // Una marca por día del récord (hasta 60; más allá cada marca vale varios
  // días) y se encienden las de la racha que se enseña.
  const tickCount = Math.min(60, Math.max(20, recordValue));
  const litTicks = hasStreak ? Math.max(1, Math.round(progress * tickCount)) : 0;

  return (
    <StatCard
      className={cn(
        'afterplay-streak-card relative flex h-full flex-col overflow-hidden',
        hasStreak ? '' : 'is-empty',
      )}
    >
      <ChartHeading
        title="Daily streak"
        right={isAllTime ? 'The rhythm you carry now' : `Your strongest run in ${year}`}
      />

      <div className="afterplay-streak-stage mt-3 flex flex-1 flex-col">
        <span className="afterplay-streak-status text-micro font-semibold text-dust">
          {statusLabel}
        </span>
        <div className="flex items-baseline gap-2">
          <strong
            className={cn(
              'font-display text-[88px] leading-[0.9] font-bold tabular-nums',
              hasStreak ? 'text-phosphor [text-shadow:var(--shadow-glow-text)]' : 'text-bone',
            )}
          >
            {mainValue}
          </strong>
          <small className="font-display text-[32px] leading-none font-bold text-dust">
            {mainValue === 1 ? 'day' : 'days'}
          </small>
        </div>
        <p className="afterplay-streak-story mt-2 text-small text-dust">{supportingCopy}</p>

        <div
          className="afterplay-streak-orbit mt-auto flex h-10 items-stretch gap-[3px] pt-4"
          role="img"
          aria-label={`${progressPercent}% of your record`}
        >
          {Array.from({ length: tickCount }, (_, index) => (
            <i
              key={index}
              className={cn(
                'min-w-0 flex-1 rounded-[1px]',
                index < litTicks ? 'bg-phosphor' : 'bg-line-strong',
              )}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between gap-3 text-micro text-dust tabular-nums">
          <span>
            {pluralize(mainValue, 'day')} {isAllTime ? 'now' : 'best'}
          </span>
          <span>{progressPercent}% of record</span>
        </div>
      </div>

      <div className="afterplay-streak-footer mt-4 grid grid-cols-2 gap-4 border-t border-line pt-3">
        <div className="min-w-0">
          <span className="block text-small text-dust">Longest ever</span>
          <strong className="mt-0.5 block text-small font-semibold text-bone tabular-nums">
            {pluralize(longestEver, 'day')}
          </strong>
        </div>
        <div className="min-w-0">
          <span className="block text-small text-dust">
            {gapToRecord > 0 ? 'To match it' : 'Status'}
          </span>
          <strong className="mt-0.5 block text-small font-semibold text-bone tabular-nums">
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
