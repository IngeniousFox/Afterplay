import { app } from 'electron';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/tursodatabase-sync';
import { migrate } from 'drizzle-orm/tursodatabase-sync/migrator';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

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

const connectLocalOnly = async (): Promise<Db> => {
  const db = drizzle({ connection: { path: getDbPath(), clientName: 'afterplay' } });
  await db.$client.connect();
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

// Decide sync sí/no UNA SOLA VEZ, al arrancar — nada de "subir de categoría"
// en caliente durante la sesión. Dos bugs reales llevaron a este diseño más
// simple:
//  1. Reconectar el MISMO fichero con url mientras la conexión local anterior
//     seguía abierta corrompió el fichero real (games/iterations/etc.
//     desaparecieron, solo quedaron las tablas internas de sync) — este
//     motor, todavía en early preview, no soporta bien dos conexiones vivas
//     a la vez sobre el mismo path.
//  2. Cerrar la anterior y abrir la nueva evitaba la corrupción, pero dejaba
//     una ventana real: cualquier query en vuelo en ese instante (el watcher
//     sondea cada 5s, sin relación con este ciclo) podía intentar usar la
//     conexión justo cuando se cerraba, y fallar con "connection is not
//     open". Con TODAS las queries de la app corriendo sobre un único
//     getDb() compartido, no hay forma barata de serializar ese swap sin
//     meter un lock por-query en todo el proyecto.
// La solución: decidir una vez, sin swap. Si arranca sin red, esa sesión
// entera se queda en local — para sincronizar hace falta reiniciar la app
// (tray → Open/Quit y volver a abrir), momento en el que se reintenta desde
// cero, ya sin nada más corriendo todavía. Un timeout acotado evita que un
// arranque sin red (o con el servicio caído) se quede colgado esperando.
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

// Ciclo de sync periódico (SPEC Bloque 4): solo pull+push sobre la conexión
// ya establecida al arrancar — sin reconectar nada, sin tocar dbInstance.
// Si esta sesión no tiene sync (arrancó sin red), no hace nada; se
// reintentará en el próximo reinicio de la app, no en caliente. Nunca
// lanza — un fallo de red aquí no debe tumbar nada.
export const runSyncCycle = async (): Promise<void> => {
  if (!syncCapable) return;

  const db = getDb();
  try {
    await db.$client.pull();
    await db.$client.push();
  } catch (error) {
    console.warn('[db] fallo sincronizando con Turso (sigo en local, reintento luego):', error);
  }
};
