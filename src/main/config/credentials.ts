import { app, safeStorage } from 'electron';
import { parse } from 'dotenv';
import { existsSync, readFileSync, renameSync, unlinkSync } from 'fs';
import { writeFileAtomicSync } from '../lib/atomicWrite';
import { isE2E } from '../lib/e2e';
import {
  CREDENTIAL_KEYS as SHARED_CREDENTIAL_KEYS,
  ENV_BY_CREDENTIAL_KEY,
} from '../../shared/credentialKeys';
import { join } from 'path';
import type {
  CredentialsImportResult,
  CredentialsValues,
  StartupKeysImport,
} from '../../shared/types';

// Credenciales de servicios externos (Twitch/IGDB, SteamGridDB, Turso),
// guardadas en userData/credentials.json cifradas con safeStorage (DPAPI en
// Windows) — sustituye al .env para SIEMPRE en la app: una instalación
// virgen arranca sin nada, funciona en local, y las claves se meten desde
// Ajustes. El .env del PROYECTO sigue existiendo solo para tooling de
// desarrollo (drizzle-kit, scripts/) que corre fuera de Electron y no puede
// leer safeStorage.
//
// El resto del código NO cambia: todo sigue leyendo process.env en el
// momento de usarlo (igdb/auth, sgdb/client, db/index). Este módulo solo
// decide DE DÓNDE salen esos valores: los carga al arrancar y los actualiza
// en caliente cuando se guardan desde Ajustes.

// El mapa vive en shared/credentialKeys.ts: lo comparte el andamio de los
// tests E2E, que fabrica el credentials.json de su sandbox desde un
// .env.test y no puede importar este fichero (arrastra electron).
const ENV_BY_KEY = ENV_BY_CREDENTIAL_KEY;

const CREDENTIAL_KEYS = SHARED_CREDENTIAL_KEYS;

type CredentialsFile = {
  version: 1;
  // false solo si safeStorage no estaba disponible al guardar (raro en
  // Windows) — los valores van entonces en claro, como iba el .env de antes.
  encrypted: boolean;
  values: Partial<Record<keyof CredentialsValues, string>>;
};

const getFilePath = (): string => join(app.getPath('userData'), 'credentials.json');

const encryptValue = (value: string): { stored: string; encrypted: boolean } =>
  safeStorage.isEncryptionAvailable()
    ? { stored: safeStorage.encryptString(value).toString('base64'), encrypted: true }
    : { stored: value, encrypted: false };

const decryptValue = (stored: string, encrypted: boolean): string | null => {
  if (!encrypted) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch (error) {
    // Cifrado con otra cuenta de usuario/máquina (DPAPI es por usuario) o
    // fichero corrupto — se trata como "sin valor" y se re-teclea en Ajustes.
    console.warn('[credentials] no se pudo descifrar un valor guardado:', error);
    return null;
  }
};

const readFile = (): CredentialsFile | null => {
  try {
    return JSON.parse(readFileSync(getFilePath(), 'utf-8')) as CredentialsFile;
  } catch {
    return null;
  }
};

const writeValues = (values: Partial<Record<keyof CredentialsValues, string>>): void => {
  let anyPlaintext = false;
  const stored: CredentialsFile['values'] = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = values[key];
    if (!value) continue;
    const { stored: encoded, encrypted } = encryptValue(value);
    stored[key] = encoded;
    if (!encrypted) anyPlaintext = true;
  }
  const file: CredentialsFile = { version: 1, encrypted: !anyPlaintext, values: stored };
  // Atómico: un credentials.json truncado por un cierre a mitad de escritura
  // es justo lo que dispara la reimportación del .env legado en el arranque
  // (ver initCredentials) — y en desarrollo eso puede acabar apuntando a la
  // base de producción. Mejor que no exista a que exista a medias.
  writeFileAtomicSync(getFilePath(), JSON.stringify(file, null, 2));
};

// Los valores en claro actuales (descifrados). null = sin configurar.
export const getCredentials = (): CredentialsValues => {
  const file = readFile();
  const result = {} as CredentialsValues;
  for (const key of CREDENTIAL_KEYS) {
    const stored = file?.values[key];
    result[key] = stored ? decryptValue(stored, file?.encrypted ?? false) : null;
  }
  return result;
};

