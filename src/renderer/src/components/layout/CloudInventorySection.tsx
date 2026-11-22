import { Cloud, DownloadCloud, Loader2, Monitor, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { CloudFolder, CloudInventory } from '../../../../shared/types';
import {
  useDeleteCloudMachine,
  usePurgeCloudFolder,
  useRecoverFromCloud,
  useScanBucket,
} from '../../hooks/saves';
import { formatBytes, pluralize } from '../../lib/format';
import { expandClass } from '../../lib/styles';
import {
  buttonSize,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../shell/controls';
import { CloudConfirmDialog } from './CloudConfirmDialog';
import { SettingsCard, SettingsNotice, StatusLine } from './SettingsCard';

// Qué hay DE VERDAD en el bucket, frente a lo que el índice local cree.
//
// Las dos cifras pueden no coincidir, y cuando no coinciden es justo cuando
// importa: el índice viaja por el sync, así que una reinstalación sin sync lo
// pierde entero y deja los backups arriba pagándose sin que nada los liste.
// Desde aquí se ven, se recuperan (se reconstruyen sus filas leyendo el
// bucket) y se puede tirar lo de una máquina que ya no exista.
//
// Nada de esto corre solo: listar cuesta operaciones de R2 y §10bis.4 prohíbe
// comprobar nada de fondo. Siempre a golpe de botón.
export const CloudInventorySection = (): React.JSX.Element => {
  const scan = useScanBucket();
  const recover = useRecoverFromCloud();
  const deleteMachine = useDeleteCloudMachine();
  const purge = usePurgeCloudFolder();
  const [inventory, setInventory] = useState<CloudInventory | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const busy = scan.isPending || recover.isPending || deleteMachine.isPending || purge.isPending;

  const refresh = async (): Promise<CloudInventory> => {
    const result = await scan.mutateAsync();
    setInventory(result);
    return result;
  };

  const handleScan = async (): Promise<void> => {
    setFlash(null);
    await refresh();
  };

  const handleRecover = async (): Promise<void> => {
    setFlash(null);
    const result = await recover.mutateAsync();
    const parts = [`${pluralize(result.recovered, 'backup')} recovered`];
    if (result.skippedNoGame > 0) {
      parts.push(`${result.skippedNoGame} waiting for their game to be added back`);
    }
    if (result.unreadableFolders > 0) parts.push(`${result.unreadableFolders} folders unreadable`);
    setFlash(parts.join(' · '));
    await refresh();
  };

  const handleDelete = async (machineId: string): Promise<void> => {
    setFlash(null);
    const deleted = await deleteMachine.mutateAsync(machineId);
    setFlash(`${pluralize(deleted, 'file')} deleted from the bucket.`);
    await refresh();
  };

  // Borra las copias de un juego ya fuera de la biblioteca, en TODOS los PCs.
  const handlePurge = async (saveKey: string): Promise<void> => {
    setFlash(null);
    const deleted = await purge.mutateAsync(saveKey);
    setFlash(`${pluralize(deleted, 'file')} deleted from the bucket.`);
    await refresh();
  };

  return (
    <SettingsCard
      title="What's in the cloud"
      description="Read the bucket itself instead of the local index: the way to spot backups this install doesn't know about, and to get them back."
      action={
        <button
          type="button"
          onClick={handleScan}
          disabled={busy}
          className={cn(secondaryButtonClass, buttonSize.md)}
        >
          {scan.isPending ? (
            <Loader2 aria-hidden size={15} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Cloud aria-hidden size={15} />
          )}
          {scan.isPending ? 'Reading…' : 'Read the bucket'}
        </button>
      }
      extra={
        <>
          {(scan.isError || recover.isError || deleteMachine.isError || purge.isError) && (
            <StatusLine tone="error">
              {(scan.error ?? recover.error ?? deleteMachine.error ?? purge.error)?.message}
            </StatusLine>
          )}
          {flash && <StatusLine tone="info">{flash}</StatusLine>}
        </>
      }
      flush
    >
      {inventory && (
        <Inventory
          inventory={inventory}
          busy={busy}
          recovering={recover.isPending}
          onRecover={handleRecover}
          onDelete={handleDelete}
          onPurge={handlePurge}
          purging={purge.isPending}
          purgeError={purge.isError ? purge.error.message : null}
          onPurgeReset={purge.reset}
        />
      )}
    </SettingsCard>
  );
};

const Inventory = ({
  inventory,
  busy,
  recovering,
  onRecover,
  onDelete,
  onPurge,
  purging,
  purgeError,
  onPurgeReset,
}: {
  inventory: CloudInventory;
  busy: boolean;
  recovering: boolean;
  onRecover: () => void;
  onDelete: (machineId: string) => void;
  onPurge: (saveKey: string) => Promise<void>;
  purging: boolean;
  purgeError: string | null;
  onPurgeReset: () => void;
}): React.JSX.Element => {
  const [purgeTarget, setPurgeTarget] = useState<PurgeGroup | null>(null);
  const groups = groupFolders(inventory.folders);
  const unknown = inventory.folders.reduce((sum, folder) => sum + folder.unknownCount, 0);

  if (inventory.objectCount === 0) {
    return (
      <div className={cn('px-5 py-4 text-small text-dust', expandClass)}>
        The bucket is empty. Nothing has been backed up yet.
      </div>
    );
  }

  return (
    <div className={expandClass}>
      <div className="flex items-center gap-2.5 px-5 py-3 text-small">
        <Cloud aria-hidden size={15} className="flex-none text-tube" />
        <span className="font-semibold text-bone">
          {formatBytes(inventory.totalBytes)} in the bucket
          <span className="font-normal text-dust">
            {' · '}
            {pluralize(inventory.objectCount, 'file')}
          </span>
        </span>
      </div>

      {/* Lo que el índice no conoce: ni se puede restaurar ni borrar desde la
          app, pero se paga igual. Es EL motivo de que esta sección exista. */}
      {unknown > 0 && (
        <div className="px-5 pb-3">
          <SettingsNotice
            action={
              <button
                type="button"
                onClick={onRecover}
                disabled={busy}
                className={cn(primaryButtonClass, buttonSize.md)}
              >
                {recovering ? (
                  <Loader2
                    aria-hidden
                    size={15}
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <DownloadCloud aria-hidden size={15} />
                )}
                {recovering ? 'Recovering…' : 'Recover them'}
              </button>
            }
          >
            {pluralize(unknown, 'backup')} up there ({formatBytes(inventory.unknownBytes)}) that
            this install doesn&apos;t know about. It can&apos;t restore or delete them until they
            are back in the index.
          </SettingsNotice>
        </div>
      )}

      <div className="border-t border-line px-5 pt-3 pb-1 text-small font-semibold text-dust">
        By PC
      </div>
      <ul>
        {inventory.machines.map((machine) => (
          <li
            key={machine.machineId}
            className="flex items-center gap-3 border-t border-line px-5 py-2.5 first:border-t-0"
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-sm bg-raised">
              <Monitor
                aria-hidden
                size={15}
                className={machine.isCurrent ? 'text-phosphor' : 'text-dust'}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-body font-semibold text-bone">
                {machine.machineName ?? 'Unregistered PC'}
                {machine.isCurrent && (
                  <span className="rounded-xs bg-phosphor px-1.5 py-px text-micro font-semibold text-ink">
                    This PC
                  </span>
                )}
              </div>
              <div className="text-micro break-all text-dust">
                {formatBytes(machine.totalBytes)} · {pluralize(machine.backupCount, 'backup')}
                {machine.home && ` · ${machine.home}`}
              </div>
            </div>
            {/* La propia máquina no se ofrece borrar: sería tirar tus backups
                actuales desde un botón pensado para limpiar los de otros. */}
            {!machine.isCurrent && (
              <button
                type="button"
                onClick={() => onDelete(machine.machineId)}
                disabled={busy}
                className={cn(iconButtonClass, 'hover:text-live')}
                aria-label="Delete this PC's backups from the bucket"
                title="Delete this PC's backups from the bucket"
              >
                <Trash2 aria-hidden size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-5 pt-3 pb-1 text-small font-semibold text-dust">
        By game
      </div>
      <div className="flex max-h-72 flex-col overflow-y-auto px-5 pb-3">
        {groups.map((group) => (
          <div
            key={group.saveKey}
            className="flex flex-col border-t border-line py-1.5 first:border-t-0"
          >
            {group.folders.map((folder) => (
              <div
                key={`${folder.saveKey}-${folder.machineId}`}
                className="flex items-center gap-2 py-1 text-small"
              >
                <span className="min-w-0 flex-1 text-bone">
                  {folder.gameTitle
                    ? `${folder.gameTitle}${folder.gameDeleted ? ' (deleted)' : ''}`
                    : `Not in your library (save key ${folder.saveKey})`}
                </span>
                {folder.unknownCount > 0 && (
                  <span className="flex-none text-micro font-semibold text-phosphor">
                    {folder.unknownCount} unknown
                  </span>
                )}
                <span className="flex-none text-dust tabular-nums">
                  {formatBytes(folder.totalBytes)}
                </span>
              </div>
            ))}
            {group.purgeable && (
              <button
                type="button"
                data-testid="cloud-purge"
                onClick={() => setPurgeTarget(group)}
                disabled={busy}
                className="flex w-fit items-center gap-1.5 rounded-xs py-0.5 text-small font-semibold text-dust transition-colors duration-150 outline-none enabled:hover:text-live focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor disabled:opacity-40"
              >
                <Trash2 aria-hidden size={13} />
                Delete these copies
              </button>
            )}
          </div>
        ))}
      </div>
      <CloudConfirmDialog
        open={purgeTarget !== null}
        title="Delete these copies"
        message={
          purgeTarget && (
            <>
              Deletes {pluralize(purgeTarget.backupCount, 'version')} of{' '}
              <span className="font-bold text-bone">{purgeTarget.title}</span> from every PC. This
              can&apos;t be undone.
            </>
          )
        }
        confirmLabel="Delete them"
        busy={purging}
        error={purgeError}
        onConfirm={() => {
          if (!purgeTarget) return;
          // Si falla, el diálogo se queda abierto con el motivo.
          onPurge(purgeTarget.saveKey).then(
            () => setPurgeTarget(null),
            () => undefined,
          );
        }}
        onCancel={() => {
          onPurgeReset();
          setPurgeTarget(null);
        }}
      />
    </div>
  );
};

type PurgeGroup = {
  saveKey: string;
  title: string;
  folders: CloudFolder[];
  backupCount: number;
  // Solo se puede limpiar lo que no tiene un juego VIVO detrás: borrado de la
  // biblioteca, o que nunca estuvo en ella.
  purgeable: boolean;
};

// Las carpetas por saveKey: limpiar borra el saveKey en TODOS los PCs, así
// que la acción es del grupo y no de una carpeta suelta.
const groupFolders = (folders: CloudFolder[]): PurgeGroup[] => {
  const groups = new Map<string, PurgeGroup>();
  for (const folder of folders) {
    const group = groups.get(folder.saveKey) ?? {
      saveKey: folder.saveKey,
      title: folder.gameTitle ?? folder.saveKey,
      folders: [],
      backupCount: 0,
      purgeable: true,
    };
    group.folders.push(folder);
    group.backupCount += folder.backupCount;
    if (folder.gameId !== null) group.purgeable = false;
    if (folder.gameTitle) group.title = folder.gameTitle;
    groups.set(folder.saveKey, group);
  }
  return [...groups.values()];
};
