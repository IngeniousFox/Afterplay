import { formatHours } from '../../lib/format';
import type { PlayedEntry } from '../../lib/playedEntries';
import { topPlayedEntries } from '../../lib/playedEntries';
import { GameCover } from '../GameCover';
import { StatCard } from './StatCard';

type MostPlayedListProps = { entries: PlayedEntry[] };

const MAX_ENTRIES = 6;

// SPEC 10.7 / prototipo — top 6 por horas, barra proporcional al más jugado
// de la lista (no al total de la biblioteca). Fuera los juegos con 0h en la
// ventana activa: con un año concreto seleccionado, `entries` trae TODOS los
// juegos de la biblioteca (para que Genre Radar pueda sumar sobre el mismo
// conjunto), incluidos los que se añadieron después de ese año — sin este
// filtro, rellenaban hasta 6 huecos con juegos que ese año ni existían aún.
export const MostPlayedList = ({ entries }: MostPlayedListProps): React.JSX.Element => {
  const top = topPlayedEntries(entries, MAX_ENTRIES);
  const maxHours = Math.max(1, ...top.map((entry) => entry.hours));

  return (
    <StatCard title="Most Played" titleClassName="mb-4.5">
      {top.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing tracked yet.</p>
      ) : (
        <div className="flex flex-col gap-3.75">
          {top.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3.25">
              <GameCover
                url={entry.coverUrl}
                className="h-10 w-7.5 flex-none overflow-hidden rounded-[6px] border border-border"
                iconSize={13}
              />
              <div className="w-37.5 flex-none truncate text-[13.5px] font-semibold text-foreground">
                {entry.title}
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(entry.hours / maxHours) * 100}%`,
                    background: 'linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,.42))',
                  }}
                />
              </div>
              <div className="w-17.5 flex-none text-right text-[12.5px] text-muted-foreground tabular-nums">
                {formatHours(entry.hours)}
              </div>
            </div>
          ))}
        </div>
      )}
    </StatCard>
  );
};
