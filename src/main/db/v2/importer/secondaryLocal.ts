import type { DatabaseSync } from 'node:sqlite';
import type { LocalDatabase } from '../connection';
import { claimInstalls, type ClaimReport, type InstallSource } from './installs';
import { legacyGameId, legacyUuid } from './legacyIds';
import { withLegacySource, type SqlValue } from './source';

// MIGRACIÓN LOCAL DE UN PC QUE NO IMPORTA (§19.6 "Los demás PCs" y "Migración
// local (todos)"). PUENTE 1.x → L3: se va con el importador.
//
// El PC migrador importa la 1.x y, de paso, escribe `local_legacy_ids` y
// reclama sus instalaciones. Los demás no importan: bajan todo del hub. Pero
// su disco sigue teniendo las rutas de la 1.x y su `machine-saves.json` sigue
// indexado por id antiguo, así que necesitan lo mismo en local:
//
//   1. El mapa id 1.x → id 2.0 de los juegos y los emuladores, DERIVADO igual
//      que lo deriva el importador (`legacyGameId` / `legacyUuid`: la regla
//      vive en `legacyIds.ts`, aquí no se repite). Otras tablas no hacen falta
//      en local: nada las consulta fuera de la validación de la importación.
//   2. Las instalaciones cuyo fichero existe en ESTE disco (`claimInstalls`),
//      solo de juegos que ya han bajado del hub: una fila de instalación sin
//      su juego rompería la clave foránea.
//
// Lee una COPIA consistente de la 1.x (`sourceCopy.ts`), nunca la base en uso.
// Idempotente: repetirlo no cambia nada.

export interface SecondaryLocalOptions {
  /** Copia consistente de la `Afterplay.db` de este PC (`copySourceConsistently`). */
  readonly source: string | DatabaseSync;
  readonly target: LocalDatabase;
  readonly now: number;
  /** Para los tests: qué rutas "existen". */
  readonly pathExists?: (path: string) => boolean;
}

export interface SecondaryLocalReport {
  readonly games: number;
  readonly emulators: number;
  /** Filas nuevas de `local_legacy_ids` (las que ya estaban no cuentan). */
  readonly legacyIdsWritten: number;
  /** Juegos de la 1.x local que aún no están en la base 2.0 (no se reclaman). */
  readonly gamesNotInHub: number;
  readonly installs: ClaimReport;
}

const asNumber = (value: SqlValue): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function migrateSecondaryLocal(options: SecondaryLocalOptions): SecondaryLocalReport {
  const { target } = options;
  const { games, emulators } = withLegacySource(options.source, (db) => ({
    games: db
      .prepare(
        'SELECT id, igdbId, executablePath, installDirectory, installSizeBytes FROM games ORDER BY id',
      )
      .all() as {
      id: number;
      igdbId: number | null;
      executablePath: SqlValue;
      installDirectory: SqlValue;
      installSizeBytes: SqlValue;
    }[],
    emulators: db.prepare('SELECT id, executablePath FROM emulators ORDER BY id').all() as {
      id: number;
      executablePath: SqlValue;
    }[],
  }));

  const gameIds = new Map<number, string>();
  for (const game of games) gameIds.set(game.id, legacyGameId(asNumber(game.igdbId), game.id));
  const emulatorIds = new Map<number, string>();
  for (const emulator of emulators)
    emulatorIds.set(emulator.id, legacyUuid('emulators', emulator.id));

  const client = target.db.$client;
  const has = (table: string, id: string): boolean =>
    client.prepare(`SELECT 1 FROM "${table}" WHERE id = ?`).get(id) !== undefined;

  let legacyIdsWritten = 0;
  let installs!: ClaimReport;
  let gamesNotInHub = 0;
  target.store.transaction(() => {
    const insert = client.prepare(
      'INSERT INTO "local_legacy_ids" ("legacyTable", "legacyId", "newId") VALUES (?, ?, ?) ' +
        'ON CONFLICT DO NOTHING',
    );
    for (const [legacyId, newId] of gameIds) {
      legacyIdsWritten += Number(insert.run('games', legacyId, newId).changes);
    }
    for (const [legacyId, newId] of emulatorIds) {
      legacyIdsWritten += Number(insert.run('emulators', legacyId, newId).changes);
    }

    const present = games.filter((game) => has('games', gameIds.get(game.id) as string));
    gamesNotInHub = games.length - present.length;
    const source: InstallSource = {
      data: {
        games: present,
        // Un emulador que aún no ha bajado del hub no se puede reclamar.
        emulators: emulators.filter((e) => has('emulators', emulatorIds.get(e.id) as string)),
      },
      gameIds,
      emulatorIds,
    };
    installs = claimInstalls(target, source, {
      pathExists: options.pathExists,
      now: options.now,
    });
  });

  return {
    games: games.length,
    emulators: emulators.length,
    legacyIdsWritten,
    gamesNotInHub,
    installs,
  };
}
