import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  achievementsTable,
  achievementUnlocksTable,
  emulatorsTable,
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../schema';

// EL ANDAMIO DE LOS TESTS DE BASE DE DATOS.
//
// Monta una base de datos DE VERDAD —fichero temporal nuevo, esquema real aplicado
// con las migraciones reales del repo— y la enchufa al `getDb()` que usan las
// consultas de producción. A partir de ahí los tests llaman a las funciones
// reales (getGames, resolveIterationForPlay, closeSession…) y comprueban lo
// que sale, sin dobles de por medio.
//
// POR QUÉ ASÍ Y NO CON MOCKS DE DRIZZLE: lo que más se rompe en un refactor
// de esta app no son las funciones sueltas, es la DERIVACIÓN — el estado, las
// horas y las fechas de un juego no se guardan, se calculan al leer desde el
// log de eventos y las sesiones. Un mock del ORM comprueba que la consulta se
// escribió como estaba escrita; una base real comprueba que el RESULTADO es
// el correcto, que es lo único que le importa a quien mira la pantalla. Ese
// es justo el fallo que un refactor introduce y que un mock deja pasar.
//
// POR QUÉ @libsql/client Y NO EL DRIVER DE PRODUCCIÓN: `@tursodatabase/sync`
// no carga bajo tsx (una dependencia suya no declara `exports`, y el runner
// muere al importarla). Debajo los dos son el mismo SQLite y el mismo esquema
// de drizzle, así que las consultas se comportan igual — lo que este andamio
// NO puede probar es el sync en sí (captura de cambios, pull/push), que vive
// en db/index.ts y necesita a Turso al otro lado.
//
// ORDEN DE CARGA, que es lo delicado: `mock.module` tiene que correr ANTES de
// que se importe la consulta que se va a probar. Por eso los tests importan
// su módulo bajo prueba con `await import()` DENTRO de un `before()`, nunca
// arriba con un import normal. El mismo patrón que queues.test.ts.
//
// Necesita --experimental-test-module-mocks (ya está en el script `test`).

export type TestDb = ReturnType<typeof drizzle>;

let current: TestDb | null = null;

// El doble del módulo de la DB. Se registra UNA vez, al cargar este fichero:
// la ruta '../index' se resuelve desde AQUÍ (src/main/db/__tests__), o sea
// src/main/db/index.ts — exactamente el mismo módulo que las consultas
// importan como '../..'. Node lo casa por URL resuelta, así que da igual
// desde qué carpeta se importe este andamio.
//
// getDb() lee `current` en cada llamada en vez de capturar la base: así cada
// test puede pedir la suya (freshDb) sin volver a registrar el mock, que solo
// se puede hacer una vez por proceso.
mock.module('../index', {
  namedExports: {
    getDb: (): TestDb => {
      if (!current) throw new Error('getDb() en un test sin base: llama antes a freshDb().');
      return current;
    },
    // Sin candado ni cola: el swap de conexión en caliente que withDbAccess
    // arbitra en producción no existe aquí, y envolverlo en algo más sería
    // inventarse un comportamiento que el test no está probando.
    withDbAccess: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  },
});

// UNA SOLA base por proceso de test, reutilizada y VACIADA entre tests.
//
// Esto es una cicatriz cara, medida a base de pasadas repetidas. La primera
// versión creaba una base nueva por test (30 por fichero) y el runner petaba
// de forma intermitente —hasta 5 de cada 12 pasadas completas— con un access
// violation (0xC0000005) del binding nativo de SQLite: un crash del PROCESO
// entero, no un test rojo, y en un fichero distinto cada vez. Lo que se
// probó y NO lo arregló, para que nadie lo repita:
//
//   · cerrar el cliente antes de borrar la carpeta (bajó la frecuencia, no lo mató)
//   · no borrar la carpeta en absoluto (igual de flaky)
//   · serializar los ficheros con --test-concurrency=1 (igual: no era contención)
//   · `:memory:` en vez de fichero (mata el crash, pero todos los clientes del
//     proceso comparten handle y encima se caen las transacciones: 109 rojos)
//
// Lo que sí lo arregla es no abrir treinta: se abre UNA y se vacían las tablas
// entre tests, que además hace la suite bastante más rápida (una migración por
// proceso en vez de treinta).
let client: ReturnType<typeof createClient> | null = null;

