import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import type { CreatePlannedGameInput, PromotePlannedGameInput } from '../../../shared/types';
import type {
  EnrichmentSource,
  GameEnrichment,
  GameEnrichmentOverrides,
} from '../queries/games/resolveGameEnrichment';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeSession,
  makeStateEvent,
  type TestDb,
} from './harness';

// PLAN TO PLAY (PLAN-TO-PLAY.md) contra una base de datos REAL.
//
// Lo que se blinda aquí es la mitad del Plan que vive en la base: el alta
// reducida, la lista con su nota de "por qué lo planeo" (desde la segunda
// oleada de rendimiento, en DOS canales: el escueto que pagan todos los
// consumidores y el de extras que solo pide la pantalla del Plan), el pin de
// Up next, el reparto de marcas al arrastrar y el paso a la biblioteca. Son
// funciones pequeñas con varias reglas duras metidas dentro —y con cicatrices
// contadas en sus propios comentarios— que un refactor puede deshacer sin que
// nada compile en rojo: una subconsulta que devuelve la nota del vecino, un
// pin que sobrevive a la promoción, un reorden que se inventa fechas.

// ── El único doble que hace falta además del andamio ───────────────────────
// El alta del Plan resuelve IGDB + HowLongToBeat + SteamGridDB ANTES de abrir
// la transacción. Aquí no hay red, ni debe haberla: un test que depende de
// Twitch falla los martes. Lo que sí importa —y se comprueba— es que lo que
// esa resolución devuelve aterriza entero en la fila del juego.
const CHECKED_AT = new Date('2026-01-05T09:00:00Z');

const enrichment = (overrides: Partial<GameEnrichment> = {}): GameEnrichment => ({
  title: 'Silksong',
  coverUrl: 'https://covers/silksong.jpg',
  heroUrl: 'https://heroes/silksong.jpg',
  developer: 'Team Cherry',
  publisher: 'Team Cherry',
  genres: ['Platform'],
  igdbId: 20001,
  steamGridDbId: 5555,
  officialPlatforms: ['PC (Microsoft Windows)'],
  releaseYear: 2026,
  hltbMain: 32,
  hltbMainExtras: null,
  hltbCompletionist: null,
  steamAppId: 1030300,
  steamAppIdCheckedAt: CHECKED_AT,
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
  ratingsCheckedAt: CHECKED_AT,
  summary: 'Hornet vuelve a un reino que no la esperaba.',
  igdbCollections: null,
  releaseDate: new Date('2026-09-04T00:00:00Z'),
  releaseDatePrecision: 'day',
  ...overrides,
});

let enrichmentImpl: (
  source: EnrichmentSource,
  overrides: GameEnrichmentOverrides,
) => Promise<GameEnrichment> = async () => enrichment();

mock.module('../queries/games/resolveGameEnrichment', {
  namedExports: {
    resolveGameEnrichment: (
      source: EnrichmentSource,
      overrides: GameEnrichmentOverrides,
    ): Promise<GameEnrichment> => enrichmentImpl(source, overrides),
  },
});

// ── Los módulos reales, DESPUÉS de registrar los mocks ─────────────────────
let db: TestDb;
let getPlannedGames: typeof import('../queries/games/getPlannedGames').getPlannedGames;
let getPlannedGameExtras: typeof import('../queries/games/getPlannedGames').getPlannedGameExtras;
let setPlanPinned: typeof import('../queries/games/getPlannedGames').setPlanPinned;
let reorderUpNext: typeof import('../queries/games/getPlannedGames').reorderUpNext;
let createPlannedGame: typeof import('../queries/games/createPlannedGame').createPlannedGame;
let promotePlannedGame: typeof import('../queries/games/promotePlannedGame').promotePlannedGame;
let getGames: typeof import('../queries/games/getGames').getGames;

before(async () => {
  ({ getPlannedGames, getPlannedGameExtras, setPlanPinned, reorderUpNext } =
    await import('../queries/games/getPlannedGames'));
  ({ createPlannedGame } = await import('../queries/games/createPlannedGame'));
  ({ promotePlannedGame } = await import('../queries/games/promotePlannedGame'));
  ({ getGames } = await import('../queries/games/getGames'));
});

beforeEach(async () => {
  db = await freshDb();
  enrichmentImpl = async () => enrichment();
});

after(() => cleanupDbs());

// ── Fábricas locales ───────────────────────────────────────────────────────
// Para que cada test hable de JUEGOS PLANEADOS y no de inserts.

type PlannedFixture = { gameId: number; iterationId: number };

// Un juego que YA está en el Plan: las tres piezas que deja el alta (juego con
// planned=true, su iteración, y el evento 'plan_to_play' con el porqué).
// Montado a mano en vez de llamando a createPlannedGame para que las fechas
// sean fijas y para que los tests de la LISTA no dependan de que el ALTA
// funcione — si las dos cosas se rompen a la vez, conviene que lo digan por
// separado.
const planned = async (
  title: string,
  options: {
    note?: string | null;
    pinnedAt?: string;
    plannedAt?: string;
    withPlanEvent?: boolean;
  } = {},
): Promise<PlannedFixture> => {
  const gameId = await makeGame(db, {
    title,
    planned: true,
    planPinnedAt: options.pinnedAt ? new Date(options.pinnedAt) : null,
  });
  const iterationId = await makeIteration(db, gameId);
  if (options.withPlanEvent !== false) {
    await makeStateEvent(
      db,
      iterationId,
      'plan_to_play',
      options.plannedAt ?? '2026-01-02T12:00:00Z',
      { note: options.note ?? null },
    );
  }
  return { gameId, iterationId };
};

const planInput = (overrides: Partial<CreatePlannedGameInput> = {}): CreatePlannedGameInput => ({
  source: { igdbId: 20001 },
  note: null,
  gameNotes: null,
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
  ...overrides,
});

