import { and, asc, eq } from 'drizzle-orm';
import { achievementCatalogs, gameMetadata, games } from '../../schema';
import { alive } from '../../store';
import { ofLiveGame } from '../common/alive';
import type { QueryContext } from '../common/context';

// `collectUsedImages` (`images/maintenance.ts:29`): qué imágenes de la caché
// local están EN USO, para limpiar lo que sobra y redescargar lo que vale.
//
// En la 1.x había una sola columna por imagen. En la 2.0 hay dos: el override
// del usuario y la de la caché externa (D-22). Cuentan las DOS de cada juego
// vivo, aunque solo una sea la efectiva: la otra vuelve a verse en cuanto
// pulsas "volver al automático", y borrar su fichero obligaría a bajarla otra
// vez justo entonces. Más los iconos (color y gris) de los catálogos de logros
// de juegos vivos, como hoy: solo de los logros con icono en color.
//
// Fuera, como hoy: las capturas (no salen de la base) y las carátulas del
// radar (`radar_games.coverUrl`; la 1.x no las contaba y aquí no se cambia).
// Un juego borrado tampoco cuenta: la app ya no lo enseña (en la 1.x su fila
// desaparecía con el borrado).

/** El tipo de la carpeta de la caché (`ImageCacheType` sin `screenshots`). */
export type UsedImageType = 'covers' | 'heroes' | 'achievements';

export interface UsedImage {
  readonly url: string;
  readonly type: UsedImageType;
}

export function collectUsedImages(ctx: QueryContext): UsedImage[] {
  const used: UsedImage[] = [];
  const gameRows = ctx.db
    .select({
      coverOverride: games.coverOverride,
      heroOverride: games.heroOverride,
      coverUrl: gameMetadata.coverUrl,
      heroUrl: gameMetadata.heroUrl,
    })
    .from(games)
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(alive(games))
    .orderBy(asc(games.syncCreated), asc(games.id))
    .all();
  for (const row of gameRows) {
    for (const url of [row.coverOverride, row.coverUrl]) {
      if (url) used.push({ url, type: 'covers' });
    }
    for (const url of [row.heroOverride, row.heroUrl]) {
      if (url) used.push({ url, type: 'heroes' });
    }
  }

  const catalogs = ctx.db
    .select({ items: achievementCatalogs.items })
    .from(achievementCatalogs)
    .where(ofLiveGame(achievementCatalogs))
    .orderBy(asc(achievementCatalogs.syncCreated), asc(achievementCatalogs.id))
    .all();
  for (const { items } of catalogs) {
    for (const item of items) {
      if (!item.iconUrl) continue;
      used.push({ url: item.iconUrl, type: 'achievements' });
      if (item.iconGrayUrl) used.push({ url: item.iconGrayUrl, type: 'achievements' });
    }
  }

  // El mismo icono se repite entre juegos y dos juegos pueden compartir
  // carátula: sin esto la redescarga contaría dos veces un solo fichero.
  const seen = new Set<string>();
  return used.filter((image) => {
    const key = `${image.type}:${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
