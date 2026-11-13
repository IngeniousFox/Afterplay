import { mock } from 'node:test';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import type { LegacyQueryViews } from './legacyQueries';

// DÓNDE CORREN LAS CONSULTAS 1.x FUERA DE LA APP (script y tests).
//
// Las consultas 1.x llaman a `getDb()` de `src/main/db/index.ts`, que fuera de
// Electron no carga (`@tursodatabase/sync` muere bajo tsx). Esto hace lo mismo
// que `db/__tests__/harness.ts`: sustituye ese módulo con `mock.module` por
// uno cuyo `getDb()` devuelve una conexión `@libsql/client` a la copia de la
// base 1.x. Es el driver con el que se prueban hoy esas consultas (mismo
// SQLite y mismo esquema de Drizzle que en producción).
//
// Requisitos, los mismos que el andamio de los tests:
// - Node con `--experimental-test-module-mocks` (el script se relanza solo con
//   la opción si le falta; `npm test` ya la pasa).
// - Importar este módulo ANTES de que nada cargue una consulta 1.x: por eso
//   `legacyQueries.ts` se carga con `import()` dentro de `collect…`.
//
// No forma parte del importador que usará la app: allí `getDb()` ya es la
// conexión 1.x.

type LegacyDb = ReturnType<typeof drizzle>;
let current: LegacyDb | null = null;

// La ruta se resuelve desde AQUÍ (src/main/db/v2/importer): '../../index' es
// src/main/db/index.ts, el mismo módulo que las consultas importan como '../..'.
mock.module('../../index', {
  namedExports: {
    getDb: (): LegacyDb => {
      if (!current) throw new Error('consultas 1.x sin base: usa collectLegacyViewsFrom().');
      return current;
    },
    withDbAccess: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  },
});

/**
 * Abre `path` (una COPIA de una base 1.x) y ejecuta sobre ella todas las
 * lecturas 1.x que compara la validación. Cierra la conexión al terminar.
 */
export async function collectLegacyViewsFrom(path: string): Promise<LegacyQueryViews> {
  const client: Client = createClient({ url: `file:${path}` });
  try {
    current = drizzle({ client });
    const { collectLegacyQueryViews } = await import('./legacyQueries');
    return await collectLegacyQueryViews();
  } finally {
    current = null;
    client.close();
    // `close()` no suelta el fichero mientras queden sentencias sin finalizar,
    // y esas solo se finalizan al recolectarlas: en Windows la copia quedaría
    // bloqueada hasta salir del proceso (EBUSY al borrarla). Con `--expose-gc`
    // (el script lo pide) se recolecta aquí; sin él, quien llama no puede
    // borrar la copia hasta que el proceso acabe.
    (globalThis as { gc?: () => void }).gc?.();
  }
}
