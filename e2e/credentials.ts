import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import {
  CREDENTIAL_KEYS,
  DATABASE_CREDENTIAL_KEYS,
  ENV_BY_CREDENTIAL_KEY,
  SYNC_CREDENTIAL_KEYS,
} from '../src/shared/credentialKeys';
import type { CredentialsValues } from '../src/shared/types';

// .env.test: LA ÚNICA FUENTE DE CREDENCIALES DE LOS TESTS E2E.
//
// La idea, y es la que hace segura toda esta carpeta: el peligro nunca fue
// "tener credenciales", fue que la app las cogiera de un sitio que nadie
// eligió. El susto del 3-ago-2026 no pasó por tener un .env, pasó porque una
// instancia de prueba lo adoptó SOLA. Así que en vez de prohibir credenciales
// (lista negra, que se rompe el día que aparece una puerta nueva), se declara
// una lista BLANCA: en modo E2E la app usa exactamente lo que hay en este
// fichero y nada más — ni el .env del proyecto, ni el credentials.json real
// del dueño, ni lo que lleve puesto la terminal.
//
// Lo que eso desbloquea es justo lo que un E2E vale: probar las integraciones
// DE VERDAD. El día que HowLongToBeat rotó su API (agosto de 2026,
// /api/bleed -> 404) ningún test se enteró, porque ninguno salía a la red;
// con credenciales de test, un E2E le pregunta a HLTB por un juego conocido y
// se pone rojo el mismo día que cambie.
//
// SIN .env.test la suite sigue corriendo: los tests que necesiten una clave
// concreta se saltan solos diciendo cuál falta. Un clon recién bajado tiene
// que poder ejecutar `npm run test:e2e` sin configurar nada.
//
// LAS DOS DE LA BASE DE DATOS NO ENTRAN NUNCA: una clave de IGDB abre un
// catálogo público, pero DATABASE_URL abre una biblioteca. La app 2.0 ya no
// se conecta a Turso (R-14), así que en el sandbox no tienen nada que hacer,
// y una credencial de producción no debe estar cerca de un proceso que pulsa
// botones solo. Lo mismo vale, con más razón, para el token del hub del sync
// (SYNC_CREDENTIAL_KEYS): ni .env.test puede traerlo, y el sandbox lo quita
// aunque alguien lo colara.

const ENV_TEST_PATH = join(process.cwd(), '.env.test');

export type TestCredentials = {
  // Todo lo que trae el fichero, ya con la forma que la app guarda.
  values: Partial<CredentialsValues>;
  // Qué claves de entorno traía de verdad, para poder decir cuál falta.
  present: Set<string>;
  exists: boolean;
};

const readEnvTest = (): TestCredentials => {
  if (!existsSync(ENV_TEST_PATH)) {
    return { values: {}, present: new Set(), exists: false };
  }

  const parsed = parse(readFileSync(ENV_TEST_PATH, 'utf-8'));
  const values: Partial<CredentialsValues> = {};
  const present = new Set<string>();

  for (const key of CREDENTIAL_KEYS) {
    const envName = ENV_BY_CREDENTIAL_KEY[key];
    const value = parsed[envName]?.trim();
    if (!value) continue;
    values[key] = value;
    present.add(envName);
  }

  return { values, present, exists: true };
};

// Se lee UNA vez por proceso de test: el fichero no cambia a mitad de suite y
// releerlo por cada arranque solo multiplicaría accesos a disco.
export const testCredentials = readEnvTest();

// Lo que se escribe en el credentials.json del sandbox: todo .env.test menos
// las de la base de datos (ver la cabecera).
export const credentialsForSandbox = (): Partial<CredentialsValues> => {
  const values = { ...testCredentials.values };
  for (const key of DATABASE_CREDENTIAL_KEYS) delete values[key];
  const loose = values as Record<string, unknown>;
  for (const key of SYNC_CREDENTIAL_KEYS) delete loose[key];
  return values;
};

// ¿Están TODAS las variables que este test necesita? Devuelve el motivo del
// salto (para test.skip) o null si se puede correr. Se nombra la variable que
// falta y el fichero donde ponerla: un test que se salta sin decir por qué es
// un test que nadie vuelve a activar.
export const missingFor = (...envNames: string[]): string | null => {
  if (!testCredentials.exists) {
    return 'sin .env.test en la raíz del repo (copia .env.test.example y rellénalo)';
  }
  const missing = envNames.filter((name) => !testCredentials.present.has(name));
  return missing.length === 0 ? null : `falta ${missing.join(', ')} en .env.test`;
};
