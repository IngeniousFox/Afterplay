import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { PlannedGameItem } from '../../../../shared/types';
import { gamesTable } from '../../schema';

// Sección Plan to Play — la contrapartida de getGames(): SOLO los juegos
// planeados, que getGames() excluye. Las partes que un juego planeado no
// tiene por definición (horas, sesiones, estado real) van fijas a cero/plan:
// no hace falta ir a mirar sessions/stateEvents para saberlo.
//
// Devuelve PlannedGameItem, que es GameListItem MÁS lo que la pantalla nueva
// del Plan necesita para decidir sin entrar a ninguna ficha (PLAN-TO-PLAY.md
// §2.3): la sinopsis, el porqué de haberlo planeado, el pin de Up next, la
// fecha completa de salida y las notas. Library sigue con getGames() y su
// GameListItem de siempre — la divergencia es de PRESENTACIÓN, y esta query
// es de dónde sale la materia prima para ella.
export const getPlannedGames = async (): Promise<PlannedGameItem[]> => {
  const db = getDb();

  // La nota de "por qué lo planeo" vive en el evento 'plan_to_play', que
  // cuelga de una iteración, que cuelga del juego — dos saltos. Se resuelve
  // con una subconsulta correlacionada en vez de dos JOIN: un juego planeado
  // tiene exactamente una iteración y un evento de este tipo, así que un LEFT
  // JOIN funcionaría igual, pero la subconsulta no puede multiplicar filas si
  // algún día un juego acabara con dos (promocionar y volver a planear, un
  // arreglo manual…) — y aquí duplicar un juego en la lista sería visible.
  //
  // NOMBRES DE TABLA LITERALES, y esto es importante: dentro de una plantilla
  // sql`` drizzle interpola una columna como `"note"`, SIN cualificar con su
  // tabla. En una subconsulta correlacionada eso es veneno — comprobado
  // ejecutándolo: la versión con ${iterationsTable.gameId} = ${gamesTable.id}
  // se renderizaba como `where "gameId" = "id"`, y ese "id" pelado lo resuelve
  // SQLite contra el ámbito de dentro, no contra el juego de fuera. Con alias
  // explícitos (se/it) y `games.id` escrito a mano, la correlación es la que
  // se quiere y no depende de cómo drizzle decida citar las columnas.
  const planNote = sql<string | null>`(
    select se.note
    from state_events se
    join iterations it on it.id = se.iterationId
    where it.gameId = games.id
      and se.type = 'plan_to_play'
    order by se.occurredAt desc
    limit 1
  )`;

  const games = await db
    .select({
      id: gamesTable.id,
      igdbId: gamesTable.igdbId,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      heroUrl: gamesTable.heroUrl,
      genres: gamesTable.genres,
      isEmulated: gamesTable.isEmulated,
      endless: gamesTable.endless,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
      hltbMain: gamesTable.hltbMain,
      summary: gamesTable.summary,
      planPinnedAt: gamesTable.planPinnedAt,
      releaseDate: gamesTable.releaseDate,
      releaseDatePrecision: gamesTable.releaseDatePrecision,
      ratingCritics: gamesTable.ratingCritics,
      ratingCriticsCount: gamesTable.ratingCriticsCount,
      ratingUsers: gamesTable.ratingUsers,
      ratingUsersCount: gamesTable.ratingUsersCount,
      steamPositive: gamesTable.steamPositive,
      steamNegative: gamesTable.steamNegative,
      steamTags: gamesTable.steamTags,
      planNote,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, true))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  return games.map((game) => ({
    id: game.id,
    igdbId: game.igdbId,
    title: game.title,
    coverUrl: game.coverUrl,
    heroUrl: game.heroUrl,
    genres: game.genres,
    isEmulated: game.isEmulated,
    endless: game.endless,
    releaseYear: game.releaseYear,
    totalHours: 0,
    addedAt: game.addedAt,
    hltbMain: game.hltbMain,
    // Un planeado no tiene exe que lanzar — el campo existe para el Play del
    // modo TV (que tampoco enseña juegos del Plan).
    executablePath: null,
    manualIterations: [],
    currentState: 'plan_to_play' as const,
    // Un juego planeado no se ha jugado nunca, por definición.
    lastPlayedAt: null,
    isLive: false,
    liveSince: null,
    sessionCount: 0,
    summary: game.summary,
    planNote: game.planNote,
    planPinnedAt: game.planPinnedAt,
    releaseDate: game.releaseDate,
    releaseDatePrecision: game.releaseDatePrecision,
    ratingCritics: game.ratingCritics,
    ratingCriticsCount: game.ratingCriticsCount,
    ratingUsers: game.ratingUsers,
    ratingUsersCount: game.ratingUsersCount,
    steamPositive: game.steamPositive,
    steamNegative: game.steamNegative,
    steamTags: game.steamTags,
  }));
};

