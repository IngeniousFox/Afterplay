import { and, eq } from 'drizzle-orm';
import { achievementUnlocks, type AchievementSource } from '../../schema';
import { alive } from '../../store';
import { writeCheck } from '../common/checks';
import type { QueryContext } from '../common/context';
import { readCatalogItems, readLiveGameKeys } from './catalog';
import { catalogSourceOf, unlockOriginOf, type UnlockFeed } from './ids';
import { getSessionWindows, placeUnlock } from './placement';

// El embudo por el que pasan TODOS los desbloqueos (Steam, cracks de Steam y
// RetroAchievements). Port de `storeUnlocks` (steam/syncAchievements.ts:120),
// con sus garantías una a una (los casos de storeUnlocks.test.ts):
//
// 1. Qué es NUEVO: lo que no constaba por NINGÚN origen. De ahí salen los
//    avisos y el broche del 100 %, y la idempotencia del sondeo en vivo.
// 2. De qué rato fue: se cruza la fecha con las sesiones del juego.
// 3. Cuándo no fiarse de la fecha: 5 logros distintos o más con el mismo
//    instante exacto son un rescate, también si llegan troceados; las filas
//    ya guardadas con ese instante se degradan. Un "no sé cuándo" no pisa un
//    "sé cuándo", ni tampoco a otro "no sé cuándo".
//
// Lo que cambia con el esquema 2.0:
//
// - Ya no hay `UNIQUE (achievementId, source)` ni `ON CONFLICT`: el id de la
//   fila es compuesto `<gameId>:<source>:<apiName>:<origin>`, y `store.create`
//   sobre un id existente "escribe encima" (y no escribe si nada cambia, F-33).
// - La "fuente" de la 1.x se parte en dos (ver `ids.ts`): el catálogo del
//   logro (`steam` | `ra`) y el ORIGEN de la fila (`steam`, `ra` o
//   `emu@<este PC>`, F-35). Lo que la 1.x miraba "de la misma fuente" (censo
//   del bloque, fecha guardada) se mira ahora del mismo ORIGEN: la fila de
//   emulador de otro PC tiene su propio reloj y no se toca desde aquí.
// - Todas las lecturas van DENTRO de la transacción (catálogo y sesiones
//   también; hoy se leían fuera), y antes de nada se comprueba que el juego
//   vive (R-15: un desbloqueo no resucita tras borrar el juego) y, si se
//   pide, que sigue con el appid o el set con el que se preguntó.

/** Un desbloqueo tal como lo entrega una fuente. `null` = no sabe cuándo. */
export interface UnlockInput {
  readonly apiName: string;
  readonly unlockedAt: Date | null;
}

/**
 * Lo que se anuncia de un logro nuevo. Misma forma que `AchievementToast`
 * (steam/notifications/overlay.ts), que no se importa porque arrastra
 * Electron: `gameTitle` y `gameHeroUrl` los rellena quien encola.
 */
export interface UnlockToast {
  displayName: string;
  iconUrl: string | null;
  globalPercent: number | null;
  gameTitle: string;
  gameHeroUrl: string | null;
}

export interface StoreUnlocksInput {
  readonly gameId: string;
  readonly feed: UnlockFeed;
  readonly unlocks: readonly UnlockInput[];
  /** Para los desbloqueos sin fecha propia: lo tienes, y perderlo sería peor. */
  readonly fallbackDate: Date;
  /** Si se da, no se escribe nada si el juego ya no tiene este appid. */
  readonly expectedAppId?: number;
  /** Ídem con el set de RetroAchievements. */
  readonly expectedRaGameId?: number;
}

/** A partir de cuántos logros con el MISMO instante exacto la fecha es de un rescate. */
export const BULK_SAME_SECOND = 5;

interface StoredRow {
  readonly id: string;
  readonly apiName: string;
  readonly origin: string;
  readonly unlockedAt: Date;
  readonly dateReliable: boolean;
}

/**
 * Los instantes que llegan en bloque: se cuentan LOGROS distintos de la tanda
 * más los ya guardados del mismo origen con ese instante (solo los instantes
 * que nombra la tanda). Los desbloqueos sin fecha no cuentan.
 */
function unreliableTimestamps(
  batch: readonly UnlockInput[],
  stored: readonly StoredRow[],
): Set<number> {
  const keysByTime = new Map<number, Set<string>>();
  for (const unlock of batch) {
    if (!unlock.unlockedAt) continue;
    const time = unlock.unlockedAt.getTime();
    const keys = keysByTime.get(time) ?? new Set<string>();
    keys.add(unlock.apiName);
    keysByTime.set(time, keys);
  }
  for (const row of stored) keysByTime.get(row.unlockedAt.getTime())?.add(row.apiName);
  return new Set(
    [...keysByTime.entries()]
      .filter(([, keys]) => keys.size >= BULK_SAME_SECOND)
      .map(([time]) => time),
  );
}

/** Los desbloqueos vivos de un juego y catálogo, de cualquier origen. */
function readStoredUnlocks(
  ctx: QueryContext,
  gameId: string,
  source: AchievementSource,
): StoredRow[] {
  return (
    ctx.db
      .select({
        id: achievementUnlocks.id,
        apiName: achievementUnlocks.apiName,
        origin: achievementUnlocks.origin,
        unlockedAt: achievementUnlocks.unlockedAt,
        dateReliable: achievementUnlocks.dateReliable,
      })
      .from(achievementUnlocks)
      // El juego vivo ya se ha comprobado en la misma transacción.
      .where(
        and(
          eq(achievementUnlocks.gameId, gameId),
          eq(achievementUnlocks.source, source),
          alive(achievementUnlocks),
        ),
      )
      .all()
  );
}

