import { ArrowRight, Link2, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import type { PendingSession } from '../../../../shared/types';
import { useGames } from '../../hooks/games';
import { useAssignSession } from '../../hooks/sessions';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision, formatElapsed, formatHours } from '../../lib/format';
import { filterByTitle } from '../../lib/search';
import { accentGradientStyle, revealClass, revealStyle } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { ModalShell } from '../ui/modal-shell';

const BLUE = '#85a3d6';
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

  const handleClose = (): void => {
    if (assignSession.isPending) return;
    setSearch('');
    assignSession.reset();
    onOpenChange(false);
  };

  const handleAssign = async (gameId: number): Promise<void> => {
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
      widthClass="w-130"
      maxHClass="max-h-[70vh]"
      bodyClassName="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      headerExtra={
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
          {session.emulatorName} · {formatByPrecision(session.startedAt, 'datetime', timeFormat)}
          {session.durationSec !== null && ` · ${formatElapsed(session.durationSec)}`}
        </div>
      }
    >
      {emulatedGames.length === 0 ? (
        // EMULADORES.md §6 — estado vacío: sin ningún juego emulado en la
        // biblioteca, directo al crear (nada de una lista vacía confusa).
        <div
          className={`flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border py-10 text-center ${revealClass}`}
        >
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: `${BLUE}1a` }}
          >
            <Link2 size={18} style={{ color: BLUE }} />
          </div>
          <p className="text-[13px] font-semibold text-foreground">
            No emulated games in your library yet.
          </p>
          <p className="max-w-72 text-[12px] text-muted-foreground">
            Add the game you were playing — it&apos;ll be marked as emulated and this session will
            be assigned to it.
          </p>
          <button
            type="button"
            onClick={onAddNewGame}
            className="[will-change:transform] mt-1 flex items-center gap-1.75 rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(47,220,126,.32)]"
            style={accentGradientStyle}
          >
            <Plus size={14} />
            Add new game
          </button>
        </div>
      ) : (
        <>
          {/* group + focus-within: el brillo del foco envuelve también el
              icono de la lupa, no solo el campo — mismo patrón que SearchStep. */}
          <div className="group/search relative mb-2.5">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.75 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-primary"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search emulated games…"
              autoFocus
              className="w-full rounded-[9px] border border-input bg-white/[0.03] py-2.25 pr-3 pl-8.5 text-[13px] text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-primary/45 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(47,220,126,.12)]"
            />
          </div>

          {filtered.length > 0 && (
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold tracking-[.11em] text-muted-foreground">
                {filtered.length} {filtered.length === 1 ? 'GAME' : 'GAMES'}
              </span>
              <span className="text-[10.5px] text-muted-foreground/60">
                ↑ ↓ to browse · ↵ to pick
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
                  className={`group/row flex items-start gap-3.25 rounded-[11px] border p-2.75 text-left transition-[transform,border-color,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-white/[0.05] hover:shadow-[0_8px_20px_rgba(0,0,0,.35)] disabled:opacity-60 ${
                    isHighlighted
                      ? 'border-primary/45 bg-white/[0.06] shadow-[0_8px_20px_rgba(0,0,0,.35)]'
                      : 'border-transparent'
                  } ${revealClass}`}
                  style={revealStyle(Math.min(index, 6))}
                >
                  {/* Misma carátula grande (72×100) que los resultados de
                      SearchStep, con el mismo zoom suave al pasar el ratón. */}
                  <GameCover
                    url={game.coverUrl}
                    className="h-25 w-18 flex-none overflow-hidden rounded-[8px] border border-border bg-muted"
                    iconSize={22}
                    imgClassName="scale-100 transition-transform duration-300 group-hover/row:scale-108"
                  />

                  <div className="min-w-0 flex-1 py-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-bold text-foreground">
                        {game.title}
                      </span>
                      {game.releaseYear !== null && (
                        <span className="flex-none text-[12px] font-semibold text-muted-foreground/80 tabular-nums">
                          {game.releaseYear}
                        </span>
                      )}
                    </div>

                    {game.genres && game.genres.length > 0 && (
                      <div className="mt-1.25 flex flex-wrap items-center gap-1.25">
                        {game.genres.slice(0, MAX_GENRES).map((genre) => (
                          <span
                            key={genre}
                            className="rounded-md border border-input bg-white/[0.04] px-1.75 py-0.5 text-[10px] font-semibold text-muted-foreground"
                          >
                            {genre}
                          </span>
                        ))}
                      </div>
                    )}

                    {game.totalHours > 0 && (
                      <div className="mt-1.5 text-[11.5px] text-muted-foreground/75">
                        {formatHours(game.totalHours)} played
                        {game.sessionCount > 0 &&
                          ` · ${game.sessionCount} session${game.sessionCount === 1 ? '' : 's'}`}
                      </div>
                    )}
                  </div>

                  <ArrowRight
                    size={15}
                    className={`mt-1 flex-none transition-[transform,color] duration-150 group-hover/row:translate-x-0.75 group-hover/row:text-primary ${
                      isHighlighted ? 'translate-x-0.75 text-primary' : 'text-muted-foreground'
                    }`}
                  />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">
                No emulated games match &quot;{search}&quot;.
              </p>
            )}

            <button
              type="button"
              onClick={onAddNewGame}
              className="mt-0.5 flex items-center gap-3.25 rounded-[11px] border border-dashed border-border p-2.75 text-left text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-white/[0.04] hover:text-foreground"
            >
              <span className="flex h-25 w-18 flex-none items-center justify-center rounded-[8px] border border-dashed border-border">
                <Plus size={18} />
              </span>
              Add new game…
            </button>
          </div>
        </>
      )}

      {assignSession.isError && (
        <div className="mt-3 rounded-[10px] border border-destructive/40 bg-destructive/10 px-3.25 py-2.5 text-[12.5px] text-destructive">
          Couldn&apos;t assign the session — {assignSession.error.message}
        </div>
      )}
    </ModalShell>
  );
};
