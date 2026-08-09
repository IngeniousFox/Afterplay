import { eq, inArray } from 'drizzle-orm';
import { resolveIterationHours } from '../../../src/main/db/queries/games/iterationHours';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import { latestRealStateEvent } from '../../../src/shared/playthroughState';
import type { SagaEntry, StateType } from '../api-types';
import type { TenantDb } from '../db';
import { getCollectionGames } from '../igdb';
import type { IgdbCredentials } from '../tenants';

// La saga de un juego: los capítulos de sus colecciones de IGDB, cruzados con
// tu biblioteca para saber cuáles tienes y cómo te fue con ellos.
//
// El cruce es lo que la hace útil: una lista de secuelas la da cualquier web,
// pero "de estos ocho, cuatro los terminaste, uno lo dejaste y tres ni los
// tienes" solo la puede contar tu propia base.
export const getSaga = async (
  db: TenantDb,
  igdb: IgdbCredentials | null,
  gameId: number,
  now: number,
): Promise<SagaEntry[]> => {
  // Sin IGDB configurado para este inquilino no hay saga que traer. Vacío y no
  // error: la sección simplemente no se pinta, igual que en un juego sin
  // colecciones.
  if (!igdb) return [];

  const [game] = await db
    .select({ igdbCollections: gamesTable.igdbCollections })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);

  const collectionIds = (game?.igdbCollections ?? []).map((collection) => collection.id);
  if (collectionIds.length === 0) return [];

  const chapters = await getCollectionGames(igdb, collectionIds, now);
  if (chapters.length === 0) return [];

  // Qué capítulos están en tu biblioteca. Se buscan por igdbId, que es la
  // única clave que comparten los dos lados — el título no vale (ediciones,
  // subtítulos regionales, mayúsculas).
  const igdbIds = chapters.map((chapter) => chapter.igdbId);
  const owned = await db
    .select({
      id: gamesTable.id,
      igdbId: gamesTable.igdbId,
      planned: gamesTable.planned,
    })
    .from(gamesTable)
    .where(inArray(gamesTable.igdbId, igdbIds));

  const ownedByIgdbId = new Map(
    owned.filter((row) => row.igdbId !== null).map((row) => [row.igdbId as number, row]),
  );

  // Agregación acotada a los juegos encontrados (como mucho 25), no a la
  // biblioteca entera: aquí no hace falta la pasada global de listLibrary.
  const ownedIds = owned.map((row) => row.id);
  const hoursByGame = new Map<number, number>();
  const stateByGame = new Map<number, StateType>();

  if (ownedIds.length > 0) {
    const iterations = await db
      .select({
        id: iterationsTable.id,
        gameId: iterationsTable.gameId,
        manualTotalPlayed: iterationsTable.manualTotalPlayed,
      })
      .from(iterationsTable)
      .where(inArray(iterationsTable.gameId, ownedIds));

    const iterationIds = iterations.map((iteration) => iteration.id);

    const sessionRows = iterationIds.length
      ? await db
          .select({
            iterationId: sessionsTable.iterationId,
            durationSec: sessionsTable.durationSec,
          })
          .from(sessionsTable)
          .where(inArray(sessionsTable.iterationId, iterationIds))
      : [];

    const trackedByIteration = new Map<number, number>();
    for (const row of sessionRows) {
      if (row.iterationId === null) continue;
      trackedByIteration.set(
        row.iterationId,
        (trackedByIteration.get(row.iterationId) ?? 0) + (row.durationSec ?? 0),
      );
    }

    for (const iteration of iterations) {
      const hours = resolveIterationHours(
        iteration.manualTotalPlayed,
        trackedByIteration.get(iteration.id) ?? 0,
      );
      hoursByGame.set(iteration.gameId, (hoursByGame.get(iteration.gameId) ?? 0) + hours);
    }

    const eventRows = iterationIds.length
      ? await db
          .select({
            gameId: iterationsTable.gameId,
            type: stateEventsTable.type,
            occurredAt: stateEventsTable.occurredAt,
            id: stateEventsTable.id,
          })
          .from(stateEventsTable)
          .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id))
          .where(inArray(stateEventsTable.iterationId, iterationIds))
      : [];

    const byGame = new Map<number, typeof eventRows>();
    for (const row of eventRows) {
      const list = byGame.get(row.gameId) ?? [];
      list.push(row);
      byGame.set(row.gameId, list);
    }
    for (const [id, candidates] of byGame) {
      const latest = latestRealStateEvent(candidates);
      if (latest) stateByGame.set(id, latest.type as StateType);
    }
  }

  return chapters.map((chapter) => {
    const match = ownedByIgdbId.get(chapter.igdbId);
    return {
      igdbId: chapter.igdbId,
      libraryId: match?.id ?? null,
      title: chapter.title,
      coverUrl: chapter.coverUrl,
      releaseYear: chapter.releaseYear,
      currentState: match ? (stateByGame.get(match.id) ?? null) : null,
      totalHours: match ? (hoursByGame.get(match.id) ?? 0) : 0,
      planned: match?.planned ?? false,
    };
  });
};
