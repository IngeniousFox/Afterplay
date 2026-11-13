import type { NewGame } from './schema';

// ── LO QUE EL MAIN ESCRIBE POR SU CUENTA EN `games` ────────────────────────
//
// Tipos INTERNOS del main, a propósito separados de los del IPC
// (shared/dto.ts). El renderer solo puede mandar la lista cerrada de
// UpdateGamePatch; el main, en cambio, sí necesita escribir columnas que
// nadie debe poder tocar desde fuera: el lote de IGDB y las notas
// (external/igdbPatch, refreshRatings, refreshGame), la adopción de IGDB
// (adoptIgdb), el emparejado de partidas guardadas (ipc/saves) o el alta
// completa (createGameWithDetails). Por eso estos se apoyan en la forma de
// INSERT de Drizzle y no viven en shared: son del main y cambian con el
// esquema.

// Fila nueva de `games`, sin el id que pone SQLite.
export type GameInsert = Omit<NewGame, 'id'>;

// Cualquier columna editable de `games` (addedAt no se reescribe nunca).
export type GamePatch = Partial<Omit<NewGame, 'id' | 'addedAt'>>;