/**
 * Guarda una tanda de desbloqueos de UNA vía y devuelve los NUEVOS de verdad
 * (no constaban por ningún origen antes de esta llamada), con los datos del
 * catálogo para el aviso.
 *
 * Devuelve `[]` sin escribir nada si la tanda está vacía, si el juego no
 * existe o tiene lápida, o si su appid / set ya no es el esperado. Un
 * desbloqueo cuyo `apiName` no está en el catálogo se ignora (sin fila ni
 * aviso). Errores de la puerta se propagan (y la transacción se deshace).
 */
export function storeUnlocks(ctx: QueryContext, input: StoreUnlocksInput): UnlockToast[] {
  const { gameId, feed, unlocks, fallbackDate } = input;
  if (unlocks.length === 0) return [];
  const source = catalogSourceOf(feed);
  const origin = unlockOriginOf(feed, ctx.deviceId);

  return ctx.store.transaction(() => {
    const game = readLiveGameKeys(ctx, gameId);
    if (!game) return [];
    if (input.expectedAppId !== undefined && game.steamAppId !== input.expectedAppId) return [];
    if (input.expectedRaGameId !== undefined && game.raGameId !== input.expectedRaGameId) return [];

    const byApiName = new Map(
      readCatalogItems(ctx, gameId, source).map((item) => [item.apiName, item]),
    );
    const windows = getSessionWindows(ctx, gameId);
    const now = ctx.now();
    const stored = readStoredUnlocks(ctx, gameId, source);

    // "Nuevo" es del LOGRO, de cualquier origen (el mismo logro visto por el
    // crack y luego por Steam no se anuncia dos veces).
    const already = new Set(stored.map((row) => row.apiName));
    // El censo del bloque y la fecha guardada, solo de ESTE origen.
    const sameOrigin = stored.filter((row) => row.origin === origin);
    const bulkTimes = unreliableTimestamps(unlocks, sameOrigin);

    // Rescate descubierto a posteriori: lo guardado con un instante que ahora
    // se sabe de bloque deja de ser un momento.
    for (const row of sameOrigin) {
      if (row.dateReliable && bulkTimes.has(row.unlockedAt.getTime())) {
        ctx.store.patch('achievement_unlocks', row.id, {
          dateReliable: false,
          sessionId: null,
          playthroughId: null,
        });
      }
    }

    // Fiabilidad con la que quedó guardado cada logro de este origen, ya
    // contando lo degradado. Su PRESENCIA dice además si ya hay fila.
    const storedReliable = new Map(
      sameOrigin.map((row) => [
        row.apiName,
        row.dateReliable && !bulkTimes.has(row.unlockedAt.getTime()),
      ]),
    );

    const fresh: UnlockToast[] = [];
    for (const unlock of unlocks) {
      const item = byApiName.get(unlock.apiName);
      if (!item) continue;

      const dateReliable =
        unlock.unlockedAt !== null && !bulkTimes.has(unlock.unlockedAt.getTime());
      // Un "no sé cuándo" no borra un "sé cuándo"…
      if (!dateReliable && storedReliable.get(item.apiName) === true) continue;
      // …ni reescribe a otro "no sé cuándo" con la fecha de respaldo de hoy.
      if (unlock.unlockedAt === null && storedReliable.has(item.apiName)) continue;

      // Sin fecha fiable no se cuelga de ninguna sesión.
      const placement = dateReliable
        ? placeUnlock(unlock.unlockedAt, windows, now)
        : { sessionId: null, playthroughId: null };

      // Todo indicado: escribe encima de la fila de este origen, o la crea, o
      // resucita una con lápida (p. ej. tras cambiar el appid) sin recuperar
      // nada de lo viejo.
      ctx.store.create('achievement_unlocks', {
        gameId,
        source,
        apiName: item.apiName,
        origin,
        unlockedAt: unlock.unlockedAt ?? fallbackDate,
        dateReliable,
        sessionId: placement.sessionId,
        playthroughId: placement.playthroughId,
      });

      if (!already.has(item.apiName)) {
        fresh.push({
          displayName: item.displayName,
          iconUrl: item.iconUrl,
          globalPercent: item.globalPercent,
          gameTitle: '',
          gameHeroUrl: null,
        });
      }
      // Dentro de la tanda, un apiName repetido es el MISMO logro.
      already.add(item.apiName);
      storedReliable.set(item.apiName, dateReliable);
    }
    return fresh;
  });
}

/**
 * Apunta que Steam contestó sobre TUS desbloqueos de este juego (el
 * `achievementsUnlocksSyncedAt` de la 1.x, R-05): `ec(steam_unlocks)` en `ok`.
 * Solo si el juego vive y sigue con ese appid (hoy la guarda iba en el WHERE,
 * syncAchievements.ts:631). Devuelve si lo apuntó.
 */
export function markSteamUnlocksSynced(
  ctx: QueryContext,
  gameId: string,
  appId: number,
  checkedAt: Date = ctx.now(),
): boolean {
  return ctx.store.transaction(() => {
    const game = readLiveGameKeys(ctx, gameId);
    if (!game || game.steamAppId !== appId) return false;
    // writeCheck relee el juego y escribe solo si algo cambia.
    return writeCheck(ctx, gameId, 'steam_unlocks', 'ok', { checkedAt });
  });
}
