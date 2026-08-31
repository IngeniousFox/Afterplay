import { createClient } from '@libsql/client';
import { app, BrowserWindow, net } from 'electron';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/tursodatabase-sync';
import { migrate } from 'drizzle-orm/tursodatabase-sync/migrator';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { remoteLabel } from '../config/credentials';
import { e2eBlocksSync } from '../lib/e2e';
import { removeEmptySidecars } from './sidecars';
import {
  applyRemotePending,
  listRemotePending,
  readLocalMigrations,
  REBUILD_MARKER,
  selectPendingByName,
  type LocalMigration,
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
  // En un test E2E, la remota está cerrada salvo que ese test la haya pedido
  // con las dos llaves (credenciales de Turso en su sandbox Y la bandera; ver
  // e2e.ts). Un test que teclee credenciales en Ajustes no abre nada.
  !e2eBlocksSync() && Boolean(process.env.DATABASE_URL && process.env.DATABASE_AUTH_TOKEN);

// QUÉ base de datos remota es esta, para decirlo en cada log de conexión.
//
// No es cosmético: el 3-ago-2026 una prueba en un sandbox aislado acabó
// conectada a la base de datos REAL (arrancó sin credentials.json, así que
// importó el .env del proyecto, que entonces tenía la de producción activa)
// y le empujó una migración. El log decía solo "conectado con Turso", así
// que el error tardó seis segundos en verse en vez de uno.
//
// La función vive en config/credentials.ts —el otro sitio que anuncia base, al
// importar claves de fuera— porque aquí había una copia idéntica, con este
// mismo incidente contado dos veces. Aquí solo se le pasa de dónde sale la url.
const currentRemoteLabel = (): string => remoteLabel(process.env.DATABASE_URL);

// getDb() sigue siendo síncrono a propósito — lo llaman decenas de queries
// existentes sin esperar nada. Solo es seguro llamarlo después de
// runMigrations(), y quien lo garantiza ya no es el ORDEN del arranque (la
// ventana se crea antes de migrar, así que el renderer puede pedir datos con
// la conexión todavía sin abrir) sino la PUERTA DE ARRANQUE de withDbAccess:
// esperar ahí es lo que hace que aquí abajo siempre haya conexión. Llamar a
// getDb() por fuera de withDbAccess sigue siendo un error, y por eso lanza.
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

// Y LA OTRA MITAD, que no es lo mismo aunque las dos salgan del mismo `false`:
// ¿sabemos que el remoto quedó A MEDIO MIGRAR?
//
// applyRemotePending aplica y registra migración a migración, así que un lote
// [16, 17] que reviente en la 17 deja el remoto con la 16 puesta y devuelve
// fallo. Aquí la puerta de connectAndMigrate impide aplicar la 16 en local
// (bien: aplicar a medias no es recuperable), y hasta hoy el ciclo de sync
// seguía de largo hasta pull()/push() igualmente — replicando filas entre un
// remoto con el layout nuevo y una local con el viejo, con el replicador
// yendo POR POSICIÓN de columna. Eso es exactamente lo que SCHEMA_MISMATCH_HINTS
// describe.
//
// Se distingue del caso NORMAL de migrationPushPending —el timeout benigno de
// "no me dio tiempo a PREGUNTAR", donde remoto y local son idénticos— porque
// plantarse en ese otro cortaría el sync de filas en cada arranque con Turso
// dormido. Solo se apaga con un push COMPLETO: un fallo de LECTURA posterior
// no la desarma, porque el remoto sigue tan a medias como antes.
let remoteSchemaAhead = false;

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
    // Los dos catch van SEPARADOS porque los dos fallos no significan lo
    // mismo: no poder PREGUNTAR deja el remoto exactamente como estaba (y la
    // local con él), mientras que fallar APLICANDO puede dejarlo con parte del
    // lote puesta y por delante de la local. Con un solo catch los dos salían
    // como un `false` indistinguible y el ciclo de sync no podía plantarse en
    // el segundo sin plantarse también en el primero.
    let pending: LocalMigration[];
    try {
      const list = listRemotePending(client, MIGRATIONS_FOLDER);
      pending = timeoutMs === null ? await list : await withTimeout(list, timeoutMs);
    } catch (error) {
      console.warn(
        '[db] no se pudo comprobar que le falta a Turso, se reintentara en segundo plano:',
        error,
      );
      return false;
    }

    if (pending.length > 0) {
      console.log(
        `[db] aplicando en Turso (sin límite de tiempo): ${pending
          .map((migration) => migration.name)
          .join(', ')}`,
      );
      try {
        const { applied } = await applyRemotePending(client, pending);
        console.log(`[db] migraciones aplicadas directamente en Turso: ${applied.join(', ')}`);
      } catch (error) {
        // Puede haber registrado alguna del lote antes de reventar: a partir de
        // aquí el esquema remoto puede ir por delante del local, y replicar
        // filas entre los dos es lo que hay que impedir (ver remoteSchemaAhead).
        remoteSchemaAhead = true;
        console.warn(
          '[db] fallo aplicando migraciones en Turso: el remoto puede haber quedado A MEDIAS, no sincronizo filas hasta arreglarlo:',
          error,
        );
        return false;
      }
    }

    remoteSchemaAhead = false;
    return true;
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
    console.log(`[db] conectado con Turso [${currentRemoteLabel()}] - sync activado`);
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
          `[db] conectado con Turso [${currentRemoteLabel()}] tras limpiar metadatos huerfanos - sync activado`,
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

// Cronómetro de las FASES del arranque de la base — la contraparte de las
// marcas [startup] de main/index.ts. Aquí dentro se va el grueso de lo que el
// usuario ve como splash, y hasta medirlo no se sabía cuál de las tres fases
// era la cara: con la biblioteca real resultó ser "comprobar Turso" con 470 ms
// de los 481 totales (conectar 6, migrar 5). Se queda puesto: el arranque pasa
// una vez y no hay dónde mirarlo después.
const phase = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[db] fase ${label}: ${Date.now() - started} ms`);
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
//     llegó. NO ES REPRODUCIBLE — de ahí todo lo que viene debajo.
//   · PRAGMA writable_schema (cirugía de catálogo): bloqueado por el
//     servidor de Turso a nivel de parser ("SQL not allowed statement").
//   · ALTER TABLE DROP COLUMN: funciona, pero SQLite lo prohíbe sobre una
//     columna indexada — que es justo la que tiene el constraint.
//
// LA POLÍTICA DE HOY (revisada el 8-ago-2026), que ya NO es la prohibición
// total de aquel día:
//
//   · Lo preferido sigue siendo EXPANDIR SIN CONTRAER. Columna nueva por
//     ALTER ADD COLUMN + UPDATE de copia, la propiedad de drizzle conserva el
//     nombre de siempre apuntando a la nueva y la vieja se queda muerta en la
//     tabla. Es una migración aditiva normal: entra sola en cada base, remota
//     y local, sin pasos manuales.
//   · Pero una reconstrucción ya no está prohibida: la prohibición se
//     sustituyó por PRUEBA (ver applyRebuildVerified). Su ÚNICA vía legítima
//     es esa función — copia previa en backups/antes-de-<migración>.db,
//     conteo de filas antes y después, y lanzar si se perdió una sola. El
//     guardarraíl de abajo (pendingTableRebuild) ya no bloquea nada: ENRUTA
//     hacia ella. Las dos entradas que aplican migraciones en local (el
//     arranque y el reintento del ciclo de sync) pasan por
//     applyMigrationsGuarded, que es quien hace ese enrutado.
//   · El precedente medido es 20260808165354_igdbid_nullable_y_adios_columna_muerta:
//     reconstruyó `games` sobre una copia de producción entera sin perder una
//     fila. Y de paso se llevó por delante la columna muerta que este bloque
//     ponía de ejemplo vivo (la vieja steamGridDbId): hoy solo queda sgdbId,
//     ver schema.ts.
const connectAndMigrate = async (): Promise<void> => {
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
    remoteConfigured &&
    !(online && (await phase('comprobar Turso', () => pushMigrationsToRemote(CONNECT_TIMEOUT_MS))));

  const { db, capable } = await phase('conectar', async () =>
    remoteConfigured && !online
      ? { db: await connectLocalOnly(), capable: false }
      : attemptInitialConnect(),
  );
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

  await phase('migrar', () => applyMigrationsGuarded(db));
};

// El arranque de la base, visto desde fuera: conectar + migrar y ABRIR LA
// PUERTA (ver startupGate más abajo) para que las consultas que el renderer ya
// haya dejado esperando entren en cuanto haya conexión.
//
// La puerta NO se abre si esto lanza, y es a propósito: main/index.ts enseña
// el diálogo de error y cierra la app: dejar pasar consultas contra una base
// que no se pudo preparar solo añadiría errores encima del que importa.
export const runMigrations = async (): Promise<void> => {
  await connectAndMigrate();
  openStartupGate();
};

// EL ARREGLO DE LA DOBLE APLICACIÓN — la pieza que faltaba desde el 7-ago-2026.
//
// Reproducido de punta a punta el 8-ago-2026 contra la base de test, con la
// cola del replicador como prueba del delito. Lo que pasaba:
//
//   1. pushMigrationsToRemote aplica la migración DIRECTAMENTE en Turso. Bien:
//      su verificación pasa y el remoto queda correcto, con games ya renombrada.
//   2. La app conecta con sync, y ahí la captura de cambios está ENCENDIDA.
//   3. La local no tiene la migración en su tabla de control, así que la
//      aplica OTRA VEZ. También correcta, vista en local.
//   4. Pero el CDC captura ese rebuild local ENTERO. Medido en la cola de la
//      base rota: 985 filas de `__new_games` (los INSERT), 2 de `sqlite_schema`
//      (el CREATE y el DROP/RENAME) y 2 de `__drizzle_migrations`.
//   5. Eso se empuja al remoto: el `DROP TABLE games` se lleva por delante la
//      tabla BUENA que ya estaba migrada, y el RENAME es justo lo que no
//      sobrevive a la replicación.
//   6. El remoto queda con `__new_games` y sin `games`; el sync lo baja y la
//      local acaba igual de rota.
//
// O sea que la migración se aplicaba DOS VECES y la segunda destruía a la
// primera. El push directo se hizo para que "el CDC nunca cargue con el DDL
// de la migración", pero nadie impedía que la aplicación LOCAL se capturara y
// subiera sola.
//
// El arreglo es decirlo explícitamente: lo que se aplica en local NO se
// replica, porque el remoto ya tiene exactamente lo mismo aplicado por su
// cuenta. La captura se apaga durante la migración y se restaura después al
// modo que tuviera — se lee antes (el pragma es consultable) en vez de
// asumirlo, para no encender la captura en una conexión que la tenía apagada.
const migrateWithoutCapture = async (db: Db): Promise<void> => {
  const [state] = await db.all<{ mode: string }>(
    sql.raw('PRAGMA unstable_capture_data_changes_conn'),
  );
  const previous = state?.mode ?? 'off';

  if (previous !== 'off') {
    await db.run(sql.raw(`PRAGMA unstable_capture_data_changes_conn('off')`));
  }
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    // En finally: si la migración revienta, la conexión NO puede quedarse sin
    // captura el resto de la sesión — todo lo que escribieras después se
    // quedaría en local sin subir nunca, y en silencio.
    if (previous !== 'off') {
      await db.run(sql.raw(`PRAGMA unstable_capture_data_changes_conn('${previous}')`));
    }
  }
};

// Las tablas de DATOS y sus filas. Se dejan fuera las internas: las de SQLite,
// las de drizzle (__drizzle_migrations) y las del replicador (turso_cdc y
// compañía), que cambian de tamaño por su cuenta y dispararían la alarma sin
// que nadie haya perdido nada.
const tableRowCounts = async (db: Db): Promise<Map<string, number>> => {
  const tables = await db.all<{ name: string }>(
    sql.raw(
      `SELECT name FROM sqlite_master WHERE type='table'
         AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         AND name NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND name NOT LIKE 'turso\\_%' ESCAPE '\\'
       ORDER BY name`,
    ),
  );

  const counts = new Map<string, number>();
  for (const { name } of tables) {
    // El nombre viene de sqlite_master, no de fuera: no hay nada que inyectar.
    const [row] = await db.all<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM "${name}"`));
    counts.set(name, Number(row?.n ?? 0));
  }
  return counts;
};

