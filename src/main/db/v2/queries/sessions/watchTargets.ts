import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { basename } from 'node:path';
import { emulatorInstalls, emulators, gameInstalls, games, planEntries } from '../../schema';
import { alive } from '../../store';
import { liveEmulatorInstall, liveGameInstall, type QueryContext } from '../common';

// Lo que vigila el watcher (sustituye a `db/queries/games/getWatchTargets.ts`
// de la 1.x; CONSULTAS.md §1.3 "WatchTarget", AFTERPLAY-2.0.md §11.1).
//
// Los objetivos salen de las instalaciones de ESTE dispositivo
// (`game_installs`, `emulator_installs`): un juego instalado solo en otro PC
// no se vigila aquí (F-06), y una ruta de otro PC no significa nada en este.
// El resto de reglas son las de hoy:
// - todos los juegos con ejecutable, sin mirar su estado (nunca se sabe
//   cuándo se vuelve a abrir uno terminado);
// - menos los PLANEADOS (`plan_entries` viva): planear no es jugar;
// - menos los EMULADOS: lo vigilado es el emulador, y vigilar también el
//   juego abriría dos sesiones para la misma tarde;
// - y todos los emuladores con ruta en este PC: al detectar uno, la sesión
//   nace sin juego (`createEmulatorSession`).
//
// Se llama cada ~5 s, así que la consulta es estrecha a propósito (solo id,
// título y ruta) en vez de la vista completa de `common/gameView.ts`.

export interface WatchTarget {
  /** `game:<uuid>` / `emu:<uuid>`: la clave del mapa de sesiones activas del watcher. */
  readonly key: string;
  readonly kind: 'game' | 'emulator';
  /** Id del juego o del emulador, según `kind`. */
  readonly refId: string;
  readonly title: string;
  /** Nombre del .exe en minúsculas (fase 1 del barrido, contra ps-list). */
  readonly exeName: string;
  /** Ruta completa en minúsculas (fase 2, contra el cmd del proceso). */
  readonly exePath: string;
}

export function getWatchTargets(ctx: QueryContext): WatchTarget[] {
  const gameRows = ctx.db
    .select({
      id: games.id,
      title: games.title,
      executablePath: gameInstalls.executablePath,
    })
    .from(gameInstalls)
    .innerJoin(games, eq(games.id, gameInstalls.gameId))
    // El plan de un juego que ya se exige vivo (`liveGameInstall`): `alive` a
    // secas, en el ON para que el LEFT siga siendo LEFT.
    .leftJoin(planEntries, and(eq(planEntries.gameId, games.id), alive(planEntries)))
    .where(
      and(
        eq(gameInstalls.deviceId, ctx.deviceId),
        liveGameInstall(),
        isNotNull(gameInstalls.executablePath),
        eq(games.isEmulated, false),
        isNull(planEntries.id),
      ),
    )
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();

  const emulatorRows = ctx.db
    .select({
      id: emulators.id,
      name: emulators.name,
      executablePath: emulatorInstalls.executablePath,
    })
    .from(emulatorInstalls)
    .innerJoin(emulators, eq(emulators.id, emulatorInstalls.emulatorId))
    .where(and(eq(emulatorInstalls.deviceId, ctx.deviceId), liveEmulatorInstall()))
    .orderBy(asc(emulators.syncCreated), asc(emulators.id))
    .all();

  const targets: WatchTarget[] = [];
  for (const game of gameRows) {
    if (!game.executablePath) continue;
    targets.push({
      key: `game:${game.id}`,
      kind: 'game',
      refId: game.id,
      title: game.title,
      exeName: basename(game.executablePath).toLowerCase(),
      exePath: game.executablePath.toLowerCase(),
    });
  }
  for (const emulator of emulatorRows) {
    if (!emulator.executablePath) continue;
    targets.push({
      key: `emu:${emulator.id}`,
      kind: 'emulator',
      refId: emulator.id,
      title: emulator.name,
      exeName: basename(emulator.executablePath).toLowerCase(),
      exePath: emulator.executablePath.toLowerCase(),
    });
  }
  return targets;
}
