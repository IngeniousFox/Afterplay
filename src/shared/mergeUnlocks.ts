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
// Y vive en src/shared —no en src/main/db/queries— porque había una CUARTA
// copia a mano fuera del escritorio: worker/src/queries/achievements.ts, que la
// portó término a término al servir la ficha del móvil. Ninguno de los
// comentarios de por aquí la nombraba, así que el día de cerrar §8 se habría
// quedado fuera y el teléfono habría fechado los logros con el criterio viejo.
// Ahora el Worker importa de aquí como el escritorio.
//
// Las copias que SIGUEN vivas y consentidas son las DOS escrituras en SQL —el
// CTE de getAchievementsOverview.ts y el group by de getMemoryFacts.ts—, que
// existen para no traerse la tabla de desbloqueos entera y solo traducen los
// dos campos que esas vistas necesitan (la fecha y su fiabilidad). Sus
// comentarios ponen la condición: el día de cerrar §8 hay que tocar las TRES, y
// esa tercera es esta función. La fila ganadora ENTERA —su sesión, su
// playthrough, sus fuentes— solo sale de aquí.
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
