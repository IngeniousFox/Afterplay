// Horas de una iteración: manualTotalPlayed REEMPLAZA a lo trackeado (es un
// total de mano, no un extra encima), nunca se suman los dos — sumar ambos
// por separado fue el bug real detrás de "meto un número y sale otro
// distinto" (ver getGames.ts/getGameById.ts).
export const resolveIterationHours = (
  manualTotalPlayed: number | null,
  trackedSeconds: number,
): number => manualTotalPlayed ?? trackedSeconds / 3600;