// Fijar/soltar un juego en "Up next" (§2.2). Siempre un gesto TUYO — la app
// no fija nada por su cuenta, la prioridad es un compromiso personal y no una
// heurística. Se podría hacer con updateGame(), pero pasa por aquí para tener
// un sitio donde vive la regla de la fecha: el orden de Up next es por cuándo
// lo fijaste (el último al final), así que soltar y volver a fijar te manda
// al final de la estantería, que es justo lo que uno espera.
export const setPlanPinned = async (gameId: number, pinned: boolean): Promise<boolean> => {
  const db = getDb();
  const result = await db
    .update(gamesTable)
    .set({ planPinnedAt: pinned ? new Date() : null })
    .where(and(eq(gamesTable.id, gameId), eq(gamesTable.planned, true)))
    .returning({ id: gamesTable.id });
  return result.length > 0;
};

// Reordenar Up next arrastrando (el "v2, solo si hace falta" de §2.2 — hizo
// falta). SIN columna nueva: el orden ya vive en planPinnedAt, así que
// reordenar es REPARTIR los timestamps que ya existen — se recogen los de los
// juegos fijados, se ordenan de más antiguo a más nuevo, y se reasignan en el
// orden nuevo. El multiset de fechas no cambia (nada se inventa ni deriva
// hacia el futuro), la columna sigue sincronizando por Turso igual que
// siempre, y el móvil (REMOTO.md) hereda el orden nuevo gratis.
//
// El precio honesto: planPinnedAt deja de ser exactamente "cuándo lo fijé"
// en cuanto reordenas — pasa a ser "mi orden". Es el mismo campo cumpliendo
// el mismo papel (ordenar la estantería); la fecha literal no la enseña
// ninguna pantalla.
export const reorderUpNext = async (orderedIds: number[]): Promise<boolean> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const pinned = await tx
      .select({ id: gamesTable.id, planPinnedAt: gamesTable.planPinnedAt })
      .from(gamesTable)
      .where(and(eq(gamesTable.planned, true), isNotNull(gamesTable.planPinnedAt)));
    const byId = new Map(pinned.map((game) => [game.id, game.planPinnedAt as Date]));

    // Solo los que SIGUEN fijados y planeados: entre el arrastre y el commit
    // pudo pasar cualquier cosa (un unpin desde otra máquina vía sync). Los
    // ids desconocidos se ignoran en vez de reventar el gesto entero.
    const ids = orderedIds.filter((id) => byId.has(id));
    if (ids.length < 2) return false;

    const stamps = ids.map((id) => (byId.get(id) as Date).getTime()).sort((a, b) => a - b);
    // Estrictamente crecientes: dos fijados en el mismo milisegundo (pasa al
    // fijar dos seguidos muy rápido) empatarían y el desempate por título
    // podría deshacer visualmente el orden que se acaba de arrastrar.
    for (let k = 1; k < stamps.length; k++) {
      if (stamps[k] <= stamps[k - 1]) stamps[k] = stamps[k - 1] + 1;
    }

    for (let k = 0; k < ids.length; k++) {
      await tx
        .update(gamesTable)
        .set({ planPinnedAt: new Date(stamps[k]) })
        .where(eq(gamesTable.id, ids[k]));
    }
    return true;
  });
};
