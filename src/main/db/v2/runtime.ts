import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openLocalDatabase, type LocalDatabase } from './connection';
import { importLegacyDatabase, type ImportReport, type LegacyQueryViews } from './importer';
import { LOCAL_DATABASE_FILE } from './importer/appData';
import { copySourceConsistently, removeDatabaseFiles } from './importer/sourceCopy';
import { createQueryContext, type QueryContext } from './queries/common/context';
import { ensureThisDevice, type ThisDeviceInfo } from './queries/common/device';
import { saveMaintenanceForeignWriteRule } from './queries/saves/maintenanceRule';
import { markSaveReindexPending } from './queries/saves/postImport';
import { timerForeignWriteRule } from './queries/sessions/timerRule';

// La base 2.0 de la app en marcha (AFTERPLAY-2.0.md §8.9, CONSULTAS.md P9).
//
// Una sola conexión SÍNCRONA para todo el proceso, abierta al arrancar antes
// de registrar el IPC: no hay red de por medio (el sync con Turso desaparece
// del escritorio), así que abrir cuesta milisegundos y ya no hace falta la
// puerta de arranque de `withDbAccess`.
//
// LA PRIMERA VEZ en una carpeta de datos sin `Afterplay2.db`, si hay una
// `Afterplay.db` 1.x al lado, se importa (§19.5-19.6):
//   1. Copia consistente de la 1.x a `backups/` (la 1.x nunca se abre: §19.1,
//      "nada se destruye").
//   2. Importación y validación directamente en `Afterplay2.db` (la única
//      ruta que el importador acepta con la opción `cutover`). Todo va en
//      una transacción, pero las migraciones del esquema se confirman antes:
//      un marcador `Afterplay2.db.importing` dice que la base aún no vale.
//   3. Si algo falla, o la app muere a medias (el marcador sigue ahí al
//      volver), se borra la base 2.0 y la app no arranca: la 1.x sigue
//      intacta y se vuelve a intentar en el siguiente arranque.
//
// Quién puede importar AQUÍ lo decide quien llama (`allowImport`): solo el
// perfil de desarrollo y los e2e. La app instalada migra con el orquestador del
// corte (`migration/cutover.ts`: reclamo en Turso, hub...), que usa la misma
// `importLegacyIntoLocal` de más abajo ANTES de abrir la base.

export interface OpenAppDatabaseOptions {
  readonly userDataDir: string;
  readonly deviceId: string;
  readonly migrationsFolder: string;
  readonly device: Omit<ThisDeviceInfo, 'now'>;
  /** ¿Se puede importar la 1.x de esta carpeta si aún no hay base 2.0? */
  readonly allowImport: boolean;
  /**
   * Crear una base 2.0 VACÍA aunque haya una 1.x al lado, sin importarla: el
   * PC secundario del corte (§19.6), que lo baja todo del hub. Solo lo pide el
   * orquestador (`migration/cutover.ts`); sin él, una 1.x sin importar sigue
   * siendo un error.
   */
  readonly freshDatabase?: boolean;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

export interface OpenedAppDatabase {
  readonly local: LocalDatabase;
  readonly ctx: QueryContext;
  /** El informe si esta apertura importó la 1.x; null si la base ya existía. */
  readonly imported: ImportReport | null;
}

export class AppDatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppDatabaseError';
  }
}

const LEGACY_FILE = 'Afterplay.db';
const IMPORTING_SUFFIX = '.importing';

/** La `Afterplay.db` 1.x de una carpeta de datos (puede no existir). */
export const legacyDatabasePath = (userDataDir: string): string => join(userDataDir, LEGACY_FILE);

/** La base 2.0 de una carpeta de datos (puede no existir). */
export const localDatabasePath = (userDataDir: string): string =>
  join(userDataDir, LOCAL_DATABASE_FILE);

/**
 * Borra la base 2.0 de la carpeta y su marcador de "importando". Solo para
 * quien la abrió y ya la cerró (o no llegó a abrirla): el orquestador del
 * corte, cuando una importación falla o se repite.
 */
export function removeLocalDatabase(userDataDir: string): void {
  const target = localDatabasePath(userDataDir);
  removeDatabaseFiles(target);
  rmSync(`${target}${IMPORTING_SUFFIX}`, { force: true });
}

const stamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-');

