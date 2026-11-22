import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  ListPlus,
  Pin,
  PinOff,
  Plus,
  Search,
  Star,
  Telescope,
  TriangleAlert,
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
import { Figure } from '../components/Figure';
import { PageHeader, SectionTitle } from '../components/PageHeader';
import { AddGameSheet } from '../components/plan/AddGameSheet';
import { useReorderTrail } from '../components/plan/useReorderTrail';
import { GlowText } from '../components/fx/GlowText';
import { loopPlayClass } from '../components/fx/motion';
import { useOffscreenPause } from '../components/fx/viewport';
import { EmptyState, ErrorState, Loading, StateMessage } from '../components/States';
import { cn } from '../lib/cn';
import { formatHours, formatRelease, pluralize } from '../lib/format';
import { bestRating } from '../lib/ratings';
import { countdownLabel, isUnreleased, releaseCountdown, releaseSortKey } from '../lib/releaseDate';
import {
  fieldClass,
  ghostButtonClass,
  iconButtonClass,
  primaryButtonClass,
  revealClass,
  revealDelay,
} from '../lib/styles';

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

// La línea de datos de un planeado: lanzamiento, nota y cuenta atrás.
const PlanMeta = ({ game }: { game: PlannedGame }): React.JSX.Element | null => {
  const rating = bestRating(game);
  const release = formatRelease(game);
  const countdown = releaseCountdown(game);
  if (!release && rating === null && !countdown) return null;

  const quiet = countdown?.kind === 'soon' && !countdown.imminent;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-small text-dust tabular-nums">
      {release && <span>{release}</span>}
      {rating !== null && (
        <span className="inline-flex items-center gap-1">
          <Star size={12} aria-hidden="true" />
          {rating}
        </span>
      )}
      {countdown && (
        <span
          className={cn(
            'rounded-xs px-1.5 text-micro font-semibold',
            quiet ? 'bg-bone/6 text-dust' : 'bg-success/12 text-success',
          )}
        >
          {countdownLabel(countdown)}
        </span>
      )}
    </div>
  );
};

