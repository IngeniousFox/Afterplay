import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

// LA MIGRACIÓN AUTOMÁTICA DESDE EL .ENV LEGADO (importLegacyEnv, vía
// initCredentials) — LA PUERTA DEL SUSTO DEL 3-AGO-2026.
//
// Aquel día una instancia de prueba con carpeta de datos nueva importó el
// .env DEL PROYECTO —que llevaba la base REAL activa— y acabó empujándole una
// migración a producción. Lo que se blinda aquí no es "que lea un .env", son
// las tres guardas que hoy evitan que se repita:
//
//   1. Solo se importa si NO existe credentials.json todavía — una instalación
//      con credenciales ya no vuelve a tocar el .env, aunque reaparezca.
//   2. Importado, el .env de userData se RETIRA (renombrado a .imported.bak):
//      un segundo arranque no tiene de dónde volver a leer.
//   3. En modo E2E (isE2E()) esto no se ejecuta NUNCA — la guarda que existe
//      *porque* pasó el incidente, y que hasta hoy no tenía ni un test.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: el módulo credentials.ts es el de verdad,
// leyendo y escribiendo ficheros de verdad en una carpeta temporal por test.
// Doblados: electron (app.getPath/isPackaged, safeStorage — igual que
// credentials.test.ts) y ../../lib/e2e (para poder encender/apagar el modo
// E2E sin depender de la variable de entorno real del proceso, que además es
// de solo-lectura al cargar ese módulo).
//
// app.isPackaged se deja SIEMPRE en `true`: así importLegacyEnv() nunca añade
// el .env del PROYECTO (process.cwd()) a sus candidatos — ese camino de
// desarrollo no se ejerce aquí a propósito, para que este fichero jamás pueda
// tocar el .env real de este repo por accidente.

const CIFRA = 'dpapi:';

let userDataDir = '';
let e2eActivo = false;

mock.module('electron', {
  namedExports: {
    app: {
      getPath: (): string => userDataDir,
      isPackaged: true,
    },
    safeStorage: {
      isEncryptionAvailable: (): boolean => true,
      encryptString: (value: string): Buffer => Buffer.from(`${CIFRA}${value}`, 'utf-8'),
      decryptString: (buffer: Buffer): string => buffer.toString('utf-8').slice(CIFRA.length),
    },
  },
});

mock.module('../../lib/e2e', {
  namedExports: {
    isE2E: (): boolean => e2eActivo,
  },
});

let credenciales: typeof import('../credentials');

before(async () => {
  credenciales = await import('../credentials');
});

const carpetasCreadas: string[] = [];

const carpetaNueva = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-legacyenv-'));
  carpetasCreadas.push(dir);
  return dir;
};

beforeEach(() => {
  userDataDir = carpetaNueva();
  e2eActivo = false;
});

after(() => {
  for (const dir of carpetasCreadas) rmSync(dir, { recursive: true, force: true });
});

const rutaEnv = (): string => join(userDataDir, '.env');
const rutaCredenciales = (): string => join(userDataDir, 'credentials.json');

describe('importar el .env legado de userData', () => {
  it('lo importa y lo RETIRA (renombrado, nunca borrado ni dejado en su sitio)', () => {
    writeFileSync(rutaEnv(), 'TWITCH_CLIENT_ID=legado-1\nDATABASE_URL=libsql://legado.turso.io\n');

    credenciales.initCredentials();

    assert.equal(credenciales.getCredentials().twitchClientId, 'legado-1');
    assert.equal(credenciales.getCredentials().databaseUrl, 'libsql://legado.turso.io');
    // applyToEnv() en caliente: el resto de la app (igdb/auth, db/index) sigue
    // leyendo process.env, así que initCredentials tiene que dejarlo puesto.
    assert.equal(process.env.TWITCH_CLIENT_ID, 'legado-1');

    assert.ok(!existsSync(rutaEnv()), 'el .env original ya no está donde estaba');
    assert.ok(existsSync(`${rutaEnv()}.imported.bak`), 'se retira renombrado, no borrado');
    assert.ok(existsSync(rutaCredenciales()), 'la importación deja credentials.json escrito');
  });

  it('no vuelve a importar en un segundo arranque: credentials.json ya existe', () => {
    writeFileSync(rutaEnv(), 'TWITCH_CLIENT_ID=legado-1\n');
    credenciales.initCredentials();
    assert.equal(credenciales.getCredentials().twitchClientId, 'legado-1');

    // Un .env NUEVO reaparece en userData (por lo que sea: una copia vieja,
    // un instalador que lo vuelve a dejar caer) con OTRO valor.
    writeFileSync(rutaEnv(), 'TWITCH_CLIENT_ID=deberia-ignorarse\n');

    credenciales.initCredentials();

    // La guarda de initCredentials mira PRESENCIA de credentials.json, no si
    // hay un .env nuevo: con el fichero ya ahí, importLegacyEnv() ni se llama.
    assert.equal(credenciales.getCredentials().twitchClientId, 'legado-1');
    assert.ok(existsSync(rutaEnv()), 'el .env reaparecido se deja intacto, sin tocar');
    assert.equal(readFileSync(rutaEnv(), 'utf-8'), 'TWITCH_CLIENT_ID=deberia-ignorarse\n');
  });

  it('con credentials.json ya existente desde el arranque, un .env presente no se toca', () => {
    // Mismo desenlace que el test anterior pero sin pasar por una importación
    // previa — el caso normal de cualquier arranque no-primero de la app.
    credenciales.setCredentials({
      ...credenciales.getCredentials(),
      twitchClientId: 'de-ajustes',
    });
    writeFileSync(rutaEnv(), 'TWITCH_CLIENT_ID=del-env\n');

    credenciales.initCredentials();

    assert.equal(credenciales.getCredentials().twitchClientId, 'de-ajustes');
    assert.ok(existsSync(rutaEnv()), 'el .env no se retira: nunca se llegó a mirar');
  });

  it('en modo E2E nunca se importa, aunque no exista credentials.json todavía', () => {
    // La guarda que existe PORQUE pasó el incidente: una carpeta de datos
    // virgen (el escenario exacto del 3-ago-2026) con un .env delante no
    // puede adoptarlo mientras el modo E2E esté encendido.
    e2eActivo = true;
    writeFileSync(
      rutaEnv(),
      'TWITCH_CLIENT_ID=legado-1\nDATABASE_URL=libsql://produccion.turso.io\n',
    );

    credenciales.initCredentials();

    assert.deepEqual(credenciales.getCredentials().twitchClientId, null);
    assert.deepEqual(credenciales.getCredentials().databaseUrl, null);
    assert.ok(existsSync(rutaEnv()), 'ni se toca ni se retira: la guarda corta ANTES de mirarlo');
    assert.ok(!existsSync(rutaCredenciales()), 'no se escribe nada');
  });

  it('un .env sin ninguna clave conocida no importa nada y se deja donde está', () => {
    writeFileSync(rutaEnv(), 'ALGO_QUE_NO_ES_NUESTRO=x\n');

    credenciales.initCredentials();

    assert.ok(!existsSync(rutaCredenciales()), 'sin claves reconocidas, no hay nada que guardar');
    assert.ok(existsSync(rutaEnv()), 'y por tanto tampoco nada que retirar');
  });
});
