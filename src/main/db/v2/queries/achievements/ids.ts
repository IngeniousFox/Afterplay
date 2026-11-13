import { emulatorOrigin } from '../../../../../shared/sync/ids';
import type { AchievementSource as DtoAchievementSource } from '../../../../../shared/types';
import type { AchievementSource, UnlockOrigin } from '../../schema';

// Identidad de un logro en el 2.0 (AFTERPLAY-2.0.md §7.2 y §7.4).
//
// En la 1.x cada logro era una fila de `achievements` con su id numérico, y
// los DTO (`AchievementEntry.id`, `SessionUnlock.achievementId`,
// `hallOfFame.achievementId`…) lo usaban como clave. En el 2.0 el catálogo es
// un JSON por juego y fuente, así que no hay fila por logro: un logro es la
// terna (`gameId`, `source`, `apiName`). El id de texto que viaja en los DTO
// es esa terna unida con `:` — el id del catálogo (`<gameId>:<source>`) más
// `:<apiName>` —, estable entre PCs y entre refrescos (CONSULTAS.md §1.3).
//
// `apiName` lo fija Steam, RetroAchievements o un crack, y no podemos
// garantizar que no lleve `:`; `gameId` (UUID) y `source` nunca lo llevan.
// Por eso la clave se lee cortando por los DOS primeros `:` y el resto entero
// es el `apiName`, igual que hace `achievementUnlockId` con los desbloqueos.
//
// Cambio pedido (P9): `AchievementId<string>` de `src/shared/entityIds.ts`
// pasa a ser este `AchievementKey`. Mientras tanto es un `string` con forma, y
// encaja tal cual en los DTO con `Id = string`.

/** `<gameId>:<source>:<apiName>`. Opaco para el renderer: solo es una clave. */
export type AchievementKey = `${string}:${AchievementSource}:${string}`;

export interface AchievementRef {
  readonly gameId: string;
  readonly source: AchievementSource;
  readonly apiName: string;
}

/** La clave de un logro. Lanza `RangeError` con partes imposibles. */
export function achievementKey(
  gameId: string,
  source: AchievementSource,
  apiName: string,
): AchievementKey {
  if (gameId.length === 0 || gameId.includes(':')) {
    throw new RangeError(`gameId inválido para una clave de logro: ${gameId}`);
  }
  if (apiName.length === 0) throw new RangeError('apiName vacío');
  return `${gameId}:${source}:${apiName}`;
}

/** Lee una clave de logro, o null si no tiene la forma esperada. */
export function parseAchievementKey(key: string): AchievementRef | null {
  const first = key.indexOf(':');
  if (first <= 0) return null;
  const second = key.indexOf(':', first + 1);
  if (second < 0) return null;
  const source = key.slice(first + 1, second);
  const apiName = key.slice(second + 1);
  if ((source !== 'steam' && source !== 'ra') || apiName.length === 0) return null;
  return { gameId: key.slice(0, first), source, apiName };
}

/**
 * Quién entrega una tanda de desbloqueos. Es el `source` de la 1.x
 * (`storeUnlocks(gameId, 'steam' | 'emu' | 'ra', …)`), que en el 2.0 se parte
 * en dos: el CATÁLOGO al que pertenece el logro (un crack de Steam reporta
 * logros del catálogo de Steam) y el ORIGEN de la fila (cada PC escribe su
 * propia fila de emulador, F-35).
 */
export type UnlockFeed = 'steam' | 'emu' | 'ra';

/** El catálogo del que son los logros que entrega una vía. */
export const catalogSourceOf = (feed: UnlockFeed): AchievementSource =>
  feed === 'ra' ? 'ra' : 'steam';

/** El `origin` de las filas que escribe esta vía en ESTE PC. */
export const unlockOriginOf = (feed: UnlockFeed, deviceId: string): UnlockOrigin =>
  feed === 'emu' ? (emulatorOrigin(deviceId) as UnlockOrigin) : feed;

/**
 * La fuente que enseña el DTO (`AchievementEntry.sources`) para un origen:
 * `emu@<cualquier PC>` es `'emu'` (CONSULTAS.md §1.3). Varios PCs con
 * emulador dan un solo `'emu'`: lo deduplica quien arma la lista.
 */
export const dtoSourceOf = (origin: string): DtoAchievementSource =>
  origin === 'steam' ? 'steam' : origin === 'ra' ? 'ra' : 'emu';
