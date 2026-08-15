import { eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type {
  ChapterStateEvent,
  ChapterUnlock,
  ManualBlock,
} from '../../../../shared/memory/chapters';
import type { MemorySession } from '../../../../shared/memory/moments';
import { manualHoursAnchor } from '../../../../shared/playthroughState';
import {
  achievementsTable,
  achievementUnlocksTable,
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../schema';

// La materia prima de los capítulos del Loop (shared/memory) leída de la DB
// en una pasada: sesiones con su juego resuelto, eventos de estado, títulos,
// y las horas manuales de cada playthrough con su ancla de calendario.
//
// Los inner join con iterations hacen el filtrado importante solos: una
// sesión de emulador sin asignar (iterationId null) no pertenece a ningún
// juego y se cae del join — la regla "no cuenta en ningún capítulo"
// (AFTERPLAY-LOOP.md §7.4) sale del modelo, no de un WHERE que recordar.

export type MemoryFacts = {
  sessions: MemorySession[];
  events: ChapterStateEvent[];
  titlesByGame: Map<number, string>;
  // Un bloque por playthrough con horas manuales, anclado con la MISMA regla
  // que Stats y el Journey (manualHoursAnchor: el fin si lo hay, si no el
  // inicio) — los capítulos deben contar lo mismo que las pantallas que
  // tienen al lado.
  manualBlocks: ManualBlock[];
  // Suma por juego de esos bloques — la línea base de los hitos de horas de
  // deriveMoments (ahí no importa el ancla, solo cuánto había ya jugado).
  manualHoursByGame: Map<number, number>;
  // Los desbloqueos de logros con fecha FIABLE, ya fundidos por logro entre
  // fuentes (LOGROS-IDEAS.md §2.3) — la materia del bloque de logros de cada
  // capítulo. Los de fecha no fiable ni salen de aquí: una fecha de rescate
  // no puede fabricar historia en ningún mes.
  unlocks: ChapterUnlock[];
};

export const getMemoryFacts = async (): Promise<MemoryFacts> => {
  const db = getDb();

  const sessions = await db
    .select({
      id: sessionsTable.id,
      gameId: iterationsTable.gameId,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      isManual: sessionsTable.isManual,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id));

  const eventRows = await db
    .select({
      iterationId: stateEventsTable.iterationId,
      gameId: iterationsTable.gameId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));

  // addedAt viaja con el título porque el Loop lo necesita para reconocer el
  // papeleo del alta (isMeaningfulStateEvent). Faltaba, y por eso la mitad
  // "alta" del filtro no se aplicaba NUNCA en la app: meter treinta juegos
  // viejos marcados Beaten sin teclear fechas abría ese mes en el Loop y le
  // cobraba un recap ("you finished thirty games in March") de un mes en el
  // que el Journey —que siempre tuvo el dato— no pinta ni una carátula.
  const games = await db
    .select({ id: gamesTable.id, title: gamesTable.title, addedAt: gamesTable.addedAt })
    .from(gamesTable);

  const manualRows = await db
    .select({
      iterationId: iterationsTable.id,
      gameId: iterationsTable.gameId,
      hours: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable)
    .where(isNotNull(iterationsTable.manualTotalPlayed));

  const titlesByGame = new Map(games.map((game) => [game.id, game.title]));
  const addedAtByGame = new Map(games.map((game) => [game.id, game.addedAt]));

  // Cada evento sale de aquí con la fecha de alta de SU juego pegada. Es lo
  // único que le falta a isMeaningfulStateEvent para poder tirar el papeleo
  // del alta, y se hace aquí —y no en el capítulo— porque el join que sabe a
  // qué juego pertenece cada evento está en esta consulta.
  const events = eventRows.map((row) => ({
    ...row,
    addedAt: addedAtByGame.get(row.gameId) ?? null,
  }));

  // Eventos agrupados por playthrough, para calcular el ancla de cada bloque
  // manual sin volver a la DB. La fila entera y no un recorte: el ancla
  // necesita el addedAt que se acaba de pegar.
  const eventsByIteration = new Map<number, typeof events>();
  for (const event of events) {
    const list = eventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    eventsByIteration.set(event.iterationId, list);
  }

  const manualBlocks: ManualBlock[] = [];
  const manualHoursByGame = new Map<number, number>();
  for (const row of manualRows) {
    const hours = row.hours ?? 0;
    if (hours <= 0) continue;
    manualBlocks.push({
      gameId: row.gameId,
      hours,
      // Con el addedAt delante: unas horas manuales cuyo único evento es el
      // que escribió el alta no pertenecen a ningún mes (anchor null), igual
      // que ese evento no abre capítulo. Si no, el capítulo del mes en curso
      // se llevaba las 200 horas de un juego que llevas años sin tocar.
      anchor: manualHoursAnchor(
        eventsByIteration.get(row.iterationId) ?? [],
        addedAtByGame.get(row.gameId),
      ),
    });
    manualHoursByGame.set(row.gameId, (manualHoursByGame.get(row.gameId) ?? 0) + hours);
  }

  // Desbloqueos con su definición, ya fundidos por logro EN SQL. La regla de
  // la casa (mergeUnlocks.ts) es "fecha fiable gana; empatadas, la más
  // temprana", y aquí solo viajan los de fecha fiable: entre las filas fiables
  // de un logro la ganadora es SIEMPRE la más temprana, que es justo lo que
  // devuelve este min() con el WHERE delante. Fila a fila da lo mismo que
  // fundir en JS y filtrar después (verificado contra la biblioteca real y
  // contra su proyección a cinco años: 3.160 y 9.480 desbloqueos idénticos);
  // lo que se ahorra son las filas que se descartaban DESPUÉS de cruzar el
  // driver, más la pasada de fundido en JS.
  //
  // Medido (mediana de 5, tres rondas alternando antes/después en la misma
  // máquina): getMemoryFacts pasó de 28 ms a 26 ms sobre la biblioteca real
  // (994 juegos, 3.243 desbloqueos, 39.808 logros) y de 102 ms a 94 ms sobre
  // esa misma biblioteca proyectada a cinco años (9.729 / 119.424). Esta
  // consulta sola es 17 ms de los 26 hoy y 50 ms de los 94 a cinco años: es la
  // cara de las cinco porque arrastra la definición del logro (nombre y
  // descripción) por desbloqueo, y no hay forma de abaratarla más desde aquí —
  // probado y descartado: un índice cubridor sobre achievements (SQLite se
  // queda igual con la búsqueda por rowid) y pre-agregar por mes en SQL
  // (44 ms -> 20 ms de conteos + 42 ms de destacados: sale MÁS caro). Lo que
  // queda es no pedir la foto entera tan a menudo, y eso se decide en
  // memories/status.ts, no aquí.
  //
  // EL PRECIO, dicho claro: el desempate deja de salir de mergeUnlocks.ts y
  // pasa a estar escrito en este SQL — como ya lo estaba en
  // getAchievementsOverview.ts por el mismo motivo (ahí son 39.808 logros). Si
  // se cierra la decisión de RETROACHIEVEMENTS.md §8 (hardcore vs softcore),
  // que toca justo este desempate, hay que tocar las TRES: mergeUnlocks y las
  // dos consultas que lo hacen en SQL.
  const unlockRows = await db
    .select({
      gameId: achievementsTable.gameId,
      name: achievementsTable.displayName,
      description: achievementsTable.description,
      globalPercent: achievementsTable.globalPercent,
      // mapWith: sin él el min() vuelve como el entero crudo del driver y el
      // capítulo compara fechas, no números. Y `sql<Date>` en vez del helper
      // min() porque ese tipa nullable (un min() suelto sobre cero filas lo
      // es); bajo un GROUP BY no hay grupos vacíos y aquí nunca falta.
      unlockedAt: sql<Date>`min(${achievementUnlocksTable.unlockedAt})`.mapWith(
        achievementUnlocksTable.unlockedAt,
      ),
    })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
    // Los de fecha no fiable ni salen de aquí: una fecha de rescate no puede
    // fabricar historia en ningún mes.
    .where(eq(achievementUnlocksTable.dateReliable, true))
    // Un capítulo cuenta que sacaste el logro y cuándo, no por cuántas vías lo
    // tienes: una fila por logro, no por (logro, fuente).
    .groupBy(achievementUnlocksTable.achievementId);

  const unlocks: ChapterUnlock[] = unlockRows;

  return { sessions, events, titlesByGame, manualBlocks, manualHoursByGame, unlocks };
};
