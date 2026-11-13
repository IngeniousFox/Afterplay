import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { CuriositiesStatus, CuriositySummary } from '../../../../../shared/types';
import { gameCuriosities, games, planEntries } from '../../schema';
import { alive } from '../../store';
import {
  gameViewRows,
  liveGame,
  ofLiveGame,
  toGameRow,
  viewCuriosities,
  viewPlan,
  writeCheck,
  type QueryContext,
} from '../common';

// Curiosidades sobre el esquema 2.0 (CONSULTAS.md §2.2, "curiosities").
//
// `game_curiosities` es UNA fila por juego (id = gameId) con la lista en JSON,
// su `generatedAt` y el `model`. Sustituye a la tabla `curiosities` (una fila
// por frase) y a `games.curiositiesGeneratedAt`. "Tiene curiosidades" = tiene
// fila viva, aunque la lista esté vacía: una lista vacía también es una
// respuesta y evita volver a pagar la pregunta.
//
// Borrar un juego NO borra su fila (es caché, `keep` en el registro): si el
// juego vuelve con el mismo id, reaparecen sin repagar. Pero mientras esté
// borrado no se enseñan ni se generan (R-15).

/** Lo que la generación necesita de un juego (el `PendingCuriositiesGame` 1.x con id de texto). */
export type PendingCuriositiesGame = {
  id: string;
  igdbId: number | null;
  title: string;
  releaseYear: number | null;
  /** Efectivo (override ?? caché): desambigua en el prompt. */
  developer: string | null;
};

/**
 * Todas las curiosidades de los juegos vivos, una entrada por frase, en el
 * orden de la lista de cada juego (para el modo ambiente).
 */
export function getAllCuriosities(ctx: QueryContext): CuriositySummary<string>[] {
  const rows = ctx.db
    .select({ gameId: gameCuriosities.gameId, items: gameCuriosities.items })
    .from(gameCuriosities)
    .where(ofLiveGame(gameCuriosities))
    .orderBy(asc(gameCuriosities.syncCreated), asc(gameCuriosities.id))
    .all();
  return rows.flatMap((row) => row.items.map((text) => ({ gameId: row.gameId, text })));
}

/**
 * Juegos vivos que aún no han pasado por la generación: sin `game_curiosities`
 * viva y sin plan vivo (los planeados se encolan al promocionarlos, como hoy).
 * En orden de creación.
 */
export function getPendingCuriositiesGames(ctx: QueryContext): PendingCuriositiesGame[] {
  return gameViewRows(ctx, and(isNull(viewPlan.id), isNull(viewCuriosities.id))).map((row) => {
    const game = toGameRow(row);
    return {
      id: game.id,
      igdbId: game.igdbId,
      title: game.title,
      releaseYear: game.releaseYear,
      developer: game.developer,
    };
  });
}

/**
 * Contadores de la tarjeta de Ajustes, en una consulta: juegos vivos sin plan,
 * y de ellos los que tienen fila de curiosidades. `running` lo añade quien
 * llama (estado del proceso).
 */
export function getCuriositiesCounts(ctx: QueryContext): Omit<CuriositiesStatus, 'running'> {
  // Uniones por clave (`plan_entries` y `game_curiosities` tienen id = gameId):
  // como mucho una fila de cada por juego, el recuento no se multiplica.
  const row = ctx.db
    .select({ total: count(), generated: count(gameCuriosities.id) })
    .from(games)
    .leftJoin(planEntries, and(eq(planEntries.gameId, games.id), alive(planEntries)))
    .leftJoin(gameCuriosities, and(eq(gameCuriosities.gameId, games.id), alive(gameCuriosities)))
    .where(and(liveGame(), isNull(planEntries.id)))
    .get();
  return { totalGames: row?.total ?? 0, generatedGames: row?.generated ?? 0 };
}

export interface StoreCuriositiesOptions {
  /** Por defecto `ctx.now()`. */
  readonly generatedAt?: Date;
}

/**
 * Guarda el resultado de UNA generación: escribe encima de la fila del juego
 * (regenerar = sustituir la lista entera) y apunta la comprobación
 * `curiosities` (`ok`, o `empty` si el modelo no tenía nada seguro que
 * contar). Una lista vacía TAMBIÉN se guarda: es lo que impide volver a pagar
 * la pregunta.
 *
 * Devuelve false sin escribir nada si el juego no existe o tiene lápida
 * (R-15): una generación que termina después de borrar el juego no debe
 * resucitar ni crear su fila. Todo en una transacción que relee el juego, así
 * que la llamada al modelo va antes y fuera.
 */
export function storeCuriosities(
  ctx: QueryContext,
  gameId: string,
  items: readonly string[],
  model: string | null,
  options: StoreCuriositiesOptions = {},
): boolean {
  return ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) return false;
    const generatedAt = options.generatedAt ?? ctx.now();
    ctx.store.create('game_curiosities', {
      gameId,
      items: [...items],
      generatedAt,
      model,
    });
    writeCheck(ctx, gameId, 'curiosities', items.length > 0 ? 'ok' : 'empty', {
      checkedAt: generatedAt,
    });
    return true;
  });
}
