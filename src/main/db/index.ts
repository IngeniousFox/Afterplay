import { createClient } from '@libsql/client';
import { app, net } from 'electron';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/tursodatabase-sync';
import { migrate } from 'drizzle-orm/tursodatabase-sync/migrator';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { pushPendingMigrations } from './migrationSync';

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

export const isDbSyncCapable = (): boolean => syncCapable;

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

const connectLocalOnly = async (): Promise<Db> => {
  const db = drizzle({ connection: { path: getDbPath(), clientName: 'afterplay' } });
  await db.$client.connect();
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
const pushMigrationsToRemote = async (): Promise<void> => {
  if (!hasRemoteConfigured()) return;

  const client = createClient({
    url: process.env.DATABASE_URL as string,
    authToken: process.env.DATABASE_AUTH_TOKEN as string,
  });

  try {
    const { applied } = await withTimeout(
      pushPendingMigrations(client, join(__dirname, '../../drizzle')),
      CONNECT_TIMEOUT_MS,
    );
    if (applied.length > 0) {
      console.log(`[db] migraciones aplicadas directamente en Turso: ${applied.join(', ')}`);
    }
  } catch (error) {
    console.warn(
      '[db] no se pudo empujar migraciones directamente a Turso, sigo igualmente:',
      error,
    );
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
  await withTimeout(db.$client.connect(), CONNECT_TIMEOUT_MS);
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
    console.log('[db] conectado con Turso - sync activado');
    return { db, capable: true };
  } catch (error) {
    if (isStaleMetadataError(error)) {
      console.warn(
        '[db] metadatos de sync huerfanos (sin fichero principal), limpiando y reintentando...',
      );
      clearOrphanedSyncSidecars();
      try {
        const db = await connectWithSync();
        console.log('[db] conectado con Turso tras limpiar metadatos huerfanos - sync activado');
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

// out/main -> out -> project root -> drizzle. Same relative depth in dev and
// in the packaged app (electron-builder includes the folder by default; it's
// plain text read via fs, so it doesn't need asarUnpack).
export const runMigrations = async (): Promise<void> => {
  // Conexión aparte, antes de tocar la de verdad: deja el remoto al día por
  // su cuenta (ver pushMigrationsToRemote) para que el CDC nunca tenga que
  // cargar con el DDL de esta migración.
  await pushMigrationsToRemote();

  const { db, capable } = await attemptInitialConnect();
  dbInstance = db;
  syncCapable = capable;

  // SQLite trae las foreign keys APAGADAS por defecto (es un pragma por
  // conexión): sin esto, los ON DELETE CASCADE del schema no se aplican y
  // borrar un juego dejaría huérfanas sus iterations/sessions/events.
  // Se activa aquí porque las migraciones son lo primero que corre en el
  // arranque y la conexión es un singleton — todo lo demás la hereda ya ON.
  await db.run(sql`PRAGMA foreign_keys = ON`);
  await migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
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
// DB, ciclo del watcher) entra por aquí. El seed y las migraciones corren en
// el arranque, antes de que exista el timer de sync, así que no lo necesitan.
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
  // tenga que cargar con ese DDL al hacer push() más abajo.
  await pushMigrationsToRemote();

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
      await db.run(sql`PRAGMA foreign_keys = ON`);
      dbInstance = db;
      syncCapable = true;
      console.log('[db] conexion con Turso restablecida - sync activado');
    } catch (error) {
      console.warn('[db] reintento de conexion con Turso fallido, sigo en local:', error);
      const db = await connectLocalOnly();
      await db.run(sql`PRAGMA foreign_keys = ON`);
      dbInstance = db;
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

export const runSyncCycle = async (): Promise<void> => {
  if (syncCycleRunning) return;
  syncCycleRunning = true;

  try {
    if (!syncCapable) await attemptSyncUpgrade();
    if (!syncCapable) return;

    const db = getDb();
    await db.$client.pull();
    await db.$client.push();
  } catch (error) {
    console.warn('[db] fallo sincronizando con Turso (sigo en local, reintento luego):', error);
  } finally {
    syncCycleRunning = false;
  }
};
