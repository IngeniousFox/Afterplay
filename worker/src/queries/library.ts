import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { resolveIterationHours } from '../../../src/main/db/queries/games/iterationHours';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import { lastPlayedAtFor } from '../../../src/shared/lastPlayedAt';
import {
  isAddedAtArtifact,
  latestRealStateEvent,
  manualHoursAnchor,
} from '../../../src/shared/playthroughState';
import { yearOf } from '../../../src/shared/yearOf';
import type { LibraryGame, PlannedGame, StateType } from '../api-types';
import type { TenantDb } from '../db';
import { isSessionLive } from './timer';

// La LISTA de la biblioteca y los agregados de los que sale. La ficha de un
// juego suelto vive en game.ts.
//
// Las horas y el "estado actual" NO son columnas: se derivan del log de
// eventos y de las sesiones de cada iteración, con reglas que ya están
// escritas y probadas en el escritorio (getGames.ts). Este fichero reusa esas
// reglas —resolveIterationHours, latestRealStateEvent, manualHoursAnchor— en
// vez de reinventarlas, que es como los dos lados acabarían diciendo cifras
// distintas del mismo dato.
//
// La diferencia con el escritorio es que allí las queries llaman a getDb(), un
// singleton de módulo. Aquí el `db` ENTRA POR PARÁMETRO, siempre: es el mismo
// motivo de la regla 1 del §5.2 (ver db.ts).

// "Sigue jugando AHORA" (isSessionLive) vive en queries/timer.ts, junto al
// resto del cronómetro y a la regla de frescura del §7.4 que aplica. Estuvo
// aquí, y mientras estuvo aquí la ficha de un juego (game.ts) no la aplicaba:
// la lista decía que no y la ficha que sí sobre el mismo cronómetro.

