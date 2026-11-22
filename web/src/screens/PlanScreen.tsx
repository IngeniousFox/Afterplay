import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Pin,
  PinOff,
  Plus,
  Search,
  Star,
  Telescope,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  computePlanDebt,
  filterQueue,
  sortHorizon,
  sortUpNext,
} from '../../../src/shared/planShelves';
import type { PlanShelfReaders } from '../../../src/shared/planShelves';
import { ApiFailure, fetchPlan, pinGame, reorderPlan, unpinGame } from '../api';
import type { PlannedGame } from '../api';
import { Cover } from '../components/Cover';
import { AddGameSheet } from '../components/plan/AddGameSheet';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { formatHours, formatRelease, pluralize } from '../lib/format';
import { bestRating } from '../lib/ratings';
import { countdownLabel, isUnreleased, releaseCountdown, releaseSortKey } from '../lib/releaseDate';
import { AMBER, BLUE, GREEN, TEAL } from '../lib/status';

const PLAN = BLUE;

type PlanChange =
  { type: 'pin' | 'unpin'; gameId: string } | { type: 'reorder'; orderedIds: string[] };

// Cómo se lee un PlannedGame de la API para repartirlo en estanterías. El
// REPARTO lo decide src/shared/planShelves —la misma función que el escritorio—
// y esto es solo la traducción a la moneda de la PWA: milisegundos donde allí
// hay Date. Estaba copiado a mano aquí dentro, con la parte sutil del horizonte
// no excluyente incluida y sin nada que lo vigilara.
const READ: PlanShelfReaders<PlannedGame> = {
  pinnedAt: (game) => game.pinnedAt,
  title: (game) => game.title,
  unreleased: (game) => isUnreleased(game),
  releaseSortKey: (game) => releaseSortKey(game),
};

