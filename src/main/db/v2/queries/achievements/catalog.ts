import { and, eq, sql } from 'drizzle-orm';
import { achievementCatalogId } from '../../../../../shared/sync/ids';
import { sameValue } from '../../../../../shared/sync/fieldClocks';
import {
  achievementCatalogs,
  games,
  type AchievementCatalogItem,
  type AchievementSource,
} from '../../schema';
import { alive } from '../../store';
import { writeCheck } from '../common/checks';
import type { QueryContext } from '../common/context';

// Escribir y leer `achievement_catalogs` (AFTERPLAY-2.0.md §7.4).
//
// En la 1.x el catálogo era una fila por logro con un `UPSERT` por
// (juego, apiName), y cada refresco tocaba solo las columnas que debía. En el
// 2.0 es UNA fila por (juego, fuente) con la lista entera en JSON, que es
// caché (clase C): se escribe ENTERA, y solo si cambia. Lo que antes decidía
// el `set` del upsert columna a columna se decide ahora en memoria, antes de
// escribir (`mergeSteamCatalog`, `mergeRaCatalog`):
//
// - La descripción guardada se conserva cuando la API manda null (los ocultos
//   de Steam nunca la traen y la que hay puede venir del schema local,
//   `fillHiddenDescriptions`). Solo en Steam, como hoy; RA siempre la da.
// - La rareza guardada se conserva si su llamada falló (`percentages === null`).
// - Un logro que ya no viene en la respuesta NO se borra: la 1.x nunca borraba
//   filas del catálogo (el upsert no quita nada), y un logro retirado sigue
//   siendo el ancla de los desbloqueos que ya tienes.
// - Los iconos que apuntan a un directorio (acaban en `/`) se guardan como
//   null. Es la limpieza que hacía `clearIconlessAchievementIcons` en cada
//   arranque (steam/backfill.ts:71); hecha al escribir, esa pasada sobra y no
//   reescribe catálogos sincronizados en cada arranque (CONSULTAS.md §2.3).
//
// "Solo si cambia": la puerta no escribe un valor estructuralmente igual
// (`sameValue`), pero para un array el ORDEN cuenta. Por eso la lista se
// guarda siempre ordenada de la misma forma (`sortIndex`, y a igualdad
// `apiName`) y con todas las claves presentes: dos respuestas iguales en otro
// orden no producen una escritura. Y como `fetchedAt` cambiaría en cada
// refresco, la fila no se toca en absoluto si la lista no cambia: "cuándo se
// preguntó" lo guarda `external_checks` (`steam_achievements`,
// `ra_achievements`), que es para lo que existe (F-34).

export type CatalogItem = AchievementCatalogItem;

/** Un logro tal como lo entrega la API de Steam (`SteamAchievementDef` de `steam/api.ts`). */
export interface SteamCatalogDefinition {
  readonly apiName: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly iconUrl: string | null;
  readonly iconGrayUrl: string | null;
  readonly hidden: boolean;
  readonly sortIndex: number;
}

/**
 * Un logro de RetroAchievements ya traducido por quien llama (`ra/sync.ts`):
 * `apiName = String(raAchievementId)` y las URL de la insignia.
 */
export interface RaCatalogDefinition {
  readonly apiName: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly iconUrl: string | null;
  readonly iconGrayUrl: string | null;
  readonly globalPercent: number | null;
  readonly sortIndex: number;
}

/** Un icono que apunta al directorio del appid no es una imagen: null (steam/backfill.ts:61). */
const iconOrNull = (url: string | null | undefined): string | null =>
  url == null || url.length === 0 || url.endsWith('/') ? null : url;

/** Todas las claves, en el mismo orden y con null explícito: la forma canónica. */
export function normalizeCatalogItem(
  item: Partial<CatalogItem> & { apiName: string },
): CatalogItem {
  return {
    apiName: item.apiName,
    displayName: item.displayName ?? item.apiName,
    description: item.description ?? null,
    iconUrl: iconOrNull(item.iconUrl),
    iconGrayUrl: iconOrNull(item.iconGrayUrl),
    hidden: item.hidden ?? false,
    globalPercent: item.globalPercent ?? null,
    sortIndex: item.sortIndex ?? 0,
  };
}

const byCatalogOrder = (a: CatalogItem, b: CatalogItem): number =>
  a.sortIndex - b.sortIndex || (a.apiName < b.apiName ? -1 : a.apiName > b.apiName ? 1 : 0);

