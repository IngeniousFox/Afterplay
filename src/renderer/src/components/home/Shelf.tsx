import { cn } from '../shell/cn';
import type { StatusKey } from '../../lib/gameStatus';
import { GameCover } from '../GameCover';
import { StatusLed } from '../library/statusLed';
import { focusRing, textLinkClass } from '../shell/controls';
import { useFitCount } from './useFitCount';

// Una estantería de Home: título, recuento, un enlace "See all" y UNA fila de
// portadas (las que quepan). Cada portada es un botón con su título debajo.

export type ShelfItem = {
  key: string;
  title: string;
  coverUrl: string | null;
  status: StatusKey;
  // La línea bajo el título: horas, "HLTB 70h"...
  meta: string | null;
  // El número de la cola en Up next.
  rank?: number;
  onOpen: () => void;
};

const GAP = 16;

export const Shelf = ({
  title,
  sub,
  action,
  items,
  minWidth,
  empty,
}: {
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
  items: ShelfItem[];
  minWidth: number;
  empty?: React.ReactNode;
}): React.JSX.Element => {
  const { attach, count } = useFitCount(minWidth, GAP);
  const shown = items.slice(0, count);

  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-lead font-semibold text-bone">{title}</h2>
        {sub && <span className="text-small text-dust">{sub}</span>}
        <span className="flex-1" />
        {action && (
          <button type="button" onClick={action.onClick} className={textLinkClass}>
            {action.label}
          </button>
        )}
      </div>
      <div ref={attach}>
        {items.length === 0 ? (
          empty
        ) : (
          <ul
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` }}
          >
            {shown.map((item) => (
              <li key={item.key} className="min-w-0">
                <ShelfCover item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const ShelfCover = ({ item }: { item: ShelfItem }): React.JSX.Element => (
  <button
    type="button"
    onClick={item.onOpen}
    className={cn(
      'group block w-full rounded-sm text-left',
      focusRing,
      'focus-visible:outline-offset-3',
    )}
  >
    <span className="relative block aspect-3/4 overflow-hidden rounded-sm bg-raised ring-1 ring-line transition-[transform,box-shadow] duration-180 ease-out group-hover:-translate-y-0.5 group-hover:shadow-lift group-hover:ring-bone/30 motion-reduce:group-hover:translate-y-0">
      <GameCover
        url={item.coverUrl}
        className="h-full w-full"
        iconSize={24}
        imgClassName="transition-transform duration-180 ease-out group-hover:scale-104 motion-reduce:group-hover:scale-100"
      />
      {item.rank !== undefined && (
        <span className="absolute top-2 left-2 flex h-7 min-w-6 items-center justify-center rounded-xs border border-line-strong bg-cabinet/85 px-1.5 font-display text-figure font-bold text-bone">
          {item.rank}
        </span>
      )}
      <StatusLed
        status={item.status}
        className="absolute top-1.75 right-1.75 size-2.25 ring-2 ring-cabinet"
      />
    </span>
    <span className="mt-2 block text-small font-semibold text-bone">{item.title}</span>
    {item.meta && <span className="mt-0.5 block text-micro text-dust">{item.meta}</span>}
  </button>
);
