import { cn } from '../../lib/utils';
import { ArrowUpRight } from 'lucide-react';
import { AMBER } from '../../lib/colors';
import { formatHours } from '../../lib/format';
import type { PlayedEntry } from '../../lib/playedEntries';
import { topPlayedEntries } from '../../lib/playedEntries';
import { GameCover } from '../GameCover';
import { StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';

type MostPlayedListProps = {
  entries: PlayedEntry[];
  onOpenGame: (gameId: number) => void;
};

const MAX_ENTRIES = 6;

// SPEC 10.7 / prototipo — top 6 por horas, barra proporcional al más jugado
// de la lista (no al total de la biblioteca). Fuera los juegos con 0h en la
// ventana activa: con un año concreto seleccionado, `entries` trae TODOS los
// juegos de la biblioteca (para que Genre Radar pueda sumar sobre el mismo
// conjunto), incluidos los que se añadieron después de ese año — sin este
// filtro, rellenaban hasta 6 huecos con juegos que ese año ni existían aún.
export const MostPlayedList = ({ entries, onOpenGame }: MostPlayedListProps): React.JSX.Element => {
  const top = topPlayedEntries(entries, MAX_ENTRIES);
  const maxHours = Math.max(1, ...top.map((entry) => entry.hours));

  return (
    <StatCard title="Most Played" titleClassName="mb-4.5">
      {top.length === 0 ? (
        <StatCardEmpty>Nothing tracked yet.</StatCardEmpty>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onOpenGame(entry.id)}
              className={cn(
                'afterplay-most-played-row group/played flex w-full items-center gap-3.25 text-left rounded-[10px] outline-none',
                '[transition:transform_230ms_cubic-bezier(0.22,1,0.36,1)]',
                '[&:is(:hover,:focus-visible)]:[transform:translateX(4px)]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
              aria-label={`Open ${entry.title}`}
            >
              <div className="relative flex-none">
                <GameCover
                  url={entry.coverUrl}
                  className={cn(
                    'afterplay-most-played-cover h-16 w-12 overflow-hidden rounded-[7px] border border-border',
                    '[transition:transform_280ms_cubic-bezier(0.22,1,0.36,1),border-color_180ms_ease,box-shadow_220ms_ease]',
                    '[.afterplay-most-played-row:is(:hover,:focus-visible)_&]:border-[rgba(216,180,91,0.44)]',
                    '[.afterplay-most-played-row:is(:hover,:focus-visible)_&]:[box-shadow:0_10px_24px_rgba(0,0,0,0.36)]',
                    '[.afterplay-most-played-row:is(:hover,:focus-visible)_&]:[transform:scale(1.045)_rotate(-0.8deg)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                  iconSize={19}
                />
                <span className="absolute -top-1.5 -left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-[#101211] bg-[#d8b45b] px-1 text-[11px] font-black text-[#141108]">
                  {index + 1}
                </span>
              </div>
              {/* La barra ES la fila (estilo recap de Steam): una pista a lo
                  ancho con el relleno dorado proporcional DETRÁS del título
                  y las horas — así no existe el hueco muerto entre nombre y
                  barra que dejaba cualquier reparto en columnas. Misma altura
                  que la carátula, para que las dos casen en la fila. */}
              <div
                className={cn(
                  'afterplay-most-played-track relative h-16 flex-1 overflow-hidden rounded-[9px] bg-white/[0.03]',
                  '[transition:background-color_180ms_ease,box-shadow_220ms_ease]',
                  '[.afterplay-most-played-row:is(:hover,:focus-visible)_&]:bg-white/[0.052]',
                  '[.afterplay-most-played-row:is(:hover,:focus-visible)_&]:[box-shadow:inset_0_0_0_1px_rgba(216,180,91,0.12)]',
                )}
              >
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
                  <div className="flex flex-none items-center gap-2">
                    <span className="text-[12.5px] font-bold tabular-nums" style={{ color: AMBER }}>
                      {formatHours(entry.hours)}
                    </span>
                    <ArrowUpRight
                      size={13}
                      className="text-white/20 transition-[transform,color] group-hover/played:-translate-y-0.5 group-hover/played:translate-x-0.5 group-hover/played:text-[#d8b45b]"
                    />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </StatCard>
  );
};
