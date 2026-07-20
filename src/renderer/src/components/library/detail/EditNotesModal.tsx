import { Save } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useUpdateGame } from '../../../hooks/games';
import { ModalFooter, ModalShell } from '../../ui/modal-shell';
import { NotesEditor } from './NotesEditor';

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
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Edit notes"
      widthClass="w-175"
      bodyClassName="px-5.5 py-5"
      footer={
        <ModalFooter
          onCancel={handleClose}
          onSubmit={handleSave}
          submitting={updateGame.isPending}
          submitLabel="Save notes"
          submittingLabel="Saving…"
          icon={<Save size={16} />}
        />
      }
    >
      {/* El editor solo lee `value` al MONTAR (mientras vive, él es la fuente
          de verdad). El portal del Dialog ya desmonta su contenido al cerrar,
          así que cada apertura lo monta de cero con la nota recién recargada;
          el key lo garantiza aunque eso cambie. */}
      <NotesEditor key={open ? 'open' : 'closed'} value={notes} onChange={setNotes} />
    </ModalShell>
  );
};
