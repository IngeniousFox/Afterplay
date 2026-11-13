import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import type { LocalDatabase } from '../connection';
import { gameInstallId, emulatorInstallId } from '../../../../shared/sync/ids';
import type { ImportContext } from './build';

// Reclamo de instalaciones de ESTE PC (§19.6 "Migración local").
//
// Las rutas de la 1.x no se importan a ciegas: pueden ser de otro PC. Con la
// opción `claimInstalls`, para cada juego y emulador con ruta en la 1.x, si la
// ruta existe en este disco se crea su fila en `game_installs` /
// `emulator_installs` de este dispositivo. Al revés que lo importado, estas
// son filas NUEVAS de este dispositivo: van por la puerta de escritura, con el
// reloj de ahora.
//
// Idempotente: si la fila ya existe no se toca (volver a importar no debe
// cambiar nada, ni siquiera `lastVerifiedAt`).

export interface ClaimReport {
  games: number;
  emulators: number;
  /** Rutas de la 1.x que no existen en este PC: de otro PC, o desinstaladas. */
  missing: number;
  alreadyPresent: number;
}

export function claimInstalls(
  target: LocalDatabase,
  ctx: ImportContext,
  options: { readonly pathExists?: (path: string) => boolean; readonly now: number },
): ClaimReport {
  const exists = options.pathExists ?? existsSync;
  const report: ClaimReport = { games: 0, emulators: 0, missing: 0, alreadyPresent: 0 };
  const { store, deviceId, db } = target;
  const has = (table: string, id: string): boolean =>
    db.$client.prepare(`SELECT 1 FROM "${table}" WHERE id = ?`).get(id) !== undefined;

  // El dispositivo tiene que existir para que sus instalaciones lo apunten.
  if (!has('devices', deviceId)) {
    store.create('devices', {
      id: deviceId,
      name: hostname(),
      kind: 'desktop',
      os: 'windows',
      firstSeenAt: new Date(options.now),
    });
  }

  const pathOrNull = (value: unknown): string | null => {
    if (typeof value !== 'string' || value === '') return null;
    if (exists(value)) return value;
    report.missing += 1;
    return null;
  };

  for (const game of ctx.data.games) {
    if (game.executablePath === null && game.installDirectory === null) continue;
    const gameId = ctx.gameIds.get(Number(game.id)) as string;
    const executablePath = pathOrNull(game.executablePath);
    const installDirectory = pathOrNull(game.installDirectory);
    if (executablePath === null && installDirectory === null) continue;
    if (has('game_installs', gameInstallId(gameId, deviceId))) {
      report.alreadyPresent += 1;
      continue;
    }
    store.create('game_installs', {
      gameId,
      deviceId,
      executablePath,
      installDirectory,
      // El tamaño se calculó sobre esa carpeta: solo vale si la carpeta está.
      installSizeBytes: installDirectory === null ? null : (game.installSizeBytes as number | null),
      lastVerifiedAt: new Date(options.now),
    });
    report.games += 1;
  }

  for (const emulator of ctx.data.emulators) {
    const emulatorId = ctx.emulatorIds.get(Number(emulator.id)) as string;
    const executablePath = pathOrNull(emulator.executablePath);
    if (executablePath === null) continue;
    if (has('emulator_installs', emulatorInstallId(emulatorId, deviceId))) {
      report.alreadyPresent += 1;
      continue;
    }
    store.create('emulator_installs', { emulatorId, deviceId, executablePath });
    report.emulators += 1;
  }
  return report;
}
