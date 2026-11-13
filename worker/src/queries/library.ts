import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { iterationSessionTotals } from '../../../src/main/db/queries/games/iterationHours';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import { deriveLibrary, type ManualIterationHours } from '../../../src/shared/domain/library';
import type { LibraryGame, PlannedGame, StateType } from '../api-types';
import type { TenantDb } from '../db';
import { isSessionLive } from './timer';

// La LISTA de la biblioteca y los agregados de los que sale. La ficha de un
// juego suelto vive en game.ts.
//
// Las horas, el número de sesiones, el "estado actual", "Last played", el
// "en vivo" y el año de las horas manuales NO son columnas: se derivan del log
// de eventos y de las sesiones. Esas reglas eran una RÉPLICA a mano de
// getGames.ts, y la réplica ya había divergido varias veces (el `sesión ??
// evento`, el margen del artefacto del alta copiado, el año en UTC). Ahora
// viven en src/shared/domain/library.ts (deriveLibrary), la MISMA función que
// llama el escritorio, y los agregados SQL de sesiones por playthrough salen
// del mismo objeto (iterationSessionTotals) que usa getGames
// (AFTERPLAY-2.0.md §15.2, F-26). Aquí solo se traen las filas.
//
// La diferencia con el escritorio es que allí las queries llaman a getDb(), un
// singleton de módulo. Aquí el `db` ENTRA POR PARÁMETRO, siempre: es el mismo
// motivo de la regla 1 del §5.2 (ver db.ts).

// "Sigue jugando AHORA" (isSessionLive) vive en queries/timer.ts, junto al
// resto del cronómetro y a la regla de frescura del §7.4 que aplica.

// Unas horas MANUALES con el año al que se atribuyen (ver manualHoursAnchor y
// deriveLibrary). Sin esto, un playthrough de 200h terminado en 2019 aportaba
// 0h a la vista de 2019 aunque su Beaten sí saliera en el desglose de estados.
export type ManualHours = Pick<ManualIterationHours, 'hours' | 'year'>;

// Todo lo que hace falta para la biblioteca Y para las stats, calculado en una
// sola pasada. La lista pública (LibraryGame) es un recorte de esto: el
// payload que va al móvil se queda ligero, pero las cifras del resumen se
// calculan con el dato completo en vez de con una versión aguada.
export type LibraryData = {
  games: LibraryGame[];
  manualByGame: Map<number, ManualHours[]>;
  // Las sesiones de la VENTANA RECIENTE (ver SESSION_WINDOW_MS), sin recortar
  // por número de filas. El tope que tenía antes el resumen (200 filas) hacía
  // que las horas del año dependieran de cuántas sesiones cupieran, que es un
  // número inventado; el recorte de aquí es por FECHA y está calculado para no
  // poder dejarse fuera ninguna sesión del año en curso.
  recentSessions: { gameId: number; startedAt: Date; durationSec: number | null }[];
};

// CUÁNTO PASADO HACE FALTA TRAER FILA A FILA.
//
// Lo único que se pregunta por sesiones SUELTAS es "¿cuántas horas llevas ESTE
// año?" (stats.ts), y ese año lo decide `yearOf` con la zona del que mira, no
// SQLite —que no tiene base de zonas horarias y no puede hacer ese corte—. La
// solución no es aproximar el corte en SQL: es traer un SUPERCONJUNTO seguro y
// dejar que yearOf siga decidiendo en JS, exactamente como antes.
//
// 367 días es ese superconjunto. El año en curso empezó como mucho hace 366
// días (bisiesto) en CUALQUIER zona, y el desfase de una zona contra UTC no
// pasa de ±14 h, así que un día de margen lo cubre entero. Sin límite
// superior: una sesión con fecha futura pertenece al año en curso si yearOf lo
// dice, y quien decide sigue siendo yearOf.
//
// Todo lo ALL-TIME (horas totales, número de sesiones, "última vez") NO pasa
// por aquí: sale agregado en SQL, que es lo que evita que esta consulta crezca
// con el historial. Medido contra Turso desde fuera: traerse la tabla de
// sesiones entera para sumarla en JS es el patrón que a cinco años pasa de 57
// filas a miles, y las filas son lo que cuesta cruzando el driver.
const SESSION_WINDOW_MS = 367 * 24 * 60 * 60 * 1000;

