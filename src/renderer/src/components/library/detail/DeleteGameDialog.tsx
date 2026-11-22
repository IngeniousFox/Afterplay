import { Trash2 } from 'lucide-react';
import { secondaryButtonClass } from '../../../lib/styles';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useDeleteGame } from '../../../hooks/games';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import { textInputClass, textInputFocusClass } from '../add-game/styles';

type DeleteGameDialogProps = {
  game: GameDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

// SPEC 10.6 / prototipo — 460px, icono rojo, pide escribir el nombre del
// juego para confirmar. Borra el juego entero (cascada a iterations/
// sessions/stateEvents/spendEvents vía ON DELETE CASCADE).
export const DeleteGameDialog = ({
  game,
  open,
  onOpenChange,
  onDeleted,
}: DeleteGameDialogProps): React.JSX.Element => {
  const [confirmText, setConfirmText] = useState('');
  const deleteGame = useDeleteGame();
  // Sin distinguir mayúsculas/minúsculas — pero símbolos y espacios sí
  // cuentan (toLowerCase() no los toca).
  const canDelete = confirmText.trim().toLowerCase() === game.title.toLowerCase();

  const handleClose = (next: boolean): void => {
    if (deleteGame.isPending) return;
    if (!next) setConfirmText('');
    onOpenChange(next);
  };

  const handleDelete = async (): Promise<void> => {
    if (!canDelete) return;
    await deleteGame.mutateAsync(game.id);
    setConfirmText('');
    onOpenChange(false);
    onDeleted();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="w-full max-w-[460px] gap-0 border border-destructive/30 bg-overlay p-0">
        <div className="relative overflow-hidden border-b border-border">
          {/* Mismo lavado de color de cabecera que ModalShell, aquí en rojo:
              es una acción destructiva, la cabecera lo dice de un vistazo. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'linear-gradient(120deg, rgba(255,94,87,.14) 0%, transparent 60%)',
            }}
          />
          <div className="relative flex items-center gap-3 px-5.5 py-5">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-sm bg-destructive/12">
              <Trash2 size={16} className="text-destructive" />
            </div>
            <AlertDialogTitle>Delete game</AlertDialogTitle>
          </div>
        </div>

        <div className="px-5.5 py-5">
          <div className="text-[13.5px] leading-relaxed text-bone">
            This permanently deletes <span className="font-bold text-foreground">{game.title}</span>{' '}
            and all of its sessions, playthroughs, status history and spending. This can&apos;t be
            undone.
          </div>

          <div className="mt-4.5 mb-1.75 text-[12px] font-semibold text-muted-foreground">
            Type the game name to confirm
          </div>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={game.title}
            autoFocus
            className={`${textInputClass} ${textInputFocusClass}`}
          />

          {deleteGame.isError && (
            <div className="mt-3 text-[12px] text-destructive">
              Couldn&apos;t delete the game — {deleteGame.error.message}
            </div>
          )}
        </div>

        <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={deleteGame.isPending}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete || deleteGame.isPending}
            className="flex items-center gap-2 rounded-sm px-5 py-2.5 text-[13.5px] font-semibold bg-live text-ink-live transition-[background-color,filter,transform] duration-150 enabled:hover:brightness-110 enabled:active:scale-[.97] motion-reduce:enabled:active:scale-100 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} />
            {deleteGame.isPending ? 'Deleting…' : 'Delete forever'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
