import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { games, planEntries, type SaveDetectionSource } from '../../schema';
import { alive, type PatchValues } from '../../store';
import { liveGame } from '../common';
import type { QueryContext } from '../common';

// Los juegos vistos desde las partidas guardadas y sus ajustes de partidas
// (columnas `save*` de `games`), sobre el esquema 2.0. Sustituyen a
// `db/queries/saves/getSaveGames.ts` y a las llamadas a `updateGame` de
// `ipc/saves.ts` (CONSULTAS.md §1.3 `SaveGame`, §1.4 "GamePatch interno de
// saves").
//
// Cada operación de `ipc/saves.ts` que hoy es "leer el juego, decidir, escribir"
// es aquí UNA transacción que relee el juego dentro: lo que se decide sobre el
// emparejamiento actual no puede pisar un cambio hecho entretanto.

/**
 * Lo que el módulo de partidas necesita de un juego (`SaveGame` de la 1.x, con
 * ids de texto). [S] El prefijo del bucket es `saveKey`, no `igdbId` (§7.4):
 * así los juegos sin igdbId también pueden ir a la nube (§12.7).
 */
export interface SaveGame {
  readonly id: string;
  readonly title: string;
  readonly igdbId: number | null;
  /**
   * Prefijo del juego en el bucket. Lo fija el alta; null solo en un juego que
   * se saltara ese paso (ver `ensureSaveKey`).
   */
  readonly saveKey: string | null;
  readonly saveBackupEnabled: boolean;
  readonly saveDetectionSource: SaveDetectionSource | null;
  readonly saveLudusaviName: string | null;
  readonly saveCustomPaths: string[] | null;
}

const saveGameColumns = {
  id: games.id,
  title: games.title,
  igdbId: games.igdbId,
  saveKey: games.saveKey,
  saveBackupEnabled: games.saveBackupEnabled,
  saveDetectionSource: games.saveDetectionSource,
  saveLudusaviName: games.saveLudusaviName,
  saveCustomPaths: games.saveCustomPaths,
};

function selectSaveGames(ctx: QueryContext, where?: SQL): SaveGame[] {
  return (
    ctx.db
      .select(saveGameColumns)
      .from(games)
      // Planeado = `plan_entries` viva (§1.1.3). `alive()` a secas en la unión:
      // el juego ya se filtra vivo en el WHERE. La condición va en el ON para
      // que el LEFT no se convierta en INNER.
      .leftJoin(planEntries, and(eq(planEntries.gameId, games.id), alive(planEntries)))
      // Los planeados no están instalados por definición: no tienen partida
      // que respaldar y solo serían ruido en el escaneo (como en la 1.x).
      .where(and(liveGame(), isNull(planEntries.id), where))
      .orderBy(asc(games.syncCreated), asc(games.id))
      .all()
  );
}

/** Los juegos vivos y no planeados (`getSaveGames`). */
export function listSaveGames(ctx: QueryContext): SaveGame[] {
  return selectSaveGames(ctx);
}

/**
 * Un juego vivo y no planeado, o null (el `games.find(id)` de cada handler de
 * `ipc/saves.ts`).
 */
export function getSaveGame(ctx: QueryContext, gameId: string): SaveGame | null {
  return selectSaveGames(ctx, eq(games.id, gameId))[0] ?? null;
}

/**
 * Garantiza que el juego tiene `saveKey` y lo devuelve; null si el juego no
 * existe o está borrado. Si ya lo tiene NO lo cambia nunca, aunque el juego
 * haya ganado igdbId después: sus copias siguen bajo el prefijo antiguo
 * (§12.7). Si no lo tiene, lo fija como el alta (§7.4): el igdbId en decimal
 * si existe, si no el id. Es la red de seguridad de la subida en lugar del
 * `requireIgdbId` de hoy.
 */
export function ensureSaveKey(ctx: QueryContext, gameId: string): string | null {
  return ctx.store.transaction(() => {
    const game = readGame(ctx, gameId);
    if (!game) return null;
    if (game.saveKey !== null) return game.saveKey;
    const saveKey = game.igdbId !== null ? String(game.igdbId) : gameId;
    ctx.store.patch('games', gameId, { saveKey });
    return saveKey;
  });
}

/**
 * Las columnas de partidas que puede escribir el módulo de partidas: un tipo
 * cerrado en lugar del `GamePatch` general (§1.4). `saveKey` no está a
 * propósito: se fija una vez (`ensureSaveKey` o el alta) y no se cambia.
 */
export interface SaveSettingsPatch {
  readonly saveBackupEnabled?: boolean;
  readonly saveDetectionSource?: SaveDetectionSource | null;
  readonly saveLudusaviName?: string | null;
  /** Siempre tokenizadas (`<winAppData>/…`), nunca una ruta resuelta. */
  readonly saveCustomPaths?: string[] | null;
}

/**
 * Aplica un patch de ajustes de partidas a un juego vivo. Devuelve false si el
 * juego no existe o está borrado. Un patch sin cambios no escribe (F-33).
 */
export function updateSaveSettings(
  ctx: QueryContext,
  gameId: string,
  patch: SaveSettingsPatch,
): boolean {
  return ctx.store.transaction(() => {
    if (!readGame(ctx, gameId)) return false;
    writeSettings(ctx, gameId, patch);
    return true;
  });
}

/**
 * `saves:setEnabled`: activa o desactiva la copia a la nube del juego. Con
 * `ludusaviName` (viene del escaneo) empareja el juego solo si no lo estaba:
 * una carpeta elegida a mano manda sobre el manifest. Devuelve false si el
 * juego no existe o está borrado (la 1.x devolvía true siempre).
 */
