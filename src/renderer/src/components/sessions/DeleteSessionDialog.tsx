import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeletePendingSession, useDeleteSession } from '../../hooks/sessions';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { buttonSize, liveButtonClass, secondaryButtonClass } from '../shell/controls';
import type { SessionId } from '../../../../shared/entityIds';

type DeleteSessionDialogProps = {
  // null = cerrado. `label` es la línea que identifica la sesión al usuario
  // ("Dark Souls — Jul 19, 2026 · 1h 27m") — cada vista la compone con lo
  // que tiene a mano.
  session: { id: SessionId; label: string } | null;
  onClose: () => void;
  // Sesión de emulador aún sin asignar (bandeja Pending): mismo diálogo,
  // pero descarta con deletePending (nunca tocó ningún juego) — sin esto,
  // descartar una pendiente borraba directo, sin confirmar, a diferencia de
  // las sesiones normales.
  pending?: boolean;
};

// Confirmación de borrado de una sesión — compartida por la vista global de
// Sesiones, el Session History del detalle y la bandeja de pendientes. Mismo
// lenguaje visual que DeleteGameDialog pero sin el "escribe el nombre":
// borrar una sesión es serio (se pierde tiempo medido) pero no catastrófico
// como borrar el juego entero — un confirmar/cancelar claro basta.
export const DeleteSessionDialog = ({
  session,
  onClose,
  pending = false,
}: DeleteSessionDialogProps): React.JSX.Element => {
  const deleteReal = useDeleteSession();
  const deletePending = useDeletePendingSession();
  // Ambos hooks se llaman siempre (regla de hooks); solo cambia cuál se
  // dispara según de qué bandeja venga la sesión.
  const del = pending ? deletePending : deleteReal;

  const handleClose = (next: boolean): void => {
    if (del.isPending) return;
    if (!next) {
      // El diálogo NO se desmonta entre sesiones — el dueño solo cambia qué
      // `session` le pasa — así que sin esto el banner de un borrado
      // fallido sobrevivía a cerrar y reaparecía sobre la SIGUIENTE sesión
      // que se abriera aquí, antes incluso de haber pulsado Delete para
      // ella. Mismo motivo por el que AssignSessionModal ya hace lo mismo.
      deleteReal.reset();
      deletePending.reset();
      onClose();
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!session) return;
    await del.mutateAsync(session.id);
    onClose();
  };

  return (
    <AlertDialog open={session !== null} onOpenChange={handleClose}>
      <AlertDialogContent className="w-full max-w-[440px] gap-0 overflow-hidden rounded-md border border-line-strong bg-overlay p-0 shadow-modal">
        <div className="flex items-center gap-3 border-b border-line px-5.5 py-4.5">
          {/* Icono en Live: acción destructiva, la cabecera lo dice de un
              vistazo sin teñir el diálogo entero. */}
          <span className="flex size-9 flex-none items-center justify-center rounded-sm bg-live/12">
            <Trash2 aria-hidden size={17} className="text-live" />
          </span>
          <AlertDialogTitle className="font-display text-title font-bold text-bone">
            Delete session
          </AlertDialogTitle>
        </div>

        <div className="px-5.5 py-5">
          <p className="text-body text-bone">
            This permanently deletes <span className="font-semibold">{session?.label}</span> and its
            tracked time.{' '}
            {pending
              ? // Una pendiente nunca se asignó a ningún juego, así que borrarla
                // no cambia horas ni stats de nada — no prometas lo contrario.
                'It was never assigned to a game, so nothing else changes.'
              : 'Hours and stats will update; the status history stays untouched.'}{' '}
            <span className="text-dust">This can&apos;t be undone.</span>
          </p>

          {del.isError && (
            <p role="alert" className="mt-3 text-small text-live">
              Couldn&apos;t delete the session — {del.error.message}
            </p>
          )}
        </div>

        <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-line !bg-transparent px-5.5 py-4">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={del.isPending}
            className={cn(secondaryButtonClass, buttonSize.md)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className={cn(liveButtonClass, buttonSize.md)}
          >
            <Trash2 aria-hidden size={15} />
            {del.isPending ? 'Deleting…' : 'Delete session'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
