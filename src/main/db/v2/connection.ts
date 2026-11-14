import { DatabaseSync } from 'node:sqlite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import {
  HybridClock,
  isDeviceShortId,
  isReservedDeviceShortId,
  maxClockOf,
  type Clock,
} from '../../../shared/sync/clock';
import { syncedEntries } from './registry';
import { localSyncState } from './schema';
import { WriteStore, type ForeignWriteRule, type LocalDb } from './store';

// Conexión a la base local 2.0 (AFTERPLAY-2.0.md §8.9).
//
// `node:sqlite` a través de `drizzle-orm/node-sqlite`: un driver SÍNCRONO, el
// mismo modelo que la API SQL de un Durable Object, para que el núcleo de sync
// se escriba una vez y corra en el hub y en el escritorio. Una sola conexión
// para toda la vida del proceso: desaparecen el cambio de conexión en caliente
// y `withDbAccess` como candado de la 1.x.
//
// Dónde vive `Afterplay2.db` y cómo se empaqueta `drizzle-v2/` lo decide quien
// integre con Electron: aquí se reciben las rutas.

export interface OpenLocalDatabaseOptions {
  /** Fichero de la base, o `':memory:'` en los tests. La carpeta debe existir. */
  readonly path: string;
  /** El `machineId` de este dispositivo (D-11): dueño de sus filas O. */
  readonly deviceId: string;
  /** Carpeta con las migraciones de Drizzle (`drizzle-v2/`). */
  readonly migrationsFolder: string;
  /** Reloj de pared (tests). Por defecto `Date.now`. */
  readonly wall?: () => number;
  /** Excepciones a la regla del dueño (fase 4). Ver `ForeignWriteRule`. */
  readonly foreignWriteRules?: readonly ForeignWriteRule[];
  /** Qué hacer si un oyente de cambios lanza. Por defecto, `console.error`. */
  readonly onListenerError?: (error: unknown) => void;
}

export interface LocalDatabase {
  /**
   * La base Drizzle para LECTURAS. Escribir en tablas sincronizadas con ella
   * está prohibido (§8.6, lo vigila un test): para eso está `store`. Las
   * tablas `local_*` sí se escriben directamente.
   */
  readonly db: LocalDb;
  /** La puerta única de escritura (§8.6). */
  readonly store: WriteStore;
  /** El reloj del dispositivo; el motor de sync (fase 3) lo adelanta al recibir filas. */
  readonly clock: HybridClock;
  readonly deviceId: string;
  /** Id corto con el que firma el reloj (§8.2). */
  readonly shortDeviceId: string;
  /** Cierra la conexión. Idempotente. */
  close(): void;
}

/** Espera de SQLite si otro proceso tiene el candado (una herramienta, otra instancia). */
export const BUSY_TIMEOUT_MS = 5000;

