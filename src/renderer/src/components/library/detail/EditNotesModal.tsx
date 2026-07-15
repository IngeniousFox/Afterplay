import { Save, X } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useUpdateGame } from '../../../hooks/games';
import { Dialog, DialogContent } from '../../ui/dialog';
import { Textarea } from '../../ui/textarea';
import { textInputClass } from '../add-game/styles';

type EditNotesModalProps = {
  game: GameDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// La ficha de Plan to Play no tiene el EditGameModal grande (nada de
// plataforma/origen/exe/playthrough tiene sentido todavía para un juego que
// aún no se juega) — pero las notas en markdown sí, y NotesSection es
// puramente de lectura (ni siquiera se pinta si no hay nada que mostrar).
// Este modal es el equivalente mínimo: solo el textarea de notas, para
// añadirlas por primera vez o corregirlas.
export const EditNotesModal = ({
  game,
  open,
  onOpenChange,
}: EditNotesModalProps): React.JSX.Element => {
  const [notes, setNotes] = useState(game.notes ?? '');
  const updateGame = useUpdateGame();

  // Reinicia el textarea a las notas reales cada vez que el modal se ABRE
  // (no en cada render mientras está abierto, o se perdería lo que se está
  // escribiendo) — patrón de "ajustar estado durante el render", sin
  // useEffect, igual que el resto de la app (ver GameDetail.tsx).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNotes(game.notes ?? '');
  }

  const handleClose = (): void => {
    if (updateGame.isPending) return;
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    await updateGame.mutateAsync({ id: game.id, patch: { notes: notes.trim() || null } });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-135 max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[18px] border border-input bg-[#121413] p-0 shadow-[0_30px_80px_rgba(0,0,0,.6)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5.5 py-4.5">
          <div className="text-[17px] font-extrabold tracking-[-.01em] text-foreground">
            Edit notes
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] border border-border bg-white/3 text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5.5 py-5">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            autoFocus
            placeholder="Markdown supported…"
            className={`${textInputClass} min-h-40 font-mono`}
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border px-5.5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={updateGame.isPending}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateGame.isPending}
            className="flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#2fdc7e,#16a35a)', color: '#08120c' }}
          >
            <Save size={16} />
            <span>{updateGame.isPending ? 'Saving…' : 'Save notes'}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
