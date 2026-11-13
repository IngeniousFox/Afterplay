import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  achievementCatalogs,
  achievementUnlocks,
  externalChecks,
  type AchievementSource,
} from '../../schema';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { liveUnlock, ofLiveGame } from '../common/alive';
import type { QueryContext } from '../common/context';
import type { CatalogItem } from './catalog';
import { catalogContents } from './catalogCache';

// El progreso de cada catálogo (juego × fuente): cuántos logros tiene, cuáles
// tienes, con qué fecha. Es la base común del resumen de Stats, de la
// tarjeta de Ajustes y del "¿100 %?" de los avisos.
//
// Completado POR FUENTE (decisión R-11 del usuario): un 100 % de Steam y uno
// de RetroAchievements son dos hitos distintos y ya no se suman. Por eso aquí
// la unidad es el catálogo, no el juego.
//
// Rendimiento (la cicatriz de getAchievementsOverview.ts:20-50): el catálogo
// entero son ~40.000 logros. Lo que solo necesita CONTAR (el tamaño de cada
// catálogo) se cuenta en SQL con `json_array_length`, sin traer el JSON. Lo
// que necesita mirar logro a logro viaja, pero son los DESBLOQUEOS (~3.400),
// ya fundidos por logro en la base, y solo se despliega el JSON de los
// catálogos que tienen alguno. Las dos cosas se guardan en memoria por
// (catálogo, `syncUpdated`) (`catalogCache.ts`): un catálogo casi nunca cambia.
//
// El fundido escrito en SQL es una SEGUNDA escritura de la regla de
// `src/shared/mergeUnlocks.ts` ("una fecha fiable gana a una que no; empatadas,
// la más temprana"), restringida a los dos campos que hacen falta aquí. Se
// acepta por lo mismo que en la 1.x (getAchievementsOverview.ts:88-112): es el
// único sitio donde la regla se paga sobre la tabla entera. Si se toca el
// desempate, hay que tocar las dos; los tests cruzan la ficha con el resumen.

export interface UnlockedItem {
  readonly item: CatalogItem;
  /** Posición en el catálogo ordenado: el desempate estable de las listas. */
  readonly index: number;
  readonly unlockedAt: Date;
  readonly dateReliable: boolean;
}

export interface CatalogProgress {
  readonly catalogId: string;
  readonly gameId: string;
  readonly source: AchievementSource;
  readonly total: number;
  /** Los logros del catálogo que constan por algún origen, en orden de catálogo. */
  readonly unlocked: readonly UnlockedItem[];
  /** El catálogo desplegado; solo de los catálogos con algún desbloqueo. */
  readonly items: readonly CatalogItem[] | null;
  /**
   * ¿Se preguntó de verdad por tus desbloqueos de esta fuente? Steam:
   * `ec(steam_unlocks)` respondido (R-05); RA: `ec(ra_achievements)`
   * respondido (catálogo y desbloqueos llegan juntos).
   */
  readonly unlocksAsked: boolean;
}

/** Regla 2 de LOGROS-IDEAS §1: "no sabemos" no es "0 %". */
export const progressIsKnown = (progress: CatalogProgress): boolean =>
  progress.unlocksAsked || progress.unlocked.length > 0;

/** El 100 % de UNA fuente. */
export const progressIsComplete = (progress: CatalogProgress): boolean =>
  progress.total > 0 && progress.unlocked.length === progress.total;

/**
 * La fecha del 100 %: la del ÚLTIMO logro, y solo si todas son fiables (con un
 * rescate por medio el momento del cierre es inventado).
 */
export function completedAtOf(progress: CatalogProgress): Date | null {
  if (!progressIsComplete(progress)) return null;
  let last = 0;
  for (const unlock of progress.unlocked) {
    if (!unlock.dateReliable) return null;
    last = Math.max(last, unlock.unlockedAt.getTime());
  }
  return new Date(last);
}

const ASKED_SOURCE = { steam: 'steam_unlocks', ra: 'ra_achievements' } as const;

/**
 * El progreso de los catálogos vivos de juegos vivos (de `gameIds`, o de
 * todos), en orden de creación del catálogo (el de la 1.x era el del primer
 * logro del juego, getAchievementsOverview.ts:158-161).
 */
