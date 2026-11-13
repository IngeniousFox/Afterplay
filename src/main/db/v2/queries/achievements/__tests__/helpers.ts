import { and, eq } from 'drizzle-orm';
import { achievementUnlocks, type AchievementSource } from '../../../schema';
import type { QueryContext } from '../../common/context';
import { seedCatalog, seedPlaythrough, seedSession } from '../../common/__tests__/fixtures';

// Fábricas de los tests de logros: que cada test hable de tandas y de
// partidas, no de milisegundos. Todo con datos inventados.

const HOUR_MS = 60 * 60 * 1000;

/** El catálogo de un juego con `Logro <apiName>` de nombre, en este orden. */
export function catalogue(
  ctx: QueryContext,
  gameId: string,
  apiNames: readonly string[],
  source: AchievementSource = 'steam',
): string {
  return seedCatalog(ctx, {
    gameId,
    source,
    items: apiNames.map((apiName, index) => ({
      apiName,
      displayName: `Logro ${apiName}`,
      sortIndex: index,
    })),
  });
}

/** Un playthrough del juego. */
export const playthrough = (ctx: QueryContext, gameId: string): string =>
  seedPlaythrough(ctx, { gameId });

/** Una sesión cerrada de `hours` horas que empieza en `iso`. */
export const session = (
  ctx: QueryContext,
  playthroughId: string,
  iso: string,
  hours: number,
): string =>
  seedSession(ctx, {
    playthroughId,
    startedAt: new Date(iso),
    endedAt: new Date(Date.parse(iso) + hours * HOUR_MS),
  });

/** Una sesión todavía abierta. */
export const openSession = (ctx: QueryContext, playthroughId: string, iso: string): string =>
  seedSession(ctx, { playthroughId, startedAt: new Date(iso), endedAt: null });

export interface StoredUnlock {
  apiName: string;
  source: string;
  origin: string;
  unlockedAt: string;
  dateReliable: boolean;
  sessionId: string | null;
  playthroughId: string | null;
}

/** Lo GUARDADO (filas vivas) de un juego, ordenado por apiName y origen (código de carácter). */
export function storedFor(ctx: QueryContext, gameId: string): StoredUnlock[] {
  const rows = ctx.db
    .select()
    .from(achievementUnlocks)
    .where(and(eq(achievementUnlocks.gameId, gameId)))
    .all()
    .filter((row) => row.syncDeleted === null);
  const key = (row: { apiName: string; origin: string }): string => `${row.apiName} ${row.origin}`;
  return rows
    .map((row) => ({
      apiName: row.apiName,
      source: row.source,
      origin: row.origin,
      unlockedAt: row.unlockedAt.toISOString(),
      dateReliable: row.dateReliable,
      sessionId: row.sessionId,
      playthroughId: row.playthroughId,
    }))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** La única fila guardada; falla si hay otra cantidad. */
export function onlyStored(ctx: QueryContext, gameId: string): StoredUnlock {
  const rows = storedFor(ctx, gameId);
  if (rows.length !== 1) throw new Error(`se esperaba UNA fila de desbloqueo y hay ${rows.length}`);
  return rows[0];
}

/** El reloj de sync de una fila: si no cambia, la puerta no escribió. */
export function syncUpdatedOf(ctx: QueryContext, table: string, id: string): string {
  const row = ctx.db.$client.prepare(`SELECT syncUpdated FROM "${table}" WHERE id = ?`).get(id) as
    { syncUpdated: string } | undefined;
  if (!row) throw new Error(`${table}: no existe ${id}`);
  return row.syncUpdated;
}
