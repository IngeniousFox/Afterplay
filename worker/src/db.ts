import { createClient } from '@libsql/client/web';
import type { Client as LibSqlClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql/web';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { TenantCredentials } from './tenants';

// El esquema COMPARTIDO, importado del escritorio tal cual. No hay una copia
// aquí, y esa es la razón de que la web viva en el mismo repo:
//
// El escritorio aplica sus migraciones DIRECTAMENTE contra Turso al arrancar
// (§5.4). La web lee esas mismas tablas. Con dos copias del esquema en dos
// repos, la deriva no da la cara al compilar sino en producción, como una fila
// leída con las columnas corridas — y el replicador de este proyecto va POR
// POSICIÓN de columna, así que ese fallo es silencioso y caro.
//
// Un detalle que lo confirma: las columnas en SQLite son camelCase
// (`endedAt`, no `ended_at`), porque drizzle usa el nombre de la propiedad tal
// cual. Escribir SQL a mano aquí sería tropezar con eso una y otra vez.
//
// Las tablas se importan donde se usan (src/queries/*), directamente del
// fichero del escritorio.
//
// POR QUÉ worker/package.json no declara drizzle-orm ni @libsql/client
// ---------------------------------------------------------------------
// Resuelven subiendo al node_modules de la app, y es DELIBERADO: `schema.ts`
// vive en src/main/db/, así que su propio `drizzle-orm/sqlite-core` resuelve
// contra la raíz sí o sí. Declarándolos aquí habría DOS copias de drizzle en
// el mismo bundle — las tablas construidas por una y consultadas por la otra.
// Sobrevive (drizzle compara `entityKind` por texto justo para eso), pero es
// una fragilidad gratuita a cambio de nada.
//
// El precio, dicho claro: `npm ci` dentro de worker/ a secas no basta para
// desplegar; hay que haber instalado la raíz. Aceptable porque el despliegue
// sale siempre de este repo, y porque `npm run typecheck` de la raíz ya cubre
// worker/ y avisaría antes.

/**
 * Abre la conexión de UNA petición.
 *
 * §5.2 regla 1 — y es EL bug de este diseño, el que hay que tener presente
 * cada vez que se toque este fichero.
 *
 * Los isolates de Cloudflare se reutilizan entre peticiones. Un cliente
 * guardado en una variable de módulo (`let db = ...` arriba del fichero, que
 * es como se hace en cualquier servidor de toda la vida) sobrevive a la
 * petición que lo creó y puede acabar sirviendo a la SIGUIENTE — que igual es
 * la del otro inquilino. No falla, no avisa: devuelve datos, los de otro.
 *
 * Por eso esto es una función que se llama dentro del handler y su resultado
 * no sale nunca del ámbito de la petición. Si alguna vez te apetece cachear
 * "para no reabrir la conexión": no. Abrir un cliente HTTP de libsql no cuesta
 * nada, y lo que te ahorrarías no compensa ni de lejos.
 */
// El tipo se declara ANTES y a mano, no con ReturnType<typeof openTenantDb>:
// esa forma obliga a dejar la función sin anotar, y el ESLint de la casa exige
// tipo de retorno explícito en todo.
export type TenantDb = LibSQLDatabase & { $client: LibSqlClient };

export const openTenantDb = (credentials: TenantCredentials): TenantDb =>
  drizzle({
    client: createClient({
      url: credentials.url,
      authToken: credentials.authToken,
    }),
  });
