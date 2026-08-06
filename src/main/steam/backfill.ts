import { and, eq, isNotNull, like } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { getAchievementsStatus } from '../db/queries/achievements/getAchievementsStatus';
import { getPendingAchievementsGames } from '../db/queries/achievements/getPendingAchievementsGames';
import { achievementsTable, gamesTable } from '../db/schema';
import type { AchievementsStatus } from '../../shared/types';
import { refreshRaForGame } from '../ra/backfill';
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
    await clearIconlessAchievementIcons();
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

// Limpieza de una vez: los iconos que se guardaron apuntando al DIRECTORIO
// del appid en vez de a un fichero (asi devuelve Steam el icono de un logro
// que su desarrollador aun no ha puesto, ver images/steamCdn.ts). No son una
// imagen que falte: son una URL que NUNCA va a funcionar, y cada una era un
// 403 y un aviso en consola por cada logro del juego.
//
// Va aqui y no en una migracion porque es dato de una fuente externa, no
// esquema: se corrige en cada arranque, es instantaneo (dos UPDATE con LIKE)
// y es idempotente. Lo que se sincronice a partir de ahora ya nace bien
// (normalizeIconUrl en steam/api.ts).
const clearIconlessAchievementIcons = async (): Promise<void> => {
  await withDbAccess(async () => {
    const db = getDb();
    await db
      .update(achievementsTable)
      .set({ iconUrl: null })
      .where(like(achievementsTable.iconUrl, '%/'));
    await db
      .update(achievementsTable)
      .set({ iconGrayUrl: null })
      .where(like(achievementsTable.iconGrayUrl, '%/'));
  });
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
// justo cuando pueden haber cambiado. Es el punto ÚNICO de refresco por
// juego, con sus dos patas: Steam (por la cola de siempre) y
// RetroAchievements (directa — es una petición, no trescientas).
//
// notify=false para las altas: dar de alta un juego que ya jugaste haría
// saltar el aviso flotante por logros de hace años, que es justo lo que la
// pasada masiva evita. Solo avisa lo que acaba de pasar.
//
// forceRaRematch: solo el botón de la ficha — re-intenta el emparejado de RA
// aunque ya se hubiera preguntado (ver refreshRaForGame).
//
// Devuelve si ALGUNA pata hizo trabajo: false = ni Steam ni RA tienen nada
// que decir de este juego. El botón de la ficha lo necesita para no quedarse
// girando eternamente esperando algo que nunca va a pasar.
export const queueAchievementsRefreshForGame = async (
  gameId: number,
  { notify = true, forceRaRematch = false }: { notify?: boolean; forceRaRematch?: boolean } = {},
): Promise<boolean> => {
  let steamQueued = false;

  if (hasSteamKey()) {
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
      if (game && game.steamAppId !== null) {
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
        steamQueued = true;
      }
    } catch (error) {
      console.warn('[steam] fallo encolando el refresco tras la sesion:', error);
    }
  }

  // La pata de RA — no exclusiva con la de Steam a propósito: son fuentes
  // distintas y un juego podría tener las dos (un clásico con puerto en
  // Steam y set en RA). refreshRaForGame ya se auto-descarta sin
  // credenciales o sin emparejar.
  const raSynced = await refreshRaForGame(gameId, notify, forceRaRematch).catch(() => false);

  return steamQueued || raSynced;
};