const applyToEnv = (values: CredentialsValues): void => {
  for (const key of CREDENTIAL_KEYS) {
    const envName = ENV_BY_KEY[key];
    const value = values[key];
    if (value) process.env[envName] = value;
    else delete process.env[envName];
  }
};

// Guardado desde Ajustes: persiste y actualiza process.env EN CALIENTE — el
// que llama (ipc/settings) se encarga además de invalidar los clientes
// cacheados que capturaron la clave vieja (token de Twitch, cliente SGDB).
export const setCredentials = (input: CredentialsValues): void => {
  const normalized = {} as CredentialsValues;
  for (const key of CREDENTIAL_KEYS) {
    const trimmed = input[key]?.trim() ?? '';
    normalized[key] = trimmed === '' ? null : trimmed;
  }
  const toStore: Partial<Record<keyof CredentialsValues, string>> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = normalized[key];
    if (value) toStore[key] = value;
  }
  writeValues(toStore);
  applyToEnv(normalized);
};

// El HOST de una base remota, para el log. Los dos caminos que IMPORTAN
// claves de fuera (el .env legado de abajo y el fichero de traslado de más
// abajo) deciden con qué base habla la app, y el 3-ago-2026 nos costó un
// susto: una instancia de prueba con carpeta de datos nueva importó el .env
// del proyecto —que entonces tenía la base REAL activa— y acabó empujándole
// una migración a producción. Desde entonces se dice en voz alta QUÉ base
// entra. Solo el host, jamás el token: esto acaba pegado en informes de error.
//
// EXPORTADA porque el tercer sitio que anuncia base —db/index.ts, en cada log
// de conexión— tenía su propia copia byte a byte de esto, con este mismo
// incidente contado otra vez encima. Es la función que decide qué base se
// canta, o sea el dato exacto que costó el susto: cambiarle el formato (por
// ejemplo, distinguir prod de test con algo más que el primer segmento del
// host) tenía que hacerse dos veces o no servía de nada. Esta firma es la
// buena de las dos: recibe la url en vez de leer process.env por dentro.
export const remoteLabel = (databaseUrl: string | null | undefined): string => {
  if (!databaseUrl) return 'sin remota';
  try {
    return new URL(databaseUrl).hostname.split('.')[0];
  } catch {
    return 'remota desconocida';
  }
};

// ── LLEVARSE LAS CLAVES A OTRO PC ──────────────────────────────────────────
//
// credentials.json NO se puede copiar y ya: safeStorage cifra con DPAPI, que
// es por usuario y por máquina, así que en el PC de destino no descifra nada
// (decryptValue lo trata como "sin valor" y te quedas sin claves creyendo
// que las llevas). El traslado tiene por eso su propio fichero, en claro,
// que la app vuelve a cifrar en cuanto lo importa.
//
// Que vaya en claro es deliberado y es la parte incómoda: el destino tiene
// que poder leerlo sin saber nada del origen, y el camino automático
// —soltarlo en la carpeta de datos— ocurre en el arranque, sin nadie delante
// a quien pedirle una contraseña. Es el mismo trato que tenía el .env al que
// esto sustituyó, con dos mejoras: vive donde tú lo dejes, y en cuanto se
// aplica se BORRA (ver importDroppedKeysFile — "retirarlo" fue durante un
// tiempo renombrarlo, que dejaba las claves legibles ahí para siempre).
export const KEYS_FILE_NAME = 'afterplay-keys.json';

// Se escribe con los NOMBRES DE ENTORNO, no con las claves internas del tipo:
// son los que ya reconoce cualquiera que haya visto un .env de esto, así el
// fichero se puede escribir a mano y sigue valiendo. De paso, renombrar un
// campo de CredentialsValues no invalida los ficheros exportados ayer.
type KeysFileShape = {
  afterplayKeys: 1;
  exportedAt: string;
  keys: Record<string, string>;
};

// Escribe afterplay-keys.json en la carpeta elegida y devuelve la ruta. Si ya
// había uno, se pisa a propósito: es el mismo fichero con las claves de
// ahora, no una copia más que confunda sobre cuál es la buena.
export const exportCredentialsTo = (directory: string): string => {
  const current = getCredentials();
  const keys: Record<string, string> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = current[key];
    if (value) keys[ENV_BY_KEY[key]] = value;
  }
  // Exportar la nada escribiría un fichero de aspecto correcto que en el otro
  // PC no importa nada — y ahí ya no hay forma de saber de quién fue la
  // culpa. Mejor negarse aquí, con el usuario delante.
  if (Object.keys(keys).length === 0) {
    throw new Error('There are no keys to export yet — add some above first.');
  }

  const file: KeysFileShape = {
    afterplayKeys: 1,
    exportedAt: new Date().toISOString(),
    keys,
  };
  const path = join(directory, KEYS_FILE_NAME);
  writeFileAtomicSync(path, JSON.stringify(file, null, 2));
  console.log(`[credentials] exportadas ${Object.keys(keys).length} claves a ${path}`);
  return path;
};

