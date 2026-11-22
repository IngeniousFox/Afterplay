import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { liveButtonClass, primaryButtonClass, secondaryButtonClass } from '../shell/controls';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type CloudConfirmDialogProps = {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  // Destructivo = botón Live; si no, el primario Phosphor.
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Confirmación de las acciones de Ajustes → partidas que no se pueden
// deshacer (limpiar copias de la nube, resolver un id duplicado). Mismo
// lenguaje que DeleteSaveBackupDialog: confirmar/cancelar, sin teclear nada.
export const CloudConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  error = null,
  destructive = true,
  onConfirm,
  onCancel,
}: CloudConfirmDialogProps): React.JSX.Element => (
  <AlertDialog
    open={open}
    onOpenChange={(next) => {
      if (!next && !busy) onCancel();
    }}
  >
    <AlertDialogContent className="w-full max-w-[440px] gap-0 border border-line-strong bg-overlay p-0">
      <div className="flex items-center gap-3 border-b border-line px-5.5 py-5">
        <div
          className={cn(
            'flex size-8 flex-none items-center justify-center rounded-sm',
            destructive ? 'bg-live/12 text-live' : 'bg-phosphor-tint text-phosphor',
          )}
        >
          <TriangleAlert aria-hidden size={16} />
        </div>
        <AlertDialogTitle>{title}</AlertDialogTitle>
      </div>
      <div className="px-5.5 py-5 text-body text-bone">
        {message}
        {error && <div className="mt-3 text-small text-live">{error}</div>}
      </div>
      <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-line !bg-transparent px-5.5 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={cn(secondaryButtonClass, 'h-10 px-4.5')}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={cn(destructive ? liveButtonClass : primaryButtonClass, 'h-10 px-5')}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
