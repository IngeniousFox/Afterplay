import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import type { CredentialsValues } from '../../../shared/types';

// LLEVARSE LAS CLAVES A OTRO PC (export/import de credentials.ts).
//
// Lo que se blinda aquí no es "que escriba un fichero", sino las decisiones
// que hacen que un traslado no te deje tirado a medio camino:
//
//   1. Ida y vuelta: lo exportado en un PC entra igual en otro.
//   2. El fichero habla en NOMBRES DE ENTORNO, no en campos internos — es lo
//      que permite escribirlo a mano y que renombrar un campo del tipo no
//      invalide los ficheros exportados ayer.
//   3. Importar FUSIONA: un fichero con una sola clave no borra las demás.
//   4. Lo importado se vuelve a CIFRAR (el traslado va en claro, el reposo no).
//   5. Un fichero que no es de esto falla y deja lo que había intacto.
//   6. El fichero soltado en la carpeta de datos: se aplica, se retira, y se
//      cuenta UNA vez — y si está roto se queda donde está para corregirlo.
//
// QUE ES REAL Y QUE ES DOBLE: el módulo es el de verdad, escribiendo ficheros
// de verdad en una carpeta temporal por test. Lo doblado es electron y nada
// más: app.getPath (la carpeta de datos) y safeStorage (DPAPI, que no existe
// fuera de Electron). El cifrado falso es un prefijo — basta para distinguir
// "guardado en claro" de "guardado cifrado", que es lo que importa aquí.

const CIFRA = 'dpapi:';

let userDataDir = '';
let cifradoDisponible = true;

mock.module('electron', {
  namedExports: {
    app: {
      getPath: (): string => userDataDir,
      // isPackaged en true A PROPOSITO: con false, initCredentials mira el
      // .env DEL PROYECTO (importLegacyEnv), que en esta máquina tiene
      // credenciales reales — el test acabaría hablando con una base de
      // verdad. Es la misma trampa del susto del 3-ago-2026.
      isPackaged: true,
    },
    safeStorage: {
      isEncryptionAvailable: (): boolean => cifradoDisponible,
      encryptString: (value: string): Buffer => Buffer.from(`${CIFRA}${value}`, 'utf-8'),
      decryptString: (buffer: Buffer): string => {
        const text = buffer.toString('utf-8');
        if (!text.startsWith(CIFRA)) throw new Error('cifrado con otra cuenta');
        return text.slice(CIFRA.length);
      },
    },
  },
});

// El módulo real, importado DESPUES del doble. En un before() y no con
// top-level await: los tests compilan como CJS.
let credenciales: typeof import('../credentials');

const VACIAS: CredentialsValues = {
  twitchClientId: null,
  twitchClientSecret: null,
  steamGridDbApiKey: null,
  databaseUrl: null,
  databaseAuthToken: null,
  r2AccountId: null,
  r2Bucket: null,
  r2AccessKeyId: null,
  r2SecretAccessKey: null,
  anthropicApiKey: null,
  steamApiKey: null,
  steamUserId64: null,
  raUsername: null,
  raApiKey: null,
};

const conClaves = (overrides: Partial<CredentialsValues>): CredentialsValues => ({
  ...VACIAS,
  ...overrides,
});

const carpetasCreadas: string[] = [];

// Una carpeta de datos NUEVA por test: es lo que hace que cada uno empiece
// sin credentials.json, como una instalación virgen.
const carpetaNueva = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-keys-'));
  carpetasCreadas.push(dir);
  return dir;
};

before(async () => {
  credenciales = await import('../credentials');
});

beforeEach(() => {
  userDataDir = carpetaNueva();
  cifradoDisponible = true;
});

