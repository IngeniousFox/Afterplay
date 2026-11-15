// Búsqueda y datos de IGDB con las claves que sube el escritorio (§9.3, F-29).
//
//   GET /search?q=          buscador de juegos
//   GET /games/:id/saga     capítulos de la saga, cruzados con tu biblioteca y tu Plan
//   GET /games/:id/media    capturas y tráiler
//
// Las claves viven cifradas en el hub (igdbCredentials.ts) y el cliente
// (igdbClient.ts) las usa en memoria. Sin ellas, las tres rutas fallan con
// `igdb_not_configured` y la PWA dice "abre Afterplay en tu PC una vez" — salvo
// cuando no hay nada que pedir a IGDB (búsqueda vacía, juego sin `igdbId` o sin
// colecciones): ahí se responde vacío sin tocar la red.

import { HubError } from '../../../core/hub';
import { readGameRow } from '../../../../src/main/db/v2/queries/common/gameView';
import { getGames } from '../../../../src/main/db/v2/queries/library/getGames';
import { getOwnedGames } from '../../../../src/main/db/v2/queries/library/getOwnedGames';
import type { GameMedia, IgdbSearchResult, SagaEntry } from '../../../../src/shared/api/v2/igdb';
import { ok } from '../outcome';
import type { TenantService } from '../tenantService';
import type { WebRoute } from './types';

/** El juego de la ruta, con lo que IGDB necesita de él. */
function gameForIgdb(
  service: TenantService,
  id: string,
): { igdbId: number | null; collectionIds: number[] } {
  const game = service.queries().read((ctx) => readGameRow(ctx, id));
  if (!game) throw new HubError('not_found', 'ese juego no existe');
  return {
    igdbId: game.igdbId,
    collectionIds: (game.igdbCollections ?? []).map((collection) => collection.id),
  };
}

export const IGDB_ROUTES: readonly WebRoute[] = [
  {
    method: 'GET',
    pattern: '/search',
    async handler(service, request) {
      const results: IgdbSearchResult[] = await service.igdb().search(request.query.q ?? '');
      return ok(results);
    },
  },
  {
    method: 'GET',
    pattern: '/games/:id/saga',
    async handler(service, _request, params) {
      const { collectionIds } = gameForIgdb(service, params.id);
      // Sin colecciones no hay saga que traer: vacío, no error.
      if (collectionIds.length === 0) return ok<SagaEntry[]>([]);
      const chapters = await service.igdb().collectionGames(collectionIds);

      // El cruce con tu espacio es lo que la hace útil: "de estos ocho,
      // cuatro los terminaste y tres ni los tienes". Se cruza por igdbId, la
      // única clave que comparten los dos lados.
      const { library, owned } = service.queries().read((ctx) => ({
        library: new Map(
          getGames(ctx)
            .filter((game) => game.igdbId !== null)
            .map((game) => [game.igdbId as number, game]),
        ),
        owned: new Map(
          getOwnedGames(ctx)
            .filter((game) => game.igdbId !== null)
            .map((game) => [game.igdbId as number, game]),
        ),
      }));

      const saga: SagaEntry[] = chapters.map((chapter) => {
        const inLibrary = library.get(chapter.igdbId);
        const known = inLibrary ?? owned.get(chapter.igdbId);
        return {
          igdbId: chapter.igdbId,
          libraryId: known?.id ?? null,
          title: chapter.title,
          coverUrl: chapter.coverUrl,
          releaseYear: chapter.releaseYear,
          currentState: inLibrary?.currentState ?? null,
          totalHours: inLibrary?.totalHours ?? 0,
          planned: inLibrary ? false : (owned.get(chapter.igdbId)?.planned ?? false),
        };
      });
      return ok(saga);
    },
  },
  {
    method: 'GET',
    pattern: '/games/:id/media',
    async handler(service, _request, params) {
      const { igdbId } = gameForIgdb(service, params.id);
      // Un juego que IGDB todavía no tiene (sale de Steam) no tiene qué pedir.
      if (igdbId === null) return ok<GameMedia>({ screenshots: [], videoId: null });
      return ok(await service.igdb().media(igdbId));
    },
  },
];
