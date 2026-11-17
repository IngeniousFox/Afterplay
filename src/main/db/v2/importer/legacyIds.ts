import { createHash } from 'node:crypto';
import { gameIdForIgdb } from '../../../../shared/sync/ids';

// Ids de lo importado de la 1.x en las tablas de id aleatorio (§7.2, §19.5).
//
// DESVIACIÓN DELIBERADA DE §19.5. El documento pide UUIDv5 de
// `legacy:<tabla>:<id>` para todo lo que no tiene id natural. Un UUIDv5 es
// determinista, pero su orden es el de un hash: el código desempata "creado
// antes" comparando ids (`compareByCreation` en `src/shared/entityIds.ts` y en
// `src/shared/domain/`: el estado actual con dos eventos a la misma hora, el
// reparto del gasto entre playthroughs, el orden de suma de las horas), y con
// UUIDv5 ese orden quedaría barajado para todo lo importado.
//
// En su lugar, un UUIDv7 DETERMINISTA:
// - versión y variante de UUIDv7, así que es un UUIDv7 válido para la puerta
//   de escritura y para cualquier lector;
// - su parte de tiempo es `LEGACY_ID_EPOCH_MS + idAntiguo`: crece con el id
//   antiguo, así que dentro de una tabla el orden de los ids nuevos es el de
//   los antiguos, y cae en 2001-2003, antes de cualquier UUIDv7 real;
// - sus 74 bits "aleatorios" salen de un SHA-256 de `legacy:<tabla>:<id>`: el
//   mismo origen da el mismo id en cualquier PC y en cualquier ejecución, y dos
//   tablas con el mismo id antiguo no chocan.
//
// La parte de tiempo NO es una fecha de creación: no hay que leerla como tal.
// Entre tablas distintas el orden es el del id antiguo y después el del hash,
// que es lo mismo que comparaba la 1.x entre ids de tablas distintas (un
// desempate sin significado, pero estable).

/** Tablas de la 1.x cuyos ids pasan por aquí (nombres de la 1.x). */
export type LegacyIdTable =
  'games' | 'iterations' | 'state_events' | 'sessions' | 'spend_events' | 'emulators';

/** 2001-01-01T00:00:00Z. Origen de la parte de tiempo de los ids importados. */
export const LEGACY_ID_EPOCH_MS = Date.UTC(2001, 0, 1);

/**
 * Mayor id antiguo admitido: 2^36 ms son unos 2,2 años, así que todo id
 * importado cae antes de 2003-04. Ninguna base 1.x se acerca (los ids son
 * autoincrementales de una app personal); si una lo superase, mejor fallar
 * que fabricar un id que choque con el tiempo real.
 */
export const MAX_LEGACY_ID = 2 ** 36;

/** Primer milisegundo que ya no puede llevar un id importado. */
export const LEGACY_ID_LIMIT_MS = LEGACY_ID_EPOCH_MS + MAX_LEGACY_ID + 1;

const hex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/** El id 2.0 de la fila `legacyId` de la tabla 1.x `table`. */
export function legacyUuid(table: LegacyIdTable, legacyId: number): string {
  if (!Number.isSafeInteger(legacyId) || legacyId < 1 || legacyId > MAX_LEGACY_ID) {
    throw new RangeError(`id 1.x fuera de rango en ${table}: ${legacyId}`);
  }
  const ms = LEGACY_ID_EPOCH_MS + legacyId;
  const hash = createHash('sha256').update(`legacy:${table}:${legacyId}`, 'utf8').digest();
  const bytes = new Uint8Array(16);
  // unix_ts_ms (48 bits, big-endian). `Math.floor` y no desplazamientos: un
  // desplazamiento de bits en JavaScript trabaja en 32 bits.
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  // ver (4 bits = 7) + rand_a (12 bits) y var (2 bits = 10) + rand_b (62 bits),
  // RFC 9562 §5.7. Los bits de relleno salen del hash.
  bytes[6] = 0x70 | (hash[0] & 0x0f);
  bytes[7] = hash[1];
  bytes[8] = 0x80 | (hash[2] & 0x3f);
  for (let i = 9; i < 16; i++) bytes[i] = hash[i - 6];
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * El id 2.0 de un juego 1.x (§19.5): el natural de §7.2 si tiene `igdbId`, y si
 * no el determinista de `legacyUuid`. LA regla vive aquí: el importador y el
 * PC secundario del corte (`secondaryLocal.ts`) la usan, así que dos PCs
 * derivan siempre el mismo id para el mismo juego.
 */
export function legacyGameId(igdbId: number | null, legacyId: number): string {
  return igdbId !== null ? gameIdForIgdb(igdbId) : legacyUuid('games', legacyId);
}

/** Milisegundos de la parte de tiempo de un UUIDv7 (o de cualquier UUID). */
export function uuidTimestampMs(uuid: string): number {
  return parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

/** ¿Tiene este UUIDv7 la parte de tiempo reservada a lo importado? */
export function isLegacyUuid(uuid: string): boolean {
  const ms = uuidTimestampMs(uuid);
  return uuid[14] === '7' && ms > LEGACY_ID_EPOCH_MS && ms < LEGACY_ID_LIMIT_MS;
}
