import { Trash2 } from 'lucide-react';
import { useDeletePendingSession, useDeleteSession } from '../../hooks/sessions';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type DeleteSessionDialogProps = {
  // null = cerrado. `label` es la línea que identifica la sesión al usuario
  // ("Dark Souls — Jul 19, 2026 · 1h 27m") — cada vista la compone con lo
  // que tiene a mano.
  session: { id: number; label: string } | null;
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
    if (!next) onClose();
  };

  const handleDelete = async (): Promise<void> => {
    if (!session) return;
    await del.mutateAsync(session.id);
    onClose();
  };

  return (
    <AlertDialog open={session !== null} onOpenChange={handleClose}>
      <AlertDialogContent className="w-full max-w-[440px] gap-0 border border-destructive/30 bg-[#121413] p-0">
        <div className="relative overflow-hidden border-b border-border">
          {/* Mismo lavado de color de cabecera que ModalShell/DeleteGame, en
              rojo: acción destructiva, la cabecera lo dice de un vistazo. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'linear-gradient(120deg, rgba(232,93,114,.14) 0%, transparent 60%)',
            }}
          />
          <div className="relative flex items-center gap-3 px-5.5 py-5">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-destructive/12">
              <Trash2 size={16} className="text-destructive" />
            </div>
            <AlertDialogTitle className="text-base font-extrabold text-foreground">
              Delete session
            </AlertDialogTitle>
          </div>
        </div>

        <div className="px-5.5 py-5">
          <div className="text-[13.5px] leading-relaxed text-[#c4cac6]">
            This permanently deletes{' '}
            <span className="font-bold text-foreground">{session?.label}</span> and its tracked
            time.{' '}
            {pending
              ? // Una pendiente nunca se asignó a ningún juego, así que borrarla
                // no cambia horas ni stats de nada — no prometas lo contrario.
                'It was never assigned to a game, so nothing else changes.'
              : 'Hours and stats will update; the status history stays untouched.'}{' '}
            This can&apos;t be undone.
          </div>

          {del.isError && (
            <div className="mt-3 text-[12px] text-destructive">
              Couldn&apos;t delete the session — {del.error.message}
            </div>
          )}
        </div>

        <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={del.isPending}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className="[will-change:transform] flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13.5px] font-bold text-white transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(220,38,38,.4)]"
            style={{ background: '#dc2626' }}
          >
            <Trash2 size={15} />
            {del.isPending ? 'Deleting…' : 'Delete session'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
