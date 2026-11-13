import { and, eq, inArray } from 'drizzle-orm';
import type { SaveBackupRow } from '../../../../../shared/dto';
import { saveBackupId } from '../../../../../shared/sync/ids';
import { devices, games, saveBackups } from '../../schema';
import { StoreError, alive } from '../../store';
import type { QueryContext } from '../common';
import {
  UNKNOWN_DEVICE_NAME,
  getSaveBackup,
  getSaveBackupsByIds,
  listSaveBackups,
} from './backupIndex';
import { withSaveMaintenance } from './maintenanceRule';
import { parseSaveObjectKey, saveObjectKey } from './objectKey';

// Escrituras del índice de partidas (`save_backups`) sobre el esquema 2.0
// (CONSULTAS.md §2.2 "saves", §2.4 y §3.4). Todo por la puerta.
//
// Patrón común, el de §2.3: la red va FUERA. Quien llama sube o borra en el
// bucket primero y después llama aquí con lo que ha quedado; cada función es
// UNA transacción síncrona que relee lo que necesita. En el orden de hoy:
// primero el bucket, luego el índice, para que un fallo a medias deje como
// mucho una fila que apunta a algo que ya no está, nunca un objeto huérfano.
//
// Exclusión entre copias del mismo juego. Hoy la da un `withDbAccess` alrededor
// de ludusavi y la subida (`sessionHook.ts`), más la cadena por juego de
// `orchestrator.ts` (`serializeGameBackup`). Con el driver síncrono no hay
// candado que pedir, y no hace falta nada más de la base: cada escritura de
// aquí relee las filas dentro de su transacción, y el id determinista impide
// duplicar una copia aunque dos pasadas la registren a la vez (F-21). La cola
// en memoria por juego (ludusavi + bucket) basta.
//
// `contentHash` y `parentContentHash` se omiten (H-2): la huella y el linaje
// son de la fase 6 (§12.2-12.4).

/** Una versión que acaba de quedar en la carpeta de ESTE PC en el bucket. */
export interface NewOwnSaveBackup {
  readonly backupName: string;
  /** La fecha del mapping.yaml; null = no consta (se usa "ahora", como la 1.x). */
  readonly createdAt: Date | null;
  /** Tamaño del OBJETO en el bucket (lo que se paga), no del fichero local. */
  readonly sizeBytes: number;
  readonly ludusaviName: string;
  readonly differential: boolean;
  readonly parentBackupName: string | null;
  readonly locations: string[] | null;
  readonly hasRegistry: boolean;
}

/** Lo que el espejo decide sobre una fila propia ya indexada. */
export interface OwnSaveBackupRef {
  readonly id: string;
  readonly backupName: string;
  readonly createdAt: Date;
}

export interface ReconcileOwnSaveBackupsInput {
  readonly gameId: string;
  /** El prefijo con el que se ha subido (`games.saveKey`). Tiene que coincidir con el del juego. */
  readonly saveKey: string;
  /**
   * ¿Ha caducado esta fila propia? Es la regla de hoy (no está en la carpeta
   * local y no la protege el suelo de poda), que depende de disco y de
   * machine-saves.json: la decide quien llama, aquí solo se aplica a las filas
   * releídas dentro de la transacción.
   */
  readonly isStale: (row: OwnSaveBackupRef) => boolean;
  /**
   * Versiones que están de verdad en el bucket y que su mapping.yaml describe.
   * `null` = el mapping.yaml de arriba no se pudo fusionar: se poda igual,
   * pero no se indexa nada (una versión sin su nodo no se puede restaurar).
   */
  readonly versions: readonly NewOwnSaveBackup[] | null;
}

export interface ReconcileOwnSaveBackupsResult {
  /** False si el juego no existe o está borrado: entonces no se escribe nada (R-15). */
  readonly gameAlive: boolean;
  /** Ids de las filas propias que han recibido lápida. */
  readonly removed: string[];
  /** Las filas creadas (o resucitadas), releídas. */
  readonly created: SaveBackupRow<string>[];
}

