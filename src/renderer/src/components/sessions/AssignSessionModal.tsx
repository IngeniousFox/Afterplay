import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import type { PendingSession } from '../../../../shared/types';
import { useGames } from '../../hooks/games';
import { useAssignSession } from '../../hooks/sessions';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision, formatElapsed } from '../../lib/format';
import { filterByTitle } from '../../lib/search';
import { accentGradientStyle } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { ModalShell } from '../ui/modal-shell';

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

  const emulatedGames = games.filter((game) => game.isEmulated);
  const filtered = filterByTitle(emulatedGames, search);

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

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Assign session"
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
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border py-10 text-center">
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
            className="mt-1 flex items-center gap-1.75 rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold"
            style={accentGradientStyle}
          >
            <Plus size={14} />
            Add new game
          </button>
        </div>
      ) : (
        <>
          <div className="relative mb-3">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.75 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search emulated games…"
              autoFocus
              className="w-full rounded-[9px] border border-input bg-white/[0.03] py-2.25 pr-3 pl-8.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            {filtered.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => handleAssign(game.id)}
                disabled={assignSession.isPending}
                className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-white/[0.04] disabled:opacity-60"
              >
                <GameCover
                  url={game.coverUrl}
                  className="h-12 w-9 flex-none overflow-hidden rounded-[6px] border border-border"
                  iconSize={14}
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
                  {game.title}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">
                No emulated games match &quot;{search}&quot;.
              </p>
            )}

            <button
              type="button"
              onClick={onAddNewGame}
              className="mt-1.5 flex items-center gap-3 rounded-[10px] border border-dashed border-border px-2.5 py-2.5 text-left text-[13px] font-semibold text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            >
              <span className="flex h-12 w-9 flex-none items-center justify-center rounded-[6px] border border-dashed border-border">
                <Plus size={15} />
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
