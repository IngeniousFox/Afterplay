import type { QueryContext } from '../common/context';
import { storeRaCatalog, type RaCatalogDefinition } from './catalog';
import { storeUnlocks, type UnlockToast } from './storeUnlocks';

// La escritura entera de `syncRaGame` (ra/sync.ts:18): en RetroAchievements
// catálogo y desbloqueos llegan en UNA respuesta (GetGameInfoAndUserProgress),
// así que se guardan en UNA transacción, después de la red. Antes iban en dos
// pasos sin releer `raGameId`: si se re-emparejaba el juego mientras tanto,
// el catálogo del set viejo caía sobre el nuevo.

export interface RaProgressDefinition extends RaCatalogDefinition {
  /** Cuándo lo sacaste, o null si no lo tienes. */
  readonly earnedAt: Date | null;
}

export interface StoreRaProgressInput {
  readonly gameId: string;
  readonly raGameId: number;
  readonly definitions: readonly RaProgressDefinition[];
  /** Por defecto, `ctx.now()`: sello de `ra_achievements` y fecha de respaldo. */
  readonly fetchedAt?: Date;
}

export type StoreRaProgressResult =
  | {
      readonly status: 'stored';
      readonly catalogCount: number;
      /** Desbloqueos que trae la respuesta (no los nuevos). */
      readonly unlockedCount: number;
      /** Los nuevos de verdad, para los avisos (solo en vivo). */
      readonly fresh: UnlockToast[];
    }
  /** El juego ya no existe o ya no apunta a ese set: no se escribió nada. */
  | { readonly status: 'stale' };

export function storeRaProgress(
  ctx: QueryContext,
  input: StoreRaProgressInput,
): StoreRaProgressResult {
  const fetchedAt = input.fetchedAt ?? ctx.now();
  return ctx.store.transaction(() => {
    const catalog = storeRaCatalog(ctx, {
      gameId: input.gameId,
      raGameId: input.raGameId,
      definitions: input.definitions,
      fetchedAt,
    });
    if (catalog.status !== 'stored') return { status: 'stale' } as const;
    const unlocks = input.definitions
      .filter((definition) => definition.earnedAt !== null)
      .map((definition) => ({ apiName: definition.apiName, unlockedAt: definition.earnedAt }));
    const fresh = storeUnlocks(ctx, {
      gameId: input.gameId,
      feed: 'ra',
      unlocks,
      fallbackDate: fetchedAt,
      expectedRaGameId: input.raGameId,
    });
    return {
      status: 'stored',
      catalogCount: input.definitions.length,
      unlockedCount: unlocks.length,
      fresh,
    } as const;
  });
}
