import { FolderOpen, HardDriveDownload } from 'lucide-react';
import { useState } from 'react';
import { useCreateManualBackup } from '../../hooks/backup';

// Copia de seguridad a demanda, en la carpeta que elija el usuario — aparte
// de la automática diaria (dailyBackup.ts, 5 rotando dentro de userData):
// esta no tiene límite ni regla de "una al día", es una vía de escape
// manual explícita ("quiero una copia AHORA, donde yo decida").
export const BackupSection = (): React.JSX.Element => {
  const createManualBackup = useCreateManualBackup();
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const handleBackupNow = async (): Promise<void> => {
    setSavedPath(null);
    const directory = await window.api.dialog.pickFolder();
    if (!directory) return;
    const filePath = await createManualBackup.mutateAsync(directory);
    setSavedPath(filePath);
  };

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[10px] bg-white/[0.02] px-3.25 py-2.75"
      style={{ border: '1px solid var(--border)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-foreground">Backups</div>
        <div className="mt-0.25 text-xs text-muted-foreground">
          On top of the automatic daily copies, save one right now wherever you want.
        </div>
        {savedPath && (
          <div className="mt-1.5 truncate font-mono text-[10.5px] text-primary" title={savedPath}>
            Saved to {savedPath}
          </div>
        )}
        {createManualBackup.isError && (
          <div className="mt-1.5 text-[11px] text-destructive">
            Couldn&apos;t create the backup — {createManualBackup.error.message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleBackupNow}
        disabled={createManualBackup.isPending}
        className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {createManualBackup.isPending ? (
          <HardDriveDownload size={14} className="animate-pulse" />
        ) : (
          <FolderOpen size={14} />
        )}
        {createManualBackup.isPending ? 'Saving…' : 'Back up now'}
      </button>
    </div>
  );
};
