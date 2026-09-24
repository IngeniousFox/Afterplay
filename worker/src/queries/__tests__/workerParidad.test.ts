import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  achievementsTable,
  achievementUnlocksTable,
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../../../src/main/db/schema';
import type { TenantDb } from '../../db';
import { getGameAchievements } from '../achievements';
import { listLibrary, listPlanned } from '../library';

// LAS TRES REGLAS QUE EL MÓVIL SE HABÍA QUEDADO A MEDIAS, contra una base de
// verdad. Ninguna se ve hoy en una pantalla rota: son cifras y formas que
// divergen en silencio del escritorio, que es la peor manera de romperse.
//
//   · "última vez jugado": el escritorio se queda con el MÁXIMO de (última
//     sesión, último evento con fecha propia) y aquí bastaba una sesión para
//     que el log dejara de mirarse.
//   · el fundido multi-fuente de logros: estaba reescrito a mano, término a
//     término, en vez de importar la regla compartida.
//   · /api/plan: la forma de la respuesta se declaraba a mano en vez de ser el
//     PlannedGame del contrato, y el `...row` colaba un campo de más.
//
// Montaje: el MISMO de workerQueries.test.ts (fichero temporal + migraciones
// reales del repo, sin mock.module — el Worker recibe su `db` por parámetro).
// Va en su propio fichero y no dentro de aquél para no pelearse con él: son
// oleadas distintas tocando la misma carpeta.

const dirs: string[] = [];

// Se resuelve desde ESTE fichero y no desde el cwd: lanzarlo suelto desde otra
// carpeta dejaría las migraciones apuntando a la nada, y el fallo sería "no
// such table" en el primer test en vez de "no encuentro las migraciones".
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(HERE, '..', '..', '..', '..', 'drizzle');

// Cada test abre su cliente y CIERRA el anterior: dejando abiertos los de todos
// los tests, el proceso se cae al salir con una violación de acceso del binario
// nativo — con todo en verde, que es el peor rojo posible.
let openClient: Client | null = null;

const freshDb = async (): Promise<TenantDb> => {
  openClient?.close();
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-worker-paridad-'));
  dirs.push(dir);
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  openClient = client;
  const database = drizzle({ client });
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  return database as unknown as TenantDb;
};

after(() => {
  openClient?.close();
  openClient = null;
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows puede tener el fichero tomado todavía; da igual, es tmp.
    }
  }
  dirs.length = 0;
});

let db: TenantDb;
beforeEach(async () => {
  db = await freshDb();
});

const HOUR_MS = 3_600_000;

// El alta va MUY lejos de las fechas de los eventos a propósito: el respaldo por
// eventos descarta los que caen pegados a `addedAt` (isAddedAtArtifact), que son
// los que escribe el propio alta y no dicen cuándo jugaste, sino cuándo lo
// apuntaste.
const ADDED_AT = new Date('2020-01-01T00:00:00Z');

const makeGame = async (
  overrides: Partial<typeof gamesTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(gamesTable)
    .values({ title: 'Juego de prueba', planned: false, addedAt: ADDED_AT, ...overrides })
    .returning({ id: gamesTable.id });
  return row.id;
};

const makeIteration = async (gameId: number): Promise<number> => {
  const [row] = await db
    .insert(iterationsTable)
    .values({ gameId, label: 'Playthrough 1', playedPlatform: 'PC', origin: 'steam' })
    .returning({ id: iterationsTable.id });
  return row.id;
};

const makeSession = async (
  iterationId: number,
  startedAt: string,
  hours: number,
): Promise<void> => {
  const start = new Date(startedAt);
  await db.insert(sessionsTable).values({
    iterationId,
    isManual: false,
    startedAt: start,
    endedAt: new Date(start.getTime() + hours * HOUR_MS),
    durationSec: Math.round(hours * 3600),
    datePrecision: 'datetime',
  });
};

const makeStateEvent = async (
  iterationId: number,
  type: typeof stateEventsTable.$inferInsert.type,
  occurredAt: string,
): Promise<void> => {
  await db.insert(stateEventsTable).values({
    iterationId,
    type,
    occurredAt: new Date(occurredAt),
    datePrecision: 'datetime',
  });
};

const makeAchievement = async (gameId: number, apiName: string): Promise<number> => {
  const [row] = await db
    .insert(achievementsTable)
    .values({ gameId, apiName, displayName: apiName, sortIndex: 0 })
    .returning({ id: achievementsTable.id });
  return row.id;
};

const makeUnlock = async (
  achievementId: number,
  source: 'steam' | 'emu' | 'ra',
  unlockedAt: string,
  dateReliable: boolean,
): Promise<void> => {
  await db
    .insert(achievementUnlocksTable)
    .values({ achievementId, source, unlockedAt: new Date(unlockedAt), dateReliable });
};

