import { and, eq } from 'drizzle-orm';
import { gameMetadata, games, type KeySource } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';

// La foto de UN juego que toman los refrescos de la ficha antes de salir a la
// red: el "actualízalo todo" (`refreshGame.ts`), el ⟳ de notas
// (`refreshRatings.ts`), el ⟳ de HowLongToBeat (`ipc/hltb.ts`) y el
// calentado del alta (`warmNewGame.ts`). Lo que la red necesita para preguntar
// (título, año, claves) y lo que la escritura volverá a comparar.

export interface ExternalSnapshot {
  readonly gameId: string;
  readonly title: string;
  readonly igdbId: number | null;
  readonly steamAppId: number | null;
  readonly steamAppIdSource: KeySource | null;
  readonly sgdbId: number | null;
  readonly sgdbIdSource: KeySource | null;
  readonly raGameId: number | null;
  /** De la caché: el año con el que se busca en HowLongToBeat y SteamGridDB. */
  readonly releaseYear: number | null;
}

/** La foto de un juego vivo, o null si no existe o tiene lápida. */
export function readExternalSnapshot(ctx: QueryContext, gameId: string): ExternalSnapshot | null {
  const row = ctx.db
    .select({
      gameId: games.id,
      title: games.title,
      igdbId: games.igdbId,
      steamAppId: games.steamAppId,
      steamAppIdSource: games.steamAppIdSource,
      sgdbId: games.sgdbId,
      sgdbIdSource: games.sgdbIdSource,
      raGameId: games.raGameId,
      releaseYear: gameMetadata.releaseYear,
    })
    .from(games)
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(and(eq(games.id, gameId), alive(games)))
    .get();
  return row ?? null;
}
