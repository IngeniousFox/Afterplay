import { AMBER } from '../../lib/colors';
import { formatHours } from '../../lib/format';
import type { PlayedEntry } from '../../lib/playedEntries';
import { topPlayedEntries } from '../../lib/playedEntries';
import { GameCover } from '../GameCover';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';

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
        <StatCardEmpty>Nothing tracked yet.</StatCardEmpty>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3.25">
              <GameCover
                url={entry.coverUrl}
                className="h-16 w-12 flex-none overflow-hidden rounded-[7px] border border-border"
                iconSize={19}
              />
              {/* La barra ES la fila (estilo recap de Steam): una pista a lo
                  ancho con el relleno dorado proporcional DETRÁS del título
                  y las horas — así no existe el hueco muerto entre nombre y
                  barra que dejaba cualquier reparto en columnas. Misma altura
                  que la carátula, para que las dos casen en la fila. */}
              <div className="relative h-16 flex-1 overflow-hidden rounded-[9px] bg-white/[0.03]">
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${Math.max(2, (entry.hours / maxHours) * 100)}%`,
                    background: `linear-gradient(90deg, ${AMBER}3d, ${AMBER}14)`,
                    borderRight: `2px solid ${AMBER}b3`,
                  }}
                />
                <div className="relative z-1 flex h-full items-center justify-between gap-3 px-3.5">
                  <span className="truncate text-[13.5px] font-semibold text-foreground">
                    {entry.title}
                  </span>
                  <span
                    className="flex-none text-[12.5px] font-bold tabular-nums"
                    style={{ color: AMBER }}
                  >
                    {formatHours(entry.hours)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </StatCard>
  );
};
