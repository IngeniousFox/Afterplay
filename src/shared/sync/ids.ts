// Identificadores de las tablas sincronizadas (AFTERPLAY-2.0.md §7.2).
//
// Tres formas: aleatorio (UUIDv7), determinista (UUIDv5 sobre un espacio de
// nombres fijo) y compuesto (partes unidas con `:`). Los deterministas son los
// que arreglan F-08 y F-21: dos PCs que dan de alta lo mismo offline producen
// la MISMA fila, y la fusión la junta campo a campo en vez de duplicarla.
//
// Sin `node:crypto`: esto corre también en el navegador y en el Worker. La
// aleatoriedad sale de `globalThis.crypto` (Node 22+, Electron, Workers) y el
// SHA-1 de UUIDv5 es propio porque tiene que ser síncrono (ver sha1.ts).

import { sha1 } from './sha1';

/**
 * Espacio de nombres UUIDv5 de Afterplay. NO DEBE CAMBIAR NUNCA: todos los ids
 * deterministas ya guardados (juegos con `igdbId`, copias de partidas) salen de
 * él. Cambiarlo haría que el mismo juego tuviera otro id en cada versión y
 * volverían los duplicados de F-08 y F-21.
 */
export const AFTERPLAY_NAMESPACE = '238ac618-84bc-446b-94b8-fb0f02d79a8e';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function uuidToBytes(uuid: string): Uint8Array {
  if (!isUuid(uuid)) throw new RangeError(`UUID mal formado: ${uuid}`);
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Marca versión (4 bits altos del byte 6) y variante RFC (`10` en el byte 8). */
function stamp(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

// ---------- UUIDv5 ----------

const utf8 = new TextEncoder();

/** UUIDv5 (RFC 9562 §5.5): SHA-1 del espacio de nombres seguido del nombre en UTF-8. */
export function uuidv5(name: string, namespace: string = AFTERPLAY_NAMESPACE): string {
  const ns = uuidToBytes(namespace);
  const nameBytes = utf8.encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  return bytesToUuid(stamp(sha1(input).slice(0, 16), 5));
}

// ---------- UUIDv7 ----------

/** Rellena el array con bytes aleatorios. Inyectable para tests deterministas. */
export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => void;

// `crypto` a secas y no `globalThis.crypto`: los tipos de Workers lo declaran
// como constante global, que no aparece como propiedad de `globalThis`.
const cryptoFill: RandomFill = (bytes) => {
  crypto.getRandomValues(bytes);
};

const MAX_UUID_MS = 2 ** 48 - 1;
// 74 bits aleatorios: 12 de rand_a y 62 de rand_b (RFC 9562 §5.7).
const RAND_BITS = BigInt(74);
const RAND_LIMIT = BigInt(1) << RAND_BITS;

export type UuidV7Generator = (at?: number | Date) => string;

/**
 * Crea un generador UUIDv7. Dentro del mismo milisegundo NO saca otro número
 * aleatorio: incrementa el anterior (RFC 9562 §6.2, método 2). Así una ráfaga
 * de altas en el mismo milisegundo (el importador, una sesión con sus eventos)
 * sale ordenada por creación, que es para lo que §7.2 elige UUIDv7, y nunca
 * repite un id aunque el azar fallara. Si el incremento desbordase los 74 bits
 * (haría falta empezar a menos de una ráfaga del máximo) se saca otro número:
 * se pierde el orden de esa ráfaga y la unicidad vuelve a depender del azar.
 *
 * Con un instante explícito distinto del último (el importador fecha las filas
 * con su fecha real, en cualquier orden) no se fuerza el orden con lo anterior:
 * hacerlo arrastraría todos los ids al instante más alto visto y perderían su
 * fecha. Esos ids siguen siendo únicos por sus 74 bits aleatorios.
 */
export function createUuidV7Generator(fill: RandomFill = cryptoFill): UuidV7Generator {
  let lastMs = -1;
  let lastRand = BigInt(0);

  const freshRand = (): bigint => {
    const bytes = new Uint8Array(10);
    fill(bytes);
    let rand = BigInt(0);
    for (const b of bytes) rand = (rand << BigInt(8)) | BigInt(b);
    // 80 bits sacados, 74 usados.
    return rand & (RAND_LIMIT - BigInt(1));
  };

  return (at) => {
    const ms = at === undefined ? Date.now() : at instanceof Date ? at.getTime() : at;
    if (!Number.isInteger(ms) || ms < 0 || ms > MAX_UUID_MS) {
      throw new RangeError(`instante fuera de rango para UUIDv7: ${String(at)}`);
    }
    let rand: bigint;
    if (ms === lastMs && lastRand + BigInt(1) < RAND_LIMIT) {
      rand = lastRand + BigInt(1);
    } else {
      rand = freshRand();
    }
    lastMs = ms;
    lastRand = rand;

    const bytes = new Uint8Array(16);
    let t = ms;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = t % 256;
      t = Math.floor(t / 256);
    }
    // rand_a (12 bits) en los bytes 6-7 tras la versión; rand_b (62 bits) en
    // los bytes 8-15 tras la variante.
    const randA = Number(rand >> BigInt(62));
    let randB = rand & ((BigInt(1) << BigInt(62)) - BigInt(1));
    bytes[6] = randA >> 8;
    bytes[7] = randA & 0xff;
    for (let i = 15; i >= 8; i--) {
      bytes[i] = Number(randB & BigInt(0xff));
      randB >>= BigInt(8);
    }
    return bytesToUuid(stamp(bytes, 7));
  };
}

/** UUIDv7 para filas sin clave natural (§7.2). `at` fija el instante (tests, importador). */
export const uuidv7: UuidV7Generator = createUuidV7Generator();

// ---------- Compuestos ----------

/**
 * Une partes con `:` (§7.2). Falla si una parte está vacía o contiene `:`.
 *
 * Por qué tan estricto: un id compuesto solo es único si se puede leer de vuelta
 * en sus partes. Con `:` dentro de una parte, `a:b` + `c` y `a` + `b:c` darían el
 * mismo id y dos filas distintas se fusionarían como si fueran una. Los casos de
 * la tabla que parecen chocar no lo hacen: `emu@<deviceId>` no lleva `:`, y
 * `<scopeType>:<scopeKey>` son DOS partes, no una con `:` dentro.
 *
 * La única excepción es `freePart`: UNA parte que puede contener `:` porque
 * todas las demás no pueden, y entonces la lectura sigue siendo única (lo que
 * sobra entre las partes fijas de los extremos es la parte libre). La usan los
 * ayudantes cuyo texto viene de fuera y no controlamos.
 */
function joinParts(parts: readonly string[], freePart?: number): string {
  if (parts.length < 2) throw new RangeError('un id compuesto necesita al menos dos partes');
  parts.forEach((part, i) => {
    if (typeof part !== 'string' || part.length === 0) {
      throw new RangeError(`parte ${i} de un id compuesto vacía`);
    }
    if (i !== freePart && part.includes(':')) {
      throw new RangeError(`parte ${i} de un id compuesto con ':': ${part}`);
    }
  });
  return parts.join(':');
}

export function compositeId(...parts: string[]): string {
  return joinParts(parts);
}

// ---------- Ids de la tabla de §7.2 ----------
//
// Solo los que no son triviales: `devices` usa el `machineId` existente y
// `game_metadata`, `plan_entries` y `game_curiosities` usan el `gameId` tal cual.

function positiveInteger(value: number, what: string): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${what} debe ser un entero positivo: ${value}`);
  }
  return String(value);
}

/**
 * `games` con `igdbId`: UUIDv5 de `igdb:<igdbId>`. Sin `igdbId` el juego lleva
 * UUIDv7 (y si más tarde lo gana, NO cambia de id: el caso residual de §7.2 se
 * resuelve fusionando juegos desde la interfaz).
 */
export function gameIdForIgdb(igdbId: number): string {
  return uuidv5(`igdb:${positiveInteger(igdbId, 'igdbId')}`);
}

/** `game_installs`: `<gameId>:<deviceId>`. */
export function gameInstallId(gameId: string, deviceId: string): string {
  return joinParts([gameId, deviceId]);
}

/** `emulator_installs`: `<emulatorId>:<deviceId>`. */
export function emulatorInstallId(emulatorId: string, deviceId: string): string {
  return joinParts([emulatorId, deviceId]);
}

/** `achievement_catalogs`: `<gameId>:<source>`, una fila por juego y fuente. */
export function achievementCatalogId(gameId: string, source: string): string {
  return joinParts([gameId, source]);
}

/** El `origin` de un desbloqueo de emulador hecho en un PC: `emu@<deviceId>`. */
export function emulatorOrigin(deviceId: string): string {
  // `@` también se prohíbe para que el origen se pueda leer de vuelta.
  if (deviceId.length === 0 || deviceId.includes(':') || deviceId.includes('@')) {
    throw new RangeError(`deviceId inválido para un origen de emulador: ${deviceId}`);
  }
  return `emu@${deviceId}`;
}

/**
 * `achievement_unlocks`: `<gameId>:<source>:<apiName>:<origin>`. `apiName` lo
 * fija Steam, RetroAchievements o el emulador y no podemos garantizar que no
 * lleve `:`; como es la única parte que puede llevarlo, el id sigue siendo único.
 * Rechazarlo haría imposible guardar ese logro.
 */
export function achievementUnlockId(
  gameId: string,
  source: string,
  apiName: string,
  origin: string,
): string {
  return joinParts([gameId, source, apiName, origin], 2);
}

/** `save_backups`: UUIDv5 de la clave del objeto en el bucket (F-21). */
export function saveBackupId(objectKey: string): string {
  if (objectKey.length === 0) throw new RangeError('clave de objeto vacía');
  return uuidv5(objectKey);
}

/**
 * `generated_memories`: `<scopeType>:<scopeKey>` (por ejemplo `month:2026-06`).
 * `scopeKey` puede llevar `:` por la misma razón que `apiName`: `scopeType` no.
 */
export function generatedMemoryId(scopeType: string, scopeKey: string): string {
  return joinParts([scopeType, scopeKey], 1);
}

/** `radar_games`: `igdb:<igdbId>`, literal (no es un UUID). */
export function radarGameId(igdbId: number): string {
  return joinParts(['igdb', positiveInteger(igdbId, 'igdbId')]);
}

/** `external_checks`: `<gameId>:<source>`. */
export function externalCheckId(gameId: string, source: string): string {
  return joinParts([gameId, source]);
}