// ══ "ÚLTIMA VEZ JUGADO" ════════════════════════════════════════════════════

describe('biblioteca: "última vez" es la más reciente de las DOS fuentes', () => {
  it('un juego trackeado en enero y completado en junio se fecha en JUNIO', async () => {
    // LA CICATRIZ, y era exactamente la del escritorio: trackeas el juego en el
    // PC en enero, lo terminas en la consola y lo marcas completado con fecha de
    // junio. Aquí había un `if (lastPlayedByGame.has(gameId)) continue;`, así que
    // con UNA sola sesión el log dejaba de mirarse y la biblioteca del móvil lo
    // ordenaba por enero — por debajo de juegos que tocaste menos — mientras la
    // del PC lo ordenaba por junio.
    const gameId = await makeGame({ title: 'Elden Ring' });
    const iterationId = await makeIteration(gameId);
    await makeSession(iterationId, '2026-01-10T18:00:00Z', 2);
    await makeStateEvent(iterationId, 'completed', '2026-06-01T20:00:00Z');

    const [game] = await listLibrary(db);
    assert.equal(game.lastPlayedAt, new Date('2026-06-01T20:00:00Z').getTime());
  });

  it('si la sesión es POSTERIOR al evento, manda la sesión', async () => {
    // La otra mitad del máximo. Marcas "on hold" en marzo y sigues jugando en
    // agosto: la respuesta a "¿cuándo lo toqué por última vez?" es agosto, y
    // quedarse con el evento sería el bug simétrico del que había.
    const gameId = await makeGame({ title: 'Hades' });
    const iterationId = await makeIteration(gameId);
    await makeStateEvent(iterationId, 'on_hold', '2026-03-01T10:00:00Z');
    await makeSession(iterationId, '2026-08-20T18:00:00Z', 1);

    const [game] = await listLibrary(db);
    assert.equal(
      game.lastPlayedAt,
      new Date('2026-08-20T18:00:00Z').getTime() + HOUR_MS,
      'debería ser el FIN de la sesión, no su arranque',
    );
  });

  it('planear no es jugar, y el evento del alta tampoco cuenta', async () => {
    // Las dos fuentes tienen que llegar limpias a la comparación: un
    // 'plan_to_play' posterior no puede adelantar la fecha (planear no es
    // jugar), y el evento que escribe el propio alta —el que hereda la hora de
    // addedAt— convertiría "los últimos que jugué" en "los últimos que añadí".
    const gameId = await makeGame({
      title: 'Celeste',
      addedAt: new Date('2026-09-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(gameId);
    await makeSession(iterationId, '2026-02-05T18:00:00Z', 3);
    await makeStateEvent(iterationId, 'plan_to_play', '2026-10-01T10:00:00Z');
    // Pegado al alta: es el artefacto que deja writeInitialPlaythrough.
    await makeStateEvent(iterationId, 'completed', '2026-09-01T09:00:00Z');

    const [game] = await listLibrary(db);
    assert.equal(
      game.lastPlayedAt,
      new Date('2026-02-05T18:00:00Z').getTime() + 3 * HOUR_MS,
      'se coló una fecha que nadie escribió como "jugado"',
    );
  });

  it('sin sesiones ni eventos con fecha propia, "última vez" es null', async () => {
    // "No lo sé" se dice con null y se va al final de la lista, en vez de
    // inventarse una fecha.
    const gameId = await makeGame({ title: 'Sin tocar' });
    await makeIteration(gameId);

    const [game] = await listLibrary(db);
    assert.equal(game.lastPlayedAt, null);
  });
});

// ══ EL FUNDIDO DE LOGROS ═══════════════════════════════════════════════════

describe('logros: el desempate multi-fuente es el compartido, no una copia', () => {
  it('una fecha fiable gana a una que no, aunque sea POSTERIOR', async () => {
    // El caso real: tienes el logro por el arrastre masivo del crack (fecha
    // inventada de hoy, no fiable) y también por Steam con la de verdad. Gana la
    // de Steam aunque sea posterior — y las dos fuentes se enumeran, porque las
    // dos pasaron.
    const gameId = await makeGame({ title: 'Hollow Knight' });
    const achievementId = await makeAchievement(gameId, 'DREAM_FK');
    await makeUnlock(achievementId, 'emu', '2024-01-01T00:00:00Z', false);
    await makeUnlock(achievementId, 'steam', '2026-05-05T12:00:00Z', true);

    const { entries } = await getGameAchievements(db, gameId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].unlockedAt, new Date('2026-05-05T12:00:00Z').getTime());
    assert.equal(entries[0].dateReliable, true);
    assert.deepEqual(entries[0].sources.slice().sort(), ['emu', 'steam']);
  });

  it('empatadas en fiabilidad, manda la MÁS TEMPRANA', async () => {
    // La pregunta que responde la ficha es "¿cuándo hiciste esto por primera
    // vez?", y esa respuesta no cambia porque después lo compraras en Steam.
    const gameId = await makeGame({ title: 'Celeste' });
    const achievementId = await makeAchievement(gameId, 'SUMMIT');
    await makeUnlock(achievementId, 'steam', '2026-04-04T12:00:00Z', true);
    await makeUnlock(achievementId, 'emu', '2023-02-02T12:00:00Z', true);

    const { entries } = await getGameAchievements(db, gameId);
    assert.equal(entries[0].unlockedAt, new Date('2023-02-02T12:00:00Z').getTime());
  });

  it('un logro sin desbloquear no finge fecha ni fuentes', async () => {
    const gameId = await makeGame({ title: 'Tunic' });
    await makeAchievement(gameId, 'PENDIENTE');

    const { entries } = await getGameAchievements(db, gameId);
    assert.equal(entries[0].unlockedAt, null);
    assert.deepEqual(entries[0].sources, []);
    // `true` y no `false`: no hay fecha que sea poco de fiar, simplemente no hay
    // fecha. Marcarlo como dudoso pintaría el aviso en un logro pendiente.
    assert.equal(entries[0].dateReliable, true);
  });
});

// ══ LA FORMA DE /api/plan ══════════════════════════════════════════════════

describe('plan: la respuesta es el PlannedGame del contrato, ni un campo más', () => {
  it('usa la primera fecha registrada en el Plan tras venir de Library', async () => {
    const gameId = await makeGame({ title: 'Vuelve al Plan', planned: true });
    const iterationId = await makeIteration(gameId);
    await makeStateEvent(iterationId, 'plan_to_play', '2025-05-01T09:00:00Z');
    await makeStateEvent(iterationId, 'plan_to_play', '2024-01-01T00:00:00Z');

    const [game] = await listPlanned(db);
    assert.equal(game.addedAt, new Date('2025-05-01T09:00:00Z').getTime());
    const [stored] = await db
      .select({ addedAt: gamesTable.addedAt })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId));
    assert.deepEqual(stored.addedAt, ADDED_AT);
  });

  it('el pin sale como pinnedAt y planPinnedAt NO viaja', async () => {
    // El `...row` de antes filtraba al JSON la columna `planPinnedAt`, que el
    // contrato no declara: la respuesta ya no era el objeto que decía ser, y la
    // PWA la castea a ciegas.
    const pinnedAt = new Date('2026-01-10T10:00:00Z');
    await makeGame({
      title: 'Silksong',
      planned: true,
      planPinnedAt: pinnedAt,
      hltbMain: 12,
      releaseDate: new Date('2026-09-10T00:00:00Z'),
      releaseDatePrecision: 'day',
    });

    const [game] = await listPlanned(db);
    assert.equal(game.pinnedAt, pinnedAt.getTime());
    assert.ok(!('planPinnedAt' in game), 'planPinnedAt se coló en la respuesta');
    // Las fechas viajan como epoch en milisegundos, nunca como Date ni ISO
    // (api-types.ts): un JSON.parse no reconstruye un Date.
    assert.equal(typeof game.addedAt, 'number');
    assert.equal(game.releaseDate, new Date('2026-09-10T00:00:00Z').getTime());
    assert.equal(game.releaseDatePrecision, 'day');
  });

  it('los campos del contrato están TODOS, y los que faltan salen null', async () => {
    // Un planeado recién apuntado casi no tiene datos. Lo que importa es que la
    // forma esté completa: la PWA lee estas claves sin comprobar nada.
    await makeGame({ title: 'Apuntado y ya', planned: true });

    const [game] = await listPlanned(db);
    assert.deepEqual(Object.keys(game).slice().sort(), [
      'addedAt',
      'coverUrl',
      'endless',
      'genres',
      'hltbMain',
      'id',
      'pinnedAt',
      'ratingCritics',
      'ratingCriticsCount',
      'ratingUsers',
      'ratingUsersCount',
      'releaseDate',
      'releaseDatePrecision',
      'releaseYear',
      'steamNegative',
      'steamPositive',
      'title',
    ]);
    assert.equal(game.pinnedAt, null);
    assert.equal(game.releaseDate, null);
  });

  it('la biblioteca no ve a los planeados y el plan no ve a los demás', async () => {
    await makeGame({ title: 'En la biblioteca', planned: false });
    await makeGame({ title: 'En el plan', planned: true });

    assert.deepEqual(
      (await listLibrary(db)).map((game) => game.title),
      ['En la biblioteca'],
    );
    assert.deepEqual(
      (await listPlanned(db)).map((game) => game.title),
      ['En el plan'],
    );
  });
});