// `timeZone` es la zona del que está mirando, tal y como la trae la petición
// (index.ts la saca de Cloudflare). Solo se usa para decidir A QUÉ AÑO
// pertenece una fecha, que es lo único que aquí depende del reloj de nadie.
// Opcional a propósito: sin ella se lee en el reloj del proceso —UTC en un
// Worker—, que es exactamente lo que hacía este fichero antes.
export const buildLibraryData = async (
  db: TenantDb,
  timeZone?: string | null,
): Promise<LibraryData> => {
  const now = Date.now();
  const windowFrom = new Date(now - SESSION_WINDOW_MS);

  // TODO EN UN SOLO VIAJE. `db.batch` manda las sentencias en UNA petición
  // HTTP a Turso; sueltas eran una ida y vuelta por la red cada una desde
  // Cloudflare, y en este endpoint la red ES el coste. Medido contra la base
  // real de Turso desde fuera del datacenter, con las cuatro consultas que
  // había antes: 220 ms encadenadas contra 65 ms en batch (un viaje suelto,
  // `select 1`, son 49 ms).
  //
  // Si añades una consulta aquí, métela EN EL BATCH. Un `await db.select()`
  // suelto en esta función cuesta 49 ms él solo, y no se nota en local
  // (SQLite en disco: 0 ms) — solo en el móvil de quien mira.
  //
  // Todas llevan el MISMO `planned = false`: un juego del Plan es intención,
  // no historial, y sin el filtro las dos cifras de horas de la portada
  // acababan hablando de poblaciones distintas (un planeado con una sesión de
  // 3 h daba totalGames 0, totalHours 0 y hoursThisYear 3). Que un planeado
  // TENGA sesiones no es un dato imposible: devolver un juego al Plan después
  // de haberlo jugado deja sus sesiones donde estaban.
  const [games, iterations, openSessions, recentSessions, stateEvents] = await db.batch([
    // `collate nocase` porque SQLite ordena ASCII puro y dejaría las
    // minúsculas detrás de todas las mayúsculas.
    db
      .select({
        id: gamesTable.id,
        title: gamesTable.title,
        coverUrl: gamesTable.coverUrl,
        releaseYear: gamesTable.releaseYear,
        addedAt: gamesTable.addedAt,
        promotedAt: gamesTable.promotedAt,
      })
      .from(gamesTable)
      .where(eq(gamesTable.planned, false))
      .orderBy(sql`${gamesTable.title} collate nocase`),

    // Una fila por PLAYTHROUGH con sus sesiones ya agregadas: la MISMA
    // consulta que getGames en el escritorio, con los mismos agregados
    // (iterationSessionTotals). Antes eran dos (las iteraciones por un lado y
    // los totales de sesiones con INNER JOIN por otro); el LEFT JOIN conserva
    // los playthroughs sin sesiones en la misma fila que sus horas manuales.
    // Así el número de filas está acotado por los playthroughs (336 en la
    // biblioteca real, y no crecen jugando) y no por las sesiones. El `order
    // by id` es el orden en que deriveLibrary suma las horas, igual que allí.
    db
      .select({
        id: iterationsTable.id,
        gameId: iterationsTable.gameId,
        manualTotalPlayed: iterationsTable.manualTotalPlayed,
        ...iterationSessionTotals,
      })
      .from(iterationsTable)
      .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
      .leftJoin(sessionsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .where(eq(gamesTable.planned, false))
      .groupBy(iterationsTable.id)
      .orderBy(asc(iterationsTable.id)),

    // Las ABIERTAS, y solo ellas, con quién las abrió y cuándo latieron por
    // última vez: es lo que isSessionLive necesita para juzgar su frescura, y
    // no cabe en el max() del agregado. Cero filas en la base real; como mucho
    // un puñado.
    db
      .select({
        gameId: iterationsTable.gameId,
        startedAt: sessionsTable.startedAt,
        startedBy: sessionsTable.startedBy,
        lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
      })
      .from(sessionsTable)
      .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
      .where(and(eq(gamesTable.planned, false), isNull(sessionsTable.endedAt))),

    // Las de la VENTANA RECIENTE, fila a fila: son las únicas que alguien
    // mira de una en una (stats.ts, las horas del año), y quien decide a qué
    // año pertenece cada una sigue siendo `yearOf` en JS. Ver
    // SESSION_WINDOW_MS.
    db
      .select({
        gameId: iterationsTable.gameId,
        startedAt: sessionsTable.startedAt,
        durationSec: sessionsTable.durationSec,
      })
      .from(sessionsTable)
      .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
      .where(and(eq(gamesTable.planned, false), gte(sessionsTable.startedAt, windowFrom))),

    // El log ENTERO, sin agregar, como en getGames: manualHoursAnchor y "Last
    // played" miran todo el historial de cada playthrough descartando antes
    // los artefactos del alta, que es una regla de src/shared y no de SQLite.
    db
      .select({
        gameId: iterationsTable.gameId,
        iterationId: stateEventsTable.iterationId,
        type: stateEventsTable.type,
        occurredAt: stateEventsTable.occurredAt,
        id: stateEventsTable.id,
      })
      .from(stateEventsTable)
      .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id))
      .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
      .where(eq(gamesTable.planned, false)),
  ]);

  // En vivo = abierta Y fresca (isSessionLive): aquí nadie barre los
  // cronómetros olvidados mientras el PC está apagado, así que la lectura
  // aplica la misma vara que el barrido. Entre varias en marcha del mismo
  // juego elige deriveLibrary (el arranque más reciente, como el escritorio).
  const liveSessions = openSessions.filter((session) => isSessionLive(session, now));

  const summaries = deriveLibrary({ games, iterations, stateEvents, liveSessions, timeZone });

  const manualByGame = new Map<number, ManualHours[]>();
  for (const [gameId, summary] of summaries) {
    if (summary.manualIterations.length > 0) manualByGame.set(gameId, summary.manualIterations);
  }

  return {
    games: games.map((game) => {
      // deriveLibrary devuelve un resumen para cada juego de `games`.
      const summary = summaries.get(game.id)!;
      return {
        id: game.id,
        title: game.title,
        coverUrl: game.coverUrl,
        releaseYear: game.releaseYear,
        totalHours: summary.totalHours,
        sessionCount: summary.sessionCount,
        currentState: (summary.currentState as StateType) ?? null,
        lastPlayedAt: summary.lastPlayedAt?.getTime() ?? null,
        isLive: summary.isLive,
        liveSince: summary.liveSince?.getTime() ?? null,
      };
    }),
    manualByGame,
    // Ya vienen con la forma que hace falta: no se copian a otro objeto.
    recentSessions,
  };
};

