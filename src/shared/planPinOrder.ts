type PinnedGame = { id: number; planPinnedAt: Date | null };

// Misma asignación para el commit de SQLite y la respuesta optimista del
// arrastre. Solo reparte las fechas de los ids pedidos que siguen fijados.
export const planPinOrder = (
  games: readonly PinnedGame[],
  orderedIds: readonly number[],
): Map<number, number> => {
  const byId = new Map(games.map((game) => [game.id, game.planPinnedAt]));
  const ids = [...new Set(orderedIds)].filter((id) => byId.get(id) != null);
  if (ids.length < 2) return new Map();

  const stamps = ids.map((id) => byId.get(id)!.getTime()).sort((a, b) => a - b);
  // Dos pines en el mismo milisegundo necesitan fechas distintas para que
  // el desempate por título no deshaga el orden recién elegido.
  for (let index = 1; index < stamps.length; index++) {
    if (stamps[index] <= stamps[index - 1]) stamps[index] = stamps[index - 1] + 1;
  }
  return new Map(ids.map((id, index) => [id, stamps[index]]));
};
