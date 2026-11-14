import { appCtx } from '../db/v2/appDb';
import {
  fillHiddenDescriptions,
  markSteamUnlocksSynced,
  storeSteamCatalog,
  storeUnlocks as storeUnlocksV2,
  type UnlockFeed,
  type UnlockInput,
} from '../db/v2/queries/achievements';
import {
  getAchievementSchema,
  getGlobalPercentages,
  getPlayerUnlocks,
  getSteamUserId,
} from './api';
import type { SteamAchievementDef } from './api';
import { getLocalAchievementTexts } from './localSchema';
import { ensureGoldbergCatalog } from './emu/goldbergCatalog';
import { readEmuUnlocksForGame } from './emu/readUnlocks';
import { maybeCelebrateCompletion } from './notifications/complete';
import { enqueueAchievementToasts } from './notifications/overlay';
import type { AchievementToast } from './notifications/overlay';
import type { PendingAchievementsGame } from './queue';
import type { GameId } from '../../shared/entityIds';

// Sincronizar los logros de UN juego (LOGROS.md §3-4): el catálogo (qué
// logros existen), tus desbloqueos por la API de Steam si hay SteamID, y los
// desbloqueos que hayan dejado los emuladores de Steam en este PC (§7).
//
// La red va siempre antes y fuera de la base; cada escritura es una consulta
// 2.0 (queries/achievements/) que relee el juego dentro de su transacción:
// uno borrado, o con otro appid, no recibe nada (R-15).

// Los avisos de una tanda: el juego (nombre y hero) solo se conoce aquí. Y
// tras la tanda, la comprobación del 100 %: si estos desbloqueos acaban de
// cerrar el juego, cae el broche dorado (notifications/complete.ts).
const toastFresh = (
  game: Pick<PendingAchievementsGame, 'id' | 'title' | 'heroUrl'>,
  fresh: AchievementToast[],
): void => {
  if (fresh.length === 0) return;
  enqueueAchievementToasts(
    fresh.map((toast) => ({ ...toast, gameTitle: game.title, gameHeroUrl: game.heroUrl })),
  );
  maybeCelebrateCompletion(game.id, game.title, game.heroUrl);
};

export type GameAchievementSyncResult = {
  catalogCount: number;
  unlockedCount: number;
  // ¿Se llegó a preguntar por TUS desbloqueos a la API de Steam?
  unlocksKnown: boolean;
};

/**
 * Guarda una tanda de desbloqueos de una vía (Steam, emulador de este PC o
 * RetroAchievements) y devuelve los NUEVOS, para avisar. La lógica (fecha
 * fiable, colocación en sesiones, el censo de instantes repetidos) vive en
 * `queries/achievements/storeUnlocks.ts`.
 */
export const storeUnlocks = async (
  gameId: GameId,
  feed: UnlockFeed,
  unlocks: UnlockInput[],
  fallbackDate: Date,
  expected: { appId?: number; raGameId?: number } | number = {},
): Promise<AchievementToast[]> => {
  const keys = typeof expected === 'number' ? { appId: expected } : expected;
  return storeUnlocksV2(appCtx(), {
    gameId,
    feed,
    unlocks,
    fallbackDate,
    ...(keys.appId === undefined ? {} : { expectedAppId: keys.appId }),
    ...(keys.raGameId === undefined ? {} : { expectedRaGameId: keys.raGameId }),
  });
};

export type EmuUnlocksApplied = {
  unlockedCount: number;
  fresh: AchievementToast[];
};

// La fuente de emuladores de UN juego: lee los ficheros que dejan los cracks
// en este PC (disco, sin red) y guarda lo que haya.
export const applyEmuUnlocksForGame = async (
  game: { id: GameId; steamAppId: number; executablePath: string | null },
  fallbackDate: Date,
): Promise<EmuUnlocksApplied> => {
  const emu = readEmuUnlocksForGame(game.steamAppId, game.executablePath);
  if (emu.unlocks.length === 0) return { unlockedCount: 0, fresh: [] };
  const fresh = await storeUnlocks(game.id, 'emu', emu.unlocks, fallbackDate, game.steamAppId);
  return { unlockedCount: emu.unlocks.length, fresh };
};

// Los logros ocultos llegan de la API sin descripción. El schema local de
// Steam (si el juego está instalado con cuenta) sí la trae: se rellena.
const fillHiddenFromLocalSchema = async (
  gameId: GameId,
  appId: number,
  definitions: SteamAchievementDef[],
): Promise<void> => {
  const mute = definitions.some(
    (definition) => definition.hidden && definition.description === null,
  );
  if (!mute) return;
  const texts = await getLocalAchievementTexts(appId);
  const filled = fillHiddenDescriptions(appCtx(), gameId, appId, texts);
  if (filled > 0) {
    console.log(
      `[steam] ${filled} descripcion(es) oculta(s) nueva(s) del schema local para el appid ${appId}`,
    );
  }
};

export const syncGameAchievements = async (
  game: PendingAchievementsGame,
  notify = false,
): Promise<GameAchievementSyncResult> => {
  const { id: gameId, steamAppId: appId } = game;
  const [definitions, percentages] = await Promise.all([
    getAchievementSchema(appId),
    getGlobalPercentages(appId),
  ]);
  const syncedAt = new Date();

  // Un catálogo vacío que la rareza no confirma no es una respuesta (appid
  // malo, juego sin publicar): no se marca nada y la pasada lo repetirá.
  const catalog = storeSteamCatalog(appCtx(), {
    gameId,
    appId,
    definitions,
    percentages,
    fetchedAt: syncedAt,
  });
  if (catalog.status !== 'stored' || catalog.count === 0) {
    return { catalogCount: 0, unlockedCount: 0, unlocksKnown: false };
  }

  await fillHiddenFromLocalSchema(gameId, appId, definitions);
  await ensureGoldbergCatalog(gameId, game.installDirectory);
  const emu = await applyEmuUnlocksForGame(game, syncedAt);
  const fresh = emu.fresh;

  const unlocks = getSteamUserId() ? await getPlayerUnlocks(appId) : null;
  if (unlocks === null) {
    if (notify) toastFresh(game, fresh);
    return { catalogCount: catalog.count, unlockedCount: emu.unlockedCount, unlocksKnown: false };
  }

  fresh.push(...(await storeUnlocks(gameId, 'steam', unlocks, syncedAt, appId)));
  markSteamUnlocksSynced(appCtx(), gameId, appId, syncedAt);

  if (notify) toastFresh(game, fresh);
  return {
    catalogCount: catalog.count,
    unlockedCount: unlocks.length + emu.unlockedCount,
    unlocksKnown: true,
  };
};
