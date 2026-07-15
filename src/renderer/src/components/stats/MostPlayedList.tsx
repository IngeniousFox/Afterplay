import { Gamepad2 } from 'lucide-react';
import { useImageSrc } from '../../hooks/useImageSrc';
import { formatHours } from '../../lib/format';

export type PlayedEntry = { id: number; title: string; coverUrl: string | null; hours: number };

type MostPlayedListProps = { entries: PlayedEntry[] };

const MAX_ENTRIES = 6;

const Cover = ({ url }: { url: string | null }): React.JSX.Element => {
  const src = useImageSrc(url, 'covers');
  return (
    <div className="h-10 w-7.5 flex-none overflow-hidden rounded-[6px] border border-border">
      {src ? (
        <img src={src} loading="lazy" alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Gamepad2 size={13} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};

// SPEC 10.7 / prototipo — top 6 por horas, barra proporcional al más jugado
// de la lista (no al total de la biblioteca). Fuera los juegos con 0h en la
// ventana activa: con un año concreto seleccionado, `entries` trae TODOS los
// juegos de la biblioteca (para que Genre Radar pueda sumar sobre el mismo
// conjunto), incluidos los que se añadieron después de ese año — sin este
// filtro, rellenaban hasta 6 huecos con juegos que ese año ni existían aún.
export const MostPlayedList = ({ entries }: MostPlayedListProps): React.JSX.Element => {
  const top = entries
    .filter((entry) => entry.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, MAX_ENTRIES);
  const maxHours = Math.max(1, ...top.map((entry) => entry.hours));

  return (
    <div className="rounded-[14px] border border-border bg-card px-5.5 py-5">
      <div className="mb-4.5 text-[14px] font-bold text-foreground">Most Played</div>
      {top.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing tracked yet.</p>
      ) : (
        <div className="flex flex-col gap-3.75">
          {top.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3.25">
              <Cover url={entry.coverUrl} />
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
    </div>
  );
};