// El payload del modal de "pasar a la biblioteca": por defecto, lo mínimo
// (sin estado inicial, sin gasto, sin horas) para que cada test añada solo lo
// que está probando.
const promoteInput = (
  gameId: number,
  overrides: Partial<PromotePlannedGameInput> = {},
): PromotePlannedGameInput => ({
  gameId,
  endless: false,
  isEmulated: false,
  iteration: { playedPlatform: 'Nintendo Switch', origin: 'Gift', format: 'physical' },
  hoursPlayed: null,
  started: null,
  finished: null,
  initialStatus: null,
  note: null,
  gameNotes: null,
  moneySpent: null,
  moneySpentDate: null,
  executablePath: null,
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
  installDirectory: null,
  installSizeBytes: null,
  ...overrides,
});

// ── Lecturas de comprobación ───────────────────────────────────────────────
// Proyecciones explícitas (nunca select() pelado) por lo mismo que dice
// projections.ts: la inferencia del modelo completo se degrada a any.

type GameCheck = {
  title: string;
  planned: boolean;
  planPinnedAt: Date | null;
  notes: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  steamGridDbId: number | null;
  executablePath: string | null;
  endless: boolean;
  addedAt: Date;
};

const readGame = async (gameId: number): Promise<GameCheck> => {
  const [row] = await db
    .select({
      title: gamesTable.title,
      planned: gamesTable.planned,
      planPinnedAt: gamesTable.planPinnedAt,
      notes: gamesTable.notes,
      coverUrl: gamesTable.coverUrl,
      heroUrl: gamesTable.heroUrl,
      steamGridDbId: gamesTable.steamGridDbId,
      executablePath: gamesTable.executablePath,
      endless: gamesTable.endless,
      addedAt: gamesTable.addedAt,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId));
  return row;
};

type IterationCheck = {
  id: number;
  label: string;
  playedPlatform: string;
  origin: string;
  format: string | null;
  manualTotalPlayed: number | null;
};

const readIterations = async (gameId: number): Promise<IterationCheck[]> =>
  db
    .select({
      id: iterationsTable.id,
      label: iterationsTable.label,
      playedPlatform: iterationsTable.playedPlatform,
      origin: iterationsTable.origin,
      format: iterationsTable.format,
      manualTotalPlayed: iterationsTable.manualTotalPlayed,
    })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

type EventCheck = {
  id: number;
  iterationId: number;
  type: string;
  occurredAt: Date;
  datePrecision: string;
  note: string | null;
};

// Por id ascendente a propósito: el ORDEN DE ESCRITURA es lo que hay que
// vigilar en SPEC 4.5 ('started' por delante del estado terminal), y ordenar
// por occurredAt lo escondería justo cuando las dos fechas coinciden.
const readEvents = async (gameId: number): Promise<EventCheck[]> =>
  db
    .select({
      id: stateEventsTable.id,
      iterationId: stateEventsTable.iterationId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      datePrecision: stateEventsTable.datePrecision,
      note: stateEventsTable.note,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(iterationsTable.id, stateEventsTable.iterationId))
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(stateEventsTable.id));

// Up next tal y como lo pinta la pantalla: fijados, de marca más antigua a más
// nueva (renderer/src/lib/plan.ts, splitPlanSections). Los tests del reorden
// comprueban el resultado por AQUÍ y no solo por las fechas sueltas: lo que el
// usuario juzga es el orden de la estantería, no los milisegundos.
// La nota de cada juego vista COMO LA VE LA PANTALLA desde que la lista va
// en dos canales: el escueto da el orden y el título, y el de extras la
// nota, unidos por id — el mismo cruce que hace usePlannedGamesWithExtras
// en el renderer.
const plannedNotes = async (): Promise<[string, string | null][]> => {
  const [games, extras] = await Promise.all([getPlannedGames(), getPlannedGameExtras()]);
  const noteById = new Map(extras.map((extra) => [extra.id, extra.planNote]));
  return games.map((game) => [game.title, noteById.get(game.id) ?? null]);
};

const upNextTitles = async (): Promise<string[]> => {
  const games = await getPlannedGames();
  return games
    .filter((game) => game.planPinnedAt !== null)
    .sort((a, b) => (a.planPinnedAt as Date).getTime() - (b.planPinnedAt as Date).getTime())
    .map((game) => game.title);
};

const pinnedAtOf = async (gameId: number): Promise<Date | null> =>
  (await readGame(gameId)).planPinnedAt;

const countRows = async (gameId: number): Promise<{ sessions: number; spend: number }> => {
  const sessions = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(iterationsTable.id, sessionsTable.iterationId))
    .where(eq(iterationsTable.gameId, gameId));
  const spend = await db
    .select({ id: spendEventsTable.id })
    .from(spendEventsTable)
    .where(eq(spendEventsTable.gameId, gameId));
  return { sessions: sessions.length, spend: spend.length };
};

// ══ EL ALTA EN PLAN TO PLAY ════════════════════════════════════════════════

