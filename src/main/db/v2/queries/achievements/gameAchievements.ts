import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { mergeUnlocksByAchievement } from '../../../../../shared/mergeUnlocks';
import type {
  AchievementEntry,
  AchievementSource as DtoAchievementSource,
  GameAchievements,
  SessionUnlock,
} from '../../../../../shared/types';
import {
  achievementCatalogs,
  achievementUnlocks,
  playthroughs,
  sessions,
  type AchievementSource,
} from '../../schema';
import { alive } from '../../store';
import { livePlaythrough, liveSession, liveUnlock } from '../common/alive';
import { answeredAt, readCheck } from '../common/checks';
import type { QueryContext } from '../common/context';
import { readGameCatalogs, readLiveGameKeys, sortedItems, type CatalogItem } from './catalog';
import type { CatalogProgress } from './progress';
import { toSourceCompletion, type SourceCompletion } from './completion';
import { achievementKey, dtoSourceOf, type AchievementKey } from './ids';

// Las dos lecturas que pintan logros sueltos: la ficha del juego
// (`getGameAchievements`) y la pantalla de Sesiones / el HUD
// (`getSessionUnlocks`). Las dos funden los orígenes con la regla de la casa
// (`mergeUnlocksByAchievement`, src/shared/mergeUnlocks.ts) agrupando por
// logro, (`gameId`, `source`, `apiName`): la fila ganadora representa al
// logro, y con ella viajan SU sesión y SU playthrough. Así las dos pantallas
// contestan lo mismo sobre el mismo trofeo (la cicatriz de achievements.test.ts).
//
// Una sesión o un playthrough borrados (también por la regla F-11, llegados
// vivos por sync bajo un padre con lápida) no se enseñan: la columna se lee
// como null. Al borrar por la puerta ya se anulan (`nullify` del registro).

// La ficha devuelve `GameAchievements<string>`, que con ids de texto lleva
// `completion`: el completado de cada catálogo, Steam antes que RA (R-11).

interface UnlockRow {
  achievementId: AchievementKey;
  source: AchievementSource;
  apiName: string;
  origin: string;
  unlockedAt: Date;
  dateReliable: boolean;
  sessionId: string | null;
  playthroughId: string | null;
}

const liveS = alias(sessions, 'ga_s');
const liveP = alias(playthroughs, 'ga_p');

const latest = (...dates: (Date | null | undefined)[]): Date | null => {
  let best: Date | null = null;
  for (const date of dates) {
    if (date && (best === null || date.getTime() > best.getTime())) best = date;
  }
  return best;
};

/**
 * Los logros de un juego con las fuentes YA FUNDIDAS, en el orden de cada
 * catálogo (Steam primero, luego RA).
 *
 * - Juego inexistente o con lápida: `{ gameId, steamAppId: null, syncedAt:
 *   null, unlocksSyncedAt: null, entries: [], completion: [] }` (no lanza).
 * - `syncedAt`: la última respuesta de catálogo de cualquiera de las dos
 *   fuentes (`ec(steam_achievements)`, `ec(ra_achievements)`) o, si no hay
 *   sello, el `fetchedAt` más reciente (el catálogo solo se reescribe si
 *   cambia, así que su `fetchedAt` no dice "cuándo se preguntó").
 * - `unlocksSyncedAt`: la última respuesta sobre TUS desbloqueos:
 *   `ec(steam_unlocks)` (R-05) o `ec(ra_achievements)` (en RA llegan con el
 *   catálogo; la 1.x estampaba las dos marcas a la vez, ra/sync.ts:67).
 */