// Qué se acepta al importar, en este orden: nuestro export (objeto con
// `keys`), un JSON plano de NOMBRE -> valor (escrito a mano) y un .env de
// toda la vida, que es lo que mucha gente ya tiene de antes y no cuesta nada
// admitir. Lo que no sea una cadena se ignora en vez de reventar: un campo de
// más en el fichero no puede tumbar la importación entera.
const parseKeysFile = (text: string): Record<string, string> => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return parse(trimmed);

  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const source = (
    typeof parsed.keys === 'object' && parsed.keys !== null ? parsed.keys : parsed
  ) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string') values[name] = value;
  }
  return values;
};

// Importar FUSIONA, nunca reemplaza: un fichero que solo trae la key de Steam
// no puede dejarte sin la de IGDB. Lo que no venga en el fichero se queda
// exactamente como estaba.
const importKeys = (raw: Record<string, string>): CredentialsImportResult => {
  const current = getCredentials();
  const merged: Partial<Record<keyof CredentialsValues, string>> = {};
  let imported = 0;
  for (const key of CREDENTIAL_KEYS) {
    const incoming = raw[ENV_BY_KEY[key]]?.trim();
    const existing = current[key];
    if (incoming) {
      merged[key] = incoming;
      imported += 1;
    } else if (existing) {
      merged[key] = existing;
    }
  }
  // Ni una sola clave conocida: casi seguro el fichero equivocado (otro json
  // cualquiera, el export de otra cosa). Fallar aquí es lo único que
  // distingue "te has traído el fichero que no era" de "ya estaba importado".
  if (imported === 0) {
    throw new Error("That file doesn't have any Afterplay keys in it.");
  }

  writeValues(merged);
  const values = getCredentials();
  applyToEnv(values);
  return { imported, values };
};

export const importCredentialsFromFile = (path: string): CredentialsImportResult => {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    throw new Error("Couldn't read that file.");
  }

  let raw: Record<string, string>;
  try {
    raw = parseKeysFile(text);
  } catch {
    throw new Error("That file isn't a keys file — expected the JSON that Export writes.");
  }

  const result = importKeys(raw);
  console.log(
    `[credentials] importadas ${result.imported} claves de ${path} -> DB [${remoteLabel(result.values.databaseUrl)}]`,
  );
  return result;
};

// El aviso del fichero soltado, esperando a que exista un renderer al que
// contárselo: la importación ocurre en el arranque, mucho antes de que haya
// ventana. Se consume una vez (ver takeStartupKeysImport).
let startupKeysImport: StartupKeysImport | null = null;

export const takeStartupKeysImport = (): StartupKeysImport | null => {
  const pending = startupKeysImport;
  startupKeysImport = null;
  return pending;
};

// El camino AUTOMÁTICO: dejas afterplay-keys.json en la carpeta de datos y
// abres la app. Se mira en CADA arranque —no solo cuando faltan credenciales,
// como el .env legado de abajo— porque soltar el fichero es una orden
// explícita de "usa estas", y el caso normal es una app que ya tenía las
// suyas: las viejas, o las de otra cuenta.
const importDroppedKeysFile = (): void => {
  const path = join(app.getPath('userData'), KEYS_FILE_NAME);
  if (!existsSync(path)) return;

  try {
    const { imported } = importCredentialsFromFile(path);
    startupKeysImport = { ok: true, imported };
    // BORRADO en cuanto se aplica, no renombrado.
    //
    // Retirarlo es obligatorio por lo de siempre: si se quedara, cada arranque
    // volvería a pisar con él lo que hayas cambiado en Ajustes desde entonces.
    // Pero aquí se renombraba a `.imported.bak` y eso dejaba el fichero EN
    // CLARO —con el token de Turso, la key de Anthropic y las de R2 dentro—
    // tirado para siempre en la misma carpeta userData, al lado del
    // credentials.json que safeStorage cifra precisamente para que esos
    // valores no estén legibles en reposo. Las claves ya están guardadas y
    // cifradas cuando se llega aquí, así que la copia legible no salva nada
    // que no esté salvado: solo alarga la ventana en la que basta con leer un
    // fichero de texto.
    try {
      unlinkSync(path);
    } catch (error) {
      console.warn('[credentials] no se pudo borrar el fichero de claves importado:', error);
    }
  } catch (error) {
    // NO se retira: se deja donde está para poder corregirlo y volver a
    // arrancar. Y el fallo viaja al renderer, que es quien puede decirlo.
    const message = error instanceof Error ? error.message : String(error);
    startupKeysImport = { ok: false, message };
    console.error(`[credentials] no se pudo importar ${path}: ${message}`);
  }
};

