import { Check, LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../shell/cn';
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
import { StatusLed } from '../library/statusLed';
import { focusRingInset, textLinkClass } from '../shell/controls';

// EL PANEL DE FILTROS DE LIBRARY (Fósforo, library.png): una columna fija a la
// izquierda de la rejilla, siempre a la vista. Estados con su LED y su
// recuento, las banderas, horas, década y género, y el orden.
//
// Semántica de siempre (lib/gameFilters): OR dentro de cada grupo, AND entre
// grupos; géneros y banderas en AND. El orden es de selección única. Todas
// las filas son botones con aria-pressed: se recorren con Tab y se activan
// con Enter o Espacio.

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
// Los géneros que se ven sin desplegar: una biblioteca variada pasa de veinte.
const GENRES_FOLDED = 8;

const toggle = <T,>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((current) => current !== value) : [...values, value];

const rowClass = cn(
  'relative flex h-8.5 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-body text-dust transition-colors duration-150',
  'hover:bg-raised hover:text-bone disabled:pointer-events-none disabled:opacity-40',
  'aria-pressed:bg-raised aria-pressed:text-bone',
  focusRingInset,
);

// La barra Phosphor de 2 px de la fila activa.
const ActiveEdge = (): React.JSX.Element => (
  <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-phosphor" />
);

const Count = ({ value }: { value: number }): React.JSX.Element => (
  <span className="ml-auto flex-none text-small text-dust tabular-nums">{value}</span>
);

const Group = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element => (
  <div role="group" aria-label={label} className="mt-5 first:mt-0">
    <div className="mb-1 px-2.5 text-small font-semibold text-dust">{label}</div>
    <div className="flex flex-col gap-px">{children}</div>
  </div>
);

const Box = ({
  checked,
  round = false,
}: {
  checked: boolean;
  round?: boolean;
}): React.JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'flex size-4 flex-none items-center justify-center border',
      round ? 'rounded-full' : 'rounded-xs',
      checked ? 'border-phosphor bg-phosphor text-ink' : 'border-edge',
    )}
  >
    {checked &&
      (round ? (
        <span className="size-1.5 rounded-full bg-ink" />
      ) : (
        <Check size={11} strokeWidth={3} />
      ))}
  </span>
);

const CheckRow = ({
  checked,
  onClick,
  disabled,
  round,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  round?: boolean;
  children: React.ReactNode;
}): React.JSX.Element => (
  <button
    type="button"
    aria-pressed={checked}
    onClick={onClick}
    disabled={disabled}
    className={rowClass}
  >
    <Box checked={checked} round={round} />
    <span className="min-w-0">{children}</span>
  </button>
);

type Props = {
  filters: GameFilters;
  onChange: (filters: GameFilters) => void;
  groups: FilterGroup[];
  flags: FlagKey[];
  sorts: SortKey[];
  genres: string[];
  // Recuento por estado con el resto de filtros y la búsqueda ya aplicados.
  statusCounts: Record<StatusKey, number>;
  // Cuántos se ven y cuántos hay: "Showing 12 of 331".
  shown: number;
  total: number;
  // Biblioteca vacía: el panel está, a cero y atenuado.
  disabled?: boolean;
};

