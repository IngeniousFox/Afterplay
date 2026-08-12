import { eq, inArray, or, sql } from 'drizzle-orm';
import { resolveIterationHours } from '../../../src/main/db/queries/games/iterationHours';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import { latestRealStateEvent, manualHoursAnchor } from '../../../src/shared/playthroughState';
import type { LibraryGame, StateType } from '../api-types';
import type { TenantDb } from '../db';
import { TIMER_STALE_MS } from './timer';

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

// Un evento de estado vale como "cuándo lo jugué" solo si la fecha la pusiste
// tú. Al dar de alta un juego con estado pero sin fechas, el evento hereda la
// hora del alta — colarlo aquí convierte "los últimos que jugué" en "los
// últimos que añadí". Se reconocen porque caen al segundo con el addedAt.
const ADDED_AT_TOLERANCE_MS = 5_000;

// "Sigue jugando AHORA", que no es lo mismo que "la fila no tiene endedAt".
//
// Las de CRONÓMETRO llevan pegada la regla de frescura del §7.4: se abren
// desde el móvil y se olvidan (§7.6), así que un latido de hace horas
// significa abandonada. Sin esto, la biblioteca pintaba LIVE un juego que
// nadie está tocando desde el viernes — y lo pintaba justo hasta que alguien
// pidiera /api/timer, que es el que barre de verdad, así que dependía del
// orden en que la portada lanzara sus peticiones.
//
// Las del WATCHER se quedan como estaban, y no es un olvido: su regla no es un
// umbral de tiempo sino "¿sigue vivo el proceso?", y eso solo lo puede
// contestar el PC. Su latido además se pausa cuando la pantalla se bloquea, o
// sea que un latido viejo ahí no significa nada. Una que quede abierta por un
// corte de luz sigue pintando LIVE hasta que el PC arranque y reconcilie:
// mismo comportamiento que el escritorio, y no es esta consulta quien lo
// cambia.
//
// Cerrarlas tampoco es cosa de aquí. Esto es una lectura; que un GET escriba
// ya es bastante excepción con /api/timer (ver queries/timer.ts).
const isSessionLive = (
  session: { startedBy: 'watcher' | 'timer'; startedAt: Date; lastHeartbeatAt: Date | null },
  now: number,
): boolean => {
  if (session.startedBy !== 'timer') return true;
  const lastBeat = session.lastHeartbeatAt ?? session.startedAt;
  return now - lastBeat.getTime() < TIMER_STALE_MS;
};

// Unas horas MANUALES con el año al que se atribuyen. Las horas manuales no
// tienen fecha propia —son un número suelto en la iteración— así que se
// cuelgan del log de estados de su playthrough: su fin si terminó, y si no su
// principio. Sin esto, un playthrough de 200h terminado en 2019 aportaba 0h a
// la vista de 2019 aunque su Beaten sí saliera en el desglose de estados.
export type ManualHours = { hours: number; year: number | null };

// Todo lo que hace falta para la biblioteca Y para las stats, calculado en una
// sola pasada. La lista pública (LibraryGame) es un recorte de esto: el
// payload que va al móvil se queda ligero, pero las cifras del resumen se
// calculan con el dato completo en vez de con una versión aguada.
export type LibraryData = {
  games: LibraryGame[];
  manualByGame: Map<number, ManualHours[]>;
  // Sesiones de toda la biblioteca, sin recortar. El tope que tenía antes el
  // resumen (200 filas) hacía que las horas del año dependieran de cuántas
  // sesiones cupieran, que es un número inventado.
  sessions: { gameId: number; startedAt: Date; durationSec: number | null }[];
};

