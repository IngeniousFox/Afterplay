import { Trash2 } from 'lucide-react';
import { secondaryButtonClass } from '../../../lib/styles';
import { useDeleteSpendEvent } from '../../../hooks/spend';
import { useDeleteStateEvent } from '../../../hooks/stateEvents';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import type { SpendEventId, StateEventId } from '../../../../../shared/entityIds';

export type DeletableHistoryEntry = {
  // Las dos clases de entrada borrables de la línea temporal — cada una con
  // su mutación y su frase de consecuencias, mismo diálogo.
  kind: 'status' | 'spend';
  id: StateEventId | SpendEventId;
  // Tal y como se ve en la fila ("Beaten · Jul 19, 2026" / "€12.99 ·
  // Purchase · Jul 19, 2026") — la compone HistoryList, que ya tiene el
  // estado o el importe y la fecha formateados a mano.
  label: string;
};

type DeleteHistoryEntryDialogProps = {
  // null = cerrado.
  entry: DeletableHistoryEntry | null;
  onClose: () => void;
};

// Confirmación de borrado de una entrada del historial (estado o gasto) — el
// mismo aviso que ya llevan sesiones (DeleteSessionDialog), juegos y copias
// de partidas: en esta casa nada se borra a pelo desde un icono de papelera.
// Mismo lenguaje visual que DeleteSessionDialog y sin el "escribe el nombre"
// de DeleteGameDialog: borrar una entrada cambia lo derivado (serio) pero no
// destruye horas ni sesiones (no catastrófico) — confirmar/cancelar basta.
export const DeleteHistoryEntryDialog = ({
  entry,
  onClose,
}: DeleteHistoryEntryDialogProps): React.JSX.Element => {
  const deleteState = useDeleteStateEvent();
  const deleteSpend = useDeleteSpendEvent();
  // Ambos hooks se llaman siempre (regla de hooks); solo cambia cuál se
  // dispara según la clase de entrada — mismo patrón que DeleteSessionDialog
  // con las pendientes.
  const del = entry?.kind === 'spend' ? deleteSpend : deleteState;

  const handleClose = (next: boolean): void => {
    if (del.isPending) return;
    if (!next) onClose();
  };

  const handleDelete = async (): Promise<void> => {
    if (!entry) return;
    await del.mutateAsync(entry.id);
    onClose();
  };

  return (
    <AlertDialog open={entry !== null} onOpenChange={handleClose}>
      <AlertDialogContent className="w-full max-w-[440px] gap-0 border border-destructive/30 bg-overlay p-0">
        <div className="relative overflow-hidden border-b border-border">
          {/* Mismo lavado de cabecera en rojo que el resto de diálogos de
              borrado: acción destructiva, dicho de un vistazo. */}
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
            <AlertDialogTitle>Delete history entry</AlertDialogTitle>
          </div>
        </div>

        <div className="px-5.5 py-5">
          <div className="text-[13.5px] leading-relaxed text-bone">
            This permanently removes{' '}
            <span className="font-bold text-foreground">{entry?.label}</span> from this game&apos;s
            history.{' '}
            {entry?.kind === 'spend'
              ? // Un gasto solo alimenta los totales de dinero — que no
                // parezca que arrastra nada más.
                'Spend totals and stats will update; nothing else changes.'
              : 'Its current status and playthrough dates will re-derive from the remaining entries; sessions and hours stay untouched.'}{' '}
            This can&apos;t be undone.
          </div>

          {del.isError && (
            <div className="mt-3 text-[12px] text-destructive">
              Couldn&apos;t delete the entry — {del.error.message}
            </div>
          )}
        </div>

        <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={del.isPending}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className="flex items-center gap-2 rounded-sm px-5 py-2.5 text-[13.5px] font-semibold bg-live text-ink-live transition-[background-color,filter,transform] duration-150 enabled:hover:brightness-110 enabled:active:scale-[.97] motion-reduce:enabled:active:scale-100 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} />
            {del.isPending ? 'Deleting…' : 'Delete entry'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