export function setSaveBackupEnabled(
  ctx: QueryContext,
  gameId: string,
  enabled: boolean,
  ludusaviName?: string,
): boolean {
  return ctx.store.transaction(() => {
    const game = readGame(ctx, gameId);
    if (!game) return false;
    writeSettings(ctx, gameId, {
      saveBackupEnabled: enabled,
      ...(ludusaviName && !game.saveLudusaviName
        ? { saveLudusaviName: ludusaviName, saveDetectionSource: 'auto' as const }
        : {}),
    });
    return true;
  });
}

/**
 * `saves:detect`: guarda el emparejamiento automático encontrado (pisa el que
 * hubiera). Las carpetas propias se conservan. Devuelve false si el juego no
 * está entre los de `listSaveGames`.
 */
export function setDetectedSaveName(
  ctx: QueryContext,
  gameId: string,
  ludusaviName: string,
): boolean {
  return ctx.store.transaction(() => {
    if (!getSaveGame(ctx, gameId)) return false;
    writeSettings(ctx, gameId, { saveLudusaviName: ludusaviName, saveDetectionSource: 'auto' });
    return true;
  });
}

/**
 * `saves:scanLibrary`: el escaneo casó este juego con un nombre de ludusavi;
 * se guarda solo si el juego no estaba emparejado. Devuelve true si ha escrito.
 * Guardar el nombre no sube nada: subir exige `saveBackupEnabled`.
 */
export function pairDetectedSaveNameIfUnpaired(
  ctx: QueryContext,
  gameId: string,
  ludusaviName: string,
): boolean {
  return ctx.store.transaction(() => {
    const game = getSaveGame(ctx, gameId);
    if (!game || game.saveLudusaviName) return false;
    writeSettings(ctx, gameId, { saveLudusaviName: ludusaviName, saveDetectionSource: 'auto' });
    return true;
  });
}

/**
 * `saves:clearDetection`: deshace un emparejamiento AUTOMÁTICO. No toca las
 * carpetas propias ni el índice. Devuelve false si el juego no está o su
 * emparejamiento no es `auto`.
 */
export function clearSaveDetection(ctx: QueryContext, gameId: string): boolean {
  return ctx.store.transaction(() => {
    const game = getSaveGame(ctx, gameId);
    if (!game || game.saveDetectionSource !== 'auto') return false;
    writeSettings(ctx, gameId, { saveLudusaviName: null, saveDetectionSource: null });
    return true;
  });
}

/**
 * `saves:addFolder`: añade una carpeta propia, ya TOKENIZADA por quien llama
 * (`tokenizePath` depende del sistema y no entra aquí). Sin duplicados. Si el
 * juego no estaba emparejado, se empareja en modo manual con su título.
 * Devuelve el nombre de ludusavi resultante, o null si el juego no está.
 */
export function addSaveFolder(
  ctx: QueryContext,
  gameId: string,
  tokenizedFolder: string,
): string | null {
  return ctx.store.transaction(() => {
    const game = getSaveGame(ctx, gameId);
    if (!game) return null;
    const current = game.saveCustomPaths ?? [];
    writeSettings(ctx, gameId, {
      saveCustomPaths: current.includes(tokenizedFolder) ? current : [...current, tokenizedFolder],
      ...(game.saveLudusaviName
        ? {}
        : { saveLudusaviName: game.title, saveDetectionSource: 'manual' as const }),
    });
    return game.saveLudusaviName ?? game.title;
  });
}

/**
 * `saves:removeFolder`: quita las carpetas propias para las que `isTarget`
 * dice que sí. La comparación (expandir la guardada y comparar sin mayúsculas)
 * depende del sistema y la pone quien llama. Si era un emparejamiento manual y
 * no queda ninguna carpeta, el juego vuelve a "sin detectar". Devuelve false si
 * el juego no está.
 */
export function removeSaveFolder(
  ctx: QueryContext,
  gameId: string,
  isTarget: (storedFolder: string) => boolean,
): boolean {
  return ctx.store.transaction(() => {
    const game = getSaveGame(ctx, gameId);
    if (!game) return false;
    const next = (game.saveCustomPaths ?? []).filter((folder) => !isTarget(folder));
    writeSettings(ctx, gameId, {
      saveCustomPaths: next.length > 0 ? next : null,
      ...(next.length === 0 && game.saveDetectionSource === 'manual'
        ? { saveLudusaviName: null, saveDetectionSource: null }
        : {}),
    });
    return true;
  });
}

// ── Interno ─────────────────────────────────────────────────────────────────

/** El juego vivo (planeado o no), o null. */
function readGame(
  ctx: QueryContext,
  gameId: string,
): { saveKey: string | null; igdbId: number | null; saveLudusaviName: string | null } | null {
  return (
    ctx.db
      .select({
        saveKey: games.saveKey,
        igdbId: games.igdbId,
        saveLudusaviName: games.saveLudusaviName,
      })
      .from(games)
      .where(and(eq(games.id, gameId), liveGame()))
      .get() ?? null
  );
}

function writeSettings(ctx: QueryContext, gameId: string, patch: SaveSettingsPatch): void {
  // Solo las claves del tipo cerrado, aunque llegue un objeto con más.
  const changes: PatchValues<'games'> = {};
  if (patch.saveBackupEnabled !== undefined) changes.saveBackupEnabled = patch.saveBackupEnabled;
  if (patch.saveDetectionSource !== undefined) {
    changes.saveDetectionSource = patch.saveDetectionSource;
  }
  if (patch.saveLudusaviName !== undefined) changes.saveLudusaviName = patch.saveLudusaviName;
  if (patch.saveCustomPaths !== undefined) changes.saveCustomPaths = patch.saveCustomPaths;
  if (Object.keys(changes).length > 0) ctx.store.patch('games', gameId, changes);
}