// Una reconstrucción de tabla, con red.
//
// Aquí antes había una PROHIBICIÓN: cualquier migración con __new_ se negaba a
// correr en local, para siempre. Nació el 7-ago-2026 tras perder producción
// dos veces, cuando no se sabía por qué pasaba — y prohibir era lo único
// responsable que se podía hacer sin entenderlo.
//
// Lo que se sabe ahora, medido el 8-ago-2026 sobre una copia de producción
// entera (985 juegos, 39.602 logros, 5 tablas hijas con CASCADE):
//   · Contra Turso, vía client.migrate(): reconstrucción completa de `games`,
//     CERO filas perdidas, integrity_check ok, los UNIQUE intactos.
//   · En local, con el driver de verdad y el migrador de drizzle: CERO filas
//     perdidas. El driver no dispara las cascadas en el borrado implícito del
//     DROP TABLE, a diferencia de SQLite estándar.
// O sea que la reconstrucción, HOY, sale limpia por los dos lados.
//
// Pero "me salió bien tres veces" no es una garantía, y el 7-ago también
// pareció ir bien hasta que se miró. Así que la prohibición no se sustituye
// por confianza: se sustituye por PRUEBA. Antes de tocar nada se deja una
// copia exacta del fichero, y después se cuenta fila por fila. Si algo se
// perdió, se LANZA — y lanzar aquí para la app entera (ver main/index.ts),
// que es justo lo que hay que hacer: seguir arrancando con la base mermada
// significaría que el sync sube ese borrado a Turso y se lleva también el
// remoto. Esa amplificación es lo que convirtió un fallo en un desastre.
//
// La verificación por conteo existe además porque la que había NO habría
// cazado nada: comprobaba que no quedaran tablas puente __new_, y en el caso
// que destrozó la base no quedaba ninguna.

