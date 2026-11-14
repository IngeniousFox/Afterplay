import { mock } from 'node:test';
import { openQueryDb, type QueryFixture } from '../queries/common/__tests__/fixtures';

// LA BASE 2.0 DE LOS TESTS DEL PROCESO PRINCIPAL.
//
// Los módulos de la app (watcher, colas, logros, partidas…) piden la base con
// `appCtx()` (db/v2/appDb.ts), que en la app la abre `initAppDb` al arrancar.
// Ese módulo arrastra 'electron', que no carga bajo tsx. Este andamio lo
// sustituye por una base 2.0 en memoria de verdad (`openQueryDb`: migraciones
// reales, este dispositivo creado, reloj de pared falso en `T0`), así que el
// código bajo prueba corre entero contra las consultas reales.
//
// ORDEN DE CARGA: `mock.module` tiene que registrarse ANTES de que se importe
// el módulo bajo prueba. Este fichero se importa arriba, con un import normal,
// y el módulo bajo prueba entra con `await import()` dentro de un `before()`.
// La ruta '../appDb' se resuelve desde AQUÍ (src/main/db/v2/__tests__); Node
// casa los mocks por URL resuelta, así que vale para cualquier importador.
//
// Necesita --experimental-test-module-mocks (ya está en el script `test`).

let current: QueryFixture | null = null;

const fixture = (): QueryFixture => {
  if (!current) throw new Error('appCtx() en un test sin base: llama antes a freshAppDb().');
  return current;
};

mock.module('../appDb', {
  namedExports: {
    APP_SCHEMA_VERSION: 1,
    appCtx: () => fixture().ctx,
    appLocalDb: () => fixture().local,
    initAppDb: () => null,
    closeAppDb: () => {},
  },
});

/** Una base nueva y vacía para el test que empieza (cierra la anterior). */
export function freshAppDb(options?: Parameters<typeof openQueryDb>[0]): QueryFixture {
  current?.close();
  current = openQueryDb(options);
  return current;
}

/** Para el `after()` del fichero. */
export function closeAppDbFixture(): void {
  current?.close();
  current = null;
}
