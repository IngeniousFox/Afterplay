import { createClient } from '@libsql/client';
import { app, net } from 'electron';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/tursodatabase-sync';
import { migrate } from 'drizzle-orm/tursodatabase-sync/migrator';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  applyRemotePending,
  listRemotePending,
  readLocalMigrations,
  REBUILD_MARKER,
} from './migrationSync';

// Bloque 4 — @tursodatabase/sync sustituye por completo a @tursodatabase/
// database: su propio connect() ya da el mismo Database (mismo prepare/exec/
// transaction) más pull()/push(), así que no hace falta el paquete plano en
// paralelo — un juego de credenciales, un solo driver, tanto si hay Turso
// configurado como si no.
type Db = ReturnType<typeof drizzle>;

let dbInstance: Db | null = null;
// true si la conexión de esta sesión se abrió con sync de verdad (Turso
// respondió al arrancar). Se decide UNA SOLA VEZ en runMigrations() y no
// cambia durante toda la sesión — ver el porqué en attemptInitialConnect.
let syncCapable = false;

// Lazy on purpose: app.getPath('userData') depends on app.setName() having
// already run. Since ES module imports are always evaluated before any code
// in the importing file, computing this at module load time (a top-level
// const) would grab the path BEFORE main/index.ts gets a chance to set the
// app name, no matter where that call appears in the file.
const getDbPath = (): string => join(app.getPath('userData'), 'Afterplay.db');

const hasRemoteConfigured = (): boolean =>
  Boolean(process.env.DATABASE_URL && process.env.DATABASE_AUTH_TOKEN);

// QUÉ base de datos remota es esta, para decirlo en cada log de conexión.
//
// No es cosmético: el 3-ago-2026 una prueba en un sandbox aislado acabó
// conectada a la base de datos REAL (arrancó sin credentials.json, así que
// importó el .env del proyecto, que entonces tenía la de producción activa)
// y le empujó una migración. El log decía solo "conectado con Turso", así
// que el error tardó seis segundos en verse en vez de uno.
//
// Solo el nombre del host, nunca el token: esto va a una consola que se pega
// en informes de error (hoy mismo ha pasado varias veces).
const remoteLabel = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) return 'sin remota';
  try {
    // libsql://afterplay-test-xxx.turso.io -> afterplay-test-xxx
    return new URL(url).hostname.split('.')[0];
  } catch {
    return 'remota desconocida';
  }
};

// getDb() sigue siendo síncrono a propósito — lo llaman decenas de queries
// existentes sin esperar nada. Solo es seguro llamarlo después de
// runMigrations(), que es lo primero que toca la DB en el arranque (SPEC
// 6: el main resuelve todo antes de que nada más la use).
export const getDb = (): Db => {
  if (!dbInstance) {
    throw new Error('getDb() llamado antes de runMigrations() — la DB todavía no está conectada.');
  }
  return dbInstance;
};

// Una conexión sin url no registra sus escrituras en la cola de CDC (el
// mecanismo del que push() saca qué subir): el modo de captura es POR
// CONEXIÓN y solo las conexiones con sync lo activan solas. Sin esto, todo
// lo escrito en una sesión offline quedaría en local para siempre, aunque
// después se reconectara con Turso (probado: cdcOperations se queda a 0 y
// push() no sube nada). Activarlo a mano con el mismo modo que usa el motor
// ('full' sobre turso_cdc) deja esas escrituras en cola, listas para el
// próximo push. Solo se hace si el fichero ya sincronizó alguna vez
// (existe turso_sync_last_change_id): en un fichero que nunca tuvo sync no
// hay línea base contra la que subir, y encolar ahí solo acumularía basura.
const enableOfflineChangeCapture = async (db: Db): Promise<void> => {
  if (!hasRemoteConfigured()) return;

  try {
    const syncMarker = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turso_sync_last_change_id'`,
    );
    if (syncMarker.length === 0) return;

    await db.run(sql`PRAGMA unstable_capture_data_changes_conn('full')`);
    console.log('[db] modo local con captura de cambios - lo que escribas se subira al reconectar');
  } catch (error) {
    console.warn('[db] no se pudo activar la captura de cambios offline:', error);
  }
};