export const listLibrary = async (db: TenantDb, timeZone?: string | null): Promise<LibraryGame[]> =>
  (await buildLibraryData(db, timeZone)).games;

// Cuáles de estos juegos de IGDB ya tienes, y dónde.
//
// Existe por un fallo real: encolé Celeste desde el buscador, la orden viajó a
// Turso, el escritorio la drenó dos minutos después y reventó con "UNIQUE
// constraint failed: games.igdbid" — porque Celeste ya estaba en la
// biblioteca. El fallo era CORRECTO, pero ocurría en el peor sitio posible: en
// otra máquina, más tarde, sin nadie delante. Esto lo mueve al momento del
// toque, que es cuando se puede hacer algo al respecto.
export type OwnedIndex = {
  byIgdbId: Map<number, 'library' | 'plan'>;
  bySteamAppId: Map<number, 'library' | 'plan'>;
};

export const findOwned = async (
  db: TenantDb,
  keys: { igdbIds?: number[]; steamAppIds?: number[] },
): Promise<OwnedIndex> => {
  const igdbIds = keys.igdbIds ?? [];
  const steamAppIds = keys.steamAppIds ?? [];
  const empty: OwnedIndex = { byIgdbId: new Map(), bySteamAppId: new Map() };
  if (igdbIds.length === 0 && steamAppIds.length === 0) return empty;

  // Las dos claves en una sola consulta: un OR sobre dos columnas indexadas
  // sale más barato que dos viajes a Turso desde un Worker.
  const conditions = [];
  if (igdbIds.length > 0) conditions.push(inArray(gamesTable.igdbId, igdbIds));
  if (steamAppIds.length > 0) conditions.push(inArray(gamesTable.steamAppId, steamAppIds));

  const rows = await db
    .select({
      igdbId: gamesTable.igdbId,
      steamAppId: gamesTable.steamAppId,
      planned: gamesTable.planned,
    })
    .from(gamesTable)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions));

  for (const row of rows) {
    const where = row.planned ? 'plan' : 'library';
    if (row.igdbId !== null) empty.byIgdbId.set(row.igdbId, where);
    if (row.steamAppId !== null) empty.bySteamAppId.set(row.steamAppId, where);
  }
  return empty;
};

