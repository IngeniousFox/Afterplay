import { Gamepad2 } from 'lucide-react';
import { useImageSrc } from '../../hooks/useImageSrc';
import { formatHours } from '../../lib/format';
import type { PlayedEntry } from './MostPlayedList';

type TopPlayedListProps = { entries: PlayedEntry[] };

const MAX_ENTRIES = 5;

const Cover = ({ url }: { url: string | null }): React.JSX.Element => {
  const src = useImageSrc(url, 'covers');
  return (
    <div className="h-9.5 w-7 flex-none overflow-hidden rounded-[6px] border border-border">
      {src ? (
        <img src={src} loading="lazy" alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Gamepad2 size={12} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};

// SPEC 10.7 / prototipo — ranking numerado top 5, sin barra (a diferencia de
// Most Played), solo puesto + carátula + título + horas.
export const TopPlayedList = ({ entries }: TopPlayedListProps): React.JSX.Element => {
  const top = [...entries].sort((a, b) => b.hours - a.hours).slice(0, MAX_ENTRIES);

  return (
    <div className="rounded-[14px] border border-border bg-card px-5.5 py-5">
      <div className="mb-4 text-[14px] font-bold text-foreground">Top Played</div>
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
              <Cover url={entry.coverUrl} />
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
    </div>
  );
};