describe('el alta en Plan to Play', () => {
  it('deja el juego planeado, con UNA iteración y el porqué en el historial — y sin nada de playthrough', async () => {
    // Las tres piezas del alta reducida y, sobre todo, lo que NO escribe: ni
    // sesiones ni gasto ni un estado inicial. Un planeado no se ha jugado, y
    // el día que alguien "unifique" esto con createGameWithDetails, este test
    // es el que dice que aquí no se fabrica playthrough.
    //
    // Las DOS notas del alta son distintas y no se pisan: `note` es el porqué
    // ("me lo recomendó Dani", que viaja en el evento) y `gameNotes` son las
    // notas del juego (que viven en la columna). Confundirlas es un fallo
    // silencioso: la nota aparece en el sitio equivocado y nadie la echa de
    // menos hasta que la busca.
    const game = await createPlannedGame(
      planInput({ note: 'Me lo recomendó Dani', gameNotes: 'La edición física está agotada' }),
    );

    const row = await readGame(game.id);
    assert.equal(row.planned, true);
    assert.equal(row.title, 'Silksong');
    assert.equal(row.notes, 'La edición física está agotada');
    // El enriquecimiento aterriza entero: si alguien deja de esparcirlo, el
    // juego nace con la ficha vacía y sin que nada se queje.
    assert.equal(row.coverUrl, 'https://covers/silksong.jpg');
    assert.equal(row.steamGridDbId, 5555);
    // Nada de Up next por el alta: fijar es SIEMPRE un gesto tuyo (§2.2).
    assert.equal(row.planPinnedAt, null);

    const iterations = await readIterations(game.id);
    assert.equal(iterations.length, 1);
    assert.deepEqual(
      [iterations[0].label, iterations[0].origin, iterations[0].format],
      ['Playthrough 1', 'Purchased', 'digital'],
    );

    const events = await readEvents(game.id);
    assert.equal(events.length, 1);
    assert.deepEqual(
      [events[0].type, events[0].note, events[0].datePrecision],
      ['plan_to_play', 'Me lo recomendó Dani', 'datetime'],
    );
    // El evento cuelga de la iteración recién creada: los stateEvents no
    // cuelgan de juegos, y por eso el alta crea una iteración que en el Plan
    // no sirve para nada más.
    assert.equal(events[0].iterationId, iterations[0].id);

    assert.deepEqual(await countRows(game.id), { sessions: 0, spend: 0 });
  });

  it('la plataforma de la iteración es la primera oficial del catálogo, y PC cuando el catálogo no dice ninguna', async () => {
    // Valor NEUTRO, no una decisión: el playthrough real se pregunta al
    // promocionar. Pero tiene que ser plausible, porque la ficha del planeado
    // ya lo enseña — un juego solo de Switch que ponga "PC" es un dato falso
    // en pantalla desde el primer día.
    enrichmentImpl = async () =>
      enrichment({ officialPlatforms: ['Nintendo Switch', 'PC (Microsoft Windows)'] });
    const switchGame = await createPlannedGame(planInput());
    assert.equal((await readIterations(switchGame.id))[0].playedPlatform, 'Nintendo Switch');

    // Un juego de Steam sin lista de plataformas (o uno que IGDB no clasifica)
    // cae al 'PC' de reserva en vez de reventar por el NOT NULL de la columna.
    enrichmentImpl = async () =>
      enrichment({ igdbId: null, steamAppId: 99, officialPlatforms: null });
    const orphan = await createPlannedGame(planInput({ source: { steamAppId: 99 } }));
    assert.equal((await readIterations(orphan.id))[0].playedPlatform, 'PC');
  });

  it('si el enriquecimiento falla no queda ni el juego a medias', async () => {
    // La red se resuelve FUERA de la transacción a propósito. La consecuencia
    // observable —y lo que este test fija— es que un IGDB caído no deja
    // fantasmas: ni un juego sin iteración, ni una iteración sin evento. Si
    // alguien mete la llamada dentro del db.transaction "para simplificar",
    // esto sigue verde… pero el día que falle a mitad, no.
    enrichmentImpl = async () => {
      throw new Error('No se encontró el juego de IGDB 20001 (¿lo quitaron del catálogo?)');
    };

    await assert.rejects(() => createPlannedGame(planInput()), /IGDB 20001/);

    assert.deepEqual(await getPlannedGames(), []);
    const iterations = await db.select({ id: iterationsTable.id }).from(iterationsTable);
    assert.equal(iterations.length, 0);
  });
});

// ══ LA LISTA DEL PLAN ══════════════════════════════════════════════════════