/**
 * Lo nuevo encima de lo guardado: los de la respuesta (un `apiName` repetido
 * cuenta una vez, el primero) y detrás los guardados que ya no vienen, todo
 * en el orden canónico.
 */
function mergeKeepingRetired(
  fresh: readonly CatalogItem[],
  previous: readonly CatalogItem[],
): CatalogItem[] {
  const seen = new Set<string>();
  const merged: CatalogItem[] = [];
  for (const item of fresh) {
    if (seen.has(item.apiName)) continue;
    seen.add(item.apiName);
    merged.push(item);
  }
  for (const item of previous) {
    if (!seen.has(item.apiName)) merged.push(normalizeCatalogItem(item));
  }
  return merged.sort(byCatalogOrder);
}

/**
 * La fusión de Steam (la del `onConflictDoUpdate` de syncAchievements.ts:559):
 * textos, iconos, `hidden` y `sortIndex` de la respuesta; descripción guardada
 * si la respuesta trae null; rareza de `percentages` si la llamada contestó
 * (un logro que no viene en el mapa queda null, como hoy), la guardada si no.
 */
export function mergeSteamCatalog(
  previous: readonly CatalogItem[],
  definitions: readonly SteamCatalogDefinition[],
  percentages: ReadonlyMap<string, number> | null,
): CatalogItem[] {
  const before = new Map(previous.map((item) => [item.apiName, item]));
  const fresh = definitions.map((definition) => {
    const old = before.get(definition.apiName);
    return normalizeCatalogItem({
      apiName: definition.apiName,
      displayName: definition.displayName,
      description: definition.description ?? old?.description ?? null,
      iconUrl: definition.iconUrl,
      iconGrayUrl: definition.iconGrayUrl,
      hidden: definition.hidden,
      globalPercent: percentages
        ? (percentages.get(definition.apiName) ?? null)
        : (old?.globalPercent ?? null),
      sortIndex: definition.sortIndex,
    });
  });
  return mergeKeepingRetired(fresh, previous);
}

