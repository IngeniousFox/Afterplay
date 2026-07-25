import { FolderPlus, FolderSearch, HardDrive, X } from 'lucide-react';
import { useScanFolders, useSetScanFolders } from '../../hooks/scan';
import { BLUE } from '../../lib/colors';
import { revealClass, revealStyle } from '../../lib/styles';
import { SettingsCard } from './SettingsCard';

// Las carpetas del modo "Scan my game folders" de Add Game. La MISMA lista
// que se puede tocar dentro del escaneo (mismos hooks, misma config): allí
// para no obligar a pasar por Ajustes antes del primer escaneo, y aquí
// porque es configuración de esta máquina y este es su sitio natural.
//
// Viven en config.json y NO en la base de datos a propósito: son rutas de
// ESTE PC, y la DB sincroniza entre ordenadores.
export const GameFoldersSection = (): React.JSX.Element => {
  const { data: folders = [] } = useScanFolders();
  const setFolders = useSetScanFolders();

  const handleAdd = async (): Promise<void> => {
    const folder = await window.api.dialog.pickFolder();
    if (!folder || folders.includes(folder)) return;
    await setFolders.mutateAsync([...folders, folder]).catch(() => undefined);
  };

  return (
    <SettingsCard
      layout="column"
      title="Game folders"
      description="Where your games live on disk. Add Game can scan these to find installed games, with their folder and executable."
      icon={FolderSearch}
      color={BLUE}
      className={revealClass}
      style={revealStyle(6)}
      headerRight={
        <button
          type="button"
          onClick={handleAdd}
          disabled={setFolders.isPending}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FolderPlus size={14} />
          Add folder
        </button>
      }
    >
      {folders.length === 0 ? (
        <div className="text-[11.5px] text-muted-foreground">
          No folders yet. Point at the folder that <em>contains</em> your games — each subfolder
          inside it is treated as one game.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {folders.map((folder) => (
            <div
              key={folder}
              className="flex items-center gap-2 rounded-[8px] border px-2.75 py-1.75"
              style={{ borderColor: `${BLUE}2e`, background: `${BLUE}0d` }}
            >
              <HardDrive size={12} className="flex-none" style={{ color: BLUE }} />
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
                title={folder}
              >
                {folder}
              </span>
              <button
                type="button"
                onClick={() =>
                  setFolders
                    .mutateAsync(folders.filter((current) => current !== folder))
                    .catch(() => undefined)
                }
                disabled={setFolders.isPending}
                title="Stop scanning this folder"
                className="flex-none rounded p-1 text-muted-foreground transition-colors duration-150 hover:text-destructive disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
};
