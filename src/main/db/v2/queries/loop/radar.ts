import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { RadarGame } from '../../../../../shared/types';
import { radarGameId } from '../../../../../shared/sync/ids';
import {
  gameMetadata,
  games,
  radarGames,
  type RadarGameRow,
  type ReleaseDatePrecision,
} from '../../schema';
import type { PatchValues } from '../../store';
import { alive } from '../../store';
import { liveGame, ofLiveGame, type QueryContext } from '../common';

// El radar de secuelas sobre el esquema 2.0 (CONSULTAS.md §2.3, `radar/pass.ts`
// `findAnnounced`, e `ipc/radar.ts`).
//
// `radar_games` tiene id `igdb:<igdbId>`: volver a escribir el mismo anuncio
// es "escribir encima". `dismissedAt` es dato del usuario: las escrituras de
// la pasada NUNCA lo indican, así que lo conservan (y también al resucitar
// una fila con lápida, R-15).

/** Lo que la pasada sabe de un anuncio. Es la forma de `CollectionGame` (igdb/types.ts). */
export interface RadarCandidate {
  readonly igdbId: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly releaseYear: number | null;
  readonly releaseDate: Date | null;
  readonly releaseDatePrecision: ReleaseDatePrecision | null;
  /** Las sagas del anuncio, en ids de colección de IGDB. */
  readonly collectionIds: readonly number[];
}

/**
 * Lo que la pasada ha descubierto y no has descartado, por fecha de salida
 * (las sin fecha primero, como el `ORDER BY` de SQLite en la 1.x). El id es
 * ahora `igdb:<igdbId>` (texto).
 */
export function listRadarGames(ctx: QueryContext): RadarGame<string>[] {
  return ctx.db
    .select({
      id: radarGames.id,
      igdbId: radarGames.igdbId,
      title: radarGames.title,
      coverUrl: radarGames.coverUrl,
      collectionName: radarGames.collectionName,
      releaseDate: radarGames.releaseDate,
      releaseDatePrecision: radarGames.releaseDatePrecision,
      releaseYear: radarGames.releaseYear,
      discoveredAt: radarGames.discoveredAt,
      dismissedAt: radarGames.dismissedAt,
    })
    .from(radarGames)
    .where(and(alive(radarGames), isNull(radarGames.dismissedAt)))
    .orderBy(asc(radarGames.releaseDate), asc(radarGames.id))
    .all();
}

/**
 * Descarta un anuncio (para siempre, hasta que se deshaga a mano). Devuelve
 * false si no existe o tiene lápida. Si ya estaba descartado no escribe: se
 * conserva la fecha del primer descarte (la 1.x la pisaba en cada clic, sin
 * que nadie la leyera).
 */
export function dismissRadarGame(ctx: QueryContext, igdbId: number): boolean {
  const id = radarGameId(igdbId);
  return ctx.store.transaction(() => {
    const row = ctx.db
      .select({ deleted: radarGames.syncDeleted, dismissedAt: radarGames.dismissedAt })
      .from(radarGames)
      .where(eq(radarGames.id, id))
      .get();
    if (!row || row.deleted !== null) return false;
    if (row.dismissedAt === null) ctx.store.patch('radar_games', id, { dismissedAt: ctx.now() });
    return true;
  });
}

export interface StoreRadarDiscoveriesResult {
  /** Descubrimientos nuevos de esta pasada (lo que la 1.x llamaba `fresh`). */
  readonly discovered: number;
  /** Filas escritas (nuevas o puestas al día). */
  readonly written: number;
  /** Filas retiradas porque ese juego ya está en tu biblioteca. */
  readonly removed: number;
}

/**
 * Las escrituras de `findAnnounced`, en UNA transacción que relee lo que
 * necesita (la llamada a IGDB va antes y fuera):
 *
 * 1. Lo que ya tienes (un juego vivo con ese `igdbId`) no es un descubrimiento.
 * 2. El resto se escribe ENTERO, no solo lo nuevo, para que una fecha que se
 *    mueve se corrija sola. `discoveredAt` solo se fija al descubrirlo (o
 *    redescubrirlo tras una lápida); `dismissedAt` no se indica nunca, así que
 *    un descarte sobrevive a la pasada.
 * 3. La saga "tuya" del anuncio es la primera de sus colecciones que aparece
 *    en `game_metadata.igdbCollections` de un juego vivo, con su nombre.
 * 4. Limpieza: se retiran (lápida) los anuncios de juegos que ya tienes.
 *
 * `discovered` cuenta los anuncios que no tenían fila viva antes de la pasada
 * y quedan visibles (un redescubrimiento que tú ya habías descartado no avisa).
 */
