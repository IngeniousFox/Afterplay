import {
  Cloud,
  DownloadCloud,
  Loader2,
  MonitorSmartphone,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import type { CloudInventory } from '../../../../shared/types';
import { useDeleteCloudMachine, useRecoverFromCloud, useScanBucket } from '../../hooks/saves';
import { formatBytes, pluralize } from '../../lib/format';
import { expandClass } from '../../lib/styles';
import { AMBER, BLUE } from '../../lib/colors';

// Qué hay DE VERDAD en el bucket, frente a lo que el índice local cree.
//
// Las dos cifras pueden no coincidir, y cuando no coinciden es justo cuando
// importa: el índice viaja por Turso, así que una reinstalación sin sync lo
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
  const [inventory, setInventory] = useState<CloudInventory | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const busy = scan.isPending || recover.isPending || deleteMachine.isPending;

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

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-white/[0.02] px-3.25 py-2.75">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md"
            style={{ background: `${BLUE}1f` }}
          >
            <Cloud size={13} style={{ color: BLUE }} />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">
              What&apos;s in the cloud
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Read the bucket itself instead of the local index — the way to spot backups this
              install doesn&apos;t know about, and to get them back.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleScan}
          disabled={busy}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scan.isPending ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
          {scan.isPending ? 'Reading…' : 'Read the bucket'}
        </button>
      </div>

      {(scan.isError || recover.isError || deleteMachine.isError) && (
        <div className="text-[11px] text-destructive">
          {(scan.error ?? recover.error ?? deleteMachine.error)?.message}
        </div>
      )}
      {flash && <div className="text-[11.5px] font-semibold text-primary">{flash}</div>}

      {inventory && (
        <Inventory
          inventory={inventory}
          busy={busy}
          recovering={recover.isPending}
          onRecover={handleRecover}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
};

const Inventory = ({
  inventory,
  busy,
  recovering,
  onRecover,
  onDelete,
}: {
  inventory: CloudInventory;
  busy: boolean;
  recovering: boolean;
  onRecover: () => void;
  onDelete: (machineId: string) => void;
}): React.JSX.Element => {
  const unknown = inventory.folders.reduce((sum, folder) => sum + folder.unknownCount, 0);

  if (inventory.objectCount === 0) {
    return (
      <div className={`text-[11.5px] text-muted-foreground ${expandClass}`}>
        The bucket is empty — nothing has been backed up yet.
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${expandClass}`}>
      <div
        className="flex items-center gap-2 rounded-[8px] border px-2.75 py-2"
        style={{ borderColor: `${BLUE}2e`, background: `${BLUE}0d` }}
      >
        <Cloud size={13} className="flex-none" style={{ color: BLUE }} />
        <span className="text-[12px] font-semibold text-foreground">
          {formatBytes(inventory.totalBytes)} in the bucket
          <span className="font-normal text-muted-foreground">
            {' · '}
            {pluralize(inventory.objectCount, 'file')}
          </span>
        </span>
      </div>

      {/* Lo que el índice no conoce: ni se puede restaurar ni borrar desde la
          app, pero se paga igual. Es EL motivo de que esta sección exista. */}
      {unknown > 0 && (
        <div
          className="flex flex-col gap-2 rounded-[8px] border px-2.75 py-2"
          style={{ borderColor: `${AMBER}3d`, background: `${AMBER}0d` }}
        >
          <div className="flex items-start gap-1.75 text-[11.5px]" style={{ color: AMBER }}>
            <TriangleAlert size={12} className="mt-0.5 flex-none" />
            <span>
              {pluralize(unknown, 'backup')} up there ({formatBytes(inventory.unknownBytes)}) that
              this install doesn&apos;t know about — it can&apos;t restore or delete them until they
              are back in the index.
            </span>
          </div>
          <button
            type="button"
            onClick={onRecover}
            disabled={busy}
            className="flex w-fit items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.03] px-3 py-1.75 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recovering ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <DownloadCloud size={13} />
            )}
            {recovering ? 'Recovering…' : 'Recover them'}
          </button>
        </div>
      )}

      <div className="text-[11px] font-bold tracking-[.05em] text-muted-foreground">BY PC</div>
      {inventory.machines.map((machine) => (
        <div
          key={machine.machineId}
          className="flex items-center gap-2.5 rounded-[8px] border px-2.75 py-2"
          style={
            machine.isCurrent
              ? { borderColor: `${BLUE}2e`, background: `${BLUE}0d` }
              : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
          }
        >
          <MonitorSmartphone
            size={13}
            className="flex-none"
            style={{ color: machine.isCurrent ? BLUE : 'rgba(255,255,255,.25)' }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-foreground">
              {machine.machineName ?? 'Unregistered PC'}
              {machine.isCurrent && (
                <span className="ml-1.5 text-[10.5px] font-bold" style={{ color: BLUE }}>
                  this PC
                </span>
              )}
            </div>
            <div className="truncate text-[10.5px] text-muted-foreground">
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
              className="flex-none rounded-md p-1.5 text-muted-foreground transition-colors duration-150 enabled:hover:bg-destructive/10 enabled:hover:text-destructive disabled:opacity-50"
              aria-label="Delete this PC's backups from the bucket"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}

      <div className="text-[11px] font-bold tracking-[.05em] text-muted-foreground">BY GAME</div>
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
        {inventory.folders.map((folder) => (
          <div
            key={`${folder.igdbId}-${folder.machineId}`}
            className="flex items-center gap-2 px-1 py-1 text-[11.5px]"
          >
            <span className="min-w-0 flex-1 truncate text-foreground">
              {folder.gameTitle ?? `Not in your library (IGDB ${folder.igdbId})`}
            </span>
            {folder.unknownCount > 0 && (
              <span className="flex-none text-[10.5px] font-bold" style={{ color: AMBER }}>
                {folder.unknownCount} unknown
              </span>
            )}
            <span className="flex-none text-muted-foreground">
              {formatBytes(folder.totalBytes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
