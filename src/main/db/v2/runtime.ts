import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openLocalDatabase, type LocalDatabase } from './connection';
import { importLegacyDatabase, type ImportReport } from './importer';
import { LOCAL_DATABASE_FILE } from './importer/appData';
import { copySourceConsistently, removeDatabaseFiles } from './importer/sourceCopy';
import { createQueryContext, type QueryContext } from './queries/common/context';
import { ensureThisDevice, type ThisDeviceInfo } from './queries/common/device';
import { saveMaintenanceForeignWriteRule } from './queries/saves/maintenanceRule';

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
// Quién puede importar lo decide quien llama (`allowImport`): en la fase 2
// solo el perfil de desarrollo y los e2e. La app instalada de la 1.x NO se
// migra desde aquí hasta el corte de la fase 10, con su reclamo en Turso.

export interface OpenAppDatabaseOptions {
  readonly userDataDir: string;
  readonly deviceId: string;
  readonly migrationsFolder: string;
  readonly device: Omit<ThisDeviceInfo, 'now'>;
  /** ¿Se puede importar la 1.x de esta carpeta si aún no hay base 2.0? */
  readonly allowImport: boolean;
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
    if (existsSync(legacy)) {
      if (!options.allowImport) {
        throw new AppDatabaseError(
          'Esta carpeta de datos es de la 1.x y esta versión no puede migrarla todavía.',
        );
      }
      imported = importLegacy(options, legacy, target, now(), log);
    }
  }

  const local = openLocalDatabase({
    path: target,
    deviceId: options.deviceId,
    migrationsFolder: options.migrationsFolder,
    foreignWriteRules: [saveMaintenanceForeignWriteRule],
  });
  const ctx = createQueryContext(local, { now });
  ensureThisDevice(ctx, { ...options.device, now: now() });
  return { local, ctx, imported };
}

function importLegacy(
  options: OpenAppDatabaseOptions,
  legacy: string,
  target: string,
  started: Date,
  log: (message: string) => void,
): ImportReport {
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