export function storeRadarDiscoveries(
  ctx: QueryContext,
  candidates: readonly RadarCandidate[],
): StoreRadarDiscoveriesResult {
  return ctx.store.transaction(() => {
    const owned = new Set(
      ctx.db
        .select({ igdbId: games.igdbId })
        .from(games)
        .where(and(liveGame(), isNotNull(games.igdbId)))
        .all()
        .map((row) => row.igdbId as number),
    );

    const collectionNames = new Map<number, string>();
    for (const row of ctx.db
      .select({ collections: gameMetadata.igdbCollections })
      .from(gameMetadata)
      .where(and(ofLiveGame(gameMetadata), isNotNull(gameMetadata.igdbCollections)))
      .orderBy(asc(gameMetadata.syncCreated), asc(gameMetadata.id))
      .all()) {
      for (const collection of row.collections ?? []) {
        collectionNames.set(collection.id, collection.name);
      }
    }

    // Si un anuncio llega dos veces, gana el último (como el upsert de la 1.x).
    const byIgdbId = new Map<number, RadarCandidate>();
    for (const candidate of candidates) {
      if (!owned.has(candidate.igdbId)) byIgdbId.set(candidate.igdbId, candidate);
    }

    const before = new Map<number, Pick<RadarGameRow, 'syncDeleted' | 'dismissedAt'>>();
    if (byIgdbId.size > 0) {
      for (const row of ctx.db
        .select({
          igdbId: radarGames.igdbId,
          syncDeleted: radarGames.syncDeleted,
          dismissedAt: radarGames.dismissedAt,
        })
        .from(radarGames)
        .where(
          inArray(
            radarGames.id,
            [...byIgdbId.keys()].map((igdbId) => radarGameId(igdbId)),
          ),
        )
        .all()) {
        before.set(row.igdbId, row);
      }
    }

    const now = ctx.now();
    let discovered = 0;
    for (const candidate of byIgdbId.values()) {
      const collectionId = candidate.collectionIds.find((id) => collectionNames.has(id)) ?? null;
      const previous = before.get(candidate.igdbId);
      const wasAlive = previous !== undefined && previous.syncDeleted === null;
      const values = {
        collectionId,
        collectionName: collectionId === null ? null : (collectionNames.get(collectionId) ?? null),
        title: candidate.title,
        coverUrl: candidate.coverUrl,
        releaseDate: candidate.releaseDate,
        releaseDatePrecision: candidate.releaseDatePrecision,
        releaseYear: candidate.releaseYear,
      } satisfies PatchValues<'radar_games'>;
      if (wasAlive) {
        // Viva: parche sin `discoveredAt` (se conserva el del descubrimiento)
        // ni `dismissedAt`. `create` exigiría `discoveredAt` (NOT NULL).
        ctx.store.patch('radar_games', radarGameId(candidate.igdbId), values);
      } else {
        // Nueva o con lápida (resucita conservando `dismissedAt`, que no se
        // indica). Es un (re)descubrimiento: `discoveredAt` de ahora.
        ctx.store.create('radar_games', { igdbId: candidate.igdbId, ...values, discoveredAt: now });
        if ((previous?.dismissedAt ?? null) === null) discovered++;
      }
    }

    // Por subconsulta y no con la lista de ids en el IN: una biblioteca
    // grande no choca con el tope de variables de SQLite.
    const stale = ctx.db
      .select({ id: radarGames.id })
      .from(radarGames)
      .where(
        and(
          alive(radarGames),
          inArray(
            radarGames.igdbId,
            ctx.db
              .select({ igdbId: games.igdbId })
              .from(games)
              .where(and(liveGame(), isNotNull(games.igdbId))),
          ),
        ),
      )
      .all();
    for (const row of stale) ctx.store.remove('radar_games', row.id);

    return { discovered, written: byIgdbId.size, removed: stale.length };
  });
}