// SQLite trae las foreign keys APAGADAS por defecto (es un pragma por
// conexión): sin esto, los ON DELETE CASCADE del schema no se aplican y
// borrar un juego dejaría huérfanas sus iterations/sessions/events. Ambas
// vías de conexión (local y con sync) necesitan aplicarlo por igual.
const enableForeignKeys = (db: Db): Promise<unknown> => db.run(sql`PRAGMA foreign_keys = ON`);

const connectLocalOnly = async (): Promise<Db> => {
  const db = drizzle({ connection: { path: getDbPath(), clientName: 'afterplay' } });
  await db.$client.connect();
  await enableForeignKeys(db);
  await enableOfflineChangeCapture(db);
  return db;
};

const CONNECT_TIMEOUT_MS = 4000;

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tardó más de ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
};

// El CDC de @tursodatabase/sync replica bien filas, pero no de forma fiable
// el DDL de una migración con recreación de tabla (CREATE __new_x + INSERT +
// DROP + RENAME) — ya nos ha dejado el remoto a medias o directamente sin
// la migración más de una vez. Esto aplica las migraciones que falten
// DIRECTAMENTE contra Turso, con una conexión propia y aparte que no toca
// dbInstance ni el fichero local — así el remoto queda al día sin depender
// de que el CDC replique DDL. Nunca bloquea el arranque: sin red o sin
// Turso configurado, simplemente no hace nada y sigue el flujo normal.
// ¿Se quedó el remoto sin comprobar en el arranque? Entonces NO se sabe si le
// falta alguna migración — y eso hay que resolverlo, no dejarlo hasta el
// próximo arranque. Lo reintenta runSyncCycle, ya sin prisa ni límite de
// tiempo: para entonces la ventana está abierta y nada le corre detrás.
let migrationPushPending = false;

// out/main -> out -> project root -> drizzle. Misma profundidad relativa en
// dev y en la app empaquetada.
const MIGRATIONS_FOLDER = join(__dirname, '../../drizzle');

// ¿Quedaron migraciones sin aplicar EN LOCAL porque el remoto no estaba al
// día? Ver la puerta de runMigrations, que es donde se explica el porqué.
let localMigrationsPending = false;

// Dos fases con reglas DISTINTAS de tiempo, y la distinción es una cicatriz:
//
//  · LEER qué falta sí corre con límite corto — el arranque no puede esperar
//    a una base de Turso dormida, y quedarse sin saber es recuperable (la
//    puerta de runMigrations no aplica nada y runSyncCycle lo reintenta).
//    OJO al leer su fallo: aparece también cuando NO hay nada pendiente,
//    porque el límite cubre abrir conexión + leer — casi siempre significa
//    "no me dio tiempo a PREGUNTAR", no "no pude aplicar nada".
//  · APLICAR corre SIN límite, siempre. Antes el timeout envolvía la
//    operación entera y su finally cerraba el cliente: withTimeout no cancela
//    nada, así que un lote DDL que pasara de 4s seguía ejecutándose en el
//    servidor mientras aquí se le cerraba la conexión por debajo — DDL
//    descuartizado a mitad. Fue una de las piezas del destrozo del 7-ago-2026
//    (las otras, en applyRemotePending). Si hay algo que aplicar, el arranque
//    ESPERA lo que haga falta: es una vez por migración y por máquina, y la
//    alternativa era esta cicatriz.
const pushMigrationsToRemote = async (timeoutMs: number | null): Promise<boolean> => {
  if (!hasRemoteConfigured()) return true;

  const client = createClient({
    url: process.env.DATABASE_URL as string,
    authToken: process.env.DATABASE_AUTH_TOKEN as string,
  });

  try {
    const list = listRemotePending(client, MIGRATIONS_FOLDER);
    const pending = timeoutMs === null ? await list : await withTimeout(list, timeoutMs);

    if (pending.length > 0) {
      console.log(
        `[db] aplicando en Turso (sin límite de tiempo): ${pending
          .map((migration) => migration.name)
          .join(', ')}`,
      );
      const { applied } = await applyRemotePending(client, pending);
      console.log(`[db] migraciones aplicadas directamente en Turso: ${applied.join(', ')}`);
    }
    return true;
  } catch (error) {
    console.warn(
      '[db] no se pudo dejar Turso al día en el arranque, se reintentara en segundo plano:',
      error,
    );
    return false;
  } finally {
    client.close();
  }
};