after(() => {
  for (const dir of carpetasCreadas) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('exportar claves', () => {
  it('escribe un fichero con los nombres de entorno, no con los campos internos', () => {
    credenciales.setCredentials(
      conClaves({ twitchClientId: 'cliente-1', steamApiKey: 'steam-abc' }),
    );

    const destino = carpetaNueva();
    const ruta = credenciales.exportCredentialsTo(destino);

    assert.equal(ruta, join(destino, credenciales.KEYS_FILE_NAME));
    const contenido = JSON.parse(readFileSync(ruta, 'utf-8')) as {
      afterplayKeys: number;
      keys: Record<string, string>;
    };
    assert.equal(contenido.afterplayKeys, 1);
    assert.deepEqual(contenido.keys, {
      TWITCH_CLIENT_ID: 'cliente-1',
      STEAM_API_KEY: 'steam-abc',
    });
  });

  it('se niega a exportar cuando no hay ninguna clave configurada', () => {
    // Un fichero de aspecto correcto y vacío por dentro no falla hasta el
    // otro PC, donde ya no hay forma de saber de quien fue la culpa.
    assert.throws(() => credenciales.exportCredentialsTo(carpetaNueva()), /no keys to export/i);
  });
});

describe('importar claves', () => {
  it('lo exportado en un PC entra igual en otro', () => {
    credenciales.setCredentials(
      conClaves({
        twitchClientId: 'cliente-1',
        twitchClientSecret: 'secreto-1',
        databaseUrl: 'libsql://mi-base.turso.io',
        databaseAuthToken: 'token-largo',
      }),
    );
    const traslado = credenciales.exportCredentialsTo(carpetaNueva());

    // El PC de destino: carpeta de datos virgen, sin credentials.json.
    userDataDir = carpetaNueva();
    const resultado = credenciales.importCredentialsFromFile(traslado);

    assert.equal(resultado.imported, 4);
    assert.equal(resultado.values.twitchClientId, 'cliente-1');
    assert.equal(resultado.values.databaseAuthToken, 'token-largo');
    assert.deepEqual(credenciales.getCredentials(), resultado.values);
  });

  it('fusiona en vez de reemplazar: lo que no trae el fichero se queda', () => {
    credenciales.setCredentials(
      conClaves({ twitchClientId: 'cliente-1', twitchClientSecret: 'secreto-1' }),
    );

    const soloSteam = join(carpetaNueva(), 'claves.json');
    writeFileSync(soloSteam, JSON.stringify({ keys: { STEAM_API_KEY: 'steam-abc' } }));
    const resultado = credenciales.importCredentialsFromFile(soloSteam);

    assert.equal(resultado.imported, 1);
    assert.equal(resultado.values.steamApiKey, 'steam-abc');
    // Lo importante: seguir teniendo IGDB después de importar solo Steam.
    assert.equal(resultado.values.twitchClientId, 'cliente-1');
    assert.equal(resultado.values.twitchClientSecret, 'secreto-1');
  });

  it('pisa el valor viejo cuando el fichero SI trae esa clave', () => {
    credenciales.setCredentials(conClaves({ twitchClientId: 'el-viejo' }));

    const fichero = join(carpetaNueva(), 'claves.json');
    writeFileSync(fichero, JSON.stringify({ keys: { TWITCH_CLIENT_ID: 'el-nuevo' } }));
    credenciales.importCredentialsFromFile(fichero);

    assert.equal(credenciales.getCredentials().twitchClientId, 'el-nuevo');
  });

  it('acepta un .env escrito a mano y un JSON plano', () => {
    const env = join(carpetaNueva(), '.env');
    writeFileSync(env, 'TWITCH_CLIENT_ID=desde-env\nSTEAMGRIDDB_API_KEY=sgdb-1\n');
    assert.equal(credenciales.importCredentialsFromFile(env).imported, 2);
    assert.equal(credenciales.getCredentials().twitchClientId, 'desde-env');

    const plano = join(carpetaNueva(), 'plano.json');
    writeFileSync(plano, JSON.stringify({ STEAM_API_KEY: 'steam-plano' }));
    assert.equal(credenciales.importCredentialsFromFile(plano).imported, 1);
    assert.equal(credenciales.getCredentials().steamApiKey, 'steam-plano');
  });

  it('guarda cifrado lo que llega en claro', () => {
    const fichero = join(carpetaNueva(), 'claves.json');
    writeFileSync(fichero, JSON.stringify({ keys: { DATABASE_AUTH_TOKEN: 'token-secreto' } }));
    credenciales.importCredentialsFromFile(fichero);

    // El traslado va en claro por narices (DPAPI es por máquina), pero el
    // reposo no: en credentials.json no puede quedar el valor legible.
    const guardado = readFileSync(join(userDataDir, 'credentials.json'), 'utf-8');
    assert.ok(!guardado.includes('token-secreto'));
    assert.equal(credenciales.getCredentials().databaseAuthToken, 'token-secreto');
  });

  it('un fichero que no es de esto falla y deja lo que habia intacto', () => {
    credenciales.setCredentials(conClaves({ twitchClientId: 'cliente-1' }));

    const ajeno = join(carpetaNueva(), 'otra-cosa.json');
    writeFileSync(ajeno, JSON.stringify({ nombre: 'una lista de la compra' }));
    assert.throws(() => credenciales.importCredentialsFromFile(ajeno), /Afterplay keys/i);

    const roto = join(carpetaNueva(), 'roto.json');
    writeFileSync(roto, '{ esto no es json');
    assert.throws(() => credenciales.importCredentialsFromFile(roto), /keys file/i);

    assert.equal(credenciales.getCredentials().twitchClientId, 'cliente-1');
  });
});

describe('el fichero soltado en la carpeta de datos', () => {
  const soltar = (contenido: string): string => {
    const ruta = join(userDataDir, credenciales.KEYS_FILE_NAME);
    writeFileSync(ruta, contenido);
    return ruta;
  };

  it('se aplica en el arranque, se retira y se cuenta una sola vez', () => {
    const ruta = soltar(JSON.stringify({ keys: { TWITCH_CLIENT_ID: 'del-fichero' } }));

    credenciales.initCredentials();

    assert.equal(credenciales.getCredentials().twitchClientId, 'del-fichero');
    assert.equal(process.env.TWITCH_CLIENT_ID, 'del-fichero');
    // Retirado: si se quedara, cada arranque volveria a pisar lo que hayas
    // cambiado en Ajustes desde entonces.
    assert.ok(!existsSync(ruta));
    assert.ok(existsSync(`${ruta}.imported.bak`));

    assert.deepEqual(credenciales.takeStartupKeysImport(), { ok: true, imported: 1 });
    // Y una sola vez: el aviso ya se dio, un segundo montaje no lo repite.
    assert.equal(credenciales.takeStartupKeysImport(), null);
  });

  it('manda sobre las credenciales que ya hubiera', () => {
    // No esta condicionado a que falten, como si lo esta el .env legado:
    // soltar el fichero es una orden explicita de "usa estas".
    credenciales.setCredentials(conClaves({ twitchClientId: 'las-de-siempre' }));
    soltar(JSON.stringify({ keys: { TWITCH_CLIENT_ID: 'las-nuevas' } }));

    credenciales.initCredentials();

    assert.equal(credenciales.getCredentials().twitchClientId, 'las-nuevas');
    credenciales.takeStartupKeysImport();
  });

  it('si esta roto se queda donde esta y el fallo viaja', () => {
    credenciales.setCredentials(conClaves({ twitchClientId: 'las-de-siempre' }));
    const ruta = soltar('{ esto tampoco es json');

    credenciales.initCredentials();

    // Se deja para poder corregirlo y volver a arrancar.
    assert.ok(existsSync(ruta));
    assert.ok(!existsSync(`${ruta}.imported.bak`));
    assert.equal(credenciales.getCredentials().twitchClientId, 'las-de-siempre');

    const aviso = credenciales.takeStartupKeysImport();
    assert.equal(aviso?.ok, false);
  });

  it('sin fichero soltado no hay nada que contar', () => {
    credenciales.initCredentials();
    assert.equal(credenciales.takeStartupKeysImport(), null);
  });
});
