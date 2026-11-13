import { and, eq } from 'drizzle-orm';
import type { GameRow } from '../../../../../shared/dto';
import { achievementCatalogId } from '../../../../../shared/sync/ids';
import { achievementCatalogs, achievementUnlocks, gameMetadata, games } from '../../schema';
import { alive } from '../../store';
import { clearCheck, readGameRow, writeCheck, type QueryContext } from '../common';
import { assertSteamAppId } from './errors';

// games:setSteamAppId en 2.0 (CONSULTAS.md §1.4 y §2.2, `setSteamAppId`; R-09).
//
// Fijar el appid a mano: `steamAppIdSource = 'manual'` (ningún refresco lo
// pisa, D-22) y `ec(steam_appid)` como respondida. Si el appid CAMBIA, lo que
// se trajo del producto equivocado no puede mezclarse con el nuevo, todo en
// la misma transacción:
// - el catálogo de logros de Steam recibe la lápida. [Mejora] La heurística
//   Steam/RA de la 1.x (`setSteamAppId.ts:44-51`) desaparece: el catálogo ya
//   va por fuente, y el de RetroAchievements no se toca;
// - los desbloqueos de Steam del juego (orígenes `steam` y `emu@*`) reciben la
//   lápida (R-09: lo que hacía la cascada al borrar el catálogo). Los de RA se
//   quedan;
// - la caché de la tienda (`steamTags`, `steamPositive`, `steamNegative`) se
//   anula, y se olvidan las comprobaciones `steam_store`,
//   `steam_achievements` y `steam_unlocks`, para que las pasadas de fondo las
//   vuelvan a pedir con el appid bueno.

/**
 * Fija el appid y devuelve el juego releído, o null si no existe o tiene
 * lápida. Lanza `GameWriteError('invalid_input')` ("Invalid Steam App ID.")
 * con un appid fuera de rango, sin escribir.
 */
export function setSteamAppId(
  ctx: QueryContext,
  gameId: string,
  appId: number,
): GameRow<string> | null {
  assertSteamAppId(appId);
  const updated = ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted, steamAppId: games.steamAppId })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) return false;

    if (game.steamAppId !== appId) forgetSteamData(ctx, gameId);
    ctx.store.patch('games', gameId, { steamAppId: appId, steamAppIdSource: 'manual' });
    writeCheck(ctx, gameId, 'steam_appid', 'ok');
    return true;
  });
  return updated ? readGameRow(ctx, gameId) : null;
}

function forgetSteamData(ctx: QueryContext, gameId: string): void {
  const catalogId = achievementCatalogId(gameId, 'steam');
  const catalog = ctx.db
    .select({ id: achievementCatalogs.id })
    .from(achievementCatalogs)
    .where(and(eq(achievementCatalogs.id, catalogId), alive(achievementCatalogs)))
    .get();
  if (catalog) ctx.store.remove('achievement_catalogs', catalogId);

  const unlocks = ctx.db
    .select({ id: achievementUnlocks.id })
    .from(achievementUnlocks)
    .where(
      and(
        eq(achievementUnlocks.gameId, gameId),
        eq(achievementUnlocks.source, 'steam'),
        alive(achievementUnlocks),
      ),
    )
    .all();
  for (const unlock of unlocks) ctx.store.remove('achievement_unlocks', unlock.id);

  const metadata = ctx.db
    .select({ id: gameMetadata.id })
    .from(gameMetadata)
    .where(and(eq(gameMetadata.id, gameId), alive(gameMetadata)))
    .get();
  if (metadata) {
    ctx.store.patch('game_metadata', gameId, {
      steamTags: null,
      steamPositive: null,
      steamNegative: null,
    });
  }

  clearCheck(ctx, gameId, 'steam_store');
  clearCheck(ctx, gameId, 'steam_achievements');
  clearCheck(ctx, gameId, 'steam_unlocks');
}