export const GameFilterPanel = ({
  filters,
  onChange,
  groups,
  flags,
  sorts,
  genres,
  statusCounts,
  shown,
  total,
  disabled = false,
}: Props): React.JSX.Element => {
  const [allGenres, setAllGenres] = useState(false);
  const activeCount = countActiveFilters(filters);
  const has = (group: FilterGroup): boolean => groups.includes(group);
  const set = <K extends keyof GameFilters>(key: K, value: GameFilters[K]): void =>
    onChange({ ...filters, [key]: value });
  const statusTotal = STATUS_ORDER.reduce((sum, status) => sum + statusCounts[status], 0);
  // Los géneros marcados se ven siempre, aunque el grupo esté plegado.
  const visibleGenres = allGenres
    ? genres
    : [
        ...genres.slice(0, GENRES_FOLDED),
        ...filters.genres.filter((genre) => genres.indexOf(genre) >= GENRES_FOLDED),
      ];

  return (
    <aside
      aria-label="Filters"
      className="flex w-58 flex-none flex-col overflow-y-auto border-r border-line bg-cabinet px-3.5 pt-5 pb-6"
    >
      {has('status') && (
        <Group label="Status">
          <button
            type="button"
            aria-pressed={filters.statuses.length === 0}
            onClick={() => set('statuses', [])}
            disabled={disabled}
            className={cn(rowClass, 'font-semibold')}
          >
            {filters.statuses.length === 0 && <ActiveEdge />}
            <LayoutGrid aria-hidden size={15} className="flex-none" />
            All games
            <Count value={statusTotal} />
          </button>
          {STATUS_ORDER.map((status) => {
            const active = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => set('statuses', toggle(filters.statuses, status))}
                disabled={disabled}
                className={rowClass}
              >
                {active && <ActiveEdge />}
                <StatusLed status={status} className={cn(!active && 'opacity-80')} />
                {STATUS_META[status].label}
                <Count value={statusCounts[status]} />
              </button>
            );
          })}
        </Group>
      )}

      {has('flags') && flags.length > 0 && (
        <Group label="Kind">
          {flags.map((flag) => (
            <CheckRow
              key={flag}
              checked={filters.flags.includes(flag)}
              onClick={() => set('flags', toggle(filters.flags, flag))}
              disabled={disabled}
            >
              {FLAG_LABELS[flag]}
            </CheckRow>
          ))}
        </Group>
      )}

      {has('playtime') && (
        <Group label="Time played">
          {PLAYTIME_ORDER.map((bucket) => (
            <CheckRow
              key={bucket}
              checked={filters.playtime.includes(bucket)}
              onClick={() => set('playtime', toggle(filters.playtime, bucket))}
              disabled={disabled}
            >
              {PLAYTIME_LABELS[bucket]}
            </CheckRow>
          ))}
        </Group>
      )}

      {has('era') && (
        <Group label="Released">
          {ERA_ORDER.map((era) => (
            <CheckRow
              key={era}
              checked={filters.eras.includes(era)}
              onClick={() => set('eras', toggle(filters.eras, era))}
              disabled={disabled}
            >
              {ERA_LABELS[era]}
            </CheckRow>
          ))}
        </Group>
      )}

      {/* Solo los géneros que existen en esta biblioteca (availableGenres). */}
      {has('genre') && genres.length > 0 && (
        <Group label="Genre">
          {visibleGenres.map((genre) => (
            <CheckRow
              key={genre}
              checked={filters.genres.includes(genre)}
              onClick={() => set('genres', toggle(filters.genres, genre))}
              disabled={disabled}
            >
              {genre}
            </CheckRow>
          ))}
          {genres.length > GENRES_FOLDED && (
            <button
              type="button"
              onClick={() => setAllGenres(!allGenres)}
              aria-expanded={allGenres}
              className={cn(textLinkClass, 'mt-1 self-start px-2.5')}
            >
              {allGenres ? 'Show fewer' : `Show all ${genres.length}`}
            </button>
          )}
        </Group>
      )}

      <Group label="Order">
        {sorts.map((sort) => (
          <CheckRow
            key={sort}
            round
            checked={filters.sort === sort}
            onClick={() => set('sort', sort)}
            disabled={disabled}
          >
            {SORT_LABELS[sort]}
          </CheckRow>
        ))}
      </Group>

      {activeCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line px-2.5 pt-4 text-small text-dust">
          <span className="tabular-nums">
            Showing {shown} of {total}
          </span>
          <button
            type="button"
            onClick={() =>
              onChange({ ...filters, statuses: [], genres: [], playtime: [], eras: [], flags: [] })
            }
            className={textLinkClass}
          >
            Clear filters
          </button>
        </div>
      )}
    </aside>
  );
};