// Una pérdida VERIFICADA deja la base local mermada y eso no se "reintenta":
// las filas ya no están. Esta bandera la marca como NO SINCRONIZABLE para lo
// que queda de proceso y runSyncCycle se planta antes del pull/push.
//
// Existe porque lanzar NO bastaba, y la protección solo duraba 60 segundos: al
// lanzar, `localMigrationsPending` se queda en true y el ciclo siguiente vuelve
// a entrar en applyPendingLocalMigrations… pero el migrador de drizzle ya había
// apuntado la migración en __drizzle_migrations dentro de la MISMA transacción
// que corrió el DDL. O sea que a la vuelta ya no hay reconstrucción pendiente,
// applyMigrationsGuarded pasa de largo, nadie vuelve a contar filas y el push
// subía la base mermada a Turso un minuto después de haber detectado el
// destrozo. Justo la amplificación que todo este módulo existe para impedir.
//
// No se apaga sola: la salida es cerrar la app y restaurar la copia de
// backups/antes-de-<migración>.db.
let dataLossBlocksSync = false;

const applyRebuildVerified = async (db: Db, rebuild: string): Promise<void> => {
  const before = await tableRowCounts(db);

  // La copia va a la carpeta de siempre pero con nombre propio y sin fecha:
  // así la rotación de las copias diarias (que filtra por su propio patrón) no
  // se la lleva por delante justo cuando más falta hace.
  const backupsDir = join(app.getPath('userData'), 'backups');
  mkdirSync(backupsDir, { recursive: true });
  const safetyCopy = join(backupsDir, `antes-de-${rebuild}.db`);
  if (!existsSync(safetyCopy)) {
    const escaped = safetyCopy.replace(/'/g, "''");
    await db.run(sql.raw(`VACUUM INTO '${escaped}'`));
    removeEmptySidecars(safetyCopy);
  }
  console.log(`[db] ${rebuild} reconstruye una tabla — copia previa en ${safetyCopy}`);

  // Sin captura: es JUSTO la reconstrucción cuyo DDL, replicado hacia arriba,
  // se llevaba por delante la tabla ya migrada del remoto (ver
  // migrateWithoutCapture).
  await migrateWithoutCapture(db);

  const after = await tableRowCounts(db);
  const losses: string[] = [];
  for (const [table, rows] of before) {
    const now = after.get(table);
    // Una tabla que DESAPARECE cuenta como pérdida total: ninguna migración de
    // este proyecto borra tablas, así que si pasa es que algo salió mal.
    if (now === undefined) losses.push(`${table}: ${rows} -> (ya no existe)`);
    else if (now < rows) losses.push(`${table}: ${rows} -> ${now}`);
  }

  if (losses.length > 0) {
    // ANTES de lanzar: quien nos llame desde el ciclo de sync solo verá una
    // excepción, y una excepción sola no impide el push del minuto siguiente.
    dataLossBlocksSync = true;
    throw new Error(
      `${rebuild} PERDIÓ DATOS al reconstruir la tabla (${losses.join(', ')}). ` +
        `La copia de justo antes está en ${safetyCopy}. No sigas usando la app con esta base: ` +
        `el sync subiría el borrado a Turso.`,
    );
  }

  console.log(`[db] ${rebuild} aplicada y verificada: ${before.size} tablas, sin pérdidas`);
};

// ¿Hay pendiente alguna migración que reconstruya una tabla?
//
// Esta guarda es el guardarraíl que faltaba, y existe porque la puerta de
// arriba NO basta: aquella cubre "el remoto no está al día", pero el 7-ago-2026
// el push al remoto funcionó y aun así se perdió la base — el DROP+RENAME se
// ejecutó igualmente (en el remoto por su cuenta, y en la local al reflejarlo
// por sync) y dejó __new_games sin games, con las tablas hijas vaciadas por
// CASCADE. Nació negándose a aplicar esas migraciones para siempre; desde el
// 8-ago-2026 no bloquea, ENRUTA: quien tenga una reconstrucción pendiente pasa
// por applyRebuildVerified (copia previa + conteo de filas) en vez de por el
// migrador a pelo.
//
// El criterio de "pendiente" es EL NOMBRE, el mismo que usa drizzle y el mismo
// que usa listRemotePending contra el remoto (por eso comparten helper,
// selectPendingByName). Aquí se leía `max(created_at)` y se daba por pendiente
// todo lo que tuviera folderMillis por encima, con un comentario que afirmaba
// que era "el mismo criterio que usa drizzle" — y era falso: el migrador que
// de verdad corre filtra por nombre (`localMigrations.filter(lm =>
// !dbNamesSet.has(lm.name))`, drizzle-orm/migrator.utils.js). Los dos
// criterios solo discrepan en el caso PELIGROSO —una carpeta fuera de orden al
// fusionar ramas, o dos con el mismo segundo, que la comparación estricta `>`
// se saltaba— y ahí este guardarraíl decía "nada pendiente" mientras drizzle
// ejecutaba la reconstrucción entera sin copia previa ni conteo de filas.
//
// Y FALLA CERRADO. La lectura solo puede darse por buena cuando dice que no
// hay tabla de control: eso sí es una instalación nueva, que crea las tablas
// desde cero sin reconstruir nada. Cualquier OTRO fallo (una conexión a
// medias, un "database tape error" del replicador, el fichero bloqueado) se
// trata como "no sé qué hay aplicado", que es exactamente el arranque en el
// que MÁS falta hace la protección: se asume que no hay nada aplicado y se
// enruta por applyRebuildVerified. El precio de equivocarse por ese lado es
// una copia del .db y un conteo de filas; por el otro, la base.
const MISSING_MIGRATIONS_TABLE_HINT = 'no such table';

// drizzle envuelve TODO fallo de db.all() en un DrizzleQueryError cuyo
// .message es solo "Failed query: ..." — el texto del motor ("no such
// table...") vive en error.cause. Mirar solo .message hacia que la deteccion
// de instalacion nueva no acertara NUNCA y todo arranque virgen pasara por la
// ruta de reconstruccion con copia y conteo. Se recorre la cadena de causas
// entera (con tope, por si alguien encadena en circulo).
const errorChainText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ').toLowerCase();
};