export function getGameAchievements(ctx: QueryContext, gameId: string): GameAchievements<string> {
  const game = readLiveGameKeys(ctx, gameId);
  if (!game) {
    return {
      gameId,
      steamAppId: null,
      syncedAt: null,
      unlocksSyncedAt: null,
      entries: [],
      completion: [],
    };
  }
  const catalogs = readGameCatalogs(ctx, gameId);
  const steamCatalogCheck = answeredAt(readCheck(ctx, gameId, 'steam_achievements'));
  const raCheck = answeredAt(readCheck(ctx, gameId, 'ra_achievements'));
  const steamUnlocksCheck = answeredAt(readCheck(ctx, gameId, 'steam_unlocks'));
  const base = {
    gameId,
    steamAppId: game.steamAppId,
    syncedAt:
      latest(steamCatalogCheck, raCheck) ?? latest(...catalogs.map((catalog) => catalog.fetchedAt)),
    unlocksSyncedAt: latest(steamUnlocksCheck, raCheck),
  };
  if (catalogs.length === 0) return { ...base, entries: [], completion: [] };

  const rows: UnlockRow[] = ctx.db
    .select({
      source: achievementUnlocks.source,
      apiName: achievementUnlocks.apiName,
      origin: achievementUnlocks.origin,
      unlockedAt: achievementUnlocks.unlockedAt,
      dateReliable: achievementUnlocks.dateReliable,
      sessionId: liveS.id,
      playthroughId: liveP.id,
    })
    .from(achievementUnlocks)
    .leftJoin(liveS, and(eq(liveS.id, achievementUnlocks.sessionId), liveSession(liveS)))
    .leftJoin(liveP, and(eq(liveP.id, achievementUnlocks.playthroughId), livePlaythrough(liveP)))
    // El juego vivo ya está comprobado arriba.
    .where(and(eq(achievementUnlocks.gameId, gameId), alive(achievementUnlocks)))
    .all()
    .map((row) => ({ ...row, achievementId: achievementKey(gameId, row.source, row.apiName) }));
  const merged = mergeUnlocksByAchievement(rows);

  const entries: AchievementEntry<string>[] = [];
  const completion: SourceCompletion[] = [];
  for (const catalog of catalogs) {
    const unlocked: CatalogProgress['unlocked'][number][] = [];
    catalog.items.forEach((item, index) => {
      const key = achievementKey(gameId, catalog.source, item.apiName);
      const found = merged.get(key);
      if (found) {
        unlocked.push({
          item,
          index,
          unlockedAt: found.winner.unlockedAt,
          dateReliable: found.winner.dateReliable,
        });
      }
      entries.push(toEntry(key, item, found));
    });
    const asked = catalog.source === 'steam' ? steamUnlocksCheck !== null : raCheck !== null;
    completion.push(
      toSourceCompletion({
        catalogId: `${gameId}:${catalog.source}`,
        gameId,
        source: catalog.source,
        total: catalog.items.length,
        unlocked,
        items: catalog.items,
        unlocksAsked: asked,
      }),
    );
  }
  return { ...base, entries, completion };
}

function toEntry(
  key: AchievementKey,
  item: CatalogItem,
  merged: { winner: UnlockRow; rows: UnlockRow[] } | undefined,
): AchievementEntry<string> {
  // Varios PCs con emulador son UN 'emu' (CONSULTAS.md §1.3).
  const sources = merged
    ? [...new Set(merged.rows.map((row) => dtoSourceOf(row.origin)))]
    : ([] as DtoAchievementSource[]);
  return {
    id: key,
    apiName: item.apiName,
    displayName: item.displayName,
    // Sin tapar la de los ocultos: Steam ya no la manda (la de hoy, ver
    // getGameAchievements.ts:87-91); si consta es del schema local.
    description: item.description,
    iconUrl: item.iconUrl,
    iconGrayUrl: item.iconGrayUrl,
    hidden: item.hidden,
    globalPercent: item.globalPercent,
    unlockedAt: merged?.winner.unlockedAt ?? null,
    dateReliable: merged?.winner.dateReliable ?? true,
    sources,
    sessionId: merged?.winner.sessionId ?? null,
    iterationId: merged?.winner.playthroughId ?? null,
  };
}

/**
 * Todos los desbloqueos colgados de una sesión viva, de cualquier juego vivo,
 * uno por logro (gana la fila del fundido, como en la ficha). Para la
 * pantalla de Sesiones y el HUD del overlay.
 *
 * Acotado como en la 1.x (getSessionUnlocks.ts:15-28): solo se miran los
 * logros de los que ALGÚN origen tiene sesión, pero de esos se miran todas
 * sus filas (el fundido necesita verlas para elegir bien). El JSON solo se
 * despliega de los catálogos de esos logros.
 */