/**
 * El paso 4 de `syncGameToR2`: reconciliar el índice de ESTE PC para un juego
 * con lo que ha quedado en el bucket. En una transacción: lápida a las filas
 * propias caducadas y alta de las versiones que falten.
 *
 * - Solo toca filas propias: las de otros PCs del mismo juego están en la
 *   misma tabla y no se leen (sin ese filtro, el primer backup de un PC daría
 *   por caducadas las del otro).
 * - Registrar dos veces la misma versión no duplica: el id sale de la clave.
 * - Una versión cuya fila tenía lápida (borrada desde la ficha pero con el zip
 *   todavía en la carpeta local) RESUCITA, igual que hoy la volvía a insertar
 *   el siguiente backup. Que el dueño borre su zip al ver la lápida es de la
 *   fase 6 (§12.5).
 *
 * Lanza `StoreError('invalid_value')` si `saveKey` no es el del juego o una
 * versión no forma una clave válida. Propaga los errores de la puerta.
 */
export function reconcileOwnSaveBackups(
  ctx: QueryContext,
  input: ReconcileOwnSaveBackupsInput,
): ReconcileOwnSaveBackupsResult {
  const outcome = ctx.store.transaction(() => {
    const game = ctx.db
      .select({ saveKey: games.saveKey, deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, input.gameId))
      .get();
    if (!game || game.deleted !== null) return null;
    if (game.saveKey !== input.saveKey) {
      throw new StoreError(
        'invalid_value',
        `save_backups: el juego ${input.gameId} usa el prefijo ${String(game.saveKey)}, no ${input.saveKey}`,
      );
    }

    // `alive()` a secas: el juego ya se ha comprobado vivo arriba.
    const own = ctx.db
      .select({
        id: saveBackups.id,
        backupName: saveBackups.backupName,
        createdAt: saveBackups.createdAt,
      })
      .from(saveBackups)
      .where(
        and(
          eq(saveBackups.gameId, input.gameId),
          eq(saveBackups.deviceId, ctx.deviceId),
          alive(saveBackups),
        ),
      )
      .all();

    const removed: string[] = [];
    const known = new Set<string>();
    for (const row of own) {
      if (input.isStale(row)) {
        ctx.store.remove('save_backups', row.id);
        removed.push(row.id);
      } else {
        known.add(row.backupName);
      }
    }

    const created: string[] = [];
    for (const version of input.versions ?? []) {
      if (known.has(version.backupName)) continue;
      known.add(version.backupName);
      const r2Key = keyOrThrow(() =>
        saveObjectKey({
          saveKey: input.saveKey,
          deviceId: ctx.deviceId,
          backupName: version.backupName,
        }),
      );
      const { id } = ctx.store.create('save_backups', {
        gameId: input.gameId,
        deviceId: ctx.deviceId,
        r2Key,
        backupName: version.backupName,
        createdAt: version.createdAt ?? ctx.now(),
        sizeBytes: version.sizeBytes,
        ludusaviName: version.ludusaviName,
        differential: version.differential,
        parentBackupName: version.parentBackupName,
        locations: version.locations,
        hasRegistry: version.hasRegistry,
      });
      created.push(id);
    }
    return { removed, created };
  });
  if (!outcome) return { gameAlive: false, removed: [], created: [] };
  return {
    gameAlive: true,
    removed: outcome.removed,
    created: getSaveBackupsByIds(ctx, outcome.created),
  };
}

/**
 * Lápida a copias PROPIAS por id, en una transacción (`deleteSaveBackups`).
 * Devuelve cuántas se han borrado; las que no existen o ya tenían lápida se
 * saltan. Una copia de otro dispositivo es un error de quien llama y propaga
 * `StoreError('not_owner')`: las ajenas solo se borran por las rutas de
 * mantenimiento (`deletePlannedSaveBackups`, `deleteDeviceSaveBackups`).
 */
export function deleteSaveBackups(ctx: QueryContext, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  return ctx.store.transaction(() => removeLive(ctx, ids, null));
}