export function loadCatalogProgress(
  ctx: QueryContext,
  gameIds?: readonly string[],
): CatalogProgress[] {
  if (gameIds && gameIds.length === 0) return [];
  const onlyGames = (column: AnySQLiteColumn): SQL | undefined =>
    gameIds ? inArray(column, [...new Set(gameIds)]) : undefined;

  const catalogs = ctx.db
    .select({
      id: achievementCatalogs.id,
      gameId: achievementCatalogs.gameId,
      source: achievementCatalogs.source,
      // Sin el JSON: el tamaño y los logros salen de la memoria por reloj.
      syncUpdated: achievementCatalogs.syncUpdated,
    })
    .from(achievementCatalogs)
    .where(and(ofLiveGame(achievementCatalogs), onlyGames(achievementCatalogs.gameId)))
    .orderBy(asc(achievementCatalogs.syncCreated), asc(achievementCatalogs.id))
    .all();
  if (catalogs.length === 0) return [];

  // El fundido por logro, en la base: una fila por (juego, fuente, apiName).
  const merged = ctx.db
    .select({
      gameId: achievementUnlocks.gameId,
      source: achievementUnlocks.source,
      apiName: achievementUnlocks.apiName,
      unlockedAt:
        sql<number>`coalesce(min(case when ${achievementUnlocks.dateReliable} then ${achievementUnlocks.unlockedAt} end), min(${achievementUnlocks.unlockedAt}))`.mapWith(
          Number,
        ),
      dateReliable:
        sql<number>`max(case when ${achievementUnlocks.dateReliable} then 1 else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(achievementUnlocks)
    .where(and(liveUnlock(), onlyGames(achievementUnlocks.gameId)))
    .groupBy(achievementUnlocks.gameId, achievementUnlocks.source, achievementUnlocks.apiName)
    .all();

  const unlocksByCatalog = new Map<
    string,
    Map<string, { unlockedAt: Date; dateReliable: boolean }>
  >();
  for (const row of merged) {
    const key = `${row.gameId}:${row.source}`;
    const byApi = unlocksByCatalog.get(key) ?? new Map();
    byApi.set(row.apiName, {
      unlockedAt: new Date(row.unlockedAt),
      dateReliable: row.dateReliable === 1,
    });
    unlocksByCatalog.set(key, byApi);
  }

  // Solo se despliega el JSON de los catálogos con algún desbloqueo; el resto
  // solo se cuenta. Las dos cosas se reutilizan mientras la fila no cambie.
  const contents = catalogContents(
    ctx.db,
    catalogs,
    new Set(catalogs.filter((catalog) => unlocksByCatalog.has(catalog.id)).map((c) => c.id)),
  );

  const asked = new Set(
    ctx.db
      .select({ gameId: externalChecks.gameId, source: externalChecks.source })
      .from(externalChecks)
      .where(
        and(
          isNull(externalChecks.syncDeleted),
          or(
            eq(externalChecks.source, ASKED_SOURCE.steam),
            eq(externalChecks.source, ASKED_SOURCE.ra),
          ),
          inArray(externalChecks.status, ['ok', 'empty']),
          onlyGames(externalChecks.gameId),
        ),
      )
      .all()
      .map((row) => `${row.gameId}:${row.source}`),
  );

  return catalogs.map((catalog) => {
    const content = contents.get(catalog.id);
    const items = content?.items ?? null;
    const byApi = unlocksByCatalog.get(catalog.id);
    const unlocked: UnlockedItem[] = [];
    if (items && byApi) {
      // Un apiName repetido en un catálogo (no lo escribe nadie del 2.0, pero
      // podría llegar) cuenta una vez: si no, "tienes 31 de 30".
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const unlock = byApi.get(item.apiName);
        if (!unlock || seen.has(item.apiName)) return;
        seen.add(item.apiName);
        unlocked.push({ item, index, ...unlock });
      });
    }
    return {
      catalogId: catalog.id,
      gameId: catalog.gameId,
      source: catalog.source,
      total: content?.total ?? 0,
      unlocked,
      items,
      unlocksAsked: asked.has(`${catalog.gameId}:${ASKED_SOURCE[catalog.source]}`),
    };
  });
}