describe('la lista del Plan', () => {
  it('cada juego trae SU nota de por qué, no la del vecino', async () => {
    // LA cicatriz de esta query, contada en su propio comentario: dentro de
    // una plantilla sql`` drizzle interpola las columnas sin cualificar, y la
    // subconsulta correlacionada se renderizaba como `where "gameId" = "id"`
    // — un "id" que SQLite resolvía contra el ámbito de dentro. Resultado: la
    // misma nota (la primera que hubiera) repetida en todas las filas.
    // Con dos juegos y dos notas distintas, ese fallo es imposible de esconder.
    await planned('Animal Well', { note: 'Me lo recomendó Dani' });
    await planned('Balatro', { note: 'Para el Steam Deck del tren' });
    await planned('Chants of Sennaar', { withPlanEvent: false });

    assert.deepEqual(await plannedNotes(), [
      ['Animal Well', 'Me lo recomendó Dani'],
      ['Balatro', 'Para el Steam Deck del tren'],
      // Sin evento no hay porqué que enseñar, y eso no es un error: los
      // planeados de antes de que existiera la nota están así.
      ['Chants of Sennaar', null],
    ]);
  });

  it('con dos entradas de plan gana la más reciente, y el juego sigue saliendo UNA sola vez', async () => {
    // El motivo de que la nota venga por subconsulta y no por LEFT JOIN: un
    // juego con dos eventos (promocionar y volver a planear, un arreglo a
    // mano) duplicaría la fila con el JOIN, y un juego repetido en la lista
    // del Plan se ve a la primera.
    const { iterationId } = await planned('Outer Wilds', {
      note: 'La primera vez que lo apunté',
      plannedAt: '2026-01-02T12:00:00Z',
    });
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-05-09T20:00:00Z', {
      note: 'Ahora sí, este verano',
    });

    assert.equal((await getPlannedGames()).length, 1);
    // Y el canal de extras tampoco duplica: la subconsulta vive allí ahora.
    assert.equal((await getPlannedGameExtras()).length, 1);
    assert.deepEqual(await plannedNotes(), [['Outer Wilds', 'Ahora sí, este verano']]);
  });

  it('con dos entradas de plan a la MISMA hora gana la última apuntada, igual que en el resto de la app', async () => {
    // ARREGLADO (era una divergencia de desempate). La subconsulta ordenaba
    // solo por `occurredAt desc`, así que con dos 'plan_to_play' a la misma
    // hora el desempate se lo quedaba el motor y devolvía la entrada MÁS
    // ANTIGUA. El criterio de la casa es el contrario y está escrito en
    // shared/playthroughState.ts — "id para desempatar cuando dos eventos
    // comparten fecha exacta (gana el insertado después)" — y lo aplican
    // getGames, getGameById y resolveIterationForPlay. Importaba porque la
    // fila del Plan enseñaba un porqué y la ficha el otro, sobre el mismo
    // juego y sin que nada fallara.
    //
    // El empate no es rebuscado: dos altas con precisión de día, un arreglo a
    // mano o un sync que reinsertó dejan la misma marca al milisegundo.
    const { iterationId } = await planned('Outer Wilds', {
      note: 'La primera vez que lo apunté',
      plannedAt: '2026-01-02T12:00:00Z',
    });
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-01-02T12:00:00Z', {
      note: 'Ahora sí, este verano',
    });

    // El juego sigue saliendo una sola vez: eso sí es invariante.
    assert.equal((await getPlannedGames()).length, 1);
    assert.deepEqual(await plannedNotes(), [['Outer Wilds', 'Ahora sí, este verano']]);
  });

  it('la fecha sigue mandando por encima del id: una entrada VIEJA insertada después no gana', async () => {
    // El borde contrario del arreglo anterior, y el que un `order by se.id
    // desc` a secas rompería: el id solo desempata cuando las fechas coinciden
    // EXACTAMENTE. Un evento de enero reinsertado hoy (un sync que rehizo la
    // fila, un arreglo manual) no puede adelantar a la nota de mayo.
    const { iterationId } = await planned('Outer Wilds', {
      note: 'Ahora sí, este verano',
      plannedAt: '2026-05-09T20:00:00Z',
    });
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-01-02T12:00:00Z', {
      note: 'La primera vez que lo apunté',
    });

    assert.deepEqual(await plannedNotes(), [['Outer Wilds', 'Ahora sí, este verano']]);
  });

  it('una nota que no es del plan no se cuela como el porqué', async () => {
    // El filtro `se.type = 'plan_to_play'` no es decorativo: las notas de los
    // otros eventos son de otra conversación entera ("lo dejé por el jefe
    // final") y aparecerían como el motivo por el que planeaste el juego.
    const { iterationId } = await planned('Tunic', { withPlanEvent: false });
    await makeStateEvent(db, iterationId, 'started', '2026-02-01T18:00:00Z', {
      note: 'Empezado en la Steam Deck',
    });

    assert.deepEqual(await plannedNotes(), [['Tunic', null]]);
  });

  it('la lista va por título ignorando mayúsculas', async () => {
    // `collate nocase`: sin él SQLite ordena por bytes y todas las mayúsculas
    // van delante de todas las minúsculas — 'Balatro' antes que 'animal
    // well', que en una lista de 260 juegos parece que falta el juego.
    await planned('animal well');
    await planned('Balatro');
    await planned('Cocoon');

    const games = await getPlannedGames();
    assert.deepEqual(
      games.map((game) => game.title),
      ['animal well', 'Balatro', 'Cocoon'],
    );
  });

  it('el Plan y la biblioteca no comparten ni un juego', async () => {
    // Las dos listas son EXCLUYENTES por la columna `planned` (schema.ts: la
    // fuente de verdad es la columna, no el evento). getGames filtra
    // planned=false y esta filtra planned=true; si alguien toca una de las
    // dos condiciones, un juego se duplica en pantalla o desaparece de las
    // dos secciones.
    await planned('Silksong');
    const libraryId = await makeGame(db, { title: 'Celeste', planned: false });
    await makeIteration(db, libraryId);

    assert.deepEqual(
      (await getPlannedGames()).map((game) => game.title),
      ['Silksong'],
    );
    assert.deepEqual(
      (await getGames()).map((game) => game.title),
      ['Celeste'],
    );
  });

  it('las horas y las sesiones de un planeado son cero POR DEFINICIÓN, no una suma', async () => {
    // Esta query NO va a mirar sessions ni stateEvents: un planeado no se ha
    // jugado y los campos van fijos. Se comprueba con una sesión colgando de
    // su iteración —dato imposible por la app, pero alcanzable con un arreglo
    // manual o un sync a medias— para que quede claro que el cero es una
    // DECISIÓN y no la casualidad de que no haya filas. Un refactor que
    // "unifique" esto con getGames y empiece a sumar cambiaría la pantalla
    // entera del Plan.
    const { gameId, iterationId } = await planned('Hades II');
    await db
      .update(gamesTable)
      .set({ executablePath: 'C:/Games/Hades2.exe' })
      .where(eq(gamesTable.id, gameId));
    await makeSession(db, iterationId, '2026-04-01T20:00:00Z', 3);

    const [game] = await getPlannedGames();
    assert.equal(game.totalHours, 0);
    assert.equal(game.sessionCount, 0);
    assert.equal(game.currentState, 'plan_to_play');
    assert.equal(game.lastPlayedAt, null);
    assert.equal(game.isLive, false);
    // Y sin exe que lanzar aunque la columna traiga uno: el botón Play del
    // modo TV no debe encontrar nada que arrancar en un juego del Plan.
    assert.equal(game.executablePath, null);
  });

  it('el reparto en dos canales: lo gordo viaja en extras y cada id del escueto tiene su fila allí', async () => {
    // El contrato del payload (segunda oleada de rendimiento): la lista
    // escueta es lo que pagan TODOS los consumidores en cada 'games:changed'
    // (354 KB de 661 filas contra los 928 del canal único viejo, medidos con
    // JSON.stringify sobre la biblioteca real), así que los campos que solo
    // mira la pantalla del Plan viajan aparte — y el cruce por id que hace el
    // renderer (usePlannedGamesWithExtras) cuenta con que ambas queries
    // comparten el mismo WHERE planned=true.
    const { gameId } = await planned('Silksong', { note: 'Me lo recomendó Dani' });
    await db
      .update(gamesTable)
      .set({
        heroUrl: 'https://heroes/silksong.jpg',
        summary: 'Hornet vuelve a un reino que no la esperaba.',
        steamTags: [{ name: 'Metroidvania', votes: 100 }],
      })
      .where(eq(gamesTable.id, gameId));

    // heroUrl SIEMPRE null en el canal escueto aunque la columna tenga valor:
    // ningún consumidor escueto lo pinta (GameListItem solo lo exige por
    // forma, ver getPlannedGames.ts) y eran 47 KB del payload viejo.
    const [game] = await getPlannedGames();
    assert.equal(game.heroUrl, null);
    // Y los campos gordos ni siquiera existen en la fila escueta: si alguien
    // los devuelve a este canal, que sea a sabiendas y con su medida.
    assert.equal('summary' in game, false);
    assert.equal('steamTags' in game, false);

    const extras = await getPlannedGameExtras();
    assert.equal(extras.length, 1);
    assert.equal(extras[0].id, gameId);
    assert.equal(extras[0].heroUrl, 'https://heroes/silksong.jpg');
    assert.equal(extras[0].summary, 'Hornet vuelve a un reino que no la esperaba.');
    assert.deepEqual(extras[0].steamTags, [{ name: 'Metroidvania', votes: 100 }]);
    assert.equal(extras[0].planNote, 'Me lo recomendó Dani');
  });
});

