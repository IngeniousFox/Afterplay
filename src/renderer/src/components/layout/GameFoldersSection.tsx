import { Folder, FolderPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScanFolders, useSetScanFolders } from '../../hooks/scan';
import { buttonSize, iconButtonClass, secondaryButtonClass } from '../shell/controls';
import { SettingsCard, StatusLine } from './SettingsCard';

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
      title="Game folders"
      description="Where your games are installed. When you add a game, Afterplay scans these to find its folder and executable instead of you browsing for it by hand. Each subfolder inside is one game. The list belongs to this PC."
      action={
        <>
          <span className="rounded-xs bg-raised px-1.5 py-0.5 text-micro font-semibold text-bone">
            This PC
          </span>
          <button
            type="button"
            onClick={handleAdd}
            disabled={setFolders.isPending}
            className={cn(secondaryButtonClass, buttonSize.md)}
          >
            <FolderPlus aria-hidden size={15} />
            Add folder
          </button>
        </>
      }
      extra={
        // setFolders.isError no se miraba antes en ningún sitio: una
        // escritura fallida (fichero bloqueado, permisos) dejaba la fila tal
        // cual, como si añadir o quitar la carpeta hubiera funcionado.
        setFolders.isError && (
          <StatusLine tone="error">
            Couldn&apos;t update your folders: {setFolders.error.message}
          </StatusLine>
        )
      }
      flush
    >
      {folders.length === 0 ? (
        <div className="px-5 py-4 text-small text-dust">
          No folders yet. Point at the folder that <em>contains</em> your games: each subfolder
          inside it is treated as one game.
        </div>
      ) : (
        <ul>
          {folders.map((folder) => (
            <li
              key={folder}
              className="flex items-center gap-3 border-t border-line px-5 py-2.5 first:border-t-0"
            >
              <span className="flex size-7.5 flex-none items-center justify-center rounded-sm bg-raised text-dust">
                <Folder aria-hidden size={15} />
              </span>
              <span className="min-w-0 flex-1 font-mono text-small break-all text-bone">
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
                aria-label={`Stop scanning ${folder}`}
                title="Stop scanning this folder"
                className={cn(iconButtonClass, 'hover:text-live')}
              >
                <X aria-hidden size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
};
