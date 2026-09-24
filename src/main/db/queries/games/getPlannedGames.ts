import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { PlannedGameExtras, PlannedGameListItem } from '../../../../shared/types';
import { planPinOrder } from '../../../../shared/planPinOrder';
import { gamesTable } from '../../schema';

// Sección Plan to Play — la contrapartida de getGames(): SOLO los juegos
// planeados, que getGames() excluye. Las partes que un juego planeado no
// tiene por definición (horas, sesiones, estado real) van fijas a cero/plan:
// no hace falta ir a mirar sessions/stateEvents para saberlo.
//
// DOS CANALES desde la segunda oleada de rendimiento. La lista vieja (25
// columnas + la nota del plan) pesaba 928 KB de 661 filas y era el payload
// más gordo de la app, con el 63% en campos que solo mira la pantalla del
// Plan. Ahora esta función devuelve el canal ESCUETO (PlannedGameListItem,
// 354 KB y 6 ms medidos sobre esos mismos 661) y getPlannedGameExtras() el
// resto — el porqué del reparto y las cifras por consumidor están en
// ipc/games.ts, y la forma en shared/types.ts.
//
// La primera fecha en el Plan sale del primer evento plan_to_play. Para los
// planeados creados directamente allí coincide con games.addedAt; al devolver
// un juego de Library al Plan conserva aquella primera fecha, y un juego que
// nunca estuvo en el Plan empieza a esperar desde hoy sin alterar su fecha
// original de alta en Afterplay.
export const getPlannedGames = async (): Promise<PlannedGameListItem[]> => {
  const db = getDb();
  const firstPlanAt = sql<number | null>`(
    select se.occurredAt
    from state_events se
    join iterations it on it.id = se.iterationId
    where it.gameId = games.id and se.type = 'plan_to_play'
    order by se.id asc
    limit 1
  )`;

  const games = await db
    .select({
      id: gamesTable.id,
      igdbId: gamesTable.igdbId,
      // Para el cruce del buscador con los juegos que solo existen en Steam
      // (ver GameListItem.steamAppId). Un planeado añadido por esa vía tiene
      // igdbId null, así que sin esto no hay forma de reconocerlo.
      steamAppId: gamesTable.steamAppId,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      genres: gamesTable.genres,
      isEmulated: gamesTable.isEmulated,
      endless: gamesTable.endless,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
      firstPlanAt,
      promotedAt: gamesTable.promotedAt,
      hltbMain: gamesTable.hltbMain,
      hltbMainExtras: gamesTable.hltbMainExtras,
      hltbCompletionist: gamesTable.hltbCompletionist,
      planPinnedAt: gamesTable.planPinnedAt,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, true))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  return games.map((game) => ({
    id: game.id,
    igdbId: game.igdbId,
    steamAppId: game.steamAppId,
    title: game.title,
    coverUrl: game.coverUrl,
    // SIEMPRE null en este canal, y es una decisión medida, no un olvido:
    // GameListItem exige el campo por forma, pero ningún consumidor escueto
    // lo pinta (verificado con Grep — banners y caras traseras salen de
    // getGames/getGameById) y llevarlo aquí eran 47 KB de los 928 del canal
    // único viejo. El heroUrl real viaja en getPlannedGameExtras().
    heroUrl: null,
    genres: game.genres,
    isEmulated: game.isEmulated,
    endless: game.endless,
    releaseYear: game.releaseYear,
    totalHours: 0,
    addedAt: game.firstPlanAt === null ? game.addedAt : new Date(Number(game.firstPlanAt)),
    promotedAt: game.promotedAt,
    hltbMain: game.hltbMain,
    hltbMainExtras: game.hltbMainExtras,
    hltbCompletionist: game.hltbCompletionist,
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
    planPinnedAt: game.planPinnedAt,
  }));
};