// ══ UP NEXT: FIJAR Y SOLTAR ════════════════════════════════════════════════

describe('Up next: fijar y soltar', () => {
  it('fijar pone marca y soltar la quita', async () => {
    const { gameId } = await planned('Silksong');

    assert.equal(await setPlanPinned(gameId, true), true);
    assert.notEqual(await pinnedAtOf(gameId), null);

    assert.equal(await setPlanPinned(gameId, false), true);
    assert.equal(await pinnedAtOf(gameId), null);
  });

  it('volver a fijar te manda al final de la estantería', async () => {
    // La regla que justifica que esto sea una función propia y no un
    // updateGame: el orden de Up next ES la fecha de fijado, así que soltar y
    // volver a fijar tiene que dar una marca NUEVA. Si alguien "optimiza"
    // conservando la anterior, el juego reaparece donde estaba y el gesto de
    // reordenar por la vía manual (soltar y refijar) deja de funcionar.
    //
    // La marca vieja es del año 2000 a propósito: así la comparación no
    // depende del reloj de la máquina más allá de lo obvio.
    const { gameId } = await planned('Silksong');
    const ancient = new Date('2000-01-01T00:00:00Z');
    await db.update(gamesTable).set({ planPinnedAt: ancient }).where(eq(gamesTable.id, gameId));

    await setPlanPinned(gameId, false);
    await setPlanPinned(gameId, true);

    const stamp = await pinnedAtOf(gameId);
    assert.notEqual(stamp, null);
    assert.ok((stamp as Date).getTime() > ancient.getTime());
  });

  it('un juego que ya no está planeado no se puede fijar ni soltar: devuelve false y no se toca su fila', async () => {
    // El `false` es CONTRATO, no cortesía: el buzón del móvil (drainMailbox)
    // lo convierte en "esta orden no hizo nada" y la deja registrada como
    // fallida. Si esto devolviera true, una orden de fijar un juego que
    // promocionaste desde el PC se daría por aplicada sin haber tocado nada.
    const promotedId = await makeGame(db, {
      title: 'Celeste',
      planned: false,
      planPinnedAt: new Date('2026-03-01T10:00:00Z'),
    });

    assert.equal(await setPlanPinned(promotedId, true), false);
    assert.equal(await setPlanPinned(promotedId, false), false);
    // Y ni siquiera le limpió la marca que le quedaba: el `and(planned)` del
    // where acota el UPDATE entero, no solo el valor devuelto.
    assert.deepEqual(await pinnedAtOf(promotedId), new Date('2026-03-01T10:00:00Z'));

    // Un id que no existe (borrado entre el gesto del móvil y el drenado)
    // tampoco lanza: devuelve false por el mismo camino.
    assert.equal(await setPlanPinned(9999, true), false);
  });
});

// ══ UP NEXT: REORDENAR ARRASTRANDO ═════════════════════════════════════════

const T1 = new Date('2026-03-01T10:00:00.000Z');
const T2 = new Date('2026-03-02T10:00:00.000Z');
const T3 = new Date('2026-03-03T10:00:00.000Z');

