import {
  achievementCatalogId,
  achievementUnlockId,
  emulatorInstallId,
  externalCheckId,
  gameIdForIgdb,
  gameInstallId,
  generatedMemoryId,
  isUuid,
  radarGameId,
  saveBackupId,
  uuidv7,
} from '../../../../shared/sync/ids';
import type { SyncedTableEntry, SyncedTableName } from '../registry';
import { StoreError } from './errors';
import type { RowOf } from './types';

// Cómo forma la puerta el id de una fila nueva (§7.2).
//
// El registro dice QUÉ forma tiene cada id; las funciones de
// `src/shared/sync/ids.ts` saben CONSTRUIRLO (con sus validaciones: partes sin
// `:`, enteros positivos, la parte libre de `apiName` y `scopeKey`). Aquí se
// unen las dos cosas tabla a tabla en vez de interpretar las partes del
// registro de forma genérica, porque la interpretación genérica no sabe qué
// parte puede llevar `:` y rechazaría logros reales. Un test comprueba que
// cada constructor da lo mismo que las partes del registro.

type IdBuilder<N extends SyncedTableName> = (values: RowOf<N>) => string | null;

/** Constructores de las tablas de id determinista o compuesto. */
export const ID_BUILDERS: { readonly [N in SyncedTableName]?: IdBuilder<N> } = {
  // Sin igdbId (null u omitido), null: el registro tiene `fallback: 'random'`
  // y se usa UUIDv7.
  games: (v) => {
    const igdbId = v.igdbId ?? null;
    return igdbId === null ? null : gameIdForIgdb(igdbId);
  },
  game_metadata: (v) => v.gameId,
  external_checks: (v) => externalCheckId(v.gameId, v.source),
  game_installs: (v) => gameInstallId(v.gameId, v.deviceId),
  emulator_installs: (v) => emulatorInstallId(v.emulatorId, v.deviceId),
  plan_entries: (v) => v.gameId,
  achievement_catalogs: (v) => achievementCatalogId(v.gameId, v.source),
  achievement_unlocks: (v) => achievementUnlockId(v.gameId, v.source, v.apiName, v.origin),
  save_backups: (v) => saveBackupId(v.r2Key),
  game_curiosities: (v) => v.gameId,
  generated_memories: (v) => generatedMemoryId(v.scopeType, v.scopeKey),
  radar_games: (v) => radarGameId(v.igdbId),
};

const builderFor = (name: SyncedTableName): IdBuilder<SyncedTableName> | undefined =>
  ID_BUILDERS[name] as IdBuilder<SyncedTableName> | undefined;

export interface NewRowId {
  readonly id: string;
  /**
   * Si es aleatorio: entonces que ya exista una fila con ese id es un error,
   * no "escribir encima" (dos filas distintas no pueden compartir un UUIDv7).
   */
  readonly random: boolean;
}

/**
 * Id de una fila nueva. `requested` es el que indica quien llama, si lo hace.
 *
 * - `given`: obligatorio (el `machineId`, D-11; `web` y `legacy`).
 * - Determinista o compuesto: se calcula; si además se indica, tiene que
 *   coincidir. Es la validación de "id === gameId" de las tablas 1:1 con un
 *   juego, y en general impide guardar una fila cuyo id no se pueda volver a
 *   calcular a partir de su contenido: dos PCs que crearan "lo mismo"
 *   producirían ids distintos y volvería F-08.
 * - Aleatorio (y `games` sin igdbId): UUIDv7 nuevo, o el indicado si es un
 *   UUID (el importador conserva el instante real de cada fila, §19.5).
 */
export function idForNewRow(
  entry: SyncedTableEntry,
  values: Readonly<Record<string, unknown>>,
  requested: unknown,
  wall: () => number,
): NewRowId {
  const name = entry.name as SyncedTableName;
  if (requested !== undefined && (typeof requested !== 'string' || requested.length === 0)) {
    throw new StoreError('invalid_value', `${name}.id: se esperaba un texto no vacío`);
  }
  switch (entry.id.kind) {
    case 'given':
      if (requested === undefined) {
        throw new StoreError(
          'incomplete',
          `${name}: el id lo tiene que indicar quien crea la fila`,
        );
      }
      return { id: requested, random: false };
    case 'deterministic':
    case 'composite': {
      const build = builderFor(name);
      if (!build) throw new Error(`${name}: falta su constructor de id en store/ids.ts`);
      let computed: string | null;
      try {
        computed = build(values as RowOf<SyncedTableName>);
      } catch (error) {
        // Las funciones de ids.ts lanzan RangeError con el motivo (parte con
        // `:`, igdbId no positivo…): es un valor inválido de quien llama.
        throw new StoreError('invalid_value', `${name}: ${(error as Error).message}`);
      }
      if (computed !== null) {
        if (requested !== undefined && requested !== computed) {
          throw new StoreError(
            'id_mismatch',
            `${name}: el id indicado (${requested}) no es el que corresponde (${computed})`,
          );
        }
        return { id: computed, random: false };
      }
      if (entry.id.kind !== 'deterministic' || entry.id.fallback !== 'random') {
        throw new Error(`${name}: su constructor de id no puede devolver null`);
      }
      return { id: randomId(name, requested, wall), random: true };
    }
    case 'random':
      return { id: randomId(name, requested, wall), random: true };
    case 'local':
      throw new Error(`${name}: una tabla local no pasa por la puerta`);
  }
}

function randomId(name: string, requested: unknown, wall: () => number): string {
  if (requested === undefined) return uuidv7(Math.floor(wall()));
  // En minúsculas, como los genera `uuidv7`: el id se compara como texto y
  // la misma fila escrita con otra capitalización serían dos.
  if (!isUuid(requested) || requested !== requested.toLowerCase()) {
    throw new StoreError('invalid_value', `${name}.id: se esperaba un UUID en minúsculas`);
  }
  return requested;
}