// Unas horas MANUALES con el año al que se atribuyen. Las horas manuales no
// tienen fecha propia —son un número suelto en la iteración— así que se
// cuelgan del log de estados de su playthrough (su fin si terminó, si no su
// principio) y, si el log no dice nada, de su primera sesión medida. Sin esto,
// un playthrough de 200h terminado en 2019 aportaba 0h a la vista de 2019
// aunque su Beaten sí saliera en el desglose de estados.
export type ManualHours = { hours: number; year: number | null };

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

  // TODO EN UN SOLO VIAJE. `db.batch` manda las seis sentencias en UNA
  // petición HTTP a Turso; sueltas eran seis idas y vueltas por la red desde
  // Cloudflare, y en este endpoint la red ES el coste. Medido contra la base
  // real de Turso desde fuera del datacenter, con las cuatro consultas que
  // había antes: 220 ms encadenadas contra 65 ms en batch (un viaje suelto,
  // `select 1`, son 49 ms). O sea que tres cuartas partes del tiempo de
  // /api/library y de /api/stats/summary eran latencia de ida y vuelta, no
  // trabajo.
  //
  // Si añades una consulta aquí, métela EN EL BATCH. Un `await db.select()`
  // suelto en esta función cuesta 49 ms él solo, y no se nota en local
  // (SQLite en disco: 0 ms) — solo en el móvil de quien mira.
  const [games, iterations, sessionTotals, openSessions, recentSessions, eventRows] =
    await db.batch([
      // Sin juegos planeados: el Plan es su propia sección y colarlos aquí los
      // metería en la biblioteca, las sesiones y las stats de golpe.
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

      // El MISMO `planned = false` que la lista de arriba, y no es un adorno:
      // sin él, `iterations` y las consultas de sesiones traían las de TODOS
      // los juegos, incluidos los del Plan. Las dos cifras de horas de la
      // portada acababan hablando de poblaciones distintas — totalHours
      // recorre `games` (sin planeados) y hoursThisYear recorre las sesiones
      // (con ellos), así que un planeado con una sesión de 3 h daba totalGames
      // 0, totalHours 0 y hoursThisYear 3. Un juego del Plan es intención, no
      // historial: no tiene horas que enseñar en ninguna de las dos.
      //
      // Que un planeado TENGA sesiones no es un dato imposible: el Plan y la
      // biblioteca son la misma tabla con un flag, así que devolver un juego
      // al Plan después de haberlo jugado deja sus sesiones donde estaban.
      db
        .select({
          id: iterationsTable.id,
          gameId: iterationsTable.gameId,
          manualTotalPlayed: iterationsTable.manualTotalPlayed,
        })
        .from(iterationsTable)
        .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
        .where(eq(gamesTable.planned, false)),

      // LO ALL-TIME DE LAS SESIONES, AGREGADO EN SQL Y NO EN JS.
      //
      // Antes esto se traía la tabla de sesiones ENTERA para sumar duraciones,
      // contar y buscar el máximo en un bucle. Es el patrón caro de esta casa:
      // lo que se paga no es el SQL, son las FILAS que cruzan el driver. Aquí
      // el número de filas pasa a estar acotado por los PLAYTHROUGHS (336 en
      // la biblioteca real, y no crecen jugando) en vez de por las sesiones,
      // que sí crecen para siempre. Medido sobre la base real: 57 filas -> 8
      // (solo salen los playthroughs que TIENEN sesiones), y a cinco años de
      // uso la diferencia es de miles de filas contra las mismas ~336.
      //
      // Las cuatro columnas son exactamente las cuatro cosas que el bucle
      // calculaba: horas medidas por playthrough, cuántas sesiones, la primera
      // (ancla de las horas manuales) y la última vez que se jugó — que es
      // `endedAt` y no `startedAt`, porque una partida larga cuenta por cuándo
      // se dejó, y en una sesión abierta el arranque es lo más reciente que
      // hay.
      db
        .select({
          gameId: iterationsTable.gameId,
          iterationId: iterationsTable.id,
          trackedSeconds: sql<number>`coalesce(sum(${sessionsTable.durationSec}), 0)`,
          sessionCount: sql<number>`count(*)`,
          firstStartedAt: sql<number>`min(${sessionsTable.startedAt})`,
          lastPlayedAt: sql<number>`max(coalesce(${sessionsTable.endedAt}, ${sessionsTable.startedAt}))`,
        })
        .from(sessionsTable)
        .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
        .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
        .where(eq(gamesTable.planned, false))
        .groupBy(iterationsTable.id),

      // Las ABIERTAS, y solo ellas: es lo único que isSessionLive puede llegar
      // a marcar como "jugando ahora", así que no hace falta mirar las
      // cerradas para saberlo. Cero filas en la base real; como mucho un
      // puñado. `startedBy` y `lastHeartbeatAt` son suyos: quién la abrió y
      // cuándo latió por última vez.
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
        .where(and(eq(gamesTable.planned, false), isNull(sessionsTable.endedAt)))
        // Desempate explícito: con dos cronómetros abiertos del mismo juego, la
        // última fila mandaba y "la última" era el orden que quisiera el motor.
        .orderBy(sessionsTable.id),

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
        // Los eventos van por el mismo filtro que las demás, aunque aquí no
        // había ninguna cifra torcida (todo lo que sale de aquí se lee por el
        // id de un juego de `games`): que todas hablen de la MISMA población
        // es lo que evita que la siguiente derivación que alguien añada vuelva
        // a mezclarlas.
        //
        // Y NO se agrega en SQL como las sesiones, aunque sea la consulta que
        // más filas trae (575 en la base real): 328 de los 336 playthroughs
        // tienen horas manuales, y manualHoursAnchor necesita el log ENTERO de
        // cada uno —descartando antes los artefactos del alta, que es una
        // regla de src/shared y no de SQLite—. Agregar aquí sería traerse casi
        // las mismas filas con una copia de la regla en SQL al lado.
        .where(eq(gamesTable.planned, false)),
    ]);

  const addedAtByGame = new Map(games.map((game) => [game.id, game.addedAt]));
  // La segunda referencia del papeleo (el sello del promote) — misma regla
  // que getGames en el escritorio, ver isAddedAtArtifact.
  const promotedAtByGame = new Map(games.map((game) => [game.id, game.promotedAt]));

  const trackedSecondsByIteration = new Map<number, number>();
  const sessionCountByGame = new Map<number, number>();
  const liveSinceByGame = new Map<number, Date>();
  // Las DOS fuentes de "última vez", cada una en su mapa: la del tracking y la
  // del log de estados. Se funden al final con lastPlayedAtFor, no antes — ver
  // abajo por qué mezclarlas aquí era el bug.
  const lastSessionByGame = new Map<number, Date>();
  const lastEventByGame = new Map<number, Date>();
  // Arranque MÁS ANTIGUO de cada playthrough: el último recurso para fechar
  // sus horas manuales cuando el log de estados no dice nada
  // (manualHoursAnchor se queda con el mínimo, así que basta con ese).
  const firstSessionByIteration = new Map<number, Date>();

  for (const row of sessionTotals) {
    trackedSecondsByIteration.set(row.iterationId, row.trackedSeconds);
    sessionCountByGame.set(
      row.gameId,
      (sessionCountByGame.get(row.gameId) ?? 0) + row.sessionCount,
    );
    firstSessionByIteration.set(row.iterationId, new Date(row.firstStartedAt));

    const playedAt = new Date(row.lastPlayedAt);
    const known = lastSessionByGame.get(row.gameId);
    if (!known || playedAt.getTime() > known.getTime()) {
      lastSessionByGame.set(row.gameId, playedAt);
    }
  }

  for (const row of openSessions) {
    if (isSessionLive(row, now)) liveSinceByGame.set(row.gameId, row.startedAt);
  }

  // Horas por juego = suma de sus iteraciones, cada una resuelta con la regla
  // compartida: lo manual (jugado FUERA del tracking) se SUMA a lo medido, no
  // lo reemplaza.
  const hoursByGame = new Map<number, number>();
  for (const iteration of iterations) {
    const tracked = trackedSecondsByIteration.get(iteration.id) ?? 0;
    hoursByGame.set(
      iteration.gameId,
      (hoursByGame.get(iteration.gameId) ?? 0) +
        resolveIterationHours(iteration.manualTotalPlayed, tracked),
    );
  }

  const eventsByIteration = new Map<number, typeof eventRows>();
  const candidatesByGame = new Map<number, typeof eventRows>();
  for (const row of eventRows) {
    const byIteration = eventsByIteration.get(row.iterationId) ?? [];
    byIteration.push(row);
    eventsByIteration.set(row.iterationId, byIteration);

    const byGame = candidatesByGame.get(row.gameId) ?? [];
    byGame.push(row);
    candidatesByGame.set(row.gameId, byGame);
  }

  // Las horas manuales con su año de atribución, por juego.
  //
  // El año sale de yearOf y NO de getFullYear(), que era el desfase con el
  // escritorio: un Worker no tiene zona horaria, así que su getFullYear() es
  // UTC mientras el PC lee el mismo instante en local. Una fecha con precisión
  // de año se guardó como el 1 de enero a las 00:00 LOCALES, o sea las 23:00Z
  // del 31 de diciembre desde España, y esas horas caían un año antes en la
  // portada del móvil que en Stats — la misma pregunta con dos respuestas
  // según la pantalla. La zona la trae la petición (index.ts); sin ella,
  // yearOf se comporta como antes.
  //
  // El `addedAt` y los arranques de sesión van por lo mismo: las dos pantallas
  // tienen que repartir estas horas con la MISMA regla, y la regla entera vive
  // en manualHoursAnchor.
  const manualByGame = new Map<number, ManualHours[]>();
  for (const iteration of iterations) {
    if (iteration.manualTotalPlayed === null) continue;
    const firstSession = firstSessionByIteration.get(iteration.id);
    const anchor = manualHoursAnchor(
      eventsByIteration.get(iteration.id) ?? [],
      addedAtByGame.get(iteration.gameId),
      // Una sola fecha y no todas las de la iteración: manualHoursAnchor se
      // queda con la más antigua, así que el min() de SQL ya la ha elegido.
      firstSession ? [firstSession] : [],
      promotedAtByGame.get(iteration.gameId),
    );
    const list = manualByGame.get(iteration.gameId) ?? [];
    list.push({
      hours: iteration.manualTotalPlayed,
      year: anchor === null ? null : yearOf(anchor, timeZone),
    });
    manualByGame.set(iteration.gameId, list);
  }

  const stateByGame = new Map<number, StateType>();
  for (const [gameId, candidates] of candidatesByGame) {
    const latest = latestRealStateEvent(candidates);
    if (latest) stateByGame.set(gameId, latest.type as StateType);

    // La otra fuente de "última vez": el log. Un juego marcado como completado
    // sin haberse trackeado nunca SÍ se jugó, y mirarlo solo por sesiones lo
    // mandaría al fondo con los intactos.
    //
    // Se mira SIEMPRE, tenga sesiones o no. Aquí había un `if
    // (lastPlayedByGame.has(gameId)) continue;` — el `sesión ?? evento` que el
    // escritorio ya había tirado: con una sola sesión el log dejaba de mirarse,
    // así que un juego trackeado en enero y completado en la consola con fecha
    // de junio salía por junio en el PC y por enero en el teléfono. La misma
    // biblioteca ordenada de dos maneras. Quién gana lo decide ahora
    // lastPlayedAtFor (src/shared), la misma función que llama getGames.
    //
    // El evento que escribe el alta no cuenta (isAddedAtArtifact): hereda la
    // hora del alta y convertiría "los últimos que jugué" en "los últimos que
    // añadí". El margen se pregunta a shared y no se copia aquí — este fichero
    // llevaba su propio ADDED_AT_TOLERANCE_MS, y una biblioteca que parta el
    // pelo distinto que el escritorio es exactamente lo que la cabecera de
    // arriba dice que este fichero existe para evitar.
    const addedAt = addedAtByGame.get(gameId);
    for (const event of candidates) {
      if (event.type === 'plan_to_play') continue;
      if (isAddedAtArtifact(event.occurredAt, addedAt, promotedAtByGame.get(gameId))) continue;
      // Se mira TODO el log, no solo el último: si el evento más reciente es
      // uno de esos sin fecha propia pero un 'started' anterior sí la tiene,
      // esa fecha sigue siendo un dato bueno que no hay que tirar.
      const known = lastEventByGame.get(gameId);
      if (!known || event.occurredAt.getTime() > known.getTime()) {
        lastEventByGame.set(gameId, event.occurredAt);
      }
    }
  }

  return {
    games: games.map((game) => {
      const liveSince = liveSinceByGame.get(game.id) ?? null;
      return {
        id: game.id,
        title: game.title,
        coverUrl: game.coverUrl,
        releaseYear: game.releaseYear,
        totalHours: hoursByGame.get(game.id) ?? 0,
        sessionCount: sessionCountByGame.get(game.id) ?? 0,
        currentState: stateByGame.get(game.id) ?? null,
        // La más reciente de las dos fuentes — ver lastPlayedAtFor (src/shared).
        lastPlayedAt:
          lastPlayedAtFor(
            lastSessionByGame.get(game.id) ?? null,
            lastEventByGame.get(game.id) ?? null,
          )?.getTime() ?? null,
        isLive: liveSince !== null,
        liveSince: liveSince?.getTime() ?? null,
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
