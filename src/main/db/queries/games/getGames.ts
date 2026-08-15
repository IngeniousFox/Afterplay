import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import {
  isAddedAtArtifact,
  latestRealStateEvent,
  manualHoursAnchor,
} from '../../../../shared/playthroughState';
import type { GameListItem, StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
import { resolveIterationHours } from './iterationHours';

// Forma de una fila candidata a "evento de estado más reciente de este
// juego". La nombro explícitamente en vez de inferirla del array para no
// tener que ir a buscar la query cada vez que quiera saber qué trae.
// iterationId: para derivar además el año de las horas manuales por
// playthrough (modelo v2 — la fecha de fin vive en el log de estados).
type StateEventCandidate = {
  gameId: number;
  iterationId: number;
  type: StateEvent['type'];
  occurredAt: Date;
  id: number;
};

// Los enteros de una agregación (`count`, `sum`, `max` sobre timestamps) no
// pasan por el mapeo de columna de drizzle: llegan crudos del driver, y los
// dos que usa esta app no son el mismo (@tursodatabase/sync en producción,
// @libsql/client en los tests). Un `sum()` que volviera como bigint
// convertiría una suma en un TypeError, y una fecha en un Date inválido, así
// que se normalizan aquí una vez en vez de confiar en el driver de turno.
const toNumber = (value: number | bigint | null): number | null =>
  value === null ? null : Number(value);

export const getGames = async (): Promise<GameListItem[]> => {
  const db = getDb();

  // Alfabético, insensible a mayúsculas — sin esto SQLite ordena ASCII puro
  // (mayúsculas antes que minúsculas) y además devolvería el orden de
  // inserción si no se pide nada. Un único sitio para el orden: tanto la
  // biblioteca como el rail lateral (MiddleColumn) leen de este mismo query
  // vía useGames(), así que se ordenan igual en los dos sin más esfuerzo.
  //
  // Sin juegos planeados: la sección Plan to Play es la ÚNICA que los ve
  // (getPlannedGames) — al excluirlos aquí desaparecen de Library, Sessions,
  // Stats y las columnas de navegación de una sola vez.
  const games = await db
    .select({
      id: gamesTable.id,
      igdbId: gamesTable.igdbId,
      // Para que el buscador de Add Game reconozca los juegos que solo existen
      // en Steam — los que tienen igdbId null y que el cruce por IGDB no puede
      // ver (ver GameListItem.steamAppId).
      steamAppId: gamesTable.steamAppId,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      // Para la cara trasera de la card (flip) — una columna de texto más
      // por juego, nada al lado de lo que ya agrega esta query.
      heroUrl: gamesTable.heroUrl,
      genres: gamesTable.genres,
      isEmulated: gamesTable.isEmulated,
      endless: gamesTable.endless,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
      hltbMain: gamesTable.hltbMain,
      // Los otros dos tramos de HLTB viajan también: el overlay in-game
      // pinta la misma barra de tres tramos que la card de la ficha, y esta
      // lista es su única fuente de datos (OVERLAY.md §8.2).
      hltbMainExtras: gamesTable.hltbMainExtras,
      hltbCompletionist: gamesTable.hltbCompletionist,
      // Para el botón Play del modo TV (BIG-PICTURE.md §5.1): el hero de
      // TvHome lanza sin pasar por la ficha, y la lista era el único sitio
      // donde la ruta no viajaba.
      executablePath: gamesTable.executablePath,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  // Iteraciones con su manualTotalPlayed — a nivel de ITERACIÓN, no ya
  // sumado por juego, porque las horas de cada iteración se resuelven igual
  // que en getGameById.ts, vía el mismo resolveIterationHours compartido de
  // más abajo: manualTotalPlayed (jugado FUERA del tracking) se SUMA a lo
  // trackeado en ESA iteración, nunca lo reemplaza — son tiempos disjuntos
  // por definición. Ver iterationHours.ts para el porqué (reemplazar, no
  // sumar, era el bug real: un playthrough con horas manuales al que el
  // watcher le seguía colgando sesiones se quedaba clavado en el número
  // manual para siempre).
  //
  // SOLO las de los juegos de la biblioteca, igual que la lista de arriba:
  // esta consulta se traía la tabla ENTERA y dos tercios eran de juegos
  // planeados (997 filas de las que 661 lo eran, en la base real) cuyo
  // gameId no aparece en `games` y que por tanto nadie llegaba a leer nunca.
  // Eso y el mismo filtro en el log de estados bajan getGames de 12,5 a
  // 8,5 ms sobre la base real de hoy (2.623 filas -> 1.252).
  // El `order by id` mantiene el orden de rowid que daba el escaneo completo
  // de antes: las horas de un juego se suman iteración a iteración y en coma
  // flotante el orden de la suma puede cambiar el último bit.
  const iterations = await db
    .select({
      id: iterationsTable.id,
      gameId: iterationsTable.gameId,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable)
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(eq(gamesTable.planned, false))
    .orderBy(asc(iterationsTable.id));

  // Las sesiones, YA AGREGADAS POR ITERACIÓN: una fila por playthrough CON
  // sesiones en vez de una fila por sesión.
  //
  // ESTE ERA EL COSTE DE LA CONSULTA, medido sobre una copia de la base real
  // con cinco años de tracking simulados encima (5.098 sesiones): traerse las
  // filas crudas costaba 16,7 ms de los 37,4 que tardaba getGames entera, y
  // las mismas cuentas hechas por SQLite cuestan 4,0 ms sobre 336 filas.
  // getGames pasó de 37,4 a 16,8 ms ahí, y de 92,6 a 28,9 ms con 15.178
  // sesiones — o sea que su coste ya no crece con las sesiones, sino con los
  // playthroughs. No es el SQL, es cuántas filas cruzan el driver; y esta
  // consulta corre en CADA 'games:changed', o sea cada vez que el watcher
  // abre o cierra una sesión.
  //
  // Las cinco columnas agregadas son exactamente las cinco cosas que el
  // bucle de JS sacaba de las filas crudas, ni una más:
  //  · sessionCount — cuenta TODAS, la abierta incluida (ya costó un fallo
  //    real: el overlay sumaba +1 "por la de ahora" creyendo que aquí solo
  //    entraban las cerradas, y todo juego en marcha enseñaba una de más).
  //  · trackedSeconds — por ITERACIÓN, para sumarlas a las manuales con
  //    resolveIterationHours. `sum` ignora los NULL igual que hacía el
  //    `?? 0` de antes; el coalesce es para la iteración cuyas sesiones son
  //    todas de duración nula.
  //  · liveSince — el arranque de la sesión ABIERTA. SPEC 4.5 dice que hay
  //    como mucho una por juego, pero la BD no lo impone (una que el watcher
  //    nunca cerró más otra abierta después son dos filas abiertas), así que
  //    se declara el criterio: gana el arranque MÁS RECIENTE, que es la que
  //    de verdad está en marcha. Antes ganaba la última fila que devolviera
  //    la query —sin ORDER BY— y el contador en vivo de la card arrancaba en
  //    un sitio distinto según el día.
  //  · lastSessionAt — cuándo se DEJÓ la última sesión, la base de "Last
  //    played": se toma endedAt y no startedAt para que una partida larga
  //    cuente por cuándo se soltó; en una abierta el arranque es lo más
  //    reciente que hay. Nunca es null: startedAt es NOT NULL.
  //  · firstSessionAt — el arranque más temprano del PLAYTHROUGH (no del
  //    juego), último recurso para fechar sus horas manuales. Basta el
  //    mínimo porque manualHoursAnchor se queda con la sesión más antigua
  //    de las que le pasen; mandarle la lista entera era mandarle 5.000
  //    fechas para que eligiera una.
  //
  // El `group by` es por iteración y no por juego porque las horas se
  // resuelven por iteración (manual + trackeado de ESA iteración); lo que
  // sea del juego entero se pliega en el bucle de abajo, que ahora recorre
  // playthroughs y no sesiones.
  const sessionsByIterationRows = await db
    .select({
      // iterationsTable.id y no sessionsTable.iterationId — mismo valor bajo
      // el inner join, pero el tipo sale number (no nullable) sin guardas.
      iterationId: iterationsTable.id,
      gameId: iterationsTable.gameId,
      sessionCount: sql<number>`count(*)`,
      trackedSeconds: sql<number>`coalesce(sum(${sessionsTable.durationSec}), 0)`,
      liveSince: sql<
        number | null
      >`max(case when ${sessionsTable.endedAt} is null then ${sessionsTable.startedAt} end)`,
      lastSessionAt: sql<number>`max(coalesce(${sessionsTable.endedAt}, ${sessionsTable.startedAt}))`,
      firstSessionAt: sql<number>`min(${sessionsTable.startedAt})`,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(eq(gamesTable.planned, false))
    .groupBy(iterationsTable.id);

  // Modelo v2: toda fila de sessions es tiempo jugado real — ya no existen
  // los marcadores de borde que antes había que descontar aquí.
  const trackedSecondsByIteration = new Map<number, number>();
  const sessionCountByGame = new Map<number, number>();
  const liveSinceByGame = new Map<number, Date>();
  const lastSessionByGame = new Map<number, Date>();
  // El arranque de la PRIMERA sesión de cada playthrough (no de cada juego):
  // último recurso para fechar sus horas manuales cuando el log de estados no
  // dice nada. Ver manualHoursAnchor — el juego que el watcher detectó solo y
  // al que le tecleaste las horas de la otra máquina no tenía año en ninguna
  // vista, teniendo sesiones fechadas delante.
  const firstSessionByIteration = new Map<number, Date>();

  // Este bucle recorre PLAYTHROUGHS, no sesiones: lo que agrega es lo que
  // sube de iteración a juego (contar, y quedarse con la fecha mayor), que
  // es lo único que el `group by` de arriba no puede hacer por sí solo.
  for (const row of sessionsByIterationRows) {
    trackedSecondsByIteration.set(row.iterationId, toNumber(row.trackedSeconds) ?? 0);
    sessionCountByGame.set(
      row.gameId,
      (sessionCountByGame.get(row.gameId) ?? 0) + (toNumber(row.sessionCount) ?? 0),
    );

    const liveSince = toNumber(row.liveSince);
    if (liveSince !== null) {
      const liveKnown = liveSinceByGame.get(row.gameId);
      if (!liveKnown || liveSince > liveKnown.getTime()) {
        liveSinceByGame.set(row.gameId, new Date(liveSince));
      }
    }

    const playedAt = toNumber(row.lastSessionAt);
    if (playedAt !== null) {
      const known = lastSessionByGame.get(row.gameId);
      if (!known || playedAt > known.getTime()) {
        lastSessionByGame.set(row.gameId, new Date(playedAt));
      }
    }

    const firstAt = toNumber(row.firstSessionAt);
    if (firstAt !== null) firstSessionByIteration.set(row.iterationId, new Date(firstAt));
  }

  // Horas por juego = suma de las horas de cada una de sus iteraciones, cada
  // una ya resuelta con la misma regla de siempre (manual + trackeado).
  const hoursByGame = new Map<number, number>();
  for (const iteration of iterations) {
    const trackedSeconds = trackedSecondsByIteration.get(iteration.id) ?? 0;
    const hours = resolveIterationHours(iteration.manualTotalPlayed, trackedSeconds);
    hoursByGame.set(iteration.gameId, (hoursByGame.get(iteration.gameId) ?? 0) + hours);
  }

  // Los stateEvents de los juegos de la biblioteca (vía sus iteraciones), sin
  // agregar. Y aquí el log ENTERO se queda: de estas mismas filas salen tres
  // derivaciones distintas —el estado actual, el respaldo de "Last played" y
  // el año de las horas manuales— y las dos últimas miran TODO el historial,
  // no solo su última fila. El "estado actual" sí es un 1-fila-por-grupo, pero
  // resolverlo aparte con un ROW_NUMBER sería una segunda pasada por la misma
  // tabla para ahorrar filas que de todas formas hay que traer.
  //
  // Lo que sí se queda fuera es el log de los juegos PLANEADOS: eran 661 de
  // las 1.236 filas de la base real, todas de gameId que no está en `games`,
  // o sea agrupadas en un Map que nadie lee.
  const stateEventRows: StateEventCandidate[] = await db
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
    .where(eq(gamesTable.planned, false));

  // Playthroughs con horas manuales, con el año al que atribuirlas para las
  // vistas por año de Stats. Manda el LOG de estados (modelo v2: la fecha de
  // fin ya no vive en una sesión ancla) y solo si el log calla se mira la
  // primera sesión medida. La regla de a qué fecha se cuelgan vive en
  // manualHoursAnchor, compartida con el Journey del renderer y con el móvil.
  const eventsByIteration = new Map<number, StateEventCandidate[]>();
  for (const row of stateEventRows) {
    const list = eventsByIteration.get(row.iterationId) ?? [];
    list.push(row);
    eventsByIteration.set(row.iterationId, list);
  }

  // addedAt por juego: lo necesitan los DOS derivados que tienen que
  // reconocer el evento artefacto del alta — el año de las horas manuales
  // (justo aquí abajo) y el respaldo de "Last played" (más abajo). Vivía solo
  // en el segundo, y esa era exactamente la grieta: un juego dado de alta hoy
  // como "completado, 50 h, jugado hace años y sin fecha" salía con
  // lastPlayedAt null (bien) y con esas 50 horas colgadas del año en curso
  // (mal), porque manualHoursAnchor recibía el log SIN filtrar. La misma
  // fecha no puede ser mentira para una cosa y verdad para la otra.
  const addedAtByGame = new Map(games.map((game) => [game.id, game.addedAt]));

  const manualIterationsByGame = new Map<
    number,
    { iterationId: number; hours: number; year: number | null }[]
  >();
  for (const iteration of iterations) {
    if (iteration.manualTotalPlayed === null) continue;
    // El `addedAt` va para que el artefacto del alta no cuente como fecha
    // (si al playthrough no le queda ninguna de verdad, el ancla es null y
    // esas horas solo pueden contar en All Time), y el arranque de sesión
    // como último recurso cuando el log entero se queda sin decir nada. El
    // orden entre las tres pistas lo decide manualHoursAnchor, que es el
    // único sitio donde está escrito.
    //
    // Va UNA sola fecha en la lista de sesiones y no todas: manualHoursAnchor
    // se queda con la más antigua, así que el min(startedAt) que ya calculó
    // SQLite es esa misma respuesta sin traer las demás.
    const firstSessionAt = firstSessionByIteration.get(iteration.id);
    const anchorDate = manualHoursAnchor(
      eventsByIteration.get(iteration.id) ?? [],
      addedAtByGame.get(iteration.gameId),
      firstSessionAt ? [firstSessionAt] : undefined,
    );
    const list = manualIterationsByGame.get(iteration.gameId) ?? [];
    list.push({
      iterationId: iteration.id,
      hours: iteration.manualTotalPlayed,
      year: anchorDate?.getFullYear() ?? null,
    });
    manualIterationsByGame.set(iteration.gameId, list);
  }

  // Agrupo las candidatas por gameId y le paso cada grupo al helper
  // compartido (ignora 'plan_to_play' — ver schema.ts — y desempata por id):
  // un juego pasado del Plan a la biblioteca como "jugado en el pasado"
  // tiene su evento real (completed/...) con fecha ANTERIOR al plan, y sin
  // ese filtro el plan ganaría siempre.
  const candidatesByGame = new Map<number, StateEventCandidate[]>();
  for (const row of stateEventRows) {
    const list = candidatesByGame.get(row.gameId) ?? [];
    list.push(row);
    candidatesByGame.set(row.gameId, list);
  }

  const latestStateEventByGame = new Map<number, StateEventCandidate>();
  for (const [gameId, candidates] of candidatesByGame) {
    const latest = latestRealStateEvent(candidates);
    if (latest) latestStateEventByGame.set(gameId, latest);
  }

  // --- Respaldo de "Last played" cuando el juego no tiene sesiones ---
  //
  // Un evento de estado vale como "cuándo lo jugué" SOLO si su fecha la
  // pusiste tú. Al añadir un juego con estado pero sin fechas,
  // writeInitialPlaythrough deja que occurredAt caiga al $defaultFn del
  // schema, o sea AHORA: ese evento no dice cuándo lo jugaste, dice cuándo lo
  // diste de alta. Reconocerlos es isAddedAtArtifact (shared/playthroughState,
  // que es donde está el porqué y el margen) — la misma regla que aplica el
  // Journey del renderer, escrita una sola vez, y la misma que filtra el ancla
  // de las horas manuales ahí arriba (addedAtByGame se construye allí).
  const lastEventByGame = new Map<number, Date>();
  for (const [gameId, candidates] of candidatesByGame) {
    const addedAt = addedAtByGame.get(gameId);
    for (const event of candidates) {
      // 'plan_to_play' fuera por lo mismo que en currentState: planear no es
      // jugar.
      if (event.type === 'plan_to_play') continue;
      if (isAddedAtArtifact(event.occurredAt, addedAt)) continue;
      // Se mira TODO el log, no solo el último: si el evento más reciente es
      // uno de esos sin fecha propia pero un 'started' anterior sí la tiene,
      // esa fecha sigue siendo un dato bueno que no hay que tirar.
      const known = lastEventByGame.get(gameId);
      if (!known || event.occurredAt.getTime() > known.getTime()) {
        lastEventByGame.set(gameId, event.occurredAt);
      }
    }
  }

  // "Last played" = la última vez que toqué este juego, venga el dato de donde
  // venga: el fin de la última sesión o el último evento CON FECHA PROPIA, lo
  // que sea más reciente. Antes era `sesión ?? evento`, o sea que en cuanto
  // había una sola sesión el log dejaba de mirarse: trackeas en enero,
  // terminas el juego en la consola y lo marcas completado con fecha de junio
  // — y la biblioteca seguía ordenándolo por enero, por debajo de juegos que
  // tocaste menos. Las dos fuentes ya vienen limpias (la del log ignora
  // 'plan_to_play' y el artefacto del alta), así que quedarse con el máximo no
  // puede subir un juego por una fecha que nadie escribió.
  //
  // null cuando no hay ni una cosa ni la otra: es "no lo sé", y como tal se va
  // al final de la lista en vez de inventarse una fecha.
  const lastPlayedAtFor = (gameId: number): Date | null => {
    const bySession = lastSessionByGame.get(gameId) ?? null;
    const byEvent = lastEventByGame.get(gameId) ?? null;
    if (!bySession) return byEvent;
    if (!byEvent) return bySession;
    return byEvent.getTime() > bySession.getTime() ? byEvent : bySession;
  };

  return games.map((game) => {
    const latestStateEvent = latestStateEventByGame.get(game.id);

    const liveSince = liveSinceByGame.get(game.id) ?? null;

    return {
      id: game.id,
      igdbId: game.igdbId,
      steamAppId: game.steamAppId,
      title: game.title,
      coverUrl: game.coverUrl,
      heroUrl: game.heroUrl,
      genres: game.genres,
      isEmulated: game.isEmulated,
      endless: game.endless,
      releaseYear: game.releaseYear,
      totalHours: hoursByGame.get(game.id) ?? 0,
      addedAt: game.addedAt,
      hltbMain: game.hltbMain,
      hltbMainExtras: game.hltbMainExtras,
      hltbCompletionist: game.hltbCompletionist,
      executablePath: game.executablePath,
      manualIterations: manualIterationsByGame.get(game.id) ?? [],
      currentState: latestStateEvent?.type ?? null,
      // La más reciente de las dos fuentes — ver lastPlayedAtFor arriba.
      lastPlayedAt: lastPlayedAtFor(game.id),
      isLive: liveSince !== null,
      liveSince,
      sessionCount: sessionCountByGame.get(game.id) ?? 0,
    };
  });
};
