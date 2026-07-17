import { formatHours } from '../../lib/format';
import type { PlayedEntry } from '../../lib/playedEntries';
import { topPlayedEntries } from '../../lib/playedEntries';
import { GameCover } from '../GameCover';
import { StatCard } from './StatCard';

type TopPlayedListProps = { entries: PlayedEntry[] };

const MAX_ENTRIES = 5;

// SPEC 10.7 / prototipo — ranking numerado top 5, sin barra (a diferencia de
// Most Played), solo puesto + carátula + título + horas. Mismo filtro de 0h
// que MostPlayedList — ver el comentario ahí.
export const TopPlayedList = ({ entries }: TopPlayedListProps): React.JSX.Element => {
  const top = topPlayedEntries(entries, MAX_ENTRIES);

  return (
    <StatCard title="Top Played" titleClassName="mb-4">
      {top.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing tracked yet.</p>
      ) : (
        <div className="flex flex-col">
          {top.map((entry, index) => (
            <div
              key={entry.id}
              className="flex items-center gap-3.25 border-b border-white/[0.045] py-2.25 last:border-b-0"
            >
              <div className="w-5.5 flex-none text-[13px] font-extrabold text-muted-foreground tabular-nums">
                {index + 1}
              </div>
              <GameCover
                url={entry.coverUrl}
                className="h-9.5 w-7 flex-none overflow-hidden rounded-[6px] border border-border"
                iconSize={12}
              />
              <div className="flex-1 truncate text-[13.5px] font-semibold text-foreground">
                {entry.title}
              </div>
              <div className="flex-none text-[13px] font-semibold text-foreground tabular-nums">
                {formatHours(entry.hours)}
              </div>
            </div>
          ))}
        </div>
      )}
    </StatCard>
  );
};