const PlanRow = ({
  game,
  order,
  onPin,
  onUnpin,
  reorder,
}: {
  game: PlannedGame;
  order: number;
  onPin: (game: PlannedGame) => void;
  onUnpin: (game: PlannedGame) => void;
  // En modo reordenar, el pin se cambia por las flechas: en un móvil, arrastrar
  // dentro de una lista que además scrollea es un gesto que falla más de lo que
  // acierta, y aquí el orden importa demasiado para dejarlo a la suerte.
  reorder?: { onUp: () => void; onDown: () => void; isFirst: boolean; isLast: boolean };
}): React.JSX.Element => {
  const rating = bestRating(game);
  const release = formatRelease(game);
  const countdown = releaseCountdown(game);

  const body = (
    <>
      <Cover url={game.coverUrl} title={game.title} className="w-11" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-bold">{game.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {release && (
            <span className="text-micro font-semibold text-muted-foreground tabular-nums">
              {release}
            </span>
          )}
          {game.hltbMain !== null && game.hltbMain > 0 && (
            <span
              className="flex items-center gap-1 text-micro font-semibold tabular-nums"
              style={{ color: TEAL }}
            >
              <Clock3 size={10} />
              {formatHours(game.hltbMain)}
            </span>
          )}
          {rating !== null && (
            <span className="flex items-center gap-1 text-micro font-bold tabular-nums">
              <Star size={10} className="text-muted-foreground" />
              {rating}
            </span>
          )}
          {countdown && (
            <span
              className="rounded-md px-1.5 py-0.25 text-micro font-extrabold tracking-wide"
              style={{
                color:
                  countdown.kind === 'soon' && !countdown.imminent
                    ? 'var(--muted-foreground)'
                    : GREEN,
                background:
                  countdown.kind === 'soon' && !countdown.imminent
                    ? 'rgba(233,228,216,.05)'
                    : `${GREEN}18`,
              }}
            >
              {countdownLabel(countdown)}
            </span>
          )}
        </div>
      </div>
    </>
  );

  const controlClass =
    'flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line-strong disabled:opacity-30';

  return (
    <div
      className="afterplay-reveal flex items-center gap-3 rounded-xl border border-border bg-card p-2"
      style={{ animationDelay: `${Math.min(order, 15) * 25}ms` }}
    >
      {/* El cuerpo entra en la ficha; los controles NO — un botón dentro de un
          Link se lleva el toque al navegar. */}
      <Link to={`/game/${game.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {body}
      </Link>

      {reorder ? (
        <div className="flex flex-none gap-1">
          <button
            type="button"
            onClick={reorder.onUp}
            disabled={reorder.isFirst}
            aria-label="Move up"
            className={controlClass}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            onClick={reorder.onDown}
            disabled={reorder.isLast}
            aria-label="Move down"
            className={controlClass}
          >
            <ChevronDown size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (game.pinnedAt !== null ? onUnpin(game) : onPin(game))}
          aria-label={game.pinnedAt !== null ? `Unpin ${game.title}` : `Pin ${game.title}`}
          className={controlClass}
          style={
            game.pinnedAt !== null
              ? { color: PLAN, borderColor: `${PLAN}4d`, background: `${PLAN}14` }
              : { color: 'var(--muted-foreground)' }
          }
        >
          {game.pinnedAt !== null ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      )}
    </div>
  );
};

const Collapsible = ({
  label,
  color,
  Icon,
  count,
  open,
  onToggle,
  whisper,
  action,
  children,
}: {
  label: string;
  color?: string;
  Icon: typeof Pin;
  count: number;
  open: boolean;
  onToggle: () => void;
  whisper?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element => (
  <section>
    <div className="mb-2.5 flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
      >
        <Icon
          size={11}
          style={color ? { color } : undefined}
          className={color ? '' : 'text-muted-foreground'}
        />
        <span
          className="text-micro font-bold tracking-[.13em] uppercase"
          style={{ color: color ?? 'var(--muted-foreground)' }}
        >
          {label}
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          {count}
        </span>
        {!open && whisper}
        <ChevronDown
          size={14}
          className="ml-auto flex-none text-muted-foreground transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && action}
    </div>
    {open && children}
  </section>
);

export const PlanScreen = (): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const [horizonOpen, setHorizonOpen] = useState(false);
  const [upNextOpen, setUpNextOpen] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [adding, setAdding] = useState(false);

  const queryClient = useQueryClient();
  const plan = useQuery({ queryKey: ['plan'], queryFn: fetchPlan });

  // Las escrituras son inmediatas (§13.3): cuando la petición vuelve, el cambio
  // está hecho en el hub. No hay estado "pendiente" ni capa optimista; se vuelve
  // a leer el plan y listo. La ficha del juego también cambia (su "Up next").
  const change = useMutation({
    mutationFn: async (op: PlanChange): Promise<void> => {
      if (op.type === 'reorder') await reorderPlan(op.orderedIds);
      else if (op.type === 'pin') await pinGame(op.gameId);
      else await unpinGame(op.gameId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
    },
  });

  const { upNext, upNextAll, queue, horizon, debt } = useMemo(() => {
    const all = plan.data ?? [];
    const needle = query.trim().toLowerCase();
    const games = needle ? all.filter((game) => game.title.toLowerCase().includes(needle)) : all;

    return {
      upNext: sortUpNext(games, READ),
      // El Up next COMPLETO, sin filtrar. Reordenar tiene que trabajar sobre
      // este y no sobre lo que se ve: con una búsqueda activa, mover una fila
      // reescribía el orden de solo los visibles y mandaba a los ocultos a
      // donde nadie había pedido.
      upNextAll: sortUpNext(all, READ),
      horizon: sortHorizon(games, READ),
      // Sin ordenar después: la cola se queda con el alfabético que ya trae
      // /plan. El escritorio le pasa aquí su lente, que la PWA no tiene.
      queue: filterQueue(games, READ),
      // La deuda se mide sobre el plan ENTERO, no sobre lo que deja ver la
      // búsqueda: es cuánto debes, no cuánto estás mirando.
      debt: computePlanDebt(all),
    };
  }, [plan.data, query]);

  if (plan.isPending) return <Loading label="Reading your plan" />;
  if (plan.isError) return <ErrorState error={plan.error} onRetry={() => plan.refetch()} />;

  const total = upNext.length + queue.length + horizon.length;

  const headline = ((): { title: string; label: string } | null => {
    for (const game of horizon) {
      const countdown = releaseCountdown(game);
      if (!countdown) continue;
      if (countdown.kind === 'soon' && !countdown.imminent) break;
      return { title: game.title, label: countdownLabel(countdown) };
    }
    return null;
  })();

  // Mover una fila. Las posiciones que llegan son las de la lista VISIBLE, así
  // que se traducen a la lista completa antes de tocar nada: si no, reordenar
  // con una búsqueda activa reescribía el orden de los tres visibles y dejaba
  // a los ocultos donde nadie los había puesto.
  const move = (gameId: string, direction: -1 | 1): void => {
    const ids = upNextAll.map((game) => game.id);
    const from = ids.indexOf(gameId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    // Todo el orden en UNA petición, no N pines sueltos: es un solo gesto, y
    // partirlo permitiría aplicar la mitad y dejar un orden que nadie pidió.
    change.mutate({ type: 'reorder', orderedIds: ids });
  };

  return (
    <div className="px-4 pt-4">
      <div className="mb-4 flex items-stretch gap-2.5">
        <div className="flex-1 rounded-xl border border-border bg-card px-3.5 py-3">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[19px] leading-none font-extrabold tabular-nums"
              style={{ color: AMBER }}
            >
              {formatHours(debt.totalHours)}
            </span>
            <span className="text-[11.5px] font-semibold text-muted-foreground">
              across {pluralize(debt.totalGames, 'game')}
            </span>
          </div>
          {debt.withoutEstimate > 0 && (
            <div className="mt-1 text-micro font-semibold text-muted-foreground/70 tabular-nums">
              {debt.withoutEstimate} without an estimate
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add a game to your plan"
          className="flex w-14 flex-none items-center justify-center rounded-xl border"
          style={{ borderColor: `${PLAN}4d`, background: `${PLAN}14`, color: PLAN }}
        >
          <Plus size={22} />
        </button>
      </div>

      {/* Un pin/unpin/reorden que el hub no pudo aplicar. Sin esto el fallo
          sería TOTALMENTE mudo: lo que se ve sale del servidor, así que una
          petición rechazada no produce ningún cambio en pantalla. */}
      {change.isError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3">
          <AlertTriangle size={14} className="mt-0.5 flex-none text-destructive" />
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {change.error instanceof ApiFailure
              ? change.error.message
              : "Couldn't save that change. Try again."}
          </span>
          <button
            type="button"
            onClick={() => change.reset()}
            aria-label="Dismiss"
            className="-mt-1 -mr-1 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-muted-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="relative mb-4">
        <Search
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your plan"
          type="search"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-9 text-[14px] font-semibold outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {total === 0 ? (
        <EmptyState>{query ? `Nothing matches “${query}”.` : 'Nothing planned yet.'}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {horizon.length > 0 && (
            <Collapsible
              label="On the horizon"
              Icon={Telescope}
              count={horizon.length}
              open={horizonOpen}
              onToggle={() => setHorizonOpen((previous) => !previous)}
              whisper={
                headline && (
                  <span className="truncate text-micro font-semibold" style={{ color: GREEN }}>
                    {headline.title} · {headline.label}
                  </span>
                )
              }
            >
              <div className="flex flex-col gap-2">
                {horizon.map((game, index) => (
                  <PlanRow
                    key={game.id}
                    game={game}
                    order={index}
                    onPin={(g) => change.mutate({ type: 'pin', gameId: g.id })}
                    onUnpin={(g) => change.mutate({ type: 'unpin', gameId: g.id })}
                  />
                ))}
              </div>
            </Collapsible>
          )}

          {upNext.length > 0 && (
            <Collapsible
              label="Up next"
              color={PLAN}
              Icon={Pin}
              count={upNext.length}
              open={upNextOpen}
              onToggle={() => setUpNextOpen((previous) => !previous)}
              action={
                upNext.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setReordering((previous) => !previous)}
                    className="flex-none rounded-lg border border-line-strong px-2.5 py-1 text-micro font-bold text-muted-foreground"
                  >
                    {reordering ? 'Done' : 'Reorder'}
                  </button>
                )
              }
            >
              <div className="flex flex-col gap-2">
                {upNext.map((game, index) => (
                  <PlanRow
                    key={game.id}
                    game={game}
                    order={index}
                    onPin={(g) => change.mutate({ type: 'pin', gameId: g.id })}
                    onUnpin={(g) => change.mutate({ type: 'unpin', gameId: g.id })}
                    reorder={
                      reordering
                        ? {
                            onUp: () => move(game.id, -1),
                            onDown: () => move(game.id, 1),
                            // Los topes se miden sobre la lista COMPLETA: con
                            // un filtro puesto, el primero que ves puede no
                            // ser el primero de verdad.
                            //
                            // Y las dos se apagan mientras hay una petición en
                            // vuelo: nada de esto es optimista, así que la
                            // lista no se mueve hasta que vuelve el servidor
                            // — y un segundo toque calculaba desde la lista
                            // VIEJA y repetía la primera orden. El usuario no
                            // veía moverse nada, que es justo lo que invita a
                            // seguir tocando.
                            isFirst: upNextAll[0]?.id === game.id || change.isPending,
                            isLast:
                              upNextAll[upNextAll.length - 1]?.id === game.id || change.isPending,
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </Collapsible>
          )}

          {queue.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-baseline justify-between">
                <h2 className="text-micro font-bold tracking-[.13em] text-muted-foreground uppercase">
                  The queue
                </h2>
                <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {pluralize(queue.length, 'game')}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {queue.map((game, index) => (
                  <PlanRow
                    key={game.id}
                    game={game}
                    order={index}
                    onPin={(g) => change.mutate({ type: 'pin', gameId: g.id })}
                    onUnpin={(g) => change.mutate({ type: 'unpin', gameId: g.id })}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {adding && <AddGameSheet onClose={() => setAdding(false)} />}
    </div>
  );
};
