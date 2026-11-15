import { and, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { SaveBackupRow } from '../../../../../shared/dto';
import { devices, games, saveBackups } from '../../schema';
import { alive } from '../../store';
import { liveGame, liveRow } from '../common';
import type { QueryContext } from '../common';

// Lecturas del índice de partidas (`save_backups`) sobre el esquema 2.0. Sustituyen
// a `db/queries/saves/{getSaveBackups,getSaveBackupsUsage,getLocalBackupsIndex}`,
// a la lectura de `verifyStorageRestore.ts` y a `hasIndexedBackups` de
// `ipc/settings.ts` (CONSULTAS.md §2.2 "saves", §2.4).
//
// Qué filas cuentan. `save_backups` no es hijo del juego (registro: `keep`),
// así que borrar un juego deja sus filas vivas. La app no enseña nada de un
// juego borrado, así que lo normal es `liveRow.save_backups` (fila viva y juego
// vivo): es lo que hacía la cascada de la 1.x. La excepción está comentada
// donde se usa.

/** Unión con `devices`, para el nombre y la carpeta de usuario del dueño. */
const selection = {
  id: saveBackups.id,
  gameId: saveBackups.gameId,
  createdAt: saveBackups.createdAt,
  backupName: saveBackups.backupName,
  r2Key: saveBackups.r2Key,
  sizeBytes: saveBackups.sizeBytes,
  ludusaviName: saveBackups.ludusaviName,
  differential: saveBackups.differential,
  parentBackupName: saveBackups.parentBackupName,
  machineId: saveBackups.deviceId,
  deviceName: devices.name,
  deviceHome: devices.home,
  locations: saveBackups.locations,
  hasRegistry: saveBackups.hasRegistry,
  contentHash: saveBackups.contentHash,
};

/**
 * Nombre que se enseña si falta la fila de `devices` (no debería: la clave
 * foránea lo impide al escribir, pero una fila llegada por sync puede
 * adelantarse a la de su dispositivo). Es el mismo texto que la 1.x pone al
 * recuperar una copia sin manifiesto.
 */
export const UNKNOWN_DEVICE_NAME = 'Unknown PC';

function selectBackups(ctx: QueryContext, where: SQL | undefined): SaveBackupRow<string>[] {
  return (
    ctx.db
      .select(selection)
      .from(saveBackups)
      // `devices` no se borra nunca (se da de baja con revokedAt): no hace falta
      // condición de vida en la unión.
      .leftJoin(devices, eq(devices.id, saveBackups.deviceId))
      .where(where)
      // El orden entre versiones es el del reloj de sync, no la hora de pared
      // de cada PC (§12.5): un PC con el reloj mal no adelanta sus copias. La
      // hora del backup solo desempata dos del mismo reloj.
      .orderBy(desc(saveBackups.syncCreated), desc(saveBackups.createdAt), desc(saveBackups.id))
      .all()
      .map(({ deviceName, deviceHome, ...row }) => ({
        ...row,
        machineName: deviceName ?? UNKNOWN_DEVICE_NAME,
        // [S] Por dispositivo, no por copia (MAPA nota 7). `''` = no se sabe,
        // que `buildRedirects` ya trata como "no redirigir" (como la 1.x al
        // recuperar una copia cuyo home no se pudo deducir).
        machineHome: deviceHome ?? '',
      }))
  );
}

/**
 * Las copias de un juego, de todos los dispositivos, la más reciente primero
 * (`getSaveBackups`). Vacío si el juego no existe o está borrado.
 */
export function listSaveBackups(ctx: QueryContext, gameId: string): SaveBackupRow<string>[] {
  return selectBackups(ctx, and(eq(saveBackups.gameId, gameId), liveRow.save_backups()));
}

/**
 * Una copia viva de un juego vivo, o null (el `rows.find(id)` de
 * `saves:restore` y `saves:deleteBackup`). Con `gameId` exige además que sea
 * de ese juego.
 */
export function getSaveBackup(
  ctx: QueryContext,
  backupId: string,
  gameId?: string,
): SaveBackupRow<string> | null {
  const conditions = [eq(saveBackups.id, backupId), liveRow.save_backups()];
  if (gameId !== undefined) conditions.push(eq(saveBackups.gameId, gameId));
  return selectBackups(ctx, and(...conditions))[0] ?? null;
}

/** Varias copias por id (vivas y de juego vivo), en el orden de `listSaveBackups`. */
export function getSaveBackupsByIds(
  ctx: QueryContext,
  ids: readonly string[],
): SaveBackupRow<string>[] {
  if (ids.length === 0) return [];
  return selectBackups(ctx, and(inArray(saveBackups.id, [...ids]), liveRow.save_backups()));
}

/** Cuánto ocupa la nube según el índice, sin preguntar al bucket (`getSaveBackupsUsage`). */
export function getSaveBackupsUsage(ctx: QueryContext): {
  totalBytes: number;
  backupCount: number;
} {
  const row = ctx.db
    .select({
      totalBytes: sql<number>`coalesce(sum(${saveBackups.sizeBytes}), 0)`,
      backupCount: sql<number>`count(*)`,
    })
    .from(saveBackups)
    .where(liveRow.save_backups())
    .get();
  return { totalBytes: Number(row?.totalBytes ?? 0), backupCount: Number(row?.backupCount ?? 0) };
}

/**
 * ¿Hay alguna copia indexada? (`hasIndexedBackups` de `ipc/settings.ts`, que
 * impide cambiar de destino con copias que el destino nuevo no tendría).
 */
export function hasIndexedSaveBackups(ctx: QueryContext): boolean {
  return (
    ctx.db.select({ id: saveBackups.id }).from(saveBackups).where(liveRow.save_backups()).get() !==
    undefined
  );
}

/** Lo mínimo para casar un zip local con su fila (`OwnBackupEntry` de la 1.x). */
export interface OwnBackupEntry {
  readonly ludusaviName: string;
  readonly backupName: string;
  readonly sizeBytes: number;
}

/**
 * Las copias que subió ESTE PC, de todos los juegos (`getOwnBackupEntries`):
 * qué zips locales ya están en la nube y se pueden borrar del disco. Solo de
 * juegos vivos, a propósito: borrar un juego ya no borra sus copias del bucket
 * (§12.7), pero se pueden limpiar a mano (`purgeSaveFolderRows`), y ante la
 * duda la copia local de un juego borrado no se da por prescindible.
 */
export function listOwnBackupEntries(ctx: QueryContext): OwnBackupEntry[] {
  return ctx.db
    .select({
      ludusaviName: saveBackups.ludusaviName,
      backupName: saveBackups.backupName,
      sizeBytes: saveBackups.sizeBytes,
    })
    .from(saveBackups)
    .where(and(eq(saveBackups.deviceId, ctx.deviceId), liveRow.save_backups()))
    .all();
}

/**
 * Todo nombre de ludusavi que el índice o la biblioteca reconocen, de
 * cualquier dispositivo (`getKnownLudusaviNames`): la lista blanca contra la
 * que `localUsage.ts` decide qué carpeta local es huérfana y se borra entera.
 *
 * Aquí se usa `alive()` a secas en `save_backups`, a propósito: es una lista
 * de lo que NO se borra, y ante la duda, no borrar. Las filas de un juego
 * borrado siguen vivas (`keep`) y reaparecen si el juego vuelve (mismo id), así
 * que su carpeta local no se trata como huérfana. Los juegos, en cambio, solo
 * vivos (planeados incluidos, como en la 1.x).
 */
export function listKnownLudusaviNames(ctx: QueryContext): string[] {
  const names = new Set<string>();
  for (const row of ctx.db
    .selectDistinct({ name: saveBackups.ludusaviName })
    .from(saveBackups)
    .where(alive(saveBackups))
    .all()) {
    names.add(row.name);
  }
  for (const row of ctx.db
    .selectDistinct({ name: games.saveLudusaviName })
    .from(games)
    .where(and(liveGame(), isNotNull(games.saveLudusaviName)))
    .all()) {
    if (row.name) names.add(row.name);
  }
  return [...names];
}

/**
 * Las claves del bucket que el índice ya conoce (copias vivas de juegos vivos):
 * lo que separa "ya se puede restaurar" de "huérfano" en `scanBucket` y lo que
 * `recoverIndexFromCloud` se salta. Sustituye a recorrer `getSaveBackups` juego
 * a juego.
 */
export function listIndexedSaveObjectKeys(ctx: QueryContext): Set<string> {
  return new Set(
    ctx.db
      .select({ r2Key: saveBackups.r2Key })
      .from(saveBackups)
      .where(liveRow.save_backups())
      .all()
      .map((row) => row.r2Key),
  );
}

/** Lo que `verifyMigratedRestore` necesita de la copia más reciente. */
export interface LatestSaveBackup {
  readonly r2Key: string;
  readonly backupName: string;
  readonly parentBackupName: string | null;
  readonly ludusaviName: string;
}

/**
 * La copia más reciente del índice, de cualquier dispositivo y juego vivo, o
 * null si no hay ninguna (la lectura de `verifyStorageRestore.ts`).
 */
export function getLatestSaveBackup(ctx: QueryContext): LatestSaveBackup | null {
  return (
    ctx.db
      .select({
        r2Key: saveBackups.r2Key,
        backupName: saveBackups.backupName,
        parentBackupName: saveBackups.parentBackupName,
        ludusaviName: saveBackups.ludusaviName,
      })
      .from(saveBackups)
      .where(liveRow.save_backups())
      .orderBy(desc(saveBackups.syncCreated), desc(saveBackups.createdAt), desc(saveBackups.id))
      .limit(1)
      .get() ?? null
  );
}

/** Una fila del índice para el linaje (§12.3-12.4): viva o con lápida. */
export interface SaveLineageRow {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly contentHash: string | null;
  readonly parentContentHash: string | null;
  readonly alive: boolean;
  readonly createdAt: Date;
  /** `syncCreated`: el orden entre versiones (§12.5). */
  readonly order: string;
}

/**
 * Todas las copias de un juego, de todos los dispositivos, TAMBIÉN las que
 * tienen lápida: una versión podada o borrada sigue diciendo de quién
 * descendía (§12.4, las lápidas no se purgan). Vacío si el juego no existe o
 * está borrado (la ficha de un juego borrado no se enseña).
 */
export function listSaveLineage(ctx: QueryContext, gameId: string): SaveLineageRow[] {
  return ctx.db
    .select({
      id: saveBackups.id,
      deviceId: saveBackups.deviceId,
      deviceName: devices.name,
      contentHash: saveBackups.contentHash,
      parentContentHash: saveBackups.parentContentHash,
      deleted: saveBackups.syncDeleted,
      createdAt: saveBackups.createdAt,
      order: saveBackups.syncCreated,
    })
    .from(saveBackups)
    .innerJoin(games, eq(games.id, saveBackups.gameId))
    .leftJoin(devices, eq(devices.id, saveBackups.deviceId))
    .where(and(eq(saveBackups.gameId, gameId), alive(games)))
    .all()
    .map(({ deleted, deviceName, ...row }) => ({
      ...row,
      deviceName: deviceName ?? UNKNOWN_DEVICE_NAME,
      alive: deleted === null,
    }));
}

/**
 * Los nombres de las copias PROPIAS de un juego que tienen lápida (§12.5,
 * F-23). El dueño las borra de su carpeta local (y del bucket, si alguien las
 * volvió a subir) antes de su siguiente backup, para que no resuciten.
 */
export function listOwnDeletedBackupNames(ctx: QueryContext, gameId: string): string[] {
  return ctx.db
    .select({ backupName: saveBackups.backupName })
    .from(saveBackups)
    .where(
      and(
        eq(saveBackups.gameId, gameId),
        eq(saveBackups.deviceId, ctx.deviceId),
        isNotNull(saveBackups.syncDeleted),
      ),
    )
    .all()
    .map((row) => row.backupName);
}