const connectWithSync = async (): Promise<Db> => {
  const db = drizzle({
    connection: {
      path: getDbPath(),
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN,
      clientName: 'afterplay',
    },
  });
  // withTimeout es un Promise.race: al saltar el límite RECHAZA, pero el
  // connect() de dentro sigue vivo — nadie lo cancela. Si Turso estaba
  // dormido y despierta a los 5s (>4s del timeout), el catch de los llamadores
  // ya habrá abierto una conexión LOCAL al mismo fichero; cuando el connect de
  // sync resuelve tarde, quedan DOS conexiones vivas sobre Afterplay.db — el
  // caso exacto que el comentario del bug #1 (más abajo) documenta como el que
  // corrompió la base real. Así que si vamos a abandonar este connect, lo
  // cerramos en cuanto (y si) resuelva, antes de que otra lo pise.
  const connecting = db.$client.connect();
  try {
    await withTimeout(connecting, CONNECT_TIMEOUT_MS);
  } catch (error) {
    void connecting.then(() => db.$client.close()).catch(() => {});
    throw error;
  }
  await enableForeignKeys(db);
  return db;
};

// connect() con sync crea, junto al .db, unos ficheros satelite (-wal,
// -info, -changes) que llevan la cuenta de hasta donde esta sincronizado.
// Si se borra solo Afterplay.db a mano y esos satelites se quedan atras (de
// la sesion anterior), connect() ve metadatos "de una DB que ya existio" sin
// el fichero principal detras y rechaza arrancar en vez de hacer un bootstrap
// limpio desde Turso — en vez de una DB nueva de verdad, parece una a medio
// borrar. Borrar esos satelites sueltos y reintentar una vez arregla
// exactamente ese caso.
const STALE_METADATA_MESSAGE = "main DB file doesn't exists, but metadata is";

const isStaleMetadataError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(STALE_METADATA_MESSAGE);

const clearOrphanedSyncSidecars = (): void => {
  const dbPath = getDbPath();
  for (const suffix of ['-wal', '-info', '-changes']) {
    const sidecarPath = `${dbPath}${suffix}`;
    if (existsSync(sidecarPath)) unlinkSync(sidecarPath);
  }
};

// La conexión con sync se decide al arrancar; si no hay red, la sesión
// empieza en local y attemptSyncUpgrade() reintenta el ascenso en caliente
// más adelante — pero SIEMPRE a través del candado de withDbAccess(). Dos
// bugs reales obligan a ese cuidado:
//  1. Reconectar el MISMO fichero con url mientras la conexión local anterior
//     seguía abierta corrompió el fichero real (games/iterations/etc.
//     desaparecieron, solo quedaron las tablas internas de sync) — este
//     motor, todavía en early preview, no soporta bien dos conexiones vivas
//     a la vez sobre el mismo path. Por eso el swap SIEMPRE cierra antes de
//     abrir.
//  2. Cerrar la anterior y abrir la nueva evitaba la corrupción, pero dejaba
//     una ventana real: cualquier query en vuelo en ese instante (el watcher
//     sondea cada 5s, sin relación con este ciclo) podía intentar usar la
//     conexión justo cuando se cerraba, y fallar con "connection is not
//     open". Por eso todo acceso a la DB entra por withDbAccess(): el swap
//     espera a que las queries en vuelo terminen y retiene las nuevas hasta
//     tener la conexión nueva lista.
const attemptInitialConnect = async (): Promise<{ db: Db; capable: boolean }> => {
  if (!hasRemoteConfigured()) return { db: await connectLocalOnly(), capable: false };

  try {
    const db = await connectWithSync();
    console.log(`[db] conectado con Turso [${remoteLabel()}] - sync activado`);
    return { db, capable: true };
  } catch (error) {
    if (isStaleMetadataError(error)) {
      console.warn(
        '[db] metadatos de sync huerfanos (sin fichero principal), limpiando y reintentando...',
      );
      clearOrphanedSyncSidecars();
      try {
        const db = await connectWithSync();
        console.log(
          `[db] conectado con Turso [${remoteLabel()}] tras limpiar metadatos huerfanos - sync activado`,
        );
        return { db, capable: true };
      } catch (retryError) {
        console.warn(
          '[db] fallo tambien tras limpiar metadatos huerfanos, sigo en local:',
          retryError,
        );
        return { db: await connectLocalOnly(), capable: false };
      }
    }

    console.warn('[db] sin conexion con Turso al arrancar, sigo en local:', error);
    return { db: await connectLocalOnly(), capable: false };
  }
};

