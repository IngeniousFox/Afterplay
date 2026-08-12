// LA regla de esta zona, en un solo sitio: "una fecha fiable gana a una que
// no; empatadas, la más temprana".
//
// La tabla guarda un desbloqueo por (logro, FUENTE) —ese es su UNIQUE—, así
// que el mismo trofeo puede constar dos veces: por el crack (fecha del rescate,
// no fiable) y por Steam (la de verdad). En pantalla es UN trofeo, y decidir
// cuál de las dos filas lo representa es esta función.
//
// Estaba escrita a mano en tres consultas (getGameAchievements,
// getAchievementsOverview, getMemoryFacts) y AUSENTE en una cuarta
// (getSessionUnlocks), que por eso colocaba el mismo logro en dos sesiones. Y
// las tres copias ya habían divergido en lo que arrastraban consigo. La
// decisión pendiente de RETROACHIEVEMENTS.md §8 (hardcore vs softcore) toca
// justo este desempate: cuando se cierre, tiene que escribirse UNA vez.
//
// Genérica sobre la forma de la fila —cada consulta selecciona sus columnas—
// y devuelve la fila GANADORA entera: quien necesite lo que viaja con ella
// (la sesión, el playthrough) lo saca de ahí, y quien necesite todas las
// fuentes tiene `rows`.
export type UnlockCandidate = {
  achievementId: number;
  unlockedAt: Date;
  dateReliable: boolean;
};

export type MergedUnlock<T extends UnlockCandidate> = {
  // La fila que representa al logro en pantalla.
  winner: T;
  // Todas las filas del mismo logro, la ganadora incluida y en el orden en
  // que llegaron — para quien tenga que enumerar las fuentes.
  rows: T[];
};

export const mergeUnlocksByAchievement = <T extends UnlockCandidate>(
  rows: readonly T[],
): Map<number, MergedUnlock<T>> => {
  const merged = new Map<number, MergedUnlock<T>>();

  for (const row of rows) {
    const existing = merged.get(row.achievementId);
    if (!existing) {
      merged.set(row.achievementId, { winner: row, rows: [row] });
      continue;
    }

    existing.rows.push(row);

    // Una fuente CON fecha fiable gana siempre a una que no la tiene, por
    // temprana que sea esta: el caso real es tener el logro por el arrastre
    // masivo del crack (fecha inventada de hoy) y también por Steam con su
    // fecha de verdad — la buena es la de Steam, aunque sea posterior.
    if (row.dateReliable && !existing.winner.dateReliable) {
      existing.winner = row;
      continue;
    }
    if (!row.dateReliable && existing.winner.dateReliable) continue;

    // Empatadas en fiabilidad: manda la más temprana. La que importa es la de
    // la primera vez, no la de la repetición — y con ella viaja SU sesión.
    if (row.unlockedAt.getTime() < existing.winner.unlockedAt.getTime()) {
      existing.winner = row;
    }
  }

  return merged;
};
