import { inArray, sql } from 'drizzle-orm';
import { achievementCatalogs } from '../../schema';
import type { LocalDb } from '../../store';
import { sortedItems, type CatalogItem } from './catalog';

// Memoria de lectura de los catálogos para las vistas globales (resumen de
// Stats, tarjeta de Ajustes).
//
// El catálogo entero son ~40.000 logros en ~860 filas JSON (~6 MB). Contarlos
// con `json_array_length` obliga a SQLite a parsear todo el JSON en cada
// consulta (medido: ~11 ms de los ~35 ms del resumen), y desplegar en JS los
// de los catálogos con desbloqueos cuesta otro tanto. Pero un catálogo solo
// cambia cuando se reescribe, y TODA escritura (la puerta, el motor de sync,
// el importador) le da un `syncUpdated` nuevo (§7.3). Así que basta leer
// `id, syncUpdated` (barato: no toca el JSON) y reutilizar lo ya calculado
// mientras el reloj de la fila no cambie.
//
// Vive por conexión (WeakMap por `db`): cada test abre la suya y no se
// contaminan. Solo guarda lo que ya se ha pedido; no adelanta trabajo.

interface Entry {
  readonly syncUpdated: string;
  total?: number;
  items?: CatalogItem[];
}

const caches = new WeakMap<LocalDb, Map<string, Entry>>();

function cacheFor(db: LocalDb): Map<string, Entry> {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  return cache;
}

/** La entrada vigente para (id, reloj), creando una vacía si el reloj cambió. */
function entryFor(cache: Map<string, Entry>, id: string, syncUpdated: string): Entry {
  const found = cache.get(id);
  if (found && found.syncUpdated === syncUpdated) return found;
  const fresh: Entry = { syncUpdated };
  cache.set(id, fresh);
  return fresh;
}

const CHUNK = 500;

/**
 * Tamaño y, si se piden, logros (en orden de catálogo) de estos catálogos,
 * dados con su `syncUpdated` actual. Solo va a la base por lo que falta.
 */
export function catalogContents(
  db: LocalDb,
  catalogs: readonly { readonly id: string; readonly syncUpdated: string }[],
  withItems: ReadonlySet<string>,
): Map<string, { total: number; items: CatalogItem[] | null }> {
  const cache = cacheFor(db);
  const missingTotals: string[] = [];
  const missingItems: string[] = [];
  for (const catalog of catalogs) {
    const entry = entryFor(cache, catalog.id, catalog.syncUpdated);
    if (withItems.has(catalog.id)) {
      if (!entry.items) missingItems.push(catalog.id);
    } else if (entry.total === undefined) {
      missingTotals.push(catalog.id);
    }
  }
  // Solo el tamaño: lo cuenta SQLite, sin traer el JSON.
  for (let start = 0; start < missingTotals.length; start += CHUNK) {
    const rows = db
      .select({
        id: achievementCatalogs.id,
        total: sql<number>`json_array_length(${achievementCatalogs.items})`.mapWith(Number),
        syncUpdated: achievementCatalogs.syncUpdated,
      })
      .from(achievementCatalogs)
      .where(inArray(achievementCatalogs.id, missingTotals.slice(start, start + CHUNK)))
      .all();
    for (const row of rows) entryFor(cache, row.id, row.syncUpdated).total = row.total;
  }
  // Los logros desplegados, solo de los que se piden.
  for (let start = 0; start < missingItems.length; start += CHUNK) {
    const rows = db
      .select({
        id: achievementCatalogs.id,
        items: achievementCatalogs.items,
        syncUpdated: achievementCatalogs.syncUpdated,
      })
      .from(achievementCatalogs)
      .where(inArray(achievementCatalogs.id, missingItems.slice(start, start + CHUNK)))
      .all();
    for (const row of rows) {
      const entry = entryFor(cache, row.id, row.syncUpdated);
      entry.items = sortedItems(row.items);
      entry.total = entry.items.length;
    }
  }
  const result = new Map<string, { total: number; items: CatalogItem[] | null }>();
  for (const catalog of catalogs) {
    const entry = cache.get(catalog.id);
    if (entry?.total === undefined) continue;
    result.set(catalog.id, {
      total: entry.total,
      items: withItems.has(catalog.id) ? (entry.items ?? null) : null,
    });
  }
  return result;
}