// Las tablas de datos, en orden hijo -> padre. `__drizzle_migrations` NO entra:
// vaciarla haría que la siguiente migración se aplicara otra vez sobre un
// esquema que ya existe.
const DATA_TABLES = [
  'achievement_unlocks',
  'achievements',
  'state_events',
  'spend_events',
  'sessions',
  'iterations',
  'save_backups',
  'generated_memories',
  'curiosities',
  'radar_games',
  'plan_mailbox',
  'games',
  'emulators',
];

// ── El contador de trabajo (presupuestos de rendimiento) ───────────────────
//
// Lo que hace lenta a esta app no es el SQL: es CUÁNTAS FILAS cruzan el driver
// hacia JavaScript. Medido sobre la biblioteca real (994 juegos, 39.808
// logros): traerse la tabla de definiciones de logros entera cuesta ~260 ms,
// y el MISMO dato agregado en SQL cuesta 40 ms. Lo mismo con getGames, que se
// trae todas las sesiones y todos los eventos de estado: 12 ms hoy, 65 ms con
// cinco años de uso simulados.
//
// Por eso los tests de rendimiento de esta casa NO cronometran. Un assert
// sobre milisegundos falla en una máquina cargada y se acaba subiendo el
// número hasta que no significa nada — justo el tipo de test que enseña a
// ignorar la suite. Se cuentan CONSULTAS y FILAS, que son deterministas: dan
// el mismo resultado en cualquier máquina, y son exactamente las dos cosas
// que un refactor empeora sin querer (un N+1 nuevo, un `select()` que se lleva
// la tabla entera).
export type QueryStats = { queries: number; rows: number };

const stats: QueryStats = { queries: 0, rows: 0 };

// Envuelve el cliente para contar sin tocar el código de producción: drizzle
// llama a `execute`/`batch` y aquí solo se suma y se deja pasar.
const counting = <C extends { execute: (...a: never[]) => Promise<unknown> }>(client: C): C => {
  const original = client.execute.bind(client);
  client.execute = async (...args: never[]): Promise<unknown> => {
    const result = await original(...args);
    stats.queries += 1;
    const rows = (result as { rows?: unknown[] })?.rows;
    if (Array.isArray(rows)) stats.rows += rows.length;
    return result;
  };
  return client;
};

// Cuenta el trabajo de UNA llamada. Devuelve lo que devolviera la función y
// las cifras, para poder afirmar las dos cosas en el mismo test: que el
// resultado sigue siendo correcto y que no ha costado más.
export const measure = async <T>(fn: () => Promise<T>): Promise<[T, QueryStats]> => {
  const before = { ...stats };
  const value = await fn();
  return [value, { queries: stats.queries - before.queries, rows: stats.rows - before.rows }];
};

// Una base LIMPIA y migrada. Llámala en un beforeEach: cada test empieza sin
// una sola fila de los anteriores — la contaminación entre tests es el fallo
// que aparece según el orden y se tarda una tarde en encontrar.
export const freshDb = async (): Promise<TestDb> => {
  if (!client) {
    const dir = mkdtempSync(join(tmpdir(), 'afterplay-test-'));
    client = counting(createClient({ url: `file:${join(dir, 'test.db')}` }));
    current = drizzle({ client });
    // Las migraciones REALES del repo, en orden. Si una migración rompe el
    // esquema, estos tests se caen antes que la app de nadie.
    await migrate(current, { migrationsFolder: 'drizzle' });
    return current;
  }

  // Vaciado. Las claves foráneas se apagan durante el borrado para no
  // depender del orden exacto (y para que un ON DELETE CASCADE no dispare
  // trabajo que no hace falta); sqlite_sequence se limpia también, así los
  // ids vuelven a empezar en 1 y los tests pueden hablar de ids concretos.
  await client.execute('PRAGMA foreign_keys = OFF');
  for (const table of DATA_TABLES) await client.execute(`DELETE FROM ${table}`);
  await client.execute('DELETE FROM sqlite_sequence');
  await client.execute('PRAGMA foreign_keys = ON');
  return current as TestDb;
};