export const buildLibraryData = async (db: TenantDb): Promise<LibraryData> => {
  // Sin juegos planeados: el Plan es su propia sección y colarlos aquí los
  // metería en la biblioteca, las sesiones y las stats de golpe.
  // `collate nocase` porque SQLite ordena ASCII puro y dejaría las minúsculas
  // detrás de todas las mayúsculas.
  const games = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  const addedAtByGame = new Map(games.map((game) => [game.id, game.addedAt]));

  const iterations = await db
    .select({
      id: iterationsTable.id,
      gameId: iterationsTable.gameId,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable);

  const sessionRows = await db
    .select({
      gameId: iterationsTable.gameId,
      iterationId: iterationsTable.id,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      // Los dos últimos son solo para isSessionLive: quién abrió la sesión y
      // cuándo latió por última vez.
      startedBy: sessionsTable.startedBy,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id));

  const eventRows = await db
    .select({
      gameId: iterationsTable.gameId,
      iterationId: stateEventsTable.iterationId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      id: stateEventsTable.id,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));

  const trackedSecondsByIteration = new Map<number, number>();
  const sessionCountByGame = new Map<number, number>();
  const liveSinceByGame = new Map<number, Date>();
  const lastPlayedByGame = new Map<number, Date>();

  const now = Date.now();

  for (const row of sessionRows) {
    trackedSecondsByIteration.set(
      row.iterationId,
      (trackedSecondsByIteration.get(row.iterationId) ?? 0) + (row.durationSec ?? 0),
    );
    sessionCountByGame.set(row.gameId, (sessionCountByGame.get(row.gameId) ?? 0) + 1);
    if (row.endedAt === null && isSessionLive(row, now)) {
      liveSinceByGame.set(row.gameId, row.startedAt);
    }

    // endedAt y no startedAt: una partida larga cuenta por cuándo se dejó. En
    // una sesión abierta, el arranque es lo más reciente que hay.
    const playedAt = row.endedAt ?? row.startedAt;
    const known = lastPlayedByGame.get(row.gameId);
    if (!known || playedAt.getTime() > known.getTime()) {
      lastPlayedByGame.set(row.gameId, playedAt);
    }
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
  // PENDIENTE CONOCIDO: `getFullYear()` aquí es UTC —un Worker no tiene zona
  // horaria— y en el escritorio es hora local. Una fecha con precisión de año
  // se guardó como el 1 de enero a las 00:00 LOCALES, así que desde España cae
  // en el 31 de diciembre anterior en UTC y estas horas se cuelgan del año de
  // antes. El mismo desfase está en stats.ts (thisYear y el año de cada
  // sesión). Arreglarlo de verdad es sacar "a qué año pertenece esta fecha" a
  // un helper de src/shared que reciba la zona del cliente, y consumirlo desde
  // los dos lados; ni src/shared ni la PWA que tendría que mandarla se pueden
  // tocar desde aquí.
  const manualByGame = new Map<number, ManualHours[]>();
  for (const iteration of iterations) {
    if (iteration.manualTotalPlayed === null) continue;
    const anchor = manualHoursAnchor(eventsByIteration.get(iteration.id) ?? []);
    const list = manualByGame.get(iteration.gameId) ?? [];
    list.push({ hours: iteration.manualTotalPlayed, year: anchor?.getFullYear() ?? null });
    manualByGame.set(iteration.gameId, list);
  }

  const stateByGame = new Map<number, StateType>();
  for (const [gameId, candidates] of candidatesByGame) {
    const latest = latestRealStateEvent(candidates);
    if (latest) stateByGame.set(gameId, latest.type as StateType);

    // Respaldo de "última vez" para juegos sin ninguna sesión: un juego
    // marcado como completado sin haberse trackeado nunca SÍ se jugó, y
    // mirarlo solo por sesiones lo mandaría al fondo con los intactos.
    if (lastPlayedByGame.has(gameId)) continue;
    const addedAt = addedAtByGame.get(gameId);
    for (const event of candidates) {
      if (event.type === 'plan_to_play') continue;
      if (
        addedAt &&
        Math.abs(event.occurredAt.getTime() - addedAt.getTime()) < ADDED_AT_TOLERANCE_MS
      ) {
        continue;
      }
      const known = lastPlayedByGame.get(gameId);
      if (!known || event.occurredAt.getTime() > known.getTime()) {
        lastPlayedByGame.set(gameId, event.occurredAt);
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
        lastPlayedAt: lastPlayedByGame.get(game.id)?.getTime() ?? null,
        isLive: liveSince !== null,
        liveSince: liveSince?.getTime() ?? null,
      };
    }),
    manualByGame,
    sessions: sessionRows.map((row) => ({
      gameId: row.gameId,
      startedAt: row.startedAt,
      durationSec: row.durationSec,
    })),
  };
};

export const listLibrary = async (db: TenantDb): Promise<LibraryGame[]> =>
  (await buildLibraryData(db)).games;

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
export const listPlanned = async (
  db: TenantDb,
): Promise<
  {
    id: number;
    title: string;
    coverUrl: string | null;
    releaseYear: number | null;
    releaseDate: number | null;
    releaseDatePrecision: 'year' | 'month' | 'day' | null;
    genres: string[] | null;
    hltbMain: number | null;
    endless: boolean;
    addedAt: number;
    pinnedAt: number | null;
    ratingCritics: number | null;
    ratingCriticsCount: number | null;
    ratingUsers: number | null;
    ratingUsersCount: number | null;
    steamPositive: number | null;
    steamNegative: number | null;
  }[]
> => {
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
    ...row,
    addedAt: row.addedAt.getTime(),
    releaseDate: row.releaseDate ? row.releaseDate.getTime() : null,
    pinnedAt: row.planPinnedAt ? row.planPinnedAt.getTime() : null,
  }));
};