/** Qué se borra al borrar una versión desde la ficha (`saves:deleteBackup`). */
export interface SaveBackupDeletionPlan {
  /** El dueño de la versión: todo lo que se borra es suyo. */
  readonly deviceId: string;
  /** Si el dueño es este PC (entonces también se limpia la copia local). */
  readonly isOwn: boolean;
  /** La versión pedida primero y después los diferenciales que cuelgan de ella. */
  readonly doomed: SaveBackupRow<string>[];
}

/**
 * Lo que hay que borrar (del bucket y del índice) para quitar una versión, o
 * null si no es una copia viva de ese juego. Un completo arrastra a sus
 * diferenciales, pero solo los de la MISMA máquina: cada una tiene su propio
 * prefijo, y un diferencial de otra nunca cuelga de un completo de esta aunque
 * el nombre coincida (comentario de `ipc/saves.ts`).
 */
export function planSaveBackupDeletion(
  ctx: QueryContext,
  backupId: string,
  gameId: string,
): SaveBackupDeletionPlan | null {
  const row = getSaveBackup(ctx, backupId, gameId);
  if (!row) return null;
  const dependents = listSaveBackups(ctx, gameId).filter(
    (candidate) =>
      candidate.id !== row.id &&
      candidate.parentBackupName === row.backupName &&
      candidate.machineId === row.machineId,
  );
  return {
    deviceId: row.machineId,
    isOwn: row.machineId === ctx.deviceId,
    doomed: [row, ...dependents],
  };
}

/**
 * El segundo paso de `saves:deleteBackup`, después de borrar los objetos del
 * bucket: lápida a las filas del plan, en una transacción. Si la versión es de
 * otro PC, es una de las tres rutas de mantenimiento de R-13 (borrado cruzado,
 * §12.5) y solo admite filas de ESE dispositivo.
 *
 * Devuelve cuántas filas se han borrado; las que ya no existen o ya tenían
 * lápida se saltan (alguien las borró entre el plan y ahora). Lanza
 * `StoreError('invalid_value')` si una fila del plan no es del dispositivo del
 * plan, y `not_owner` si la regla de R-13 no está registrada en la puerta.
 */
export function deletePlannedSaveBackups(ctx: QueryContext, plan: SaveBackupDeletionPlan): number {
  const ids = plan.doomed.map((row) => row.id);
  if (ids.length === 0) return 0;
  const run = (): number => ctx.store.transaction(() => removeLive(ctx, ids, plan.deviceId));
  return plan.deviceId === ctx.deviceId
    ? run()
    : withSaveMaintenance('delete_backup', [plan.deviceId], run);
}

/**
 * El paso de índice de `deleteMachineFromCloud`, después de borrar del bucket
 * todo lo de esa máquina: lápida a todas sus copias vivas, de cualquier juego
 * (también de juegos borrados o planeados: sus objetos ya no existen). Es una
 * de las tres rutas de mantenimiento de R-13. La fila de `devices` se queda:
 * un dispositivo no se borra nunca.
 *
 * Devuelve cuántas filas se han borrado. Lanza `StoreError('invalid_value')`
 * si `deviceId` es este PC (borraría sus propias copias, como protege hoy
 * `recovery.ts`), y `not_owner` si la regla no está registrada.
 */
export function deleteDeviceSaveBackups(ctx: QueryContext, deviceId: string): number {
  if (deviceId === ctx.deviceId) {
    throw new StoreError(
      'invalid_value',
      'save_backups: ese dispositivo es este PC; borrar su carpeta borraría sus propias copias',
    );
  }
  return withSaveMaintenance('delete_machine', [deviceId], () =>
    ctx.store.transaction(() => {
      // `alive()` a secas, a propósito: también las de juegos borrados.
      const ids = ctx.db
        .select({ id: saveBackups.id })
        .from(saveBackups)
        .where(and(eq(saveBackups.deviceId, deviceId), alive(saveBackups)))
        .all()
        .map((row) => row.id);
      return removeLive(ctx, ids, deviceId);
    }),
  );
}