// El otro canal: los campos que SOLO mira la pantalla del Plan (sinopsis,
// porqué, fecha completa, notas, etiquetas, hero) — 591 KB y 7 ms sobre los
// 661 reales. Misma condición WHERE que getPlannedGames a propósito: cada id
// del canal escueto tiene su fila aquí, y el renderer los junta por id
// (usePlannedGamesWithExtras) sin casos raros que resolver.
export const getPlannedGameExtras = async (): Promise<PlannedGameExtras[]> => {
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
  // El `se.id desc` NO es adorno: es el desempate de la casa escrito en
  // shared/playthroughState.ts ("id para desempatar cuando dos eventos
  // comparten fecha exacta — gana el insertado después"), el mismo que aplican
  // getGames, getGameById y resolveIterationForPlay. Sin él el desempate se lo
  // quedaba el motor y devolvía la entrada MÁS ANTIGUA: con dos 'plan_to_play'
  // a la misma hora (dos altas con precisión de día, un arreglo a mano, un
  // sync que reinsertó) la fila del Plan enseñaba un porqué y la ficha el otro.
  const planNote = sql<string | null>`(
    select se.note
    from state_events se
    join iterations it on it.id = se.iterationId
    where it.gameId = games.id
      and se.type = 'plan_to_play'
    order by se.occurredAt desc, se.id desc
    limit 1
  )`;

  // Por id y no por título: el orden de PRESENTACIÓN lo pone el canal
  // escueto — este solo se consulta para cruzarlo por id.
  return db
    .select({
      id: gamesTable.id,
      heroUrl: gamesTable.heroUrl,
      summary: gamesTable.summary,
      planNote,
      releaseDate: gamesTable.releaseDate,
      releaseDatePrecision: gamesTable.releaseDatePrecision,
      ratingCritics: gamesTable.ratingCritics,
      ratingCriticsCount: gamesTable.ratingCriticsCount,
      ratingUsers: gamesTable.ratingUsers,
      ratingUsersCount: gamesTable.ratingUsersCount,
      steamPositive: gamesTable.steamPositive,
      steamNegative: gamesTable.steamNegative,
      steamTags: gamesTable.steamTags,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, true))
    .orderBy(asc(gamesTable.id));
};

// Fijar/soltar un juego en "Up next" (§2.2). Siempre un gesto TUYO — la app
// no fija nada por su cuenta, la prioridad es un compromiso personal y no una
// heurística. Se podría hacer con updateGame(), pero pasa por aquí para tener
// un sitio donde vive la regla de la fecha: el orden de Up next es por cuándo
// lo fijaste (el último al final), así que soltar y volver a fijar te manda
// al final de la estantería, que es justo lo que uno espera.
//
// `pinnedAt` es para quien fijó en OTRO momento y en otro sitio: el buzón del
// móvil (plan/drainMailbox.ts) aplica de golpe pines de hace minutos, y con la
// fecha de aquí todos caían juntos en el instante del drenado — el orden del
// teléfono se perdía. Desde el escritorio no se pasa: fijar es ahora mismo, y
// ese es el default.
export const setPlanPinned = async (
  gameId: number,
  pinned: boolean,
  pinnedAt?: Date,
): Promise<boolean> => {
  const db = getDb();
  const result = await db
    .update(gamesTable)
    .set({ planPinnedAt: pinned ? (pinnedAt ?? new Date()) : null })
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

    // Solo los que SIGUEN fijados y planeados: entre el arrastre y el commit
    // pudo pasar cualquier cosa (un unpin desde otra máquina vía sync). Los
    // ids desconocidos se ignoran en vez de reventar el gesto entero.
    //
    // Y REPETIDOS fuera antes de contar (el Set): sin deduplicar, un [A, A]
    // con un solo juego fijado medía 2, se colaba por el guardián de abajo,
    // le corría la marca 1ms y devolvía true. Ese true es contrato — el buzón
    // del móvil lo lee como "orden aplicada" (drainMailbox.ts:242-246), así
    // que una orden malformada se daba por buena sin que hubiera estantería
    // que reordenar. El Set conserva la primera aparición de cada id, que es
    // la posición que el usuario soltó.
    const stamps = planPinOrder(pinned, orderedIds);
    if (stamps.size === 0) return false;

    for (const [id, stamp] of stamps) {
      await tx
        .update(gamesTable)
        .set({ planPinnedAt: new Date(stamp) })
        .where(eq(gamesTable.id, id));
    }
    return true;
  });
};
