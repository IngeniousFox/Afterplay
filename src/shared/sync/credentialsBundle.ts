// El paquete de credenciales que viaja entre los PCs emparejados al mismo hub.
// Lo comparten el escritorio (main/sync/runtime.ts) y el hub
// (hub/worker/src/credentialBundle.ts), que lo guarda cifrado. Solo tipos y
// funciones puras: ni red ni almacenamiento.
//
// QUÉ VIAJA: todas las claves de servicios (IGDB, SteamGridDB, R2, S3,
// Anthropic, Steam, RetroAchievements) y el destino de las partidas guardadas
// (`saveStorageProvider`), del que dependen las de R2/S3.
// QUÉ NO VIAJA JAMÁS: `databaseUrl` y `databaseAuthToken` (Turso es de la 1.x y
// decide con qué base habla cada PC) ni el emparejado con el hub.

import { CREDENTIAL_KEYS } from '../credentialKeys';
import type { CredentialsValues } from '../types';

/** Las claves que NO se sincronizan nunca. */
const NEVER_SYNCED: readonly (keyof CredentialsValues)[] = ['databaseUrl', 'databaseAuthToken'];

/** Pseudo-clave: el valor de configuración `saveStorageProvider` ('cloudflare' | 's3'). */
export const STORAGE_PROVIDER_KEY = 'saveStorageProvider';

export type SyncedCredentialKey =
  | Exclude<keyof CredentialsValues, 'databaseUrl' | 'databaseAuthToken'>
  | typeof STORAGE_PROVIDER_KEY;

export const SYNCED_CREDENTIAL_KEYS: readonly SyncedCredentialKey[] = [
  ...CREDENTIAL_KEYS.filter((key) => !NEVER_SYNCED.includes(key)),
  STORAGE_PROVIDER_KEY,
] as SyncedCredentialKey[];

/** `value: null` = la clave se borró; ese borrado también se propaga. */
export interface CredentialEntry {
  value: string | null;
  /** ms desde epoch del último cambio hecho por una persona (no del sync). */
  updatedAt: number;
}

export type CredentialsBundle = Partial<Record<SyncedCredentialKey, CredentialEntry>>;

/** Tope de cada valor: las claves reales miden decenas de caracteres. */
export const CREDENTIAL_VALUE_MAX_LENGTH = 4096;

const SYNCED_SET = new Set<string>(SYNCED_CREDENTIAL_KEYS);

/** ¿Es la clave de una credencial que viaja? */
export const isSyncedCredentialKey = (key: string): key is SyncedCredentialKey =>
  SYNCED_SET.has(key);

/** ASCII imprimible (con espacio): sin saltos de línea ni caracteres de control. */
const PRINTABLE = /^[\x20-\x7e]+$/;

/** ¿Es un valor que el hub aceptaría para `key`? */
export function isSyncableValue(key: SyncedCredentialKey, value: string): boolean {
  if (value.length === 0 || value.length > CREDENTIAL_VALUE_MAX_LENGTH) return false;
  if (!PRINTABLE.test(value)) return false;
  return key !== STORAGE_PROVIDER_KEY || value === 'cloudflare' || value === 's3';
}

/**
 * Valida un paquete recibido. ESTRICTO: una clave desconocida, un valor fuera de
 * forma o un sello no entero lanzan `Error` (sin incluir el valor en el mensaje).
 */
export function parseCredentialsBundle(input: unknown): CredentialsBundle {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('el paquete de credenciales debe ser un objeto');
  }
  const out: CredentialsBundle = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!isSyncedCredentialKey(key)) {
      throw new Error(`clave de credencial desconocida: ${key.slice(0, 40)}`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`entrada no válida para ${key}`);
    }
    const { value, updatedAt, ...rest } = raw as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw new Error(`campos desconocidos en ${key}`);
    if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      throw new Error(`updatedAt no válido para ${key}`);
    }
    if (value !== null && (typeof value !== 'string' || !isSyncableValue(key, value))) {
      throw new Error(`valor no válido para ${key}`);
    }
    out[key] = { value, updatedAt };
  }
  return out;
}

/**
 * Fusiona dos paquetes, clave a clave: gana la entrada entrante si la base no
 * tiene ninguna o si es MÁS NUEVA; en un empate se queda la de la base. Pura.
 */
export function mergeCredentialBundles(
  base: CredentialsBundle,
  incoming: CredentialsBundle,
): CredentialsBundle {
  const out: CredentialsBundle = { ...base };
  for (const key of SYNCED_CREDENTIAL_KEYS) {
    const entry = incoming[key];
    if (!entry) continue;
    const current = out[key];
    if (!current || entry.updatedAt > current.updatedAt) out[key] = { ...entry };
  }
  return out;
}