const PlanRow = ({
  game,
  order,
  position,
  onPin,
  onUnpin,
  reorder,
  moved = false,
}: {
  game: PlannedGame;
  order: number;
  // Su puesto en el Up next, que se pinta en grande delante de la carátula.
  position?: number;
  onPin: (game: PlannedGame) => void;
  onUnpin: (game: PlannedGame) => void;
  // En modo reordenar, el pin se cambia por las flechas: en un móvil, arrastrar
  // dentro de una lista que además scrollea es un gesto que falla más de lo que
  // acierta, y aquí el orden importa demasiado para dejarlo a la suerte.
  reorder?: { onUp: () => void; onDown: () => void; isFirst: boolean; isLast: boolean };
  // La última fila que se movió con las flechas: deja estela al llegar.
  moved?: boolean;
}): React.JSX.Element => {
  const pinned = game.pinnedAt !== null;
  const { rowRef, trailRef } = useReorderTrail(position, reorder !== undefined, moved);

  return (
    <li
      ref={rowRef}
      className={cn(revealClass, 'relative flex items-center gap-2 border-b border-line py-2')}
      style={revealDelay(order, 25, 15)}
    >
      <span
        ref={trailRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 opacity-0"
      />
      {/* El cuerpo entra en la ficha; los controles NO — un botón dentro de un
          Link se lleva el toque al navegar. */}
      <Link
        to={`/game/${game.id}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
      >
        {position !== undefined && (
          <span className="w-6 shrink-0 text-center font-display text-[28px] leading-none font-bold text-dust">
            {position}
          </span>
        )}
        <Cover url={game.coverUrl} title={game.title} className="w-10" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-body font-semibold text-bone">{game.title}</div>
          <PlanMeta game={game} />
        </div>
        {game.hltbMain !== null && game.hltbMain > 0 && (
          <Figure
            value={formatHours(game.hltbMain)}
            className="shrink-0 text-[24px] leading-none text-bone"
          />
        )}
      </Link>

      {reorder ? (
        <div className="flex shrink-0">
          <button
            type="button"
            onClick={reorder.onUp}
            disabled={reorder.isFirst}
            aria-label={`Move ${game.title} up`}
            className={iconButtonClass}
          >
            <ChevronUp size={18} />
          </button>
          <button
            type="button"
            onClick={reorder.onDown}
            disabled={reorder.isLast}
            aria-label={`Move ${game.title} down`}
            className={iconButtonClass}
          >
            <ChevronDown size={18} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (pinned ? onUnpin(game) : onPin(game))}
          aria-label={pinned ? `Unpin ${game.title}` : `Pin ${game.title} to Up next`}
          aria-pressed={pinned}
          className={cn(iconButtonClass, '-mr-2', pinned && 'text-phosphor')}
        >
          {pinned ? <PinOff size={17} /> : <Pin size={17} />}
        </button>
      )}
    </li>
  );
};

// El primero del Up next, en grande: "lo siguiente que vas a jugar".
const NextUpCard = ({
  game,
  onUnpin,
}: {
  game: PlannedGame;
  onUnpin: (game: PlannedGame) => void;
}): React.JSX.Element => {
  const { observe, playState } = useOffscreenPause();
  return (
    <div
      ref={observe}
      className={cn(
        revealClass,
        'relative flex gap-4 overflow-hidden rounded-md border border-line-strong bg-panel p-3',
        'shadow-[inset_2px_0_0_var(--color-phosphor),0_0_24px_-10px_rgb(255_179_71/0.45)]',
      )}
    >
      {/* El brillo del Next up: un reflejo que cruza la tarjeta cada pocos
        segundos (transform) y se para fuera de la vista. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-1/3',
          'bg-[linear-gradient(90deg,transparent,rgb(255_214_150/0.09)_45%,rgb(255_214_150/0.14)_50%,rgb(255_214_150/0.09)_55%,transparent)]',
          'animate-[fx-shine_7s_var(--ease-in-out)_1.2s_infinite_both] motion-reduce:hidden',
          loopPlayClass,
        )}
        style={{ animationPlayState: playState }}
      />
      <Link to={`/game/${game.id}`} className="relative shrink-0" tabIndex={-1} aria-hidden="true">
        <Cover url={game.coverUrl} title={game.title} className="w-20 shadow-lift" />
      </Link>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <GlowText className="text-small font-semibold text-phosphor">Next up</GlowText>
        <Link
          to={`/game/${game.id}`}
          className="mt-0.5 rounded-sm font-display text-title font-bold text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
        >
          {game.title}
        </Link>
        <PlanMeta game={game} />
        {game.hltbMain !== null && game.hltbMain > 0 && (
          <span className="mt-0.5 text-small text-dust">
            HLTB Main {formatHours(game.hltbMain)}
          </span>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Link to={`/game/${game.id}`} className={cn(primaryButtonClass, 'flex-1')}>
            Open game
          </Link>
          <button
            type="button"
            onClick={() => onUnpin(game)}
            aria-label={`Unpin ${game.title}`}
            className={cn(iconButtonClass, 'text-phosphor')}
          >
            <PinOff size={17} />
          </button>
        </div>
      </div>
    </div>
  );
};

const Collapsible = ({
  label,
  Icon,
  count,
  open,
  onToggle,
  whisper,
  children,
}: {
  label: string;
  Icon: typeof Pin;
  count: number;
  open: boolean;
  onToggle: () => void;
  whisper?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element => (
  <section>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-h-11 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor"
    >
      <Icon size={16} className="shrink-0 text-dust" aria-hidden="true" />
      <span className="text-lead font-semibold text-bone">{label}</span>
      <span className="text-small text-dust tabular-nums">{count}</span>
      {!open && whisper}
      <ChevronDown
        size={18}
        aria-hidden="true"
        className={cn(
          'ml-auto shrink-0 text-dust transition-transform duration-200 motion-reduce:transition-none',
          open && 'rotate-180',
        )}
      />
    </button>
    {open && children}
  </section>
);

export const PlanScreen = (): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const [horizonOpen, setHorizonOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [adding, setAdding] = useState(false);
  // La fila que se acaba de mover con las flechas (deja estela al llegar).
  const [movedId, setMovedId] = useState<string | null>(null);

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

  const addButton = (
    <button
      type="button"
      onClick={() => setAdding(true)}
      aria-label="Add a game to your plan"
      className={cn(iconButtonClass, '-mr-3 text-phosphor')}
    >
      <Plus size={22} />
    </button>
  );

  const header = (
    <PageHeader
      title="Plan"
      aside={
        <>
          {plan.data && plan.data.length > 0 && (
            <span>
              {pluralize(debt.totalGames, 'game')} · about {formatHours(debt.totalHours)}
            </span>
          )}
          {addButton}
        </>
      }
    />
  );

  if (plan.isPending)
    return (
      <div className="px-4">
        {header}
        <Loading label="Reading your plan" />
      </div>
    );
  if (plan.isError)
    return (
      <div className="px-4">
        {header}
        <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
        {adding && <AddGameSheet onClose={() => setAdding(false)} />}
      </div>
    );

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
    setMovedId(gameId);
    // Todo el orden en UNA petición, no N pines sueltos: es un solo gesto, y
    // partirlo permitiría aplicar la mitad y dejar un orden que nadie pidió.
    change.mutate({ type: 'reorder', orderedIds: ids });
  };

  const pin = (game: PlannedGame): void => change.mutate({ type: 'pin', gameId: game.id });
  const unpin = (game: PlannedGame): void => change.mutate({ type: 'unpin', gameId: game.id });

  // Sin búsqueda ni reordenar, el primero del Up next se presenta en grande.
  const showNextUp = !reordering && query.trim() === '' && upNext.length > 0;
  const upNextRows = showNextUp ? upNext.slice(1) : upNext;

  return (
    <div className="px-4 pb-6">
      {header}

      {/* Un pin/unpin/reorden que el hub no pudo aplicar. Sin esto el fallo
          sería TOTALMENTE mudo: lo que se ve sale del servidor, así que una
          petición rechazada no produce ningún cambio en pantalla. */}
      {change.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2.5 rounded-md border border-live/40 bg-live/8 py-1 pl-3"
        >
          <TriangleAlert size={16} className="mt-2.5 shrink-0 text-live" aria-hidden="true" />
          <span className="min-w-0 flex-1 py-2 text-small text-bone">
            {change.error instanceof ApiFailure
              ? change.error.message
              : "Couldn't save that change. Try again."}
          </span>
          <button
            type="button"
            onClick={() => change.reset()}
            aria-label="Dismiss"
            className={iconButtonClass}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {plan.data.length === 0 ? (
        <StateMessage
          Icon={ListPlus}
          title="Nothing planned yet"
          hint="Add the games you want to play next. Your PC fills in the times when it syncs."
          action={
            <button type="button" onClick={() => setAdding(true)} className={primaryButtonClass}>
              <Plus size={18} />
              Add a game
            </button>
          }
        />
      ) : (
        <>
          <div className="relative mb-4">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dust"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your plan"
              aria-label="Search your plan"
              type="search"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className={cn(fieldClass, 'pr-11 pl-9 [&::-webkit-search-cancel-button]:hidden')}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className={cn(iconButtonClass, 'absolute top-0 right-0')}
              >
                <X size={16} />
              </button>
            )}
          </div>

          {total === 0 ? (
            <EmptyState>Nothing matches “{query}”.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {showNextUp && <NextUpCard game={upNext[0]} onUnpin={unpin} />}

              {(upNextRows.length > 0 || reordering) && (
                <section>
                  <SectionTitle
                    className="mb-0"
                    aside={
                      upNext.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setReordering((previous) => !previous)}
                          className={cn(ghostButtonClass, '-mr-3 -mb-2 px-3 text-phosphor')}
                        >
                          {reordering ? 'Done' : 'Reorder'}
                        </button>
                      )
                    }
                  >
                    {showNextUp ? 'Then' : 'Up next'}
                  </SectionTitle>
                  {reordering && (
                    <p className="text-small text-dust">Move games with the arrows.</p>
                  )}
                  <ul className="mt-1 border-t border-line">
                    {upNextRows.map((game, index) => (
                      <PlanRow
                        key={game.id}
                        game={game}
                        order={index}
                        position={index + (showNextUp ? 2 : 1)}
                        onPin={pin}
                        onUnpin={unpin}
                        moved={game.id === movedId}
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
                                // VIEJA y repetía la primera orden.
                                isFirst: upNextAll[0]?.id === game.id || change.isPending,
                                isLast:
                                  upNextAll[upNextAll.length - 1]?.id === game.id ||
                                  change.isPending,
                              }
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                </section>
              )}

              {queue.length > 0 && (
                <section>
                  <SectionTitle className="mb-0" aside={pluralize(queue.length, 'game')}>
                    The queue
                  </SectionTitle>
                  <ul className="mt-1 border-t border-line">
                    {queue.map((game, index) => (
                      <PlanRow
                        key={game.id}
                        game={game}
                        order={index}
                        onPin={pin}
                        onUnpin={unpin}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {horizon.length > 0 && (
                <Collapsible
                  label="On the horizon"
                  Icon={Telescope}
                  count={horizon.length}
                  open={horizonOpen}
                  onToggle={() => setHorizonOpen((previous) => !previous)}
                  whisper={
                    headline && (
                      <span className="min-w-0 text-small text-success">
                        {headline.title} · {headline.label}
                      </span>
                    )
                  }
                >
                  <ul className="border-t border-line">
                    {horizon.map((game, index) => (
                      <PlanRow
                        key={game.id}
                        game={game}
                        order={index}
                        onPin={pin}
                        onUnpin={unpin}
                      />
                    ))}
                  </ul>
                </Collapsible>
              )}
            </div>
          )}
        </>
      )}

      {adding && <AddGameSheet onClose={() => setAdding(false)} />}
    </div>
  );
};
