import { Trash2, TriangleAlert } from 'lucide-react';
import type { SaveBackupRow } from '../../../../../shared/types';
import { useDeleteSaveBackup } from '../../../hooks/saves';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatBytes, pluralize } from '../../../lib/format';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../ui/alert-dialog';

type DeleteSaveBackupDialogProps = {
  // null = cerrado.
  backup: SaveBackupRow | null;
  gameId: number;
  // Todas las versiones del juego: hacen falta para saber si de esta cuelga
  // alguna otra (ver abajo).
  versions: SaveBackupRow[];
  onClose: () => void;
};

// Confirmación de borrado de una versión en la nube. Mismo lenguaje que
// DeleteSessionDialog —y por el mismo motivo: es serio pero no catastrófico,
// así que confirmar/cancelar basta y no hace falta teclear nada— con UNA
// diferencia que aquí importa mucho:
//
// **Borrar una copia completa se lleva por delante sus diferenciales.** Los
// incrementales solo contienen lo que cambió respecto a su completo; sin él
// no se pueden restaurar, así que quedarían ocupando espacio sin servir para
// nada. El handler ya los borra en cascada, y este diálogo existe sobre todo
// para que eso no sea una sorpresa: la cuenta real de lo que se pierde va en
// el propio botón.
export const DeleteSaveBackupDialog = ({
  backup,
  gameId,
  versions,
  onClose,
}: DeleteSaveBackupDialogProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const deleteBackup = useDeleteSaveBackup();

  const dependents = backup
    ? versions.filter((version) => version.parentBackupName === backup.backupName)
    : [];
  const total = dependents.length + 1;
  const isLast = backup !== null && versions.length === total;

  const handleClose = (next: boolean): void => {
    if (deleteBackup.isPending) return;
    if (!next) onClose();
  };

  const handleDelete = async (): Promise<void> => {
    if (!backup) return;
    await deleteBackup.mutateAsync({ backupId: backup.id, gameId });
    onClose();
  };

  return (
    <AlertDialog open={backup !== null} onOpenChange={handleClose}>
      <AlertDialogContent className="w-full max-w-[440px] gap-0 border border-destructive/30 bg-[#121413] p-0">
        <div className="relative overflow-hidden border-b border-border">
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
              Delete cloud version
            </AlertDialogTitle>
          </div>
        </div>

        <div className="px-5.5 py-5">
          <div className="text-[13.5px] leading-relaxed text-[#c4cac6]">
            This permanently removes the save backed up on{' '}
            <span className="font-bold text-foreground">
              {backup && formatByPrecision(backup.createdAt, 'datetime', timeFormat)}
            </span>{' '}
            from {backup?.machineName} ({backup && formatBytes(backup.sizeBytes)}) from your cloud
            storage. The save on your PC is not touched. This can&apos;t be undone.
          </div>

          {dependents.length > 0 && (
            <Notice>
              {pluralize(dependents.length, 'later version')} only stores what changed since this
              one, so {dependents.length === 1 ? 'it goes' : 'they go'} too —{' '}
              <span className="font-bold">{total} versions in total</span>.
            </Notice>
          )}

          {isLast && (
            <Notice>
              This is the last copy of this game in the cloud. Afterwards there&apos;s nothing to
              restore from until the next backup runs.
            </Notice>
          )}

          {deleteBackup.isError && (
            <div className="mt-3 text-[12px] text-destructive">
              Couldn&apos;t delete it — {deleteBackup.error.message}
            </div>
          )}
        </div>

        <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
          <button
            type="button"
            onClick={() => handleClose(false)}
            disabled={deleteBackup.isPending}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteBackup.isPending}
            className="[will-change:transform] flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13.5px] font-bold text-white transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(220,38,38,.4)]"
            style={{ background: '#dc2626' }}
          >
            <Trash2 size={15} />
            {deleteBackup.isPending
              ? 'Deleting…'
              : total > 1
                ? `Delete ${total} versions`
                : 'Delete version'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const Notice = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    className="mt-3 flex items-start gap-1.75 rounded-[9px] px-3 py-2 text-[12px] leading-relaxed"
    style={{ background: 'rgba(227,178,74,.1)', color: '#e3b24a' }}
  >
    <TriangleAlert size={13} className="mt-0.5 flex-none" />
    <span>{children}</span>
  </div>
);
