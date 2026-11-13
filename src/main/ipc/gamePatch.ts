import type { UpdateGamePatch } from '../../shared/types';

// LAS CLAVES QUE games:update ACEPTA DEL RENDERER, EN EJECUCIÓN.
//
// El tipo UpdateGamePatch (shared/dto.ts) solo protege a quien compila contra
// él: por el IPC llega un objeto cualquiera, y `db.update(games).set(patch)`
// escribiría tal cual cualquier columna que viniera dentro —las de caché
// externa incluidas—. Por eso el handler se queda solo con estas claves antes
// de escribir y descarta el resto en silencio (F-42). La validación completa
// del contrato IPC llega en otra fase; esto es solo el cierre de la lista.
//
// `satisfies` + la comprobación de abajo atan la lista al tipo en los dos
// sentidos: una clave aquí que no esté en el tipo no compila, y un campo nuevo
// en el tipo que no se añada aquí tampoco.
export const UPDATE_GAME_PATCH_KEYS = [
  'title',
  'coverUrl',
  'heroUrl',
  'steamGridDbId',
  'notes',
  'executablePath',
  'installDirectory',
  'installSizeBytes',
  'endless',
  'isEmulated',
] as const satisfies readonly (keyof UpdateGamePatch)[];

type ClavesSinListar = Exclude<keyof UpdateGamePatch, (typeof UPDATE_GAME_PATCH_KEYS)[number]>;
// Si esto falla, falta en UPDATE_GAME_PATCH_KEYS el campo que nombra el error.
export const updateGamePatchKeysComplete: [ClavesSinListar] extends [never]
  ? true
  : { faltanEnLaLista: ClavesSinListar } = true;

const ALLOWED = new Set<string>(UPDATE_GAME_PATCH_KEYS);

// Copia solo las claves permitidas que vienen PROPIAS en el patch (no las del
// prototipo). Los valores no se validan aquí: eso es del contrato completo.
export const pickUpdateGamePatch = (patch: UpdateGamePatch): UpdateGamePatch => {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (ALLOWED.has(key)) picked[key] = value;
  }
  return picked as UpdateGamePatch;
};