// Suelta la conexion nativa. Llamalo en un after() del fichero de test.
//
// Cerrar SI ayuda, medido: sin este close() el crash nativo de freshDb sube
// de 1 de cada 14 pasadas a 4 de cada 16.
export const cleanupDbs = (): void => {
  try {
    client?.close();
  } catch {
    // Ya cerrado o medio muerto: lo unico que importaba era soltarlo.
  }
  client = null;
  current = null;
};

// ── Fábricas ───────────────────────────────────────────────────────────────
//
// Rellenan los NOT NULL sin gracia (label, playedPlatform, origin…) para que
// cada test escriba solo lo que de verdad está probando. Todo lo demás se
// puede pisar por overrides.

export const makeGame = async (
  db: TestDb,
  overrides: Partial<typeof gamesTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(gamesTable)
    .values({
      title: 'Juego de prueba',
      planned: false,
      addedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })
    .returning({ id: gamesTable.id });
  return row.id;
};

export const makeIteration = async (
  db: TestDb,
  gameId: number,
  overrides: Partial<typeof iterationsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(iterationsTable)
    .values({
      gameId,
      label: 'Playthrough 1',
      playedPlatform: 'PC',
      origin: 'steam',
      ...overrides,
    })
    .returning({ id: iterationsTable.id });
  return row.id;
};

// Una sesión MEDIDA por defecto (isManual false, con fin y duración
// coherentes). `hours` calcula el fin y la duración a la vez para que no se
// puedan contradecir — un desfase entre endedAt y durationSec sería un dato
// imposible que ninguna parte de la app produce.
export const makeSession = async (
  db: TestDb,
  iterationId: number,
  startedAt: string,
  hours: number,
  overrides: Partial<typeof sessionsTable.$inferInsert> = {},
): Promise<number> => {
  const start = new Date(startedAt);
  const [row] = await db
    .insert(sessionsTable)
    .values({
      iterationId,
      isManual: false,
      startedAt: start,
      endedAt: new Date(start.getTime() + hours * 3600 * 1000),
      durationSec: Math.round(hours * 3600),
      datePrecision: 'datetime',
      ...overrides,
    })
    .returning({ id: sessionsTable.id });
  return row.id;
};

// Una sesión ABIERTA (jugando ahora): sin fin ni duración, que es como el
// watcher las deja mientras el proceso vive.
export const makeOpenSession = async (
  db: TestDb,
  iterationId: number,
  startedAt: string,
  overrides: Partial<typeof sessionsTable.$inferInsert> = {},
): Promise<number> =>
  makeSession(db, iterationId, startedAt, 0, {
    endedAt: null,
    durationSec: null,
    ...overrides,
  });

// Un emulador registrado en Ajustes. Para el watcher es un .exe más
// (EMULADORES.md §4), así que la ruta importa tanto como el nombre: es lo que
// se cruza contra la lista de procesos.
export const makeEmulator = async (
  db: TestDb,
  overrides: Partial<typeof emulatorsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(emulatorsTable)
    .values({
      name: 'RetroArch',
      executablePath: 'C:\\Emu\\RetroArch\\retroarch.exe',
      ...overrides,
    })
    .returning({ id: emulatorsTable.id });
  return row.id;
};

export const makeStateEvent = async (
  db: TestDb,
  iterationId: number,
  type: typeof stateEventsTable.$inferInsert.type,
  occurredAt: string,
  overrides: Partial<typeof stateEventsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(stateEventsTable)
    .values({
      iterationId,
      type,
      occurredAt: new Date(occurredAt),
      datePrecision: 'datetime',
      ...overrides,
    })
    .returning({ id: stateEventsTable.id });
  return row.id;
};

export const makeAchievement = async (
  db: TestDb,
  gameId: number,
  apiName: string,
  overrides: Partial<typeof achievementsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(achievementsTable)
    .values({
      gameId,
      apiName,
      displayName: apiName,
      sortIndex: 0,
      hidden: false,
      ...overrides,
    })
    .returning({ id: achievementsTable.id });
  return row.id;
};

export const makeUnlock = async (
  db: TestDb,
  achievementId: number,
  unlockedAt: string,
  overrides: Partial<typeof achievementUnlocksTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(achievementUnlocksTable)
    .values({
      achievementId,
      unlockedAt: new Date(unlockedAt),
      dateReliable: true,
      source: 'steam',
      ...overrides,
    })
    .returning({ id: achievementUnlocksTable.id });
  return row.id;
};