/** La de RA (ra/sync.ts:46): la respuesta manda en todo; RA no tiene ocultos. */
export function mergeRaCatalog(
  previous: readonly CatalogItem[],
  definitions: readonly RaCatalogDefinition[],
): CatalogItem[] {
  const fresh = definitions.map((definition) =>
    normalizeCatalogItem({ ...definition, hidden: false }),
  );
  return mergeKeepingRetired(fresh, previous);
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/**
 * Los logros del catálogo vivo de un juego y fuente, en orden de catálogo, o
 * `[]` si no hay. No mira si el juego está vivo: lo usan las escrituras, que
 * ya lo han comprobado dentro de su transacción.
 */
export function readCatalogItems(
  ctx: QueryContext,
  gameId: string,
  source: AchievementSource,
): CatalogItem[] {
  const row = ctx.db
    .select({ items: achievementCatalogs.items, deleted: achievementCatalogs.syncDeleted })
    .from(achievementCatalogs)
    .where(eq(achievementCatalogs.id, achievementCatalogId(gameId, source)))
    .get();
  return row && row.deleted === null ? sortedItems(row.items) : [];
}

/** Ordena por `sortIndex` sin perder el orden guardado entre iguales (lo importado). */
export const sortedItems = (items: readonly CatalogItem[]): CatalogItem[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.sortIndex - b.item.sortIndex || a.index - b.index)
    .map(({ item }) => item);

/** Los catálogos vivos de un juego vivo: Steam primero, luego RA. */
export function readGameCatalogs(
  ctx: QueryContext,
  gameId: string,
): { source: AchievementSource; items: CatalogItem[]; fetchedAt: Date }[] {
  return (
    ctx.db
      .select({
        source: achievementCatalogs.source,
        items: achievementCatalogs.items,
        fetchedAt: achievementCatalogs.fetchedAt,
      })
      .from(achievementCatalogs)
      .innerJoin(games, eq(games.id, achievementCatalogs.gameId))
      // El juego ya se une: `alive` en las dos basta (README, F-11 con el padre unido).
      .where(and(eq(achievementCatalogs.gameId, gameId), alive(achievementCatalogs), alive(games)))
      // Steam antes que RA (el orden alfabético daría el contrario).
      .orderBy(sql`case ${achievementCatalogs.source} when 'steam' then 0 else 1 end`)
      .all()
      .map((row) => ({ ...row, items: sortedItems(row.items) }))
  );
}

// ── Escritura ───────────────────────────────────────────────────────────────

/** Las claves externas de un juego vivo, o null si no existe o tiene lápida. */
export function readLiveGameKeys(
  ctx: QueryContext,
  gameId: string,
): { steamAppId: number | null; raGameId: number | null } | null {
  const row = ctx.db
    .select({
      steamAppId: games.steamAppId,
      raGameId: games.raGameId,
      deleted: games.syncDeleted,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  return row && row.deleted === null
    ? { steamAppId: row.steamAppId, raGameId: row.raGameId }
    : null;
}

/**
 * Escribe la lista entera de un catálogo SOLO si cambia respecto a la viva.
 * Devuelve si escribió. Sobre una fila con lápida (p. ej. tras cambiar el
 * appid) la resucita con todo indicado, así que no recupera nada viejo. Debe
 * llamarse dentro de la transacción de quien ya comprobó que el juego vive.
 */
export function writeCatalogIfChanged(
  ctx: QueryContext,
  gameId: string,
  source: AchievementSource,
  items: readonly CatalogItem[],
  fetchedAt: Date,
): boolean {
  const current = ctx.db
    .select({ items: achievementCatalogs.items, deleted: achievementCatalogs.syncDeleted })
    .from(achievementCatalogs)
    .where(eq(achievementCatalogs.id, achievementCatalogId(gameId, source)))
    .get();
  if (current && current.deleted === null && sameValue(current.items, items)) return false;
  ctx.store.create('achievement_catalogs', { gameId, source, items: [...items], fetchedAt });
  return true;
}

export type StoreCatalogResult =
  /** Catálogo (o su ausencia confirmada) apuntado; `written` = la fila cambió. */
  | { readonly status: 'stored'; readonly written: boolean; readonly count: number }
  /** El juego ya no existe, o su clave externa cambió mientras se preguntaba. */
  | { readonly status: 'stale' }
  /** Catálogo vacío que no es una respuesta (clave mala, juego sin publicar): nada se marca. */
  | { readonly status: 'unconfirmed' };

export interface StoreSteamCatalogInput {
  readonly gameId: string;
  /** El appid con el que se preguntó: si el juego ya tiene otro, no se escribe nada. */
  readonly appId: number;
  readonly definitions: readonly SteamCatalogDefinition[];
  /** Rareza global; null = la llamada falló. */
  readonly percentages: ReadonlyMap<string, number> | null;
  /** Por defecto, `ctx.now()`. Es el `checkedAt` de `steam_achievements`. */
  readonly fetchedAt?: Date;
}

/**
 * La mitad de base del catálogo de `syncGameAchievements` (syncAchievements.ts
 * :471-583), en una transacción: relee que el juego vive y sigue con ese
 * appid (R-15 y la guarda de hoy), funde con el catálogo guardado, escribe si
 * cambia y apunta `steam_achievements`.
 *
 * - `unconfirmed`: catálogo vacío y la rareza no lo confirma (null, o con
 *   entradas). No escribe nada, para que la pasada del arranque lo repita
 *   (el comentario largo de syncAchievements.ts:471-510).
 * - `stale`: juego borrado o con otro appid. No escribe nada.
 * - `stored`: `count` es el número de logros de la respuesta (`catalogCount`
 *   de hoy). Con cero logros confirmados no se crea una fila vacía; el sello
 *   queda `empty`.
 */
export function storeSteamCatalog(
  ctx: QueryContext,
  input: StoreSteamCatalogInput,
): StoreCatalogResult {
  const { gameId, appId, definitions, percentages } = input;
  if (definitions.length === 0 && (percentages === null || percentages.size > 0)) {
    return { status: 'unconfirmed' };
  }
  const fetchedAt = input.fetchedAt ?? ctx.now();
  return ctx.store.transaction(() => {
    const game = readLiveGameKeys(ctx, gameId);
    if (!game || game.steamAppId !== appId) return { status: 'stale' } as const;
    const previous = readCatalogItems(ctx, gameId, 'steam');
    const merged = mergeSteamCatalog(previous, definitions, percentages);
    const written =
      merged.length > 0 && writeCatalogIfChanged(ctx, gameId, 'steam', merged, fetchedAt);
    writeCheck(ctx, gameId, 'steam_achievements', definitions.length > 0 ? 'ok' : 'empty', {
      checkedAt: fetchedAt,
    });
    return { status: 'stored', written, count: definitions.length } as const;
  });
}

export interface StoreRaCatalogInput {
  readonly gameId: string;
  /** El set con el que se preguntó: si el juego ya apunta a otro, no se escribe. */
  readonly raGameId: number;
  readonly definitions: readonly RaCatalogDefinition[];
  /** Por defecto, `ctx.now()`. Es el `checkedAt` de `ra_achievements`. */
  readonly fetchedAt?: Date;
}

/**
 * El catálogo de RetroAchievements (ra/sync.ts:27-70), en una transacción que
 * relee `raGameId` (hoy no lo releía, CONSULTAS.md §2.3) y que el juego vive.
 * Apunta `ra_achievements`, que en RA vale por catálogo Y desbloqueos: los
 * dos llegan en la misma respuesta (hoy estampaba los dos sellos a la vez).
 */
export function storeRaCatalog(ctx: QueryContext, input: StoreRaCatalogInput): StoreCatalogResult {
  const fetchedAt = input.fetchedAt ?? ctx.now();
  return ctx.store.transaction(() => {
    const game = readLiveGameKeys(ctx, input.gameId);
    if (!game || game.raGameId !== input.raGameId) return { status: 'stale' } as const;
    const previous = readCatalogItems(ctx, input.gameId, 'ra');
    const merged = mergeRaCatalog(previous, input.definitions);
    const written =
      merged.length > 0 && writeCatalogIfChanged(ctx, input.gameId, 'ra', merged, fetchedAt);
    writeCheck(
      ctx,
      input.gameId,
      'ra_achievements',
      input.definitions.length > 0 ? 'ok' : 'empty',
      {
        checkedAt: fetchedAt,
      },
    );
    return { status: 'stored', written, count: input.definitions.length } as const;
  });
}

/**
 * Las descripciones de los ocultos que dejó el schema local de Steam
 * (syncAchievements.ts:392). La lectura del disco va FUERA, antes; esto
 * recibe su resultado (`texts`, por `apiName`) y, en una transacción que
 * relee el catálogo y que el juego sigue con ese appid, rellena solo los
 * ocultos cuyo texto cambia. Un texto ausente o vacío no borra nada.
 * Devuelve cuántas descripciones cambió (0 = no escribió).
 */
export function fillHiddenDescriptions(
  ctx: QueryContext,
  gameId: string,
  appId: number,
  texts: ReadonlyMap<string, { readonly description?: string | null }>,
): number {
  if (texts.size === 0) return 0;
  return ctx.store.transaction(() => {
    const game = readLiveGameKeys(ctx, gameId);
    if (!game || game.steamAppId !== appId) return 0;
    const items = readCatalogItems(ctx, gameId, 'steam');
    let filled = 0;
    const next = items.map((item) => {
      const description = texts.get(item.apiName)?.description;
      if (!item.hidden || !description || item.description === description) return item;
      filled++;
      return { ...item, description };
    });
    if (filled === 0) return 0;
    ctx.store.patch('achievement_catalogs', achievementCatalogId(gameId, 'steam'), {
      items: next,
    });
    return filled;
  });
}

/** Un logro tal como lo necesita el `achievements.json` de Goldberg (emu/goldbergCatalog.ts). */
export interface GoldbergCatalogItem {
  readonly apiName: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly hidden: boolean;
}

/**
 * El catálogo de STEAM de un juego vivo para escribírselo a Goldberg. Hoy
 * leía la tabla `achievements` entera del juego, que mezclaba Steam y RA
 * (CONSULTAS.md §2.3); un crack de Steam solo entiende los apiName de Steam.
 * `[]` si no hay catálogo o el juego no vive. El fichero lo escribe quien
 * llama, fuera de toda transacción.
 */
export function getGoldbergCatalogItems(ctx: QueryContext, gameId: string): GoldbergCatalogItem[] {
  if (!readLiveGameKeys(ctx, gameId)) return [];
  return readCatalogItems(ctx, gameId, 'steam').map((item) => ({
    apiName: item.apiName,
    displayName: item.displayName,
    description: item.description,
    hidden: item.hidden,
  }));
}
