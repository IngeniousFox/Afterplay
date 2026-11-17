import { app } from 'electron';
import { hostname, homedir } from 'node:os';
import { join } from 'node:path';
import { isDevProfile } from '../../lib/devProfileRules';
import { isE2E } from '../../lib/e2e';
import { getMachineId, listLegacySaveLocationOverrides } from '../../saves/machine';
import type { LocalDatabase } from './connection';
import type { ImportReport } from './importer';
import { remapLegacyRestoreTargets } from './queries/saves';
import type { QueryContext } from './queries/common/context';
import { importLegacyIntoLocal, openAppDatabase } from './runtime';

// La base 2.0 del proceso principal: se abre UNA vez al arrancar
// (`initAppDb`, desde index.ts, antes de registrar el IPC) y todo lo demás la
// pide con `appCtx()`. Sin red ni candado: el driver es síncrono.

import { APP_SCHEMA_VERSION } from './schemaVersion';

export { APP_SCHEMA_VERSION };

// `out/main/index.js` → raíz del proyecto (sin empaquetar) o del asar.
const MIGRATIONS_FOLDER = join(__dirname, '../../drizzle-v2');

let current: { local: LocalDatabase; ctx: QueryContext } | null = null;

/**
 * Abre la base. Esta función solo importa la 1.x en el perfil de desarrollo y
 * en los e2e. En la app instalada la importa el orquestador del corte
 * (`migration/cutover.ts`) ANTES de abrir; y el PC secundario, que no importa,
 * pide `fresh` para crear una base vacía junto a la 1.x.
 */
export function initAppDb(options: { readonly fresh?: boolean } = {}): ImportReport | null {
  if (current) return null;
  const opened = openAppDatabase({
    userDataDir: app.getPath('userData'),
    deviceId: getMachineId(),
    migrationsFolder: MIGRATIONS_FOLDER,
    device: {
      name: hostname(),
      home: homedir(),
      appVersion: app.getVersion(),
      schemaVersion: APP_SCHEMA_VERSION,
    },
    allowImport: isDevProfile() || isE2E(),
    freshDatabase: options.fresh === true,
  });
  current = { local: opened.local, ctx: opened.ctx };
  if (opened.imported) importSaveRestoreTargets(opened.ctx);
  return opened.imported;
}

/**
 * PUENTE 1.x → L3. La importación del corte (§19.6 paso 4): copia consistente
 * de la 1.x, importa y valida en `Afterplay2.db`, y si algo falla lo borra todo
 * y lanza. Va ANTES de abrir la base (`initAppDb`): la base no puede estar
 * abierta. La llama el orquestador (`migration/cutover.ts`).
 */
export function importLegacyForCutover(sourcePath?: string): ImportReport {
  if (current) throw new Error('importLegacyForCutover() con la base ya abierta');
  return importLegacyIntoLocal({
    userDataDir: app.getPath('userData'),
    deviceId: getMachineId(),
    migrationsFolder: MIGRATIONS_FOLDER,
    now: new Date(),
    log: (message) => console.log(message),
    sourcePath,
  });
}

/** ¿Está la base 2.0 abierta? */
export const isAppDbOpen = (): boolean => current !== null;

/**
 * Los destinos de restauración que la 1.x guardaba en machine-saves.json por id
 * numérico pasan a `local_save_state`, con el id de juego que les ha dado el
 * importador (`local_legacy_ids`). Solo tras una importación, y solo los de
 * juegos que existen. El fichero no se toca: es la vuelta atrás a la 1.x.
 */
export function importSaveRestoreTargets(ctx: QueryContext): void {
  // Con `local_legacy_ids`, no con `legacyUuid`: un juego con igdbId tiene un
  // id derivado del igdbId (§19.5), no del id antiguo.
  const moved = remapLegacyRestoreTargets(ctx, listLegacySaveLocationOverrides());
  if (moved > 0) console.log(`[v2] ${moved} destino(s) de restauracion de partidas importados`);
}

/** El contexto de las consultas 2.0. Lanza si la base no está abierta. */
export function appCtx(): QueryContext {
  if (!current) throw new Error('appCtx() llamado antes de initAppDb()');
  return current.ctx;
}

/** La conexión entera (oyentes de cambios, copias). */
export function appLocalDb(): LocalDatabase {
  if (!current) throw new Error('appLocalDb() llamado antes de initAppDb()');
  return current.local;
}

/** Al salir de la app. Idempotente. */
export function closeAppDb(): void {
  current?.local.close();
  current = null;
}
