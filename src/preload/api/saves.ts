import { invoke, subscribe } from '../ipc';
import type {
  CloudInventory,
  DuplicateResolution,
  IdentityCheck,
  InstallIdentityStatus,
  LocalBackupsUsage,
  RecoveryResult,
  RestoreRequestInput,
  RestoreResult,
  SaveBackupsUsage,
  SavesActivityEvent,
  SavesBackupResult,
  SavesGameState,
  SavesQueuedEvent,
  SavesScanEntry,
  SavesStatus,
} from '../../main/saves/contracts';
import type { GameId, SaveBackupId } from '../../shared/entityIds';

export const savesApi = {
  getStatus: (): Promise<SavesStatus> => invoke('saves:getStatus'),
  getLegalFiles: (): Promise<{ name: string; path: string }[]> => invoke('saves:getLegalFiles'),
  openPath: (path: string): Promise<void> => invoke('saves:openPath', path),
  getUsage: (): Promise<SaveBackupsUsage> => invoke('saves:getUsage'),
  // Mantenimiento de la carpeta LOCAL de backups (Ajustes) — no confundir
  // con getUsage, que es el mismo dato pero en R2.
  getLocalUsage: (): Promise<LocalBackupsUsage> => invoke('saves:getLocalUsage'),
  cleanLocalBackups: (): Promise<{ files: number; bytes: number; folders: number }> =>
    invoke('saves:cleanLocalBackups'),

  // Identidad de esta máquina en el bucket. needsIdentityCheck es local y
  // gratis; checkIdentity es la que va a la red (solo a petición).
  needsIdentityCheck: (): Promise<boolean> => invoke('saves:needsIdentityCheck'),
  checkIdentity: (): Promise<IdentityCheck | null> => invoke('saves:checkIdentity'),
  adoptMachine: (machineId: string): Promise<void> => invoke('saves:adoptMachine', machineId),
  keepIdentity: (): Promise<void> => invoke('saves:keepIdentity'),
  // Id duplicado (otra instalación usa el de este PC). getInstallIdentity es local.
  getInstallIdentity: (): Promise<InstallIdentityStatus> => invoke('saves:getInstallIdentity'),
  resolveDuplicate: (resolution: DuplicateResolution): Promise<void> =>
    invoke('saves:resolveDuplicate', resolution),

  // Qué hay de verdad en el bucket, y cómo rescatar lo que el índice no sepa.
  scanBucket: (): Promise<CloudInventory> => invoke('saves:scanBucket'),
  recoverFromCloud: (): Promise<RecoveryResult> => invoke('saves:recoverFromCloud'),
  deleteMachine: (machineId: string): Promise<number> => invoke('saves:deleteMachine', machineId),
  // Borra saves/<saveKey>/ de TODOS los PCs. Irreversible.
  purgeFolder: (saveKey: string): Promise<number> => invoke('saves:purgeFolder', saveKey),

  scanLibrary: (): Promise<SavesScanEntry[]> => invoke('saves:scanLibrary'),
  getGameState: (gameId: GameId): Promise<SavesGameState | null> =>
    invoke('saves:getGameState', gameId),

  // ludusaviName solo lo manda la pantalla de resultados del escaneo, que es
  // la única que ya sabe con qué juego de ludusavi casó cada fila.
  setEnabled: (gameId: GameId, enabled: boolean, ludusaviName?: string): Promise<boolean> =>
    invoke('saves:setEnabled', gameId, enabled, ludusaviName),
  detect: (gameId: GameId): Promise<string | null> => invoke('saves:detect', gameId),
  // Deshacer un emparejado automático (§4: ludusavi puede casar con el juego
  // equivocado, o con uno sin un solo archivo local) — devuelve a "sin
  // detectar" sin tocar las carpetas propias.
  clearDetection: (gameId: GameId): Promise<boolean> => invoke('saves:clearDetection', gameId),
  addFolder: (gameId: GameId, folder: string): Promise<string | null> =>
    invoke('saves:addFolder', gameId, folder),
  removeFolder: (gameId: GameId, folder: string): Promise<boolean> =>
    invoke('saves:removeFolder', gameId, folder),

  backupNow: (gameId: GameId): Promise<SavesBackupResult | null> =>
    invoke('saves:backupNow', gameId),
  restore: (request: RestoreRequestInput): Promise<RestoreResult> =>
    invoke('saves:restore', request),
  setRestoreTarget: (gameId: GameId, target: string | null): Promise<void> =>
    invoke('saves:setRestoreTarget', gameId, target),
  deleteBackup: (backupId: SaveBackupId, gameId: GameId): Promise<boolean> =>
    invoke('saves:deleteBackup', backupId, gameId),

  // Copias automáticas en marcha (al cerrar una sesión). Devuelve la función
  // de limpieza que quita el listener, para encajar con el cleanup de
  // useEffect — mismo contrato que watcher.onGamesChanged.
  onActivity: (callback: (event: SavesActivityEvent) => void): (() => void) =>
    subscribe('saves:activity', callback),

  // Aviso de "tu --preview va a esperar detrás de otra operación" — enviado
  // por saves:getGameState en el instante en que se pide el estado, antes de
  // que la promesa resuelva (ver ipc/saves.ts). Mismo contrato que onActivity.
  onQueued: (callback: (event: SavesQueuedEvent) => void): (() => void) =>
    subscribe('saves:queued', callback),
};
