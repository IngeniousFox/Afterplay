import { redistributePinStamps } from './domain/planOrder';
import type { EntityId, EntityIdLike, GameId } from './entityIds';

// Genérico en la representación del id, como redistributePinStamps.
type PinnedGame<Id extends EntityIdLike = EntityId> = { id: GameId<Id>; planPinnedAt: Date | null };

// Adaptador Date → milisegundos para quien maneja filas del escritorio con
// `planPinnedAt: Date` (la respuesta optimista del arrastre en el renderer).
// La regla del reparto NO vive aquí: vive en shared/domain/planOrder.ts, la
// misma que usan el commit de SQLite, el drenado del buzón y la PWA.
export const planPinOrder = <Id extends EntityIdLike>(
  games: readonly PinnedGame<Id>[],
  orderedIds: readonly GameId<Id>[],
): Map<GameId<Id>, number> =>
  redistributePinStamps(
    games.map((game) => ({ id: game.id, pinnedAt: game.planPinnedAt?.getTime() ?? null })),
    orderedIds,
  );
