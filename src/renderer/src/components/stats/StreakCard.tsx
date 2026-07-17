import { Flame } from 'lucide-react';
import { useMemo } from 'react';
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
// número grande es la racha ACTUAL (lo que está en juego ahora mismo) y
// debajo va la más larga de siempre; filtrando por un año, la actual no
// tiene sentido (ese año ya no se puede extender) — solo se enseña la más
// larga DE ese año.
export const StreakCard = ({ sessions, year }: StreakCardProps): React.JSX.Element => {
  const dayKeys = useMemo(() => playedDayKeys(sessions), [sessions]);
  const isAllTime = year === 'all';
  const mainValue = isAllTime ? currentStreak(dayKeys) : longestStreak(dayKeys, year);
  const longestEver = longestStreak(dayKeys);

  return (
    <StatCard title="Daily streak" className="flex h-full flex-col">
      <div className="mt-0.5 text-xs text-muted-foreground">
        {isAllTime ? 'Open a session every day to keep it alive' : `Your longest run of ${year}`}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-4">
        <div className="flex items-center gap-2.5">
          <Flame size={30} color={AMBER} fill={mainValue > 0 ? AMBER : 'none'} />
          <span className="text-[42px] font-extrabold text-foreground tabular-nums">
            {mainValue}
          </span>
          <span className="self-end pb-2.5 text-[14px] text-muted-foreground">
            {mainValue === 1 ? 'day' : 'days'}
          </span>
        </div>
        <div className="mt-0.5 text-[12.5px] font-semibold text-muted-foreground">
          {isAllTime ? 'Current streak' : `Longest streak in ${year}`}
        </div>
      </div>

      {isAllTime && (
        <div className="flex items-center justify-between border-t border-white/5 pt-3">
          <span className="text-[12.5px] text-muted-foreground">Longest ever</span>
          <span className="text-[14px] font-bold tabular-nums text-foreground">
            {pluralize(longestEver, 'day')}
          </span>
        </div>
      )}
    </StatCard>
  );
};