export function openLocalDatabase(options: OpenLocalDatabaseOptions): LocalDatabase {
  const { path, deviceId, migrationsFolder } = options;
  // El deviceId forma ids compuestos (`<gameId>:<deviceId>`, §7.2): con `:`
  // dentro no se podrían leer de vuelta y fallaría cada instalación.
  if (deviceId.length === 0 || deviceId.includes(':')) {
    throw new Error(`openLocalDatabase: deviceId inválido (${deviceId})`);
  }
  const client = new DatabaseSync(path);
  try {
    applyPragmas(client, path);
    const db = drizzle({ client });
    migrate(db, { migrationsFolder });
    // Las migraciones de drizzle-kit que reconstruyen tablas llevan
    // `PRAGMA foreign_keys=OFF/ON`. Dentro de la transacción del migrador no
    // tienen efecto, pero se vuelve a fijar y comprobar por si alguna se
    // ejecutara fuera: escribir con las claves foráneas apagadas sin saberlo
    // es justo lo que §7.7 reserva a la descarga de sync.
    client.exec('PRAGMA foreign_keys = ON');
    if (pragma(client, 'foreign_keys') !== 1) {
      throw new Error('openLocalDatabase: no se pudieron activar las claves foráneas');
    }

    const wall = options.wall ?? Date.now;
    const shortDeviceId = ensureShortDeviceId(db, deviceId);
    // §8.2 "Arranque": por encima del mayor reloj de la base. Importa al
    // restaurar una copia hecha con un reloj adelantado: sin esto, una
    // escritura local podría llevar un reloj menor que la fila que modifica,
    // perdería en la fusión y "limpiar syncDirty si syncUpdated no cambió"
    // (§8.5) dejaría de ser seguro.
    const clock = new HybridClock(shortDeviceId, wall, maxStoredClock(db));
    const store = new WriteStore({
      db,
      clock,
      deviceId,
      wall,
      foreignWriteRules: options.foreignWriteRules,
      onListenerError: options.onListenerError,
    });

    let closed = false;
    return {
      db,
      store,
      clock,
      deviceId,
      shortDeviceId,
      close: () => {
        if (closed) return;
        closed = true;
        client.close();
      },
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

function pragma(client: DatabaseSync, name: string): unknown {
  const row = client.prepare(`PRAGMA ${name}`).get();
  return row ? Object.values(row)[0] : undefined;
}

/**
 * PRAGMA de la conexión. Se fijan antes de migrar: `foreign_keys` no se puede
 * cambiar dentro de una transacción.
 */
function applyPragmas(client: DatabaseSync, path: string): void {
  // WAL: los lectores no bloquean al escritor ni al revés, y una escritura
  // interrumpida no corrompe la base. En memoria no aplica (queda `memory`).
  if (path !== ':memory:') {
    client.exec('PRAGMA journal_mode = WAL');
    if (pragma(client, 'journal_mode') !== 'wal') {
      throw new Error(`openLocalDatabase: no se pudo activar WAL en ${path}`);
    }
  }
  // FULL y no NORMAL: con WAL + NORMAL un corte de luz puede perder las
  // transacciones confirmadas desde el último checkpoint (minutos de cierres
  // de sesión y ediciones). El volumen de escritura de la app es pequeño y un
  // fsync por transacción no se nota; perder un cierre de sesión, sí (F-05).
  client.exec('PRAGMA synchronous = FULL');
  // §7.7: claves foráneas declaradas solo en el cliente y comprobadas en toda
  // escritura normal. Solo la descarga de sync las apaga (fase 3).
  client.exec('PRAGMA foreign_keys = ON');
  // Una sola conexión por proceso, pero otro proceso puede abrir el fichero
  // (copias de seguridad, herramientas): mejor esperar que fallar al momento.
  client.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
}

const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Un id corto al azar: 6 caracteres `[0-9a-z]`, nunca uno reservado (`000000`, `legacy`). */
export function randomShortDeviceId(): string {
  for (;;) {
    let id = '';
    while (id.length < 6) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      for (const byte of bytes) {
        // Muestreo por rechazo: 252 = 36 × 7. Con `byte % 36` a secas, los
        // primeros caracteres saldrían más a menudo y habría más choques.
        if (byte >= 252 || id.length === 6) continue;
        id += SHORT_ID_ALPHABET[byte % 36];
      }
    }
    if (!isReservedDeviceShortId(id)) return id;
  }
}

/**
 * Lee el id corto de `local_sync_state` y lo sortea la primera vez. Si lo
 * guardado no es válido (una edición a mano, una base de otra versión) se
 * sortea otro: solo desempata relojes (§8.2) y ningún dato depende de él.
 *
 * Revisión, hallazgo 6: también se sortea otro si se sorteó para OTRO
 * dispositivo (la base se copió a este PC). Si no, dos PCs con la misma base
 * firmarían con el mismo id corto. El reloj no retrocede por cambiar de id:
 * arranca igualmente por encima del mayor reloj guardado (`maxStoredClock`).
 */
function ensureShortDeviceId(db: LocalDb, deviceId: string): string {
  db.insert(localSyncState).values({ id: 1 }).onConflictDoNothing().run();
  const row = db
    .select({
      shortDeviceId: localSyncState.shortDeviceId,
      shortDeviceIdFor: localSyncState.shortDeviceIdFor,
    })
    .from(localSyncState)
    .where(eq(localSyncState.id, 1))
    .get();
  const stored = row?.shortDeviceId;
  if (
    isDeviceShortId(stored) &&
    !isReservedDeviceShortId(stored) &&
    row?.shortDeviceIdFor === deviceId
  ) {
    return stored;
  }
  let fresh = randomShortDeviceId();
  // Que el nuevo no repita por azar el del otro PC (1 entre 2.000 millones,
  // pero cuesta una comparación).
  while (fresh === stored) fresh = randomShortDeviceId();
  db.update(localSyncState)
    .set({ shortDeviceId: fresh, shortDeviceIdFor: deviceId })
    .where(eq(localSyncState.id, 1))
    .run();
  return fresh;
}

/**
 * El mayor reloj de la base. `syncUpdated` es, por definición (§7.3), el mayor
 * reloj de su fila, lápida incluida, así que basta su máximo por tabla: un
 * recorrido de una sola columna, sin parsear `syncFields`.
 */
export function maxStoredClock(db: LocalDb): Clock {
  const maxima: (Clock | null)[] = [];
  for (const entry of syncedEntries) {
    const row = db
      .select({ value: sql<Clock | null>`max("syncUpdated")` })
      .from(entry.table)
      .get();
    maxima.push(row?.value ?? null);
  }
  // `maxClockOf` valida el formato: un texto corrupto que se ordenase por
  // encima de todo arrastraría el reloj a un futuro imposible.
  return maxClockOf(maxima);
}
