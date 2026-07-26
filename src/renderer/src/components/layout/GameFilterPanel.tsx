import { ArrowUpDown, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import {
  countActiveFilters,
  ERA_LABELS,
  FLAG_LABELS,
  PLAYTIME_LABELS,
  SORT_LABELS,
  type EraBucket,
  type FilterGroup,
  type FlagKey,
  type GameFilters,
  type PlaytimeBucket,
  type SortKey,
} from '../../lib/gameFilters';
import { STATUS_META, type StatusKey } from '../../lib/gameStatus';
import { expandClass } from '../../lib/styles';
import { StatusIcon } from '../StatusIcon';

// Panel de filtros de las columnas de navegación. Va PLEGADO por defecto y
// detrás de un botón: la columna mide 312px y su trabajo principal es
// enseñar la lista — un panel siempre desplegado se comería la mitad del
// alto útil para algo que no se usa en la mayoría de visitas.

const STATUS_ORDER: StatusKey[] = [
  'playing',
  'on_hold',
  'resting',
  'beaten',
  'dropped',
  'unplayed',
];
const PLAYTIME_ORDER: PlaytimeBucket[] = ['none', 'short', 'medium', 'long'];
const ERA_ORDER: EraBucket[] = ['now', 'tens', 'aughts', 'retro'];

// Alterna un valor dentro de un grupo. Todos los grupos son multi-selección:
// que marcar "Beaten" desmarcase "Playing" obligaría a mirar dos veces para
// una pregunta tan normal como "¿qué he jugado y qué he dejado?".
const toggle = <T,>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((current) => current !== value) : [...values, value];

const Chip = ({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1.25 rounded-[7px] border px-1.75 py-1 text-[10.5px] font-semibold transition-colors duration-150 ${
      active
        ? 'text-foreground'
        : 'border-input text-muted-foreground hover:border-primary/45 hover:text-foreground'
    }`}
    // Cada estado tiñe su propio chip con SU color (el mismo de la fila y de
    // la ficha), así que el filtro se reconoce por color antes que por
    // texto. Los grupos sin color propio caen al verde de acento.
    style={
      active
        ? {
            borderColor: `${color ?? 'var(--primary)'}59`,
            background: `${color ?? 'var(--primary)'}1f`,
            color: color ?? 'var(--primary)',
          }
        : undefined
    }
  >
    {children}
  </button>
);

const Group = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element => (
  <div className="mt-2.5 first:mt-0">
    <div className="mb-1.25 text-[9px] font-bold tracking-[.12em] text-muted-foreground/70">
      {label}
    </div>
    <div className="flex flex-wrap gap-1">{children}</div>
  </div>
);

type Props = {
  filters: GameFilters;
  onChange: (filters: GameFilters) => void;
  // Qué grupos ofrece esta columna — ver FilterGroup en lib/gameFilters.
  groups: FilterGroup[];
  // Qué banderas y qué órdenes tienen sentido AQUÍ. En Plan to Play, por
  // ejemplo, "Playing now" o "Most played" no significan nada: esos juegos
  // no se han tocado por definición.
  flags: FlagKey[];
  sorts: SortKey[];
  genres: string[];
  // Para el "N de M" — sin él no hay forma de saber cuánto se está
  // escondiendo, que es justo lo que angustia de un filtro puesto.
  shown: number;
  total: number;
};

export const GameFilterPanel = ({
  filters,
  onChange,
  groups,
  flags,
  sorts,
  genres,
  shown,
  total,
}: Props): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(filters);
  const has = (group: FilterGroup): boolean => groups.includes(group);

  const set = <K extends keyof GameFilters>(key: K, value: GameFilters[K]): void =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex flex-1 items-center gap-1.5 rounded-[8px] border px-2.25 py-1.5 text-[11px] font-semibold transition-colors duration-150 ${
            activeCount > 0
              ? 'border-primary/45 bg-primary/10 text-primary'
              : 'border-input text-muted-foreground hover:border-primary/45 hover:text-foreground'
          }`}
        >
          <SlidersHorizontal size={12} className="flex-none" />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 text-[9.5px] font-bold tabular-nums">
              {activeCount}
            </span>
          )}
          {/* El recuento vive en el propio botón y no dentro del panel: con
              el panel cerrado sigue siendo la única pista de que la lista
              está recortada. */}
          {activeCount > 0 && (
            <span className="ml-auto text-[10px] font-normal tabular-nums opacity-80">
              {shown}/{total}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...filters, statuses: [], genres: [], playtime: [], eras: [], flags: [] })
            }
            title="Clear filters"
            className="flex-none rounded-[8px] border border-input p-1.5 text-muted-foreground transition-colors duration-150 hover:border-destructive/45 hover:text-destructive"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div
          className={`mt-1.5 rounded-[9px] border border-border bg-white/[0.02] p-2.5 ${expandClass}`}
        >
          {has('status') && (
            <Group label="STATUS">
              {STATUS_ORDER.map((status) => {
                const meta = STATUS_META[status];
                return (
                  <Chip
                    key={status}
                    active={filters.statuses.includes(status)}
                    color={meta.color}
                    onClick={() => set('statuses', toggle(filters.statuses, status))}
                  >
                    <StatusIcon meta={meta} size={10} />
                    {meta.label}
                  </Chip>
                );
              })}
            </Group>
          )}

          {has('flags') && flags.length > 0 && (
            <Group label="QUICK">
              {flags.map((flag) => (
                <Chip
                  key={flag}
                  active={filters.flags.includes(flag)}
                  onClick={() => set('flags', toggle(filters.flags, flag))}
                >
                  {FLAG_LABELS[flag]}
                </Chip>
              ))}
            </Group>
          )}

          {has('playtime') && (
            <Group label="PLAYTIME">
              {PLAYTIME_ORDER.map((bucket) => (
                <Chip
                  key={bucket}
                  active={filters.playtime.includes(bucket)}
                  onClick={() => set('playtime', toggle(filters.playtime, bucket))}
                >
                  {PLAYTIME_LABELS[bucket]}
                </Chip>
              ))}
            </Group>
          )}

          {has('era') && (
            <Group label="RELEASED">
              {ERA_ORDER.map((era) => (
                <Chip
                  key={era}
                  active={filters.eras.includes(era)}
                  onClick={() => set('eras', toggle(filters.eras, era))}
                >
                  {ERA_LABELS[era]}
                </Chip>
              ))}
            </Group>
          )}

          {/* Solo los géneros que existen en ESTA lista (ver
              availableGenres), y con scroll: una biblioteca variada pasa de
              veinte géneros y sin tope el panel se volvería la pantalla. */}
          {has('genre') && genres.length > 0 && (
            <Group label="GENRE">
              <div className="flex max-h-27 w-full flex-wrap gap-1 overflow-y-auto">
                {genres.map((genre) => (
                  <Chip
                    key={genre}
                    active={filters.genres.includes(genre)}
                    onClick={() => set('genres', toggle(filters.genres, genre))}
                  >
                    {genre}
                  </Chip>
                ))}
              </div>
            </Group>
          )}

          <Group label="SORT BY">
            {sorts.map((sort) => (
              <Chip
                key={sort}
                active={filters.sort === sort}
                // El orden es de selección ÚNICA (no toggle): una lista solo
                // puede estar ordenada de una manera, y volver a pulsar el
                // activo no debe dejarla sin orden.
                onClick={() => set('sort', sort)}
              >
                {filters.sort === sort && <ArrowUpDown size={9} />}
                {SORT_LABELS[sort]}
              </Chip>
            ))}
          </Group>
        </div>
      )}
    </div>
  );
};
