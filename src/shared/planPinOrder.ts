import { redistributePinStamps } from './domain/planOrder';

type PinnedGame = { id: number; planPinnedAt: Date | null };

// Adaptador Date → milisegundos para quien maneja filas del escritorio con
// `planPinnedAt: Date` (la respuesta optimista del arrastre en el renderer).
// La regla del reparto NO vive aquí: vive en shared/domain/planOrder.ts, la
// misma que usan el commit de SQLite, el drenado del buzón y la PWA.
export const planPinOrder = (
  games: readonly PinnedGame[],
  orderedIds: readonly number[],
): Map<number, number> =>
  redistributePinStamps(
    games.map((game) => ({ id: game.id, pinnedAt: game.planPinnedAt?.getTime() ?? null })),
    orderedIds,
  );
