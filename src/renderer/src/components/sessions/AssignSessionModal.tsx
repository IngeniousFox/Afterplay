import { ArrowRight, Link2, Plus, Search, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PendingSession } from '../../../../shared/types';
import { useGames } from '../../hooks/games';
import { useAssignSession } from '../../hooks/sessions';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision, formatHours, pluralize } from '../../lib/format';
import { filterByTitle } from '../../lib/search';
import { GameCover } from '../GameCover';
import { pressClass } from '../fx';
import { buttonSize, focusRing, kbdClass, primaryButtonClass } from '../shell/controls';
import { ModalShell } from '../ui/modal-shell';
import { BLUE } from '../../lib/colors';
import type { GameId } from '../../../../shared/entityIds';

// Igual que SearchStep: como mucho un par de chips de género, o la fila se
// convierte en un muro de píldoras.
const MAX_GENRES = 2;

type AssignSessionModalProps = {
  session: PendingSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // "+ Add new game" — la pantalla dueña abre el Add Game con isEmulated
  // premarcado y, al crearse, asigna esta sesión al juego nuevo.
  onAddNewGame: () => void;
};

// EMULADORES.md §6 — asignar una sesión pendiente a un juego. La lista solo
// ofrece juegos isEmulated (regla 3: un juego nativo no puede recibir una
// sesión de emulador; el backend lo vuelve a comprobar igualmente).
export const AssignSessionModal = ({
  session,
  open,
  onOpenChange,
  onAddNewGame,
}: AssignSessionModalProps): React.JSX.Element => {
  const { data: games = [] } = useGames();
  const assignSession = useAssignSession();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [search, setSearch] = useState('');
  // Fila resaltada por TECLADO — igual que SearchStep, separado del :hover del
  // ratón (CSS puro) para que el scrollIntoView no pelee con el scroll manual.
  const [highlighted, setHighlighted] = useState(-1);

  const emulatedGames = games.filter((game) => game.isEmulated);
  const filtered = filterByTitle(emulatedGames, search);

  // Cambiar la búsqueda descarta el resaltado (apuntaría a un juego que ya no
  // está en la lista filtrada) — ajuste durante el render, sin useEffect.
  const [seenSearch, setSeenSearch] = useState(search);
  if (search !== seenSearch) {
    setSeenSearch(search);
    setHighlighted(-1);
  }

  // Cerrar queda bloqueado mientras la asignación está en vuelo: si se cerrara
  // a medias, la sesión pendiente seguiría en la bandeja o no, según cuándo
  // volviera la mutation, y sin nada en pantalla que lo contara.
  const handleClose = (): void => {
    if (assignSession.isPending) return;
    setSearch('');
    assignSession.reset();
    onOpenChange(false);
  };

  const handleAssign = async (gameId: GameId): Promise<void> => {
    await assignSession.mutateAsync({ sessionId: session.id, gameId });
    setSearch('');
    onOpenChange(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (filtered.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => Math.min(filtered.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && highlighted >= 0) {
      event.preventDefault();
      void handleAssign(filtered[highlighted].id);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Assign session"
      icon={Link2}
      color={BLUE}
      widthClass="w-160 max-w-[calc(100vw-48px)]"
      maxHClass="max-h-[78vh]"
      bodyClassName="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      headerExtra={
        <div className="mt-0.5 text-small text-dust tabular-nums">
          {session.emulatorName} · {formatByPrecision(session.startedAt, 'datetime', timeFormat)}
          {session.durationSec !== null && ` · ${formatHours(session.durationSec / 3600)}`}
        </div>
      }
    >
      {emulatedGames.length === 0 ? (
        // EMULADORES.md §6 — estado vacío: sin ningún juego emulado en la
        // biblioteca, directo al crear (nada de una lista vacía confusa).
        <div className="flex animate-fade-in flex-col items-center gap-3 rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-tube/12">
            <Link2 aria-hidden size={19} className="text-tube" />
          </span>
          <p className="text-body font-semibold text-bone">
            No emulated games in your library yet.
          </p>
          <p className="max-w-80 text-small text-dust">
            Add the game you were playing — it&apos;ll be marked as emulated and this session will
            be assigned to it.
          </p>
          <button
            type="button"
            onClick={onAddNewGame}
            className={cn(primaryButtonClass, buttonSize.md, 'mt-1', pressClass)}
          >
            <Plus aria-hidden size={15} />
            Add new game
          </button>
        </div>
      ) : (
        <>
          {/* group + focus-within: el foco Phosphor envuelve también el icono
              de la lupa, no solo el campo. */}
          <div className="group/search relative mb-3">
            <Search
              aria-hidden
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dust transition-colors group-focus-within/search:text-phosphor"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search emulated games…"
              aria-label="Search emulated games"
              autoFocus
              className="h-10 w-full rounded-sm border border-edge bg-inset pr-3 pl-9.5 text-body text-bone outline-hidden transition-[border-color,box-shadow] duration-150 placeholder:text-dust focus:border-phosphor focus:shadow-focus-field"
            />
          </div>

          {filtered.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-0.5">
              <span className="text-small font-semibold text-dust tabular-nums">
                {pluralize(filtered.length, 'game')}
              </span>
              <span className="flex items-center gap-1 text-micro text-dust">
                <kbd className={kbdClass}>↑</kbd>
                <kbd className={kbdClass}>↓</kbd>
                to browse ·<kbd className={kbdClass}>Enter</kbd>
                to pick
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {filtered.map((game, index) => {
              const isHighlighted = index === highlighted;
              return (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => handleAssign(game.id)}
                  disabled={assignSession.isPending}
                  // block:'nearest' es idempotente (no hace nada si la fila ya
                  // se ve entera), así que vale llamarlo al pintar la resaltada.
                  ref={isHighlighted ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                  className={cn(
                    'group/row relative flex animate-fade-in items-center gap-3.5 overflow-hidden rounded-sm border p-2.5 text-left',
                    'transition-[border-color,background-color] duration-150 ease-out hover:border-phosphor/50 hover:bg-raised disabled:opacity-60',
                    focusRing,
                    isHighlighted ? 'border-phosphor/60 bg-raised' : 'border-line',
                    // Elegir el juego ES el Assign: la fila se hunde al pulsarla.
                    pressClass,
                    'active:scale-[.98]',
                  )}
                  style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}
                >
                  {/* La barra lateral de la fila elegida con el teclado. */}
                  {isHighlighted && (
                    <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-phosphor" />
                  )}
                  <GameCover
                    url={game.coverUrl}
                    className="h-20 w-15 flex-none overflow-hidden rounded-sm border border-line bg-raised"
                    iconSize={20}
                    imgClassName="scale-100 transition-transform duration-300 group-hover/row:scale-105 motion-reduce:transition-none"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-body font-semibold text-bone">{game.title}</span>
                      {game.releaseYear !== null && (
                        <span className="flex-none text-small text-dust tabular-nums">
                          {game.releaseYear}
                        </span>
                      )}
                    </div>

                    {game.genres && game.genres.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {game.genres.slice(0, MAX_GENRES).map((genre) => (
                          <span
                            key={genre}
                            className="rounded-sm border border-line-strong px-1.5 text-micro text-dust"
                          >
                            {genre}
                          </span>
                        ))}
                      </div>
                    )}

                    {game.totalHours > 0 && (
                      <div className="mt-1.5 text-small text-dust">
                        {formatHours(game.totalHours)} played
                        {game.sessionCount > 0 && ` · ${pluralize(game.sessionCount, 'session')}`}
                      </div>
                    )}
                  </div>

                  <ArrowRight
                    aria-hidden
                    size={16}
                    className={cn(
                      'flex-none transition-[transform,scale,color] duration-150 group-hover/row:translate-x-0.5 group-hover/row:text-phosphor motion-reduce:transition-none',
                      isHighlighted ? 'translate-x-0.5 text-phosphor' : 'text-dust',
                    )}
                  />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-1 py-3 text-small text-dust">
                No emulated games match &quot;{search}&quot;.
              </p>
            )}

            <button
              type="button"
              onClick={onAddNewGame}
              className={cn(
                'mt-0.5 flex items-center gap-3.5 rounded-sm border border-dashed border-line-strong p-2.5 text-left text-body font-semibold text-dust',
                'transition-[border-color,background-color,color] duration-150 ease-out hover:border-phosphor/50 hover:bg-raised hover:text-bone',
                focusRing,
              )}
            >
              <span className="flex h-20 w-15 flex-none items-center justify-center rounded-sm border border-dashed border-line-strong">
                <Plus aria-hidden size={18} />
              </span>
              Add new game…
            </button>
          </div>
        </>
      )}

      {assignSession.isError && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2.5 rounded-sm border border-live/40 bg-live/10 px-3.5 py-3 text-small text-bone"
        >
          <TriangleAlert aria-hidden size={16} className="mt-px flex-none text-live" />
          Couldn&apos;t assign the session — {assignSession.error.message}
        </div>
      )}
    </ModalShell>
  );
};
