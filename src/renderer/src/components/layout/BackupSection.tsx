import { FolderOpen, HardDriveDownload } from 'lucide-react';
import { useState } from 'react';
import { useCreateManualBackup } from '../../hooks/backup';
import { revealClass, revealStyle } from '../../lib/styles';
import { SettingsCard } from './SettingsCard';

const TEAL = '#2bb6a6';

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
    <SettingsCard
      layout="row"
      title="Backups"
      description="On top of the automatic daily copies, save one right now wherever you want."
      textClassName="min-w-0 flex-1"
      icon={HardDriveDownload}
      color={TEAL}
      className={revealClass}
      style={revealStyle(4)}
      extra={
        <>
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
        </>
      }
    >
      <button
        type="button"
        onClick={handleBackupNow}
        disabled={createManualBackup.isPending}
        className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {createManualBackup.isPending ? (
          <HardDriveDownload size={14} className="animate-pulse" />
        ) : (
          <FolderOpen size={14} />
        )}
        {createManualBackup.isPending ? 'Saving…' : 'Back up now'}
      </button>
    </SettingsCard>
  );
};
