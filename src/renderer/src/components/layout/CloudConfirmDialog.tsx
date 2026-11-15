import { TriangleAlert } from 'lucide-react';
import { BLUE } from '../../lib/colors';
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
  // Destructivo = botón rojo; si no, el azul de la app.
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
    <AlertDialogContent className="w-full max-w-[440px] gap-0 border border-destructive/30 bg-[#121413] p-0">
      <div className="flex items-center gap-3 border-b border-border px-5.5 py-5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-destructive/12">
          <TriangleAlert size={16} className="text-destructive" />
        </div>
        <AlertDialogTitle className="text-base font-extrabold text-foreground">
          {title}
        </AlertDialogTitle>
      </div>
      <div className="px-5.5 py-5 text-[13.5px] leading-relaxed text-[#c4cac6]">
        {message}
        {error && <div className="mt-3 text-[12px] text-destructive">{error}</div>}
      </div>
      <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-[10px] px-5 py-2.5 text-[13.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: destructive ? '#dc2626' : BLUE }}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