const pendingTableRebuild = async (db: Db): Promise<string | null> => {
  let appliedNames = new Set<string>();
  try {
    const rows = await db.all<{ name: string | null }>(sql`select name from __drizzle_migrations`);
    appliedNames = new Set(
      rows.map((row) => row.name).filter((name): name is string => Boolean(name)),
    );
  } catch (error) {
    if (errorChainText(error).includes(MISSING_MIGRATIONS_TABLE_HINT)) return null;
    console.warn(
      '[db] no se pudo leer __drizzle_migrations: doy por pendiente TODO lo que haya en la carpeta para no aplicar una reconstruccion sin red',
      error,
    );
  }

  const pending = selectPendingByName(readLocalMigrations(MIGRATIONS_FOLDER), appliedNames);
  return (
    pending.find((migration) =>
      migration.statements.some((statement) => statement.includes(REBUILD_MARKER)),
    )?.name ?? null
  );
};

// LA ÚNICA VÍA por la que esta app aplica migraciones en su base local.
//
// Es una función y no dos líneas sueltas porque hay DOS entradas —el arranque
// (runMigrations) y el reintento del ciclo de sync (applyPendingLocalMigrations)—
// y hasta que se juntaron aquí solo la primera pasaba por el guardarraíl: la
// segunda llamaba a migrateWithoutCapture a pelo, sin preguntar por
// reconstrucciones, sin copia previa y sin conteo de filas. O sea que una
// migración diferida por arrancar sin red (justo la que la puerta de arriba
// deja pendiente) se aplicaba SIN protección… y tres líneas más abajo el
// push() de runSyncCycle habría subido a Turso lo que se hubiera perdido. Esa
// amplificación es exactamente lo que applyRebuildVerified existe para
// impedir, así que no puede haber una segunda puerta que la esquive.
const applyMigrationsGuarded = async (db: Db): Promise<void> => {
  const rebuild = await pendingTableRebuild(db);
  if (rebuild) {
    await applyRebuildVerified(db, rebuild);
    return;
  }

  await migrateWithoutCapture(db);
};