describe('Up next: reordenar arrastrando', () => {
  it('reparte las marcas que YA existen: las mismas fechas, en el orden nuevo', async () => {
    // El corazón del diseño: reordenar NO inventa fechas ni empuja nada hacia
    // el futuro, REPARTE el puñado de marcas que ya había. Por eso la columna
    // sigue sincronizando por Turso sin sorpresas y el móvil hereda el orden.
    // Un refactor que use new Date() para el primero (o Date.now() + índice)
    // pasaría el test del ORDEN y rompería este del multiset.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const beta = await planned('Beta', { pinnedAt: T2.toISOString() });
    const cosmo = await planned('Cosmo', { pinnedAt: T3.toISOString() });

    assert.equal(await reorderUpNext([cosmo.gameId, alpha.gameId, beta.gameId]), true);

    assert.deepEqual(
      [
        await pinnedAtOf(cosmo.gameId),
        await pinnedAtOf(alpha.gameId),
        await pinnedAtOf(beta.gameId),
      ],
      [T1, T2, T3],
    );
    // Y la estantería, vista como la pinta la pantalla, quedó como se soltó.
    assert.deepEqual(await upNextTitles(), ['Cosmo', 'Alpha', 'Beta']);
  });

  it('dos fijados en el mismo milisegundo se separan por uno, para que el orden arrastrado no se deshaga al pintarlo', async () => {
    // Fijar dos juegos seguidos muy rápido deja dos planPinnedAt idénticos.
    // Si el reparto los dejara empatados, el desempate por título de la
    // pantalla (splitPlanSections) mandaría, y la fila volvería sola al sitio
    // del que la acabas de sacar: el gesto se deshace delante de tus ojos.
    // De ahí el +1ms estrictamente creciente.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const beta = await planned('Beta', { pinnedAt: T1.toISOString() });
    const cosmo = await planned('Cosmo', { pinnedAt: T1.toISOString() });

    assert.equal(await reorderUpNext([cosmo.gameId, beta.gameId, alpha.gameId]), true);

    assert.deepEqual(
      [
        await pinnedAtOf(cosmo.gameId),
        await pinnedAtOf(beta.gameId),
        await pinnedAtOf(alpha.gameId),
      ],
      [T1, new Date(T1.getTime() + 1), new Date(T1.getTime() + 2)],
    );
    // El orden alfabético sería justo el contrario: si esto pasa, es porque
    // las marcas mandan de verdad.
    assert.deepEqual(await upNextTitles(), ['Cosmo', 'Beta', 'Alpha']);
  });

  it('con menos de dos fijados no hay nada que repartir: devuelve false y no toca nada', async () => {
    // Con una sola marca el reparto sería la identidad, y devolver true haría
    // que el buzón del móvil diera por buena una orden que no cambió nada.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const suelto = await planned('Beta');

    assert.equal(await reorderUpNext([]), false);
    assert.equal(await reorderUpNext([alpha.gameId]), false);
    // Dos ids, pero uno ya no está fijado (lo soltaste desde el móvil entre
    // el arrastre y el commit): se cae del reparto y quedan menos de dos.
    assert.equal(await reorderUpNext([alpha.gameId, suelto.gameId]), false);

    assert.deepEqual(await pinnedAtOf(alpha.gameId), T1);
    assert.equal(await pinnedAtOf(suelto.gameId), null);
  });

  it('los ids desconocidos se ignoran en vez de reventar el gesto entero', async () => {
    // Entre que sueltas la fila y llega el UPDATE puede pasar cualquier cosa
    // (un unpin o un borrado desde otra máquina, vía sync). Tirar el gesto
    // entero por un id fantasma sería castigar al usuario por un cambio que
    // no hizo él.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const beta = await planned('Beta', { pinnedAt: T2.toISOString() });

    assert.equal(await reorderUpNext([beta.gameId, 9999, alpha.gameId]), true);
    assert.deepEqual(await upNextTitles(), ['Beta', 'Alpha']);
  });

  it('un juego que ya no está en el Plan no entra en el reparto aunque conserve su marca', async () => {
    // Mismo acotado por `planned = true` que setPlanPinned. Un juego
    // promocionado con la marca puesta (fila legacy, o un sync a medias) no
    // puede colarse en Up next ni robarle una fecha a los que sí están.
    const ghostId = await makeGame(db, {
      title: 'Ghost',
      planned: false,
      planPinnedAt: T3,
    });
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const beta = await planned('Beta', { pinnedAt: T2.toISOString() });

    assert.equal(await reorderUpNext([ghostId, beta.gameId, alpha.gameId]), true);

    assert.deepEqual(await pinnedAtOf(ghostId), T3);
    assert.deepEqual(await pinnedAtOf(beta.gameId), T1);
    assert.deepEqual(await pinnedAtOf(alpha.gameId), T2);
  });

  it('a los fijados que no le mandaste no los toca', async () => {
    // Reordenar un trozo de la estantería reparte SOLO las marcas de ese
    // trozo. Lo contrario —recolocar a todos los fijados— movería juegos que
    // el usuario ni ha tocado en un gesto que solo afectaba a dos filas.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const beta = await planned('Beta', { pinnedAt: T2.toISOString() });
    const cosmo = await planned('Cosmo', { pinnedAt: T3.toISOString() });

    assert.equal(await reorderUpNext([cosmo.gameId, alpha.gameId]), true);

    assert.deepEqual(await pinnedAtOf(cosmo.gameId), T1);
    assert.deepEqual(await pinnedAtOf(alpha.gameId), T3);
    assert.deepEqual(await pinnedAtOf(beta.gameId), T2);
  });

  it('un id repetido no finge una estantería de dos: devuelve false y no mueve la marca', async () => {
    // ARREGLADO. El filtro conservaba los repetidos, así que [A, A] con UN
    // solo juego fijado medía 2, pasaba el guardián de "menos de dos", le
    // corría la marca +1ms y devolvía true. Ese true es CONTRATO: el buzón del
    // móvil lo convierte en "orden aplicada" (drainMailbox.ts:242-246), de
    // modo que una orden malformada se archivaba como buena sin haber
    // reordenado nada — y encima con la fecha del único fijado movida.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });

    assert.equal(await reorderUpNext([alpha.gameId, alpha.gameId]), false);
    assert.deepEqual(await pinnedAtOf(alpha.gameId), T1);
  });

  it('un id repetido dentro de un reorden de verdad no le roba sitio a nadie', async () => {
    // El borde contrario: la deduplicación no puede cargarse un gesto válido.
    // Con dos fijados y un id duplicado, se reparte entre los DOS juegos que
    // hay (no entre tres puestos), y vale la PRIMERA aparición del repetido —
    // que es donde el usuario soltó la fila.
    const alpha = await planned('Alpha', { pinnedAt: T1.toISOString() });
    const beta = await planned('Beta', { pinnedAt: T2.toISOString() });

    assert.equal(await reorderUpNext([beta.gameId, alpha.gameId, beta.gameId]), true);

    assert.deepEqual(await pinnedAtOf(beta.gameId), T1);
    assert.deepEqual(await pinnedAtOf(alpha.gameId), T2);
    assert.deepEqual(await upNextTitles(), ['Beta', 'Alpha']);
  });
});