export function getSessionUnlocks(ctx: QueryContext): SessionUnlock<string>[] {
  // 1. Qué logros tienen ALGUNA fila con sesión: entra por el índice de
  //    `sessionId`, sin recorrer la tabla (lo pide el HUD en plena partida).
  const withSession = ctx.db
    .selectDistinct({
      gameId: achievementUnlocks.gameId,
      source: achievementUnlocks.source,
      apiName: achievementUnlocks.apiName,
    })
    .from(achievementUnlocks)
    .where(and(isNotNull(achievementUnlocks.sessionId), liveUnlock()))
    .all();
  if (withSession.length === 0) return [];
  const wanted = new Set(
    withSession.map((row) => achievementKey(row.gameId, row.source, row.apiName)),
  );

  // 2. TODAS las filas de esos logros (el fundido necesita verlas), por juego.
  const gameIds = [...new Set(withSession.map((row) => row.gameId))];
  const rows: UnlockRow[] = [];
  for (let start = 0; start < gameIds.length; start += 500) {
    const chunk = ctx.db
      .select({
        gameId: achievementUnlocks.gameId,
        source: achievementUnlocks.source,
        apiName: achievementUnlocks.apiName,
        origin: achievementUnlocks.origin,
        unlockedAt: achievementUnlocks.unlockedAt,
        dateReliable: achievementUnlocks.dateReliable,
        sessionId: liveS.id,
        playthroughId: liveP.id,
      })
      .from(achievementUnlocks)
      .leftJoin(liveS, and(eq(liveS.id, achievementUnlocks.sessionId), liveSession(liveS)))
      .leftJoin(liveP, and(eq(liveP.id, achievementUnlocks.playthroughId), livePlaythrough(liveP)))
      .where(
        and(inArray(achievementUnlocks.gameId, gameIds.slice(start, start + 500)), liveUnlock()),
      )
      .all();
    for (const row of chunk) {
      const key = achievementKey(row.gameId, row.source, row.apiName);
      if (wanted.has(key)) rows.push({ ...row, achievementId: key });
    }
  }

  const winners = [...mergeUnlocksByAchievement(rows).values()]
    .map(({ winner }) => winner)
    .filter((winner) => winner.sessionId !== null);
  if (winners.length === 0) return [];

  // El catálogo de los logros ganadores, para el nombre, el icono y la rareza.
  const catalogIds = [...new Set(winners.map((w) => `${parseGame(w.achievementId)}:${w.source}`))];
  const itemsByKey = new Map<string, CatalogItem>();
  for (let start = 0; start < catalogIds.length; start += 500) {
    const catalogRows = ctx.db
      .select({
        gameId: achievementCatalogs.gameId,
        source: achievementCatalogs.source,
        items: achievementCatalogs.items,
      })
      .from(achievementCatalogs)
      .where(
        and(
          inArray(achievementCatalogs.id, catalogIds.slice(start, start + 500)),
          alive(achievementCatalogs),
        ),
      )
      .all();
    for (const catalog of catalogRows) {
      for (const item of sortedItems(catalog.items)) {
        const key = achievementKey(catalog.gameId, catalog.source, item.apiName);
        if (!itemsByKey.has(key)) itemsByKey.set(key, item);
      }
    }
  }

  const result: SessionUnlock<string>[] = [];
  for (const winner of winners) {
    // Sin logro en el catálogo no hay nombre ni icono que pintar (la 1.x
    // unía con `achievements` y ese caso no podía darse).
    const item = itemsByKey.get(winner.achievementId);
    if (!item || winner.sessionId === null) continue;
    result.push({
      sessionId: winner.sessionId,
      achievementId: winner.achievementId,
      displayName: item.displayName,
      iconUrl: item.iconUrl,
      globalPercent: item.globalPercent,
    });
  }
  return result;
}

const parseGame = (key: string): string => key.slice(0, key.indexOf(':'));
