import { cn } from '../../lib/utils';
import { formatHours } from '../../lib/format';
import type { PlayedEntry } from '../../lib/playedEntries';
import { topPlayedEntries } from '../../lib/playedEntries';
import { GameCover } from '../GameCover';
import { ChartHeading, StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import type { GameId } from '../../../../shared/entityIds';

type MostPlayedListProps = {
  entries: PlayedEntry[];
  onOpenGame: (gameId: GameId) => void;
};

const MAX_ENTRIES = 6;

// SPEC 10.7 — top 6 por horas, barra proporcional al más jugado de la lista
// (no al total de la biblioteca). Fuera los juegos con 0h en la ventana
// activa: con un año concreto, `entries` trae TODOS los juegos de la
// biblioteca (Genre Radar suma sobre el mismo conjunto).
//
// Fósforo: lista con el puesto real (aquí sí hay orden), carátula, barra
// ámbar en pista Inset y horas en Big Shoulders. Clic en la fila abre la ficha.
export const MostPlayedList = ({ entries, onOpenGame }: MostPlayedListProps): React.JSX.Element => {
  const top = topPlayedEntries(entries, MAX_ENTRIES);
  const maxHours = Math.max(1, ...top.map((entry) => entry.hours));
  const playedCount = entries.filter((entry) => entry.hours > 0).length;

  return (
    <StatCard className="flex h-full flex-col">
      <ChartHeading
        title="Most played"
        right={top.length > 0 ? `Top ${top.length} of ${playedCount}, by hours` : undefined}
      />
      {top.length === 0 ? (
        <div className="mt-4">
          <StatCardEmpty>Nothing tracked yet.</StatCardEmpty>
        </div>
      ) : (
        <div className="mt-3 flex flex-col">
          {top.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onOpenGame(entry.id)}
              className={cn(
                'afterplay-most-played-row group/played grid w-full grid-cols-[28px_36px_minmax(0,1.1fr)_minmax(0,1fr)_auto] items-center gap-3',
                'rounded-sm border-b border-line px-1 py-1.5 text-left last:border-b-0',
                'transition-colors duration-150 hover:bg-raised',
                'outline-hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-phosphor',
              )}
              aria-label={`Open ${entry.title}`}
            >
              <span className="text-center font-display text-[26px] leading-none font-bold text-dust tabular-nums">
                {index + 1}
              </span>
              <GameCover
                url={entry.coverUrl}
                className="afterplay-most-played-cover h-12 w-9 overflow-hidden rounded-sm border border-line"
                iconSize={15}
              />
              <span className="truncate text-body font-semibold text-bone">{entry.title}</span>
              <span className="afterplay-most-played-track relative h-2.5 overflow-hidden rounded-[2px] bg-inset">
                <span
                  className="absolute inset-y-0 left-0 rounded-[2px] bg-phosphor/80 transition-colors group-hover/played:bg-phosphor"
                  style={{ width: `${Math.max(2, (entry.hours / maxHours) * 100)}%` }}
                />
              </span>
              <span className="min-w-20 text-right font-display text-[24px] leading-none font-bold text-bone tabular-nums">
                {formatHours(entry.hours)}
              </span>
            </button>
          ))}
        </div>
      )}
    </StatCard>
  );
};
