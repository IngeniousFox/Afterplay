import { app, safeStorage } from 'electron';
import { parse } from 'dotenv';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CredentialsValues } from '../../shared/types';

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

const ENV_BY_KEY: Record<keyof CredentialsValues, string> = {
  twitchClientId: 'TWITCH_CLIENT_ID',
  twitchClientSecret: 'TWITCH_CLIENT_SECRET',
  steamGridDbApiKey: 'STEAMGRIDDB_API_KEY',
  databaseUrl: 'DATABASE_URL',
  databaseAuthToken: 'DATABASE_AUTH_TOKEN',
};

const CREDENTIAL_KEYS = Object.keys(ENV_BY_KEY) as (keyof CredentialsValues)[];

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
  writeFileSync(getFilePath(), JSON.stringify(file, null, 2));
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

// Migración única desde el mundo .env: si todavía no existe credentials.json
// pero hay un .env con valores (el de userData que la app instalada usaba, o
// el del proyecto en desarrollo), se importan y el de userData se renombra a
// .env.imported.bak — a partir de ahí el .env deja de leerse para siempre.
const importLegacyEnv = (): void => {
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
      console.log(`[credentials] importadas del .env legado (${envPath})`);
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
  if (!readFile()) importLegacyEnv();
  applyToEnv(getCredentials());
};