// Migración única desde el mundo .env: si todavía no existe credentials.json
// pero hay un .env con valores (el de userData que la app instalada usaba, o
// el del proyecto en desarrollo), se importan y el de userData se renombra a
// .env.imported.bak — a partir de ahí el .env deja de leerse para siempre.
const importLegacyEnv = (): void => {
  // En un test de extremo a extremo, JAMÁS. Su carpeta de datos es virgen, o
  // sea que sin esta salida caería aquí y adoptaría el .env del proyecto —
  // que lleva la base que el dueño tenga activa ese día. Es el escenario
  // exacto del 3-ago-2026, y la razón de que el modo E2E exista (ver e2e.ts).
  if (isE2E()) return;

  const userDataEnvPath = join(app.getPath('userData'), '.env');
  const candidates = [userDataEnvPath];
  if (!app.isPackaged) candidates.push(join(process.cwd(), '.env'));

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    try {
      const parsed = parse(readFileSync(envPath, 'utf-8'));
      const values: Partial<Record<keyof CredentialsValues, string>> = {};
      for (const key of CREDENTIAL_KEYS) {
        const value = parsed[ENV_BY_KEY[key]]?.trim();
        if (value) values[key] = value;
      }
      if (Object.keys(values).length === 0) continue;

      writeValues(values);
      // Se dice QUÉ base remota traen, no solo de dónde vienen: este es el
      // punto exacto donde un .env decide con qué base habla la app (ver
      // remoteLabel para el susto que lo trajo).
      console.log(
        `[credentials] importadas del .env legado (${envPath}) -> DB [${remoteLabel(values.databaseUrl)}]`,
      );
      if (envPath === userDataEnvPath) {
        // Solo se retira el de userData — el del proyecto es la fuente del
        // tooling de desarrollo (drizzle-kit/scripts) y no se toca.
        try {
          renameSync(userDataEnvPath, `${userDataEnvPath}.imported.bak`);
        } catch (error) {
          console.warn('[credentials] no se pudo renombrar el .env importado:', error);
        }
      }
      return;
    } catch (error) {
      console.warn(`[credentials] no se pudo importar ${envPath}:`, error);
    }
  }
};

// Llamar UNA vez en el arranque, tras app.whenReady() (safeStorage lo exige)
// y ANTES de runMigrations() — la conexión con Turso y el push de
// migraciones leen process.env en ese momento.
export const initCredentials = (): void => {
  // Gatear por PRESENCIA del fichero, no por readFile(): readFile() devuelve
  // null tanto si falta como si está corrupto, y un credentials.json truncado
  // (un cierre a mitad de escritura) disparaba importLegacyEnv() — que en
  // desarrollo relee el .env del PROYECTO y puede adoptar la DATABASE_URL de
  // producción (el incidente del 3-ago-2026). Si existe pero no parsea, se
  // avisa fuerte y NO se importa: mejor arrancar sin credenciales (se
  // re-teclean en Ajustes) que hablar con la base equivocada.
  if (existsSync(getFilePath())) {
    if (!readFile()) {
      console.error(
        '[credentials] credentials.json existe pero no se pudo leer/parsear — NO se importa el .env legado. Re-introduce las claves en Ajustes.',
      );
    }
  } else {
    importLegacyEnv();
  }
  // Y el traslado desde otro PC, que va aparte del bloque de arriba a
  // propósito: no se condiciona a que falten credenciales (ver
  // importDroppedKeysFile). Nunca lanza — un fichero mal escrito no puede
  // impedir que la app arranque con lo que ya tenía.
  importDroppedKeysFile();
  applyToEnv(getCredentials());
};