// El reintento de la puerta de arriba: el remoto ya está al día, así que ahora
// sí toca poner la local a la par. Va por withDbAccess como todo lo demás —
// esto corre desde el ciclo de sync, con el watcher sondeando por su cuenta.
//
// Si la verificación de una reconstrucción detecta pérdida, applyRebuildVerified
// LANZA. Aquí eso no tumba la app (esto no es el arranque): corta el ciclo y el
// error queda en lastSyncFailure, que Ajustes enseña. Pero lo que de verdad
// impide que el borrado suba a Turso NO es cortar este ciclo —el siguiente ya
// no vería nada pendiente— sino la bandera dataLossBlocksSync que
// applyRebuildVerified levanta antes de lanzar; ver allí.
//
// Así que la política no es una sola, son dos con el mismo throw detrás, y a
// propósito: por el arranque (runMigrations) cierra la app con diálogo, porque
// hay un humano delante al que se le puede pedir que restaure la copia; por
// aquí la sesión sigue viva pero ya sin sync, porque tumbar la ventana a mitad
// de una partida no salvaría ni una fila más.
const applyPendingLocalMigrations = async (): Promise<void> => {
  if (!localMigrationsPending || migrationPushPending || !dbInstance) return;
  await withDbAccess(async () => applyMigrationsGuarded(getDb()));
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

// ---- Puerta del ARRANQUE (para la ventana que nace antes que la conexión) --
//
// Hasta hoy el orden era rígido: primero runMigrations(), y solo después se
// creaba la ventana — porque antes de runMigrations() no hay conexión y
// getDb() LANZA. El precio medido de esa rigidez: la ventana esperaba a la
// comprobación de Turso (470 ms con la base despierta, hasta los 4000 ms de
// CONNECT_TIMEOUT_MS con la base dormida) sin que el renderer, que tarda otros
// ~155 ms en arrancar, hubiera empezado siquiera.
//
// Ahora main/index.ts crea la ventana ANTES de migrar, así que las primeras
// consultas del renderer pueden llegar con la conexión todavía sin abrir. En
// vez de reventar, ESPERAN aquí: la puerta se cierra al cargar el módulo y la
// abre runMigrations() al terminar. Es el mismo mecanismo que el swap en
// caliente y por la misma razón de fondo (no hay conexión utilizable ahora
// mismo), solo que una vez y al principio.
//
// getDb() sigue lanzando a propósito: quien llegue a la DB sin pasar por
// withDbAccess se está saltando también el swap, y eso tiene que doler.
//
// La línea que deja al abrirla dice CUÁNTAS consultas se encontraron la puerta
// cerrada, y no es adorno: es lo que demuestra que la carrera es real. Medido
// sobre arranques seguidos con la base despierta salen entre 0 y 4 según lo
// que tarde cada lado (el renderer no pide datos hasta bien entrado su montaje,
// así que a veces llega después). Con Turso dormido gana siempre el renderer y
// esperan aquí todas. Sin esta puerta, esas mismas consultas reventarían con
// "getDb() llamado antes de runMigrations()".
let startupGate: Promise<void> | null = null;
let releaseStartupGate: (() => void) | null = null;
let waitedAtStartupGate = 0;

startupGate = new Promise<void>((resolve) => {
  releaseStartupGate = resolve;
});

const openStartupGate = (): void => {
  console.log(
    `[db] puerta de arranque abierta: ${waitedAtStartupGate} consulta(s) esperaban a que hubiera conexion`,
  );
  releaseStartupGate?.();
  releaseStartupGate = null;
  startupGate = null;
};

// Todo acceso a la DB desde fuera del arranque (handlers IPC de dominios con
// DB, ciclo del watcher) entra por aquí. Las migraciones corren en el
// arranque, antes de que exista el timer de sync, así que no lo necesitan.
export const withDbAccess = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (startupGate) waitedAtStartupGate++;
  while (startupGate) await startupGate;
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
      console.log(`[db] conexion con Turso [${currentRemoteLabel()}] restablecida - sync activado`);
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

// Apuntar un fallo para que Ajustes lo enseñe. En una función porque hay DOS
// sitios que lo hacen: el catch del ciclo y la parada seca por esquema remoto
// a medias, que no lanza pero tampoco es un ciclo bueno — y la racha
// (`consecutive`, la que decide si esto va a consola) tiene que contarse igual
// en los dos.
const recordSyncFailure = (message: string, schemaMismatch: boolean): SyncFailure => {
  lastSyncFailure = {
    message,
    at: new Date(),
    schemaMismatch,
    consecutive: (lastSyncFailure?.consecutive ?? 0) + 1,
  };
  return lastSyncFailure;
};

// Lo que hay que hacer DESPUÉS de un pull que de verdad ha traído cosas.
//
// Hoy es el drenado del buzón del Plan, y vive aquí en vez de en cada llamador
// por dos motivos que costaron un repaso entero:
//
//  · `syncCapable` no significa "acaba de haber un pull": se pone a true una
//    vez y no vuelve a bajar aunque el pull siguiente falle. Colgar el drenado
//    de esa bandera dejaba que corriera contra datos viejos, y peor: cuando
//    runSyncCycle salía de inmediato por estar ya en marcha, el `.then()` del
//    llamador disparaba igual sin que hubiera habido pull ninguno.
//  · Había TRES sitios que llaman a runSyncCycle (arranque, el tic de 60s y
//    el de settings al guardar credenciales) y solo dos drenaban. Con el
//    enganche aquí dentro, cualquier llamador futuro —un botón de "sincronizar
//    ya", un handler de volver de suspensión— lo hereda sin acordarse.
//
// Se registra una sola vez desde main/index.ts. No se importa el drenado desde
// aquí a propósito: sería una dependencia circular (él ya importa este módulo).
let afterSuccessfulSync: (() => Promise<void>) | null = null;

export const onSyncCompleted = (task: () => Promise<void>): void => {
  afterSuccessfulSync = task;
};

// Un pull que trae filas es UN ESCRITOR MÁS de la base local, y el contrato de
// la casa dice que todo el que escribe avisa: los hooks de juegos usan
// `staleTime: Infinity` y solo se sostienen mientras eso se cumpla.
//
// Hasta que esto existió, el único aviso posterior al sync colgaba del drenado
// del buzón del Plan y solo salía si el buzón había aplicado algo: cubría la
// vía móvil→buzón y NO la normal. Lo que baja de OTRO PC tuyo (SPEC-2, "un
// solo usuario, varias máquinas suyas") entraba en la DB en silencio absoluto
// y la ventana seguía enseñando las horas, el estado y las notas de antes
// hasta reiniciar la app — sin ninguna pista, porque el sync iba bien.
//
// Se avisa a TODAS las ventanas: cada una tiene su propio caché de react-query
// (la principal y el HUD del overlay), la referencia a la principal vive en
// main/index.ts y no aquí, y un canal que una ventana no escucha es un no-op.
//
// Se EXPORTA porque este barrido es el único emisor que debe quedar. El
// drenado del buzón del Plan tenía el suyo propio en main/index.ts (mainWindow
// + sendToOverlay) y los dos disparaban en el MISMO ciclo: las filas del buzón
// llegan por pull, así que el ciclo que aplica órdenes es casi siempre uno con
// pulled=true. El overlay es un BrowserWindow más, o sea que aquel segundo
// emisor no añadía ni un destinatario — solo una segunda invalidación del
// caché — y encima ya discrepaban en el criterio (este alcanza cualquier
// ventana futura; aquel, dos conocidas).
export const notifyPulledChanges = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('games:changed');
  }
};

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
  // Base marcada por una pérdida verificada (ver dataLossBlocksSync): ni pull
  // ni push mientras dure el proceso. No se toca lastSyncFailure — el mensaje
  // del destrozo, con la ruta de la copia previa, es justo lo que Ajustes tiene
  // que seguir enseñando en vez de un "reintentando" que no va a arreglar nada.
  if (dataLossBlocksSync) return;
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

    // Y si el remoto quedó A MEDIO MIGRAR (ver remoteSchemaAhead), este ciclo
    // se planta aquí: acabamos de negarnos a poner la local a la par —la
    // puerta de connectAndMigrate lo impide mientras el push no cierre— así
    // que seguir a pull()/push() sería replicar filas entre dos esquemas
    // distintos, con el replicador yendo por POSICIÓN de columna. No es
    // permanente como dataLossBlocksSync: el reintento del push de arriba lo
    // levanta en cuanto Turso acepte lo que le falta.
    if (remoteSchemaAhead) {
      const failure = recordSyncFailure(
        'Turso se quedó a medio migrar: no se sincronizan filas hasta que se apliquen las migraciones que le faltan.',
        true,
      );
      if (failure.consecutive === 1) {
        console.warn(
          '[db] remoto a medio migrar: ni pull ni push hasta que las migraciones que faltan entren en Turso',
        );
      }
      return;
    }

    const db = getDb();
    // pull() devuelve si de verdad ha aplicado cambios: sin eso, avisar en
    // cada tic de 60s invalidaría el caché entero de la ventana un minuto sí
    // y otro también sin que nada hubiera cambiado.
    const pulled = await db.$client.pull();
    await db.$client.push();
    lastSyncFailure = null;

    if (pulled) notifyPulledChanges();

    // Y solo AQUÍ, con el pull ya hecho y sin fallo: es la única garantía de
    // que lo que el móvil escribió en el remoto existe ya en local. La tarea
    // no puede lanzar (ver runPlanMailboxDrain), pero se blinda igualmente:
    // un fallo suyo no puede contarse como un fallo de sync.
    try {
      await afterSuccessfulSync?.();
    } catch (taskError) {
      console.warn('[db] la tarea posterior al sync falló (el sync sí fue bien):', taskError);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const failure = recordSyncFailure(
      message,
      SCHEMA_MISMATCH_HINTS.some((hint) => lower.includes(hint)),
    );
    // Solo el PRIMERO de una racha va a consola: este ciclo corre cada minuto
    // y un fallo persistente llenaba el log de la misma línea repetida, que
    // es justo lo que hace que se deje de leer.
    if (failure.consecutive === 1) {
      console.warn('[db] fallo sincronizando con Turso (sigo en local, reintento luego):', error);
    }
  } finally {
    syncCycleRunning = false;
  }
};