/** Un dispositivo según el bucket (`machines/<id>.json`). */
export interface BucketDevice {
  readonly deviceId: string;
  /** `machineName` del manifiesto; null si no hay manifiesto. */
  readonly name: string | null;
  /** `home` del manifiesto, o el deducido de las rutas del mapping.yaml; null si nada. */
  readonly home: string | null;
}

/** Una versión del bucket que el índice no conoce, ya casada con su juego. */
export interface RecoveredSaveBackup {
  readonly gameId: string;
  /** La clave tal como sale en el listado del bucket. */
  readonly r2Key: string;
  readonly createdAt: Date | null;
  readonly sizeBytes: number;
  readonly ludusaviName: string;
  readonly differential: boolean;
  readonly parentBackupName: string | null;
  readonly locations: string[] | null;
  readonly hasRegistry: boolean;
}

export interface RecoverSaveBackupsInput {
  /** Los manifiestos leídos. Un dispositivo sin entrada aquí sale como "Unknown PC". */
  readonly devices: readonly BucketDevice[];
  readonly backups: readonly RecoveredSaveBackup[];
}

export interface RecoverSaveBackupsResult {
  /** Filas creadas o resucitadas. */
  readonly recovered: number;
  /** Ya estaban vivas en el índice: no se tocan. */
  readonly alreadyIndexed: number;
  /** Su juego no existe o está borrado (R-15). */
  readonly skippedNoGame: number;
}

/**
 * Las escrituras de `recoverIndexFromCloud`, en una transacción. Quien llama
 * lista el bucket, lee los manifiestos y los mapping.yaml y casa cada carpeta
 * con su juego por `saveKey`; esto solo escribe.
 *
 * - Antes de la primera copia de otra máquina se crea su fila de `devices`
 *   (`kind: 'desktop'`, `os: 'windows'`, nombre y carpeta del manifiesto,
 *   `firstSeenAt` = la copia más antigua que se recupera de ella). Si ya
 *   existe no se pisa el nombre (es editable); solo se rellena `home` si
 *   faltaba.
 * - Las copias de otras máquinas son una de las tres rutas de R-13.
 * - El id sale de la clave: una copia ya indexada no se duplica, y una con
 *   lápida cuyo objeto sigue en el bucket resucita (el bucket es la verdad,
 *   como hoy: una fila que falta se recupera).
 *
 * Lanza `StoreError('invalid_value')` si una clave no tiene la forma de
 * `objectKey.ts` o su `saveKey` no es el del juego, y `not_owner` si la regla
 * de R-13 no está registrada y hay copias ajenas.
 */
