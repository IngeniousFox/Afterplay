import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { getAchievementsStatus } from '../db/queries/achievements/getAchievementsStatus';
import { getPendingAchievementsGames } from '../db/queries/achievements/getPendingAchievementsGames';
import { gamesTable } from '../db/schema';
import type { AchievementsStatus } from '../../shared/types';
import { hasSteamKey } from './api';
import { ensureGoldbergCatalog } from './emu/goldbergCatalog';
import { readEmuUnlocksForGame } from './emu/readUnlocks';
import {
  enqueueAchievements,
  getFailedAchievementsCount,
  isAchievementsQueueRunning,
} from './queue';
import { storeUnlocks } from './syncAchievements';

// La pasada de logros: encuentra los juegos pendientes y los encola. Mismo
// papel que curiosities/backfill.ts — el trabajo real lo hace la cola, esto
// solo decide a quién le toca.

export const getSteamAchievementsStatus = async (): Promise<AchievementsStatus> =>
  withDbAccess(async () =>
    getAchievementsStatus(isAchievementsQueueRunning(), getFailedAchievementsCount()),
  );

// full=true resincroniza TODOS los juegos de Steam — es el botón "Sync now"
// de Ajustes. Con false solo se traen los catálogos que faltan, que es lo
// que basta al arrancar.
export const runAchievementsBackfill = async (full: boolean): Promise<number> => {
  if (!hasSteamKey()) return 0;

  const pending = await withDbAccess(async () => getPendingAchievementsGames(full));
  if (pending.length === 0) return 0;

  enqueueAchievements(pending);
  return pending.length;
};

// Una pasada suave al arrancar, encadenada tras el primer sync (main/index.ts)
// igual que los recaps y el backfill de appids: solo catálogos que falten,
// nunca refresco de desbloqueos — arrancar la app no debería disparar
// cientos de peticiones a Steam.
export const runAchievementsStartupPass = async (): Promise<void> => {
  try {
    const queued = await runAchievementsBackfill(false);
    if (queued > 0) {
      // Solo ASCII en los console.log, misma convencion que
      // watcher/watcher.ts: la consola de Windows no siempre usa UTF-8.
      console.log(`[steam] logros: ${queued} juegos sin catalogo, encolados`);
    }
  } catch (error) {
    console.warn('[steam] fallo en la pasada inicial de logros (se reintentara):', error);
  }
};

// El barrido de emuladores del arranque (LOGROS.md §7): para cada juego con
// catálogo, mira si algún crack dejó desbloqueos en este PC y los recoge. Es
// disco local puro — cero red, cero key — así que puede correr en cada
// arranque sin pedir permiso: recoge lo que se jugó con la app cerrada.
//
// De paso escribe el achievements.json de Goldberg donde falte (ver
// goldbergCatalog.ts): así el emulador empieza a REGISTRAR aunque nunca
// pulses Sync now.
export const runEmuUnlocksSweep = async (): Promise<void> => {
  try {
    const games = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          steamAppId: gamesTable.steamAppId,
          executablePath: gamesTable.executablePath,
          installDirectory: gamesTable.installDirectory,
        })
        .from(gamesTable)
        .where(and(isNotNull(gamesTable.steamAppId), isNotNull(gamesTable.achievementsSyncedAt))),
    );

    let withUnlocks = 0;
    for (const game of games) {
      if (game.steamAppId === null) continue;

      await withDbAccess(async () => ensureGoldbergCatalog(game.id, game.installDirectory));

      const emu = readEmuUnlocksForGame(game.steamAppId, game.executablePath);
      if (emu.unlocks.length === 0) continue;
      await storeUnlocks(game.id, 'emu', emu.unlocks, new Date());
      withUnlocks++;
    }

    if (withUnlocks > 0) {
      console.log(`[steam] logros de emulador: ${withUnlocks} juego(s) con desbloqueos locales`);
    }
  } catch (error) {
    console.warn('[steam] fallo en el barrido de emuladores (se reintentara):', error);
  }
};

// Al cerrar una sesión de juego: refrescar los logros de ESE juego, que es
// justo cuando pueden haber cambiado. Encola la sync completa (Steam + emu)
// por la misma cola de siempre — si el juego no está en Steam, no hay appid y
// no hay nada que hacer.
//
// notify=false para las altas: dar de alta un juego que ya jugaste haría
// saltar el aviso flotante por logros de hace años, que es justo lo que la
// pasada masiva evita. Solo avisa lo que acaba de pasar.
export const queueAchievementsRefreshForGame = async (
  gameId: number,
  { notify = true }: { notify?: boolean } = {},
): Promise<void> => {
  if (!hasSteamKey()) return;

  try {
    const [game] = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          steamAppId: gamesTable.steamAppId,
          executablePath: gamesTable.executablePath,
          installDirectory: gamesTable.installDirectory,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(and(eq(gamesTable.id, gameId), isNotNull(gamesTable.steamAppId)))
        .limit(1),
    );
    if (!game || game.steamAppId === null) return;

    enqueueAchievements([
      {
        id: game.id,
        title: game.title,
        steamAppId: game.steamAppId,
        executablePath: game.executablePath,
        installDirectory: game.installDirectory,
        heroUrl: game.heroUrl,
        notify,
      },
    ]);
  } catch (error) {
    console.warn('[steam] fallo encolando el refresco tras la sesion:', error);
  }
};