/** Abre (y la primera vez, importa) la base 2.0 de esta carpeta de datos. */
export function openAppDatabase(options: OpenAppDatabaseOptions): OpenedAppDatabase {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.log(message));
  const target = join(options.userDataDir, LOCAL_DATABASE_FILE);
  let imported: ImportReport | null = null;

  // Una importación que no terminó (la app murió a medias): esa base no vale.
  if (existsSync(`${target}${IMPORTING_SUFFIX}`)) {
    log('[v2] la importación anterior no terminó: se repite');
    removeDatabaseFiles(target);
    rmSync(`${target}${IMPORTING_SUFFIX}`, { force: true });
  }

  if (!existsSync(target)) {
    const legacy = join(options.userDataDir, LEGACY_FILE);
    if (existsSync(legacy) && !options.freshDatabase) {
      if (!options.allowImport) {
        throw new AppDatabaseError(
          'Esta carpeta de datos es de la 1.x y esta versión no puede migrarla todavía.',
        );
      }
      imported = importLegacyIntoLocal({ ...options, now: now(), log });
    }
  }

  const local = openLocalDatabase({
    path: target,
    deviceId: options.deviceId,
    migrationsFolder: options.migrationsFolder,
    foreignWriteRules: [saveMaintenanceForeignWriteRule, timerForeignWriteRule],
  });
  const ctx = createQueryContext(local, { now });
  ensureThisDevice(ctx, { ...options.device, now: now() });
  // `save_backups` no se importa (§19.5): el índice se reindexa desde el bucket
  // en segundo plano cuando haya credenciales. El marcador es local y se deja
  // aquí, ya fuera de la transacción de la importación; lo cumple (y lo
  // reintenta si falla) `saves/postImportReindex.ts`.
  if (imported) markSaveReindexPending(ctx);
  return { local, ctx, imported };
}

export interface ImportLegacyIntoLocalOptions {
  readonly userDataDir: string;
  readonly deviceId: string;
  readonly migrationsFolder: string;
  readonly now: Date;
  readonly log: (message: string) => void;
  /** La foto de las lecturas 1.x, si quien llama pudo tomarla (ver importer/index.ts). */
  readonly legacyQueryViews?: LegacyQueryViews;
}

/**
 * LA importación de la app (§19.6 paso 4): copia consistente de la 1.x a
 * `backups/`, importa y valida desde esa copia directamente en `Afterplay2.db`
 * y, si algo falla, borra la base 2.0 y relanza (la 1.x no se ha tocado).
 * La usan el arranque del perfil de desarrollo / e2e (`openAppDatabase`) y el
 * orquestador del corte (`migration/cutover.ts`): un solo camino.
 *
 * Las sesiones abiertas se importan cerradas en su último latido, en
 * producción también (§19.6 paso 3). Un buzón con órdenes pendientes sigue
 * abortando (§19.7).
 */
export function importLegacyIntoLocal(options: ImportLegacyIntoLocalOptions): ImportReport {
  const { log } = options;
  const started = options.now;
  const target = join(options.userDataDir, LOCAL_DATABASE_FILE);
  const legacy = join(options.userDataDir, LEGACY_FILE);
  const backups = join(options.userDataDir, 'backups');
  mkdirSync(backups, { recursive: true });
  // Nunca pisa una copia anterior (dos intentos en el mismo milisegundo, o un reloj atrasado).
  let copy = join(backups, `Afterplay-before-v2-${stamp(started)}.db`);
  for (let attempt = 2; existsSync(copy); attempt++) {
    copy = join(backups, `Afterplay-before-v2-${stamp(started)}-${attempt}.db`);
  }
  const raw = `${copy}.raw`;
  const marker = `${target}${IMPORTING_SUFFIX}`;
  writeFileSync(marker, started.toISOString());

  log('[v2] importando la base 1.x a la 2.0 (primera apertura)');
  let report: ImportReport;
  try {
    copySourceConsistently(legacy, raw, copy);
    removeDatabaseFiles(raw);
    const fresh = openLocalDatabase({
      path: target,
      deviceId: options.deviceId,
      migrationsFolder: options.migrationsFolder,
    });
    try {
      report = importLegacyDatabase({
        source: copy,
        target: fresh,
        deviceId: options.deviceId,
        claimInstalls: true,
        closeOpenSessions: true,
        legacyQueryViews: options.legacyQueryViews,
        cutover: { userDataDir: options.userDataDir },
      });
    } finally {
      fresh.close();
    }
  } catch (error) {
    removeDatabaseFiles(target);
    rmSync(marker, { force: true });
    throw new AppDatabaseError(
      'No se pudo importar la base 1.x. No se ha cambiado nada: la 1.x sigue intacta.',
      { cause: error },
    );
  }
  rmSync(marker);
  log(
    `[v2] importación terminada en ${Math.round(report.elapsedMs)} ms; copia de la 1.x en backups/`,
  );
  return report;
}