export function recoverSaveBackups(
  ctx: QueryContext,
  input: RecoverSaveBackupsInput,
): RecoverSaveBackupsResult {
  const parsed = input.backups.map((backup) => {
    const parts = parseSaveObjectKey(backup.r2Key);
    if (!parts) {
      throw new StoreError(
        'invalid_value',
        `save_backups: clave de bucket inválida (${backup.r2Key})`,
      );
    }
    return { backup, parts };
  });
  const foreign = new Set(
    parsed.map(({ parts }) => parts.deviceId).filter((id) => id !== ctx.deviceId),
  );
  const info = new Map(input.devices.map((device) => [device.deviceId, device]));

  return withSaveMaintenance('recover_index', foreign, () =>
    ctx.store.transaction(() => {
      let recovered = 0;
      let alreadyIndexed = 0;
      let skippedNoGame = 0;
      const ensured = new Set<string>();

      // La copia más antigua de cada máquina entre las que se van a crear.
      const firstSeen = new Map<string, number>();
      const pending: typeof parsed = [];
      for (const entry of parsed) {
        const game = ctx.db
          .select({ saveKey: games.saveKey, deleted: games.syncDeleted })
          .from(games)
          .where(eq(games.id, entry.backup.gameId))
          .get();
        if (!game || game.deleted !== null) {
          skippedNoGame++;
          continue;
        }
        if (game.saveKey !== entry.parts.saveKey) {
          throw new StoreError(
            'invalid_value',
            `save_backups: ${entry.backup.r2Key} no es del juego ${entry.backup.gameId} (prefijo ${String(game.saveKey)})`,
          );
        }
        const existing = ctx.db
          .select({ deleted: saveBackups.syncDeleted })
          .from(saveBackups)
          .where(eq(saveBackups.id, saveBackupId(entry.backup.r2Key)))
          .get();
        if (existing && existing.deleted === null) {
          alreadyIndexed++;
          continue;
        }
        pending.push(entry);
        const when = entry.backup.createdAt?.getTime();
        if (when !== undefined) {
          const seen = firstSeen.get(entry.parts.deviceId);
          if (seen === undefined || when < seen) firstSeen.set(entry.parts.deviceId, when);
        }
      }

      for (const { backup, parts } of pending) {
        const deviceId = parts.deviceId;
        if (deviceId !== ctx.deviceId && !ensured.has(deviceId)) {
          ensureBucketDevice(ctx, deviceId, info.get(deviceId), firstSeen.get(deviceId));
          ensured.add(deviceId);
        }
        ctx.store.create('save_backups', {
          gameId: backup.gameId,
          deviceId,
          r2Key: backup.r2Key,
          backupName: parts.backupName,
          createdAt: backup.createdAt ?? ctx.now(),
          sizeBytes: backup.sizeBytes,
          ludusaviName: backup.ludusaviName,
          differential: backup.differential,
          parentBackupName: backup.parentBackupName,
          locations: backup.locations,
          hasRegistry: backup.hasRegistry,
        });
        recovered++;
      }
      return { recovered, alreadyIndexed, skippedNoGame };
    }),
  );
}

/**
 * La fila de `devices` de otra máquina del bucket (tabla U: cualquiera la
 * crea). No se pisa una existente salvo para rellenar `home` si faltaba.
 */
function ensureBucketDevice(
  ctx: QueryContext,
  deviceId: string,
  info: BucketDevice | undefined,
  firstSeenAt: number | undefined,
): void {
  const home = info?.home ? info.home : null;
  const existing = ctx.db
    .select({ home: devices.home })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get();
  if (existing) {
    if (existing.home === null && home !== null) ctx.store.patch('devices', deviceId, { home });
    return;
  }
  ctx.store.create('devices', {
    id: deviceId,
    name: info?.name ? info.name : UNKNOWN_DEVICE_NAME,
    kind: 'desktop',
    // En la 2.0 todos los escritorios son Windows (D-14).
    os: 'windows',
    // Lo que no consta se omite (H-2).
    ...(home !== null ? { home } : {}),
    firstSeenAt: firstSeenAt !== undefined ? new Date(firstSeenAt) : ctx.now(),
  });
}

/**
 * Lápida a las filas vivas de `ids`. Con `deviceId`, todas tienen que ser de
 * ese dispositivo. Devuelve cuántas se han borrado. Va dentro de una
 * transacción de quien llama.
 */
function removeLive(ctx: QueryContext, ids: readonly string[], deviceId: string | null): number {
  const rows = ctx.db
    .select({ id: saveBackups.id, deviceId: saveBackups.deviceId })
    .from(saveBackups)
    .where(and(inArray(saveBackups.id, [...new Set(ids)]), alive(saveBackups)))
    .all();
  for (const row of rows) {
    if (deviceId !== null && row.deviceId !== deviceId) {
      throw new StoreError(
        'invalid_value',
        `save_backups: la fila ${row.id} es de ${row.deviceId}, no de ${deviceId}`,
      );
    }
  }
  for (const row of rows) ctx.store.remove('save_backups', row.id);
  return rows.length;
}

function keyOrThrow(build: () => string): string {
  try {
    return build();
  } catch (error) {
    throw new StoreError('invalid_value', `save_backups: ${(error as Error).message}`);
  }
}
