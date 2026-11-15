import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { externalChecks, games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';

// Los juegos "nunca preguntados" a las fuentes externas (AFTERPLAY-2.0.md
// §13.3, §14.3 `enrich`). El caso que los produce: el hub crea `games` y
// `plan_entries` con título, `igdbId` y carátula cuando se añade un juego
// desde el móvil, y NO escribe `external_checks` (no puede preguntar a nadie).
// El juego existe y se ve, pero sin notas, sinopsis, tiempos, etiquetas ni
// logros hasta que un PC lo completa.
//
// "Nunca preguntado" es lo mismo que en el resto de pasadas de arranque (sin
// fila viva en `external_checks`), mirando la fuente que SIEMPRE se escribe al
// completar un juego, haya salido bien o no (`igdb_ratings`, ver `newGame.ts`
// y `refreshGame.ts`). Un fallo ya es una pregunta hecha: reintentarlo es
// cosa del refresco periódico, no de esta pasada. Un juego sin `igdbId` (alta
// manual o de Steam) nace con esa fila (`empty`), así que no entra.

/**
 * Hasta `limit` juegos vivos con `igdbId` y sin ninguna comprobación viva de
 * `igdb_ratings`, en orden de creación (los más antiguos primero).
 */
export function selectGamesToEnrich(ctx: QueryContext, limit: number): string[] {
  const ec = alias(externalChecks, 'enrich_ec');
  const rows = ctx.db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        alive(games),
        isNotNull(games.igdbId),
        sql`not exists (select 1 from ${externalChecks} as ${sql.identifier('enrich_ec')} where ${and(
          eq(ec.gameId, games.id),
          eq(ec.source, 'igdb_ratings'),
          isNull(ec.syncDeleted),
        )})`,
      ),
    )
    .orderBy(asc(games.syncCreated), asc(games.id))
    .limit(limit)
    .all();
  return rows.map((row) => row.id);
}
