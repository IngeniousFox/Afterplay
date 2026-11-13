import { saveBackupId } from '../../../../../shared/sync/ids';

// La clave de un objeto del bucket de partidas y el id de su fila en
// `save_backups` (AFTERPLAY-2.0.md §12.1 y §12.5, F-21).
//
// DECISIÓN QUE HEREDAN EL IMPORTADOR Y LA FASE 6. El id de una copia es el
// UUIDv5 de `r2Key` (`store/ids.ts` → `saveBackupId`), y `r2Key` es la clave
// COMPLETA del objeto dentro del bucket, exactamente la que la 1.x escribe hoy
// (`orchestrator.ts`: `${r2.gamePrefix(igdbId, machineId)}${version.name}`):
//
//   saves/<saveKey>/<deviceId>/<backupName>
//
// - Sin barra inicial, sin nombre de bucket, sin proveedor ni servidor: la
//   misma clave sirve en R2 y en cualquier S3, y `migrateStorage.ts` copia los
//   objetos con la clave tal cual, así que cambiar de destino no cambia ids.
// - `<saveKey>` es `games.saveKey`: el `igdbId` en decimal tal cual (lo que la
//   1.x ya tiene en el bucket) o, para un juego sin igdbId, su id (§7.4).
// - `<deviceId>` es el `machineId` de machine-saves.json (= `devices.id`).
// - `<backupName>` es el nombre del zip de ludusavi (`backup-<fecha>.zip`).
//
// Como el formato del bucket no cambia (§12.1), una fila creada al subir y la
// que se recupere leyendo el listado del bucket dan el MISMO id. Por eso el
// importador puede no migrar `save_backups` y reindexar desde el bucket, y por
// eso aquí no se admite ninguna variante: una clave con otra forma daría otro
// id para el mismo objeto y volvería F-21.

/** Raíz de las partidas en el bucket. */
export const SAVES_ROOT = 'saves/';

/** Las tres partes de la clave de una copia. */
export interface SaveObjectKeyParts {
  readonly saveKey: string;
  readonly deviceId: string;
  readonly backupName: string;
}

/** Un trozo de la clave: no vacío, sin `/` y sin ser `.` ni `..`. */
function assertSegment(what: string, value: string): void {
  if (value.length === 0 || value.includes('/') || value === '.' || value === '..') {
    throw new RangeError(`clave de partida: ${what} inválido (${JSON.stringify(value)})`);
  }
}

/** `saves/<saveKey>/<deviceId>/`: la carpeta de un juego en un dispositivo. */
export function saveFolderPrefix(saveKey: string, deviceId: string): string {
  assertSegment('saveKey', saveKey);
  assertSegment('deviceId', deviceId);
  return `${SAVES_ROOT}${saveKey}/${deviceId}/`;
}

/** `saves/<saveKey>/<deviceId>/<backupName>`: la clave de la que sale el id. */
export function saveObjectKey(parts: SaveObjectKeyParts): string {
  assertSegment('backupName', parts.backupName);
  return `${saveFolderPrefix(parts.saveKey, parts.deviceId)}${parts.backupName}`;
}

/**
 * Las partes de una clave del bucket, o null si no tiene exactamente la forma
 * de arriba. Cualquier otra cosa se ignora en vez de adivinar: el bucket puede
 * tener objetos que no ha puesto Afterplay (como `recovery.ts` hoy). A
 * diferencia de la 1.x, `<saveKey>` no tiene por qué ser un número.
 */
export function parseSaveObjectKey(key: string): SaveObjectKeyParts | null {
  if (!key.startsWith(SAVES_ROOT)) return null;
  const parts = key.slice(SAVES_ROOT.length).split('/');
  if (parts.length !== 3) return null;
  const [saveKey, deviceId, backupName] = parts;
  for (const part of parts) {
    if (part.length === 0 || part === '.' || part === '..') return null;
  }
  return { saveKey, deviceId, backupName };
}

/** El id de la fila de `save_backups` de una clave (lo mismo que calcula la puerta). */
export function saveBackupIdForKey(key: string): string {
  return saveBackupId(key);
}