// PROTOCOLO PARA CAMBIOS DE ESQUEMA QUE ALTER NO SOPORTA
// (quitar un constraint, cambiar un tipo… — todo lo que drizzle-kit resuelve
// generando una reconstrucción CREATE __new_x + INSERT + DROP + RENAME).
//
// Escrito tras perder producción DOS veces con la misma reconstrucción el
// 7-ago-2026 (quitando el UNIQUE de games.steamGridDbId), y tras probar cada
// alternativa con recibo:
//   · Reconstruir en caliente: contra test salió impecable y contra
//     producción el lote no fue fail-stop, el PRAGMA foreign_keys=off no se
//     respetó (el CASCADE del DROP vació las tablas hijas) y el RENAME no
//     llegó. NO ES REPRODUCIBLE. Prohibido, en remoto y en local.
//   · PRAGMA writable_schema (cirugía de catálogo): bloqueado por el
//     servidor de Turso a nivel de parser ("SQL not allowed statement").
//   · ALTER TABLE DROP COLUMN: funciona, pero SQLite lo prohíbe sobre una
//     columna indexada — que es justo la que tiene el constraint.
//
// Lo único que queda, y es el protocolo: EXPANDIR SIN CONTRAER. Columna nueva
// por ALTER ADD COLUMN + UPDATE de copia, la propiedad de drizzle conserva el
// nombre de siempre apuntando a la nueva, y la vieja se queda muerta en la
// tabla (el ejemplo vivo: games.steamGridDbId → sgdbId, ver schema.ts). Es
// una migración aditiva normal: entra sola en cada base, remota y local, sin
// pasos manuales. Ningún cliente ejecuta jamás una reconstrucción; el
// guardarraíl de abajo (pendingTableRebuild) lo garantiza aunque alguien
// genere una por descuido.
export const runMigrations = async (): Promise<void> => {
  const remoteConfigured = hasRemoteConfigured();
  // Sondeo barato ANTES de pagar dos timeouts de red completos (push de
  // migraciones + connectWithSync, 4s cada uno de CONNECT_TIMEOUT_MS): sin
  // adaptador de red (avión, sin cable) ninguno de los dos va a responder
  // nunca, así que arrancar en local directamente ahorra hasta 8s de espera
  // muerta. Mismo sondeo que isTursoReachable() usa más abajo para el ciclo
  // de ascenso en caliente — no sustituye al timeout real (con wifi pero sin
  // Turso alcanzable, ese caso sigue necesitando la espera de verdad para
  // saberlo), solo el caso "no hay red en absoluto".
  const online = !remoteConfigured || net.isOnline();

  // Conexión aparte, antes de tocar la de verdad: deja el remoto al día por
  // su cuenta (ver pushMigrationsToRemote) para que el CDC nunca tenga que
  // cargar con el DDL de esta migración. Va en secuencia y no en paralelo con
  // la conexión de abajo A PROPÓSITO: la de sync no debe engancharse a Turso
  // mientras el DDL está a medias.
  migrationPushPending =
    remoteConfigured && !(online && (await pushMigrationsToRemote(CONNECT_TIMEOUT_MS)));

  const { db, capable } =
    remoteConfigured && !online
      ? { db: await connectLocalOnly(), capable: false }
      : await attemptInitialConnect();
  dbInstance = db;
  syncCapable = capable;

  // LA PUERTA: si hay remoto configurado y no se pudo dejar al día, en local
  // NO se aplica nada.
  //
  // Sin ella, `migrationPushPending` era solo una nota para reintentar luego y
  // esta línea corría igual — o sea que el caso "no me dio tiempo a
  // preguntarle a Turso" (4s, con una base dormida que tarda en despertar: ver
  // pushMigrationsToRemote) terminaba con la migración aplicada SOLO en local.
  // Con las migraciones aditivas de siempre eso se reabsorbía en el reintento
  // y no se notó nunca. Con una reconstrucción de tabla fue fatal por partida
  // doble: la local se rompió al ejecutarla sobre CDC, y encima quedó con otro
  // orden de columnas que el remoto — y el replicador va POR POSICIÓN de
  // columna (ver SCHEMA_MISMATCH_HINTS), así que lo siguiente habría sido
  // escribir valores en la columna equivocada.
  //
  // Quedarse sin aplicar es siempre recuperable: se reintenta en cuanto vuelva
  // la red (runSyncCycle) y hasta entonces la app trabaja con el esquema que
  // ya tenía. Aplicar a medias no lo es.
  if (migrationPushPending) {
    localMigrationsPending = true;
    console.warn(
      '[db] Turso no se pudo comprobar al arrancar: NO aplico migraciones en local hasta que el remoto esté al día (se reintenta en el ciclo de sync)',
    );
    return;
  }

  const rebuild = await pendingTableRebuild(db);
  if (rebuild) {
    localMigrationsPending = true;
    console.error(
      `[db] ${rebuild} RECONSTRUYE UNA TABLA y no se ejecuta en local nunca (ver el protocolo en el comentario de runMigrations). Migra el fichero en frío, súbelo a Turso y borra el .db local para que se baje ya migrado.`,
    );
    return;
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
};

// ¿Hay pendiente alguna migración que reconstruya una tabla?
//
// Esta guarda es el guardarraíl que faltaba, y existe porque la puerta de
// arriba NO basta: aquella cubre "el remoto no está al día", pero el 7-ago-2026
// el push al remoto funcionó y aun así se perdió la base — el DROP+RENAME se
// ejecutó igualmente (en el remoto por su cuenta, y en la local al reflejarlo
// por sync) y dejó __new_games sin games, con las tablas hijas vaciadas por
// CASCADE. La conclusión tras probarlo en test (impecable) y en producción
// (destrozo) es que este DDL no es reproducible, así que la única política
// segura es no ejecutarlo NUNCA desde la app.
//
// El criterio de "pendiente" es el mismo que usa drizzle: created_at por
// encima del último aplicado. Sin tabla de control no hay nada que proteger —
// es una instalación nueva, que crea las tablas desde cero sin reconstruir.
const pendingTableRebuild = async (db: Db): Promise<string | null> => {
  let lastApplied = 0;
  try {
    const rows = await db.all<{ created_at: number | null }>(
      sql`select max(created_at) as created_at from __drizzle_migrations`,
    );
    lastApplied = Number(rows[0]?.created_at ?? 0);
  } catch {
    return null;
  }

  const pending = readLocalMigrations(MIGRATIONS_FOLDER).filter(
    (migration) => migration.folderMillis > lastApplied,
  );
  return (
    pending.find((migration) =>
      migration.statements.some((statement) => statement.includes(REBUILD_MARKER)),
    )?.name ?? null
  );
};

// El reintento de la puerta de arriba: el remoto ya está al día, así que ahora
// sí toca poner la local a la par. Va por withDbAccess como todo lo demás —
// esto corre desde el ciclo de sync, con el watcher sondeando por su cuenta.
const applyPendingLocalMigrations = async (): Promise<void> => {
  if (!localMigrationsPending || migrationPushPending || !dbInstance) return;
  await withDbAccess(async () => migrate(getDb(), { migrationsFolder: MIGRATIONS_FOLDER }));
  localMigrationsPending = false;
  console.log('[db] migraciones locales aplicadas al fin (el remoto ya estaba al día)');
};

// ---- Candado de acceso a la DB (para el swap de conexión en caliente) ----
// Mientras no hay swap en curso (el 99.9% del tiempo) esto es un contador y
// nada más: coste cero. Durante un swap, las queries nuevas esperan en la
// puerta y el swap espera a que las que estaban en vuelo terminen.
let swapGate: Promise<void> | null = null;
let releaseSwapGate: (() => void) | null = null;
let queriesInFlight = 0;
const idleWaiters: Array<() => void> = [];

// Todo acceso a la DB desde fuera del arranque (handlers IPC de dominios con
// DB, ciclo del watcher) entra por aquí. Las migraciones corren en el
// arranque, antes de que exista el timer de sync, así que no lo necesitan.
export const withDbAccess = async <T>(fn: () => Promise<T>): Promise<T> => {
  while (swapGate) await swapGate;
  queriesInFlight++;
  try {
    return await fn();
  } finally {
    queriesInFlight--;
    if (queriesInFlight === 0) {
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }
};

const waitForDbIdle = (): Promise<void> => {
  if (queriesInFlight === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
};

// Sondeo barato de alcanzabilidad ANTES de tocar el candado: si Turso no va
// a responder, no tiene sentido pagar el swap (drenar queries + cerrar +
// timeout de 4s + reabrir en local) cada 60s — eso congelaría la UI un rato
// cada minuto mientras se está offline. Cualquier respuesta HTTP vale (un
// 404 también demuestra que el host contesta); solo un error de red cuenta
// como inalcanzable.
const isTursoReachable = async (): Promise<boolean> => {
  if (!net.isOnline()) return false;

  try {
    const url = new URL(process.env.DATABASE_URL as string);
    url.protocol = 'https:';
    url.pathname = '/health';
    await net.fetch(url.toString(), { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

const IDLE_TIMEOUT_MS = 8000;

// Ascenso en caliente local -> sync cuando vuelve la conexión, sin reiniciar
// la app. El orden importa (ver el comentario sobre attemptInitialConnect):
// retener queries nuevas -> drenar las en vuelo -> cerrar la conexión local
// -> abrir la de sync. Si algo falla, se vuelve a una conexión local (que
// sigue capturando cambios para el siguiente intento) y se reintenta en un
// ciclo posterior.
const attemptSyncUpgrade = async (): Promise<void> => {
  if (syncCapable || !hasRemoteConfigured() || !dbInstance) return;
  if (!(await isTursoReachable())) return;

  // Si la sesión arrancó sin red, una migración pudo haberse aplicado SOLO
  // en local (runMigrations() ya lo intentó contra el remoto al arrancar,
  // pero sin red no llegó a nada). Este es el primer momento en que hay
  // conexión otra vez — aprovecharlo para dejar el remoto al día por la vía
  // directa, ANTES de reconectar con sync, para que el CDC no sea quien
  // tenga que cargar con ese DDL al hacer push() más abajo. Sin límite de
  // tiempo: aquí la ventana ya está abierta y nadie espera.
  migrationPushPending = !(await pushMigrationsToRemote(null));

  swapGate = new Promise((resolve) => {
    releaseSwapGate = resolve;
  });
  try {
    try {
      await withTimeout(waitForDbIdle(), IDLE_TIMEOUT_MS);
    } catch {
      console.warn('[db] queries en vuelo sin terminar, pospongo el reintento de sync');
      return;
    }

    try {
      await dbInstance.$client.close();
    } catch {
      // Ya estaba cerrada (p.ej. un intento anterior falló a medias) — el
      // objetivo es solo que no queden dos conexiones vivas al mismo path.
    }

    try {
      const db = await connectWithSync();
      dbInstance = db;
      syncCapable = true;
      console.log(`[db] conexion con Turso [${remoteLabel()}] restablecida - sync activado`);
    } catch (error) {
      console.warn('[db] reintento de conexion con Turso fallido, sigo en local:', error);
      dbInstance = await connectLocalOnly();
    }
  } finally {
    releaseSwapGate?.();
    releaseSwapGate = null;
    swapGate = null;
  }
};

// Ciclo de sync periódico (SPEC Bloque 4). Si la sesión arrancó sin red,
// cada ciclo intenta primero el ascenso en caliente; con sync ya activo,
// solo pull+push sobre la conexión estable. Nunca lanza — un fallo de red
// aquí no debe tumbar nada. El guard evita ciclos solapados si uno se
// alarga (el intervalo es de 60s, pero un swap + pull puede tardar).
let syncCycleRunning = false;

// El último fallo de sync, para que Ajustes pueda ENSEÑARLO. Antes esto solo
// salía por consola, y ahí murió durante horas un desajuste de esquema entre
// local y Turso: la app reintentaba cada minuto en silencio, fallando siempre
// igual, mientras la interfaz decía que todo iba bien.
export type SyncFailure = {
  message: string;
  at: Date;
  // Un desajuste de ESQUEMA (una tabla o columna que no cuadra con el remoto)
  // no se arregla reintentando, a diferencia de un corte de red: hay que
  // aplicar la migración que falta. La UI lo dice con otras palabras.
  schemaMismatch: boolean;
  consecutive: number;
};

let lastSyncFailure: SyncFailure | null = null;

export const getLastSyncFailure = (): SyncFailure | null => lastSyncFailure;

// Firma de los errores del motor cuando el esquema remoto no cuadra: el
// replicador va por posición de columna, así que un desajuste sale como un
// tipo que no encaja o una tabla que no existe, nunca como un error de red.
const SCHEMA_MISMATCH_HINTS = [
  'type mismatch',
  'no such table',
  'no such column',
  'has no column named',
  'database tape error',
];

export const runSyncCycle = async (): Promise<void> => {
  if (syncCycleRunning) return;
  syncCycleRunning = true;

  try {
    // Lo que no dio tiempo a comprobar en el arranque se resuelve aquí, sin
    // límite de tiempo: ya no hay nadie esperando a que abra la ventana. Va
    // ANTES del pull/push por lo de siempre — el DDL primero, y solo después
    // el sync de filas.
    //
    // Solo cuando YA hay sync: si la sesión sigue en local, attemptSyncUpgrade
    // (abajo) hace este mismo push justo antes de reconectar. Sin la guarda de
    // syncCapable, el caso "arranqué sin red + hay migración pendiente"
    // empujaba a Turso DOS veces en el mismo ciclo (aquí y en el upgrade),
    // pagando dos round-trips completos justo cuando la red acaba de volver.
    if (syncCapable && migrationPushPending) {
      migrationPushPending = !(await pushMigrationsToRemote(null));
      if (!migrationPushPending) console.log('[db] migraciones de Turso comprobadas al fin');
    }

    if (!syncCapable) await attemptSyncUpgrade();
    if (!syncCapable) return;

    // Con el remoto ya al día, lo que la puerta del arranque dejó sin aplicar
    // en local se aplica ahora — ANTES del pull/push, igual que el DDL va
    // siempre antes que las filas.
    await applyPendingLocalMigrations();

    const db = getDb();
    await db.$client.pull();
    await db.$client.push();
    lastSyncFailure = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    lastSyncFailure = {
      message,
      at: new Date(),
      schemaMismatch: SCHEMA_MISMATCH_HINTS.some((hint) => lower.includes(hint)),
      consecutive: (lastSyncFailure?.consecutive ?? 0) + 1,
    };
    // Solo el PRIMERO de una racha va a consola: este ciclo corre cada minuto
    // y un fallo persistente llenaba el log de la misma línea repetida, que
    // es justo lo que hace que se deje de leer.
    if (lastSyncFailure.consecutive === 1) {
      console.warn('[db] fallo sincronizando con Turso (sigo en local, reintento luego):', error);
    }
  } finally {
    syncCycleRunning = false;
  }
};