// ══ PASAR UN PLANEADO A LA BIBLIOTECA ══════════════════════════════════════

describe('pasar un planeado a la biblioteca', () => {
  it('conserva el id, la iteración y el historial: el porqué de haberlo planeado sigue ahí', async () => {
    // La decisión de diseño entera de promotePlannedGame: se ACTUALIZA en vez
    // de borrar y recrear. Si alguien lo reescribe como delete + create, el
    // id cambia (y con él las referencias de sesiones, logros y backups) y el
    // 'plan_to_play' se pierde — con él, la fecha en la que el juego entró en
    // Afterplay y la nota de por qué lo apuntaste.
    const { gameId, iterationId } = await planned('Silksong', {
      note: 'Me lo recomendó Dani',
      plannedAt: '2026-01-02T12:00:00Z',
    });

    const game = await promotePlannedGame(
      promoteInput(gameId, {
        iteration: { playedPlatform: 'Nintendo Switch', origin: 'Gift', format: 'physical' },
        hoursPlayed: 4.5,
      }),
    );

    assert.equal(game.id, gameId);
    assert.equal(game.planned, false);

    // La MISMA iteración, rellenada con el playthrough de verdad. Que no nazca
    // una segunda es lo que impide que el juego acabe con dos playthroughs
    // activos y el evento del plan colgando de uno huérfano.
    const iterations = await readIterations(gameId);
    assert.equal(iterations.length, 1);
    assert.equal(iterations[0].id, iterationId);
    assert.deepEqual(
      [iterations[0].playedPlatform, iterations[0].origin, iterations[0].format],
      ['Nintendo Switch', 'Gift', 'physical'],
    );
    assert.equal(iterations[0].manualTotalPlayed, 4.5);

    const events = await readEvents(gameId);
    assert.deepEqual(
      events.map((event) => [event.type, event.note]),
      [['plan_to_play', 'Me lo recomendó Dani']],
    );
    assert.deepEqual(events[0].occurredAt, new Date('2026-01-02T12:00:00Z'));
  });

  it('el pin de Up next se limpia al promocionar', async () => {
    // §2.2, y una cicatriz literal: sin esto el juego se iba a la biblioteca
    // con su fecha de fijado puesta — invisible allí, pero lista para
    // reaparecer arriba del Plan si el juego volviera a planearse alguna vez.
    const { gameId } = await planned('Silksong', { pinnedAt: T1.toISOString() });

    await promotePlannedGame(promoteInput(gameId));

    assert.equal(await pinnedAtOf(gameId), null);
    // Y cambia de lista: fuera del Plan, dentro de la biblioteca.
    assert.deepEqual(await getPlannedGames(), []);
    assert.deepEqual(
      (await getGames()).map((game) => game.title),
      ['Silksong'],
    );
  });

  it('SPEC 4.5: un estado terminal estrena "started" por delante', async () => {
    // El juego que planeaste y que resulta que ya te habías pasado: el log no
    // puede empezar por "Completado" sin haber pasado nunca por "Jugando", o
    // el Journey de la ficha cuenta una historia que no ocurrió. El orden es
    // el de ESCRITURA (por id): las dos fechas pueden coincidir y entonces
    // ordenar por occurredAt no distinguiría nada.
    const { gameId } = await planned('Silksong', { note: 'Lo apunté antes de jugarlo' });

    await promotePlannedGame(
      promoteInput(gameId, {
        initialStatus: 'completed',
        started: { date: new Date('2026-01-05T00:00:00Z'), precision: 'day' },
        finished: { date: new Date('2026-02-10T00:00:00Z'), precision: 'day' },
        note: 'Final verdadero a la segunda',
      }),
    );

    const events = await readEvents(gameId);
    assert.deepEqual(
      events.map((event) => [event.type, event.occurredAt, event.note]),
      [
        ['plan_to_play', new Date('2026-01-02T12:00:00Z'), 'Lo apunté antes de jugarlo'],
        ['started', new Date('2026-01-05T00:00:00Z'), null],
        // La nota del modal va en el estado ELEGIDO, no en el 'started' que se
        // fabrica por delante.
        ['completed', new Date('2026-02-10T00:00:00Z'), 'Final verdadero a la segunda'],
      ],
    );
    // Modelo v2: las fechas del playthrough SON los eventos. Ni una sesión
    // marcadora de borde, que es como se hacía antes.
    assert.deepEqual((await countRows(gameId)).sessions, 0);
  });

  it('sin estado inicial no se estrena historial (y el gasto solo se apunta si lo hubo)', async () => {
    // Promocionar un juego que aún no has tocado (Unplayed) no debe inventar
    // ningún evento: el Plan pasa a biblioteca y punto.
    const { gameId } = await planned('Silksong');

    await promotePlannedGame(promoteInput(gameId, { initialStatus: null }));

    assert.deepEqual(
      (await readEvents(gameId)).map((event) => event.type),
      ['plan_to_play'],
    );
    assert.deepEqual(await countRows(gameId), { sessions: 0, spend: 0 });
  });

  it('el gasto inicial se apunta con su fecha y su precisión', async () => {
    const { gameId } = await planned('Silksong');

    await promotePlannedGame(
      promoteInput(gameId, {
        moneySpent: 19.99,
        moneySpentDate: { date: new Date('2026-06-01T00:00:00Z'), precision: 'month' },
      }),
    );

    const [spend] = await db
      .select({
        amount: spendEventsTable.amount,
        type: spendEventsTable.type,
        occurredAt: spendEventsTable.occurredAt,
        datePrecision: spendEventsTable.datePrecision,
      })
      .from(spendEventsTable)
      .where(eq(spendEventsTable.gameId, gameId));
    assert.deepEqual(
      [spend.type, spend.amount, spend.occurredAt, spend.datePrecision],
      ['purchase', 19.99, new Date('2026-06-01T00:00:00Z'), 'month'],
    );
  });

  it('el arte elegido al planear sobrevive a la promoción si el modal no elige otro', async () => {
    // null significa "sin elección propia en el picker", NO "bórralo". El
    // juego lleva su carátula desde que lo planeaste (a veces elegida a mano),
    // y pisarla con null al promocionar sería perder trabajo hecho.
    const { gameId } = await planned('Silksong');
    await db
      .update(gamesTable)
      .set({ coverUrl: 'cover-del-plan', heroUrl: 'hero-del-plan', steamGridDbId: 5555 })
      .where(eq(gamesTable.id, gameId));

    await promotePlannedGame(
      promoteInput(gameId, { coverUrl: null, heroUrl: null, steamGridDbId: null }),
    );
    let row = await readGame(gameId);
    assert.deepEqual(
      [row.coverUrl, row.heroUrl, row.steamGridDbId],
      ['cover-del-plan', 'hero-del-plan', 5555],
    );

    // Y con elección propia sí manda el modal (el mismo juego, ya en la
    // biblioteca, se vuelve a planear a mano para poder repetir la promoción).
    await db.update(gamesTable).set({ planned: true }).where(eq(gamesTable.id, gameId));
    await promotePlannedGame(
      promoteInput(gameId, {
        coverUrl: 'cover-elegida',
        heroUrl: 'hero-elegida',
        steamGridDbId: 77,
      }),
    );
    row = await readGame(gameId);
    assert.deepEqual(
      [row.coverUrl, row.heroUrl, row.steamGridDbId],
      ['cover-elegida', 'hero-elegida', 77],
    );
  });

  it('las notas del planeado sobreviven a la promoción igual que el arte, y el modal las pisa si trae otras', async () => {
    // ARREGLADO: era una asimetría dentro del mismo `set`. coverUrl, heroUrl y
    // steamGridDbId estaban protegidos contra el null ("sin elección propia")
    // y `notes` se escribía siempre, así que un gameNotes null borraba lo que
    // escribiste al planear el juego. No se notaba desde el escritorio solo
    // porque el modal se abre prellenado con esas notas (AddGameModal.tsx:228)
    // — o sea, la salvaguarda vivía en un componente del renderer y cualquier
    // otro camino de promoción (el móvil, drainMailbox manda gameNotes: null,
    // un script) borraba en silencio.
    const { gameId } = await planned('Silksong');
    await db
      .update(gamesTable)
      .set({ notes: 'Comprarlo en físico si sale edición' })
      .where(eq(gamesTable.id, gameId));

    await promotePlannedGame(promoteInput(gameId, { gameNotes: null }));
    assert.equal((await readGame(gameId)).notes, 'Comprarlo en físico si sale edición');

    // Y con notas propias sí manda el modal: conservar no es congelar. (El
    // mismo juego se vuelve a planear a mano para repetir la promoción.)
    await db.update(gamesTable).set({ planned: true }).where(eq(gamesTable.id, gameId));
    await promotePlannedGame(promoteInput(gameId, { gameNotes: 'Al final, digital' }));
    assert.equal((await readGame(gameId)).notes, 'Al final, digital');

    // Vaciarlas a propósito sigue siendo posible: la cadena vacía SÍ se
    // escribe, porque solo el null significa "no traigo elección". Lo que no
    // puede pasar es que una promoción muda borre trabajo hecho.
    await db.update(gamesTable).set({ planned: true }).where(eq(gamesTable.id, gameId));
    await promotePlannedGame(promoteInput(gameId, { gameNotes: '' }));
    assert.equal((await readGame(gameId)).notes, '');
  });

  it('promocionar dos veces no cuela, y el intento no deja nada a medias', async () => {
    // El guardián de "ya no está en Plan to Play" evita el estropicio de
    // verdad: writeInitialPlaythrough volvería a escribir el log inicial
    // entero sobre un juego que ya lo tiene, duplicando el 'started' y el
    // estado terminal (y el gasto). Al lanzar DENTRO de la transacción, el
    // segundo intento no deja ni una fila.
    const { gameId } = await planned('Silksong');
    await promotePlannedGame(
      promoteInput(gameId, {
        initialStatus: 'started',
        started: { date: new Date('2026-01-05T00:00:00Z'), precision: 'day' },
        moneySpent: 19.99,
        moneySpentDate: { date: new Date('2026-01-05T00:00:00Z'), precision: 'day' },
      }),
    );

    await assert.rejects(() => promotePlannedGame(promoteInput(gameId)), /no está en Plan to Play/);

    assert.deepEqual(
      (await readEvents(gameId)).map((event) => event.type),
      ['plan_to_play', 'started'],
    );
    assert.deepEqual(await countRows(gameId), { sessions: 0, spend: 1 });
    assert.equal((await readIterations(gameId)).length, 1);

    // Y un juego que ya no existe (borrado desde otra pantalla) tampoco pasa
    // por un fallo de motor: mensaje propio y nada escrito.
    await assert.rejects(() => promotePlannedGame(promoteInput(9999)), /No existe el juego 9999/);
  });

  it('promocionar no cambia la fecha de entrada en Afterplay', async () => {
    // `addedAt` es cuándo el juego entró en la app, no cuándo empezaste a
    // jugarlo: de él salen la píldora "esperando 8 meses" del Plan y la lente
    // "Longest waiting". Sellarlo de nuevo al promocionar borraría la espera
    // entera de un juego que llevaba dos años apuntado.
    const gameId = await makeGame(db, {
      title: 'Silksong',
      planned: true,
      addedAt: new Date('2024-06-01T00:00:00Z'),
    });
    await makeIteration(db, gameId);

    await promotePlannedGame(promoteInput(gameId));

    assert.deepEqual((await readGame(gameId)).addedAt, new Date('2024-06-01T00:00:00Z'));
  });
});
