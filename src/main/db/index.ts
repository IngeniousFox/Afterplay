import type { LibSQLDatabase } from 'drizzle-orm/libsql';

// LA BASE 1.x, SOLO PARA LEERLA.
//
// La app ya no abre la base 1.x: el proceso principal trabaja con la 2.0
// (`v2/appDb.ts`), que la importa una vez (`v2/runtime.ts`). Lo único que
// queda de la 1.x es lo que usa el importador para comprobar que la
// importación enseña lo mismo que enseñaba la 1.x
// (`v2/importer/legacyQueries.ts`): el esquema (`schema.ts`) y las lecturas de
// `queries/`, que piden la conexión con `getDb()`.
//
// Aquí no hay conexión: quien ejecuta esas lecturas pone la suya.
// `v2/importer/legacyQueryHost.ts` (el script de importación y los tests)
// sustituye este módulo con `mock.module` por una conexión `@libsql/client` a
// una COPIA de la base 1.x. Sin ese reemplazo, `getDb()` lanza: nada de la app
// debe llegar hasta aquí.
//
// El sync con Turso que vivía en este fichero ya no existe en el escritorio
// (AFTERPLAY-2.0.md, fase 2): el sync nuevo es la fase 3.

/** La conexión que esperan las lecturas 1.x (Drizzle sobre SQLite). */
export type LegacyDb = LibSQLDatabase<Record<string, never>>;

export const getDb = (): LegacyDb => {
  throw new Error(
    'getDb(): la base 1.x solo se lee desde el importador (legacyQueryHost.ts), no desde la app',
  );
};

/** Las lecturas 1.x la usan como envoltorio; sin conexión propia no hay nada que esperar. */
export const withDbAccess = async <T>(fn: () => Promise<T>): Promise<T> => fn();