// Los juegos del Plan. Sección aparte de la biblioteca, igual que en el
// escritorio: aquí no hay horas ni estado que derivar — un planeado es
// intención, no historial.
//
// El tipo de vuelta es el PlannedGame del CONTRATO (api-types.ts), no una
// lista de campos escrita aquí. Lo era, con los mismos 17 campos copiados a
// mano, y nada ataba las dos formas: añadir un campo al contrato compilaba en
// los dos lados y la PWA —que castea a ciegas, `request<PlannedGame[]>`— leía
// undefined en tiempo de ejecución. Por lo mismo el objeto se construye campo
// a campo y no con `...row`: el spread colaba en el JSON un `planPinnedAt` que
// el contrato no declara, o sea que la respuesta ya no era el objeto que dice
// ser.
export const listPlanned = async (db: TenantDb): Promise<PlannedGame[]> => {
  const firstPlanAt = sql<number | null>`(
    select se.occurredAt
    from state_events se
    join iterations it on it.id = se.iterationId
    where it.gameId = games.id and se.type = 'plan_to_play'
    order by se.id asc
    limit 1
  )`;
  const rows = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      releaseYear: gamesTable.releaseYear,
      releaseDate: gamesTable.releaseDate,
      releaseDatePrecision: gamesTable.releaseDatePrecision,
      genres: gamesTable.genres,
      hltbMain: gamesTable.hltbMain,
      endless: gamesTable.endless,
      addedAt: gamesTable.addedAt,
      firstPlanAt,
      planPinnedAt: gamesTable.planPinnedAt,
      ratingCritics: gamesTable.ratingCritics,
      ratingCriticsCount: gamesTable.ratingCriticsCount,
      ratingUsers: gamesTable.ratingUsers,
      ratingUsersCount: gamesTable.ratingUsersCount,
      steamPositive: gamesTable.steamPositive,
      steamNegative: gamesTable.steamNegative,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, true))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    coverUrl: row.coverUrl,
    releaseYear: row.releaseYear,
    releaseDate: row.releaseDate ? row.releaseDate.getTime() : null,
    releaseDatePrecision: row.releaseDatePrecision,
    genres: row.genres,
    hltbMain: row.hltbMain,
    endless: row.endless,
    // Igual que la lista del escritorio: esperar en el Plan empieza con la
    // primera entrada allí, no con el alta anterior en Library.
    addedAt: row.firstPlanAt === null ? row.addedAt.getTime() : Number(row.firstPlanAt),
    // El nombre de la columna es planPinnedAt y el del contrato pinnedAt: es el
    // único campo que se renombra al salir, y la razón de que el `...row` de
    // antes filtrara los DOS al JSON.
    pinnedAt: row.planPinnedAt ? row.planPinnedAt.getTime() : null,
    ratingCritics: row.ratingCritics,
    ratingCriticsCount: row.ratingCriticsCount,
    ratingUsers: row.ratingUsers,
    ratingUsersCount: row.ratingUsersCount,
    steamPositive: row.steamPositive,
    steamNegative: row.steamNegative,
  }));
};
