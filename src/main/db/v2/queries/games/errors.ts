// Errores esperados de las escrituras sobre juegos (paquete P2).
//
// `StoreError` (store/errors.ts) es el error de la PUERTA: reglas de sync,
// valores inválidos, dueño… Lo que se define aquí son las reglas de NEGOCIO de
// estas consultas (no está planeado, tiene partidas, ya está en la biblioteca),
// que la puerta no conoce y para las que su unión de códigos no tiene sitio.
// Llevan un `code` estable para que el IPC y la interfaz distingan los casos
// sin leer el texto; los mensajes son los de la 1.x, porque hay renderer y
// tests que los enseñan o los buscan.

export type GameWriteErrorCode =
  /** El juego no existe o tiene lápida. */
  | 'not_found'
  /** Se esperaba un juego en el Plan (entrada viva) y no lo está. */
  | 'not_planned'
  /** No se puede devolver al Plan: ya está o tiene registros de partida. */
  | 'cannot_move_to_plan'
  /**
   * Ya hay un juego VIVO con ese igdbId. Con id determinista (§7.2) crearlo
   * otra vez sería escribir encima del que ya existe, no un duplicado.
   */
  | 'already_exists'
  /** Entrada inválida (appid fuera de rango, `plan_to_play` como estado…). */
  | 'invalid_input';

export class GameWriteError extends Error {
  readonly code: GameWriteErrorCode;

  constructor(code: GameWriteErrorCode, message: string) {
    super(message);
    this.name = 'GameWriteError';
    this.code = code;
  }
}

export const isGameWriteError = (
  error: unknown,
  code?: GameWriteErrorCode,
): error is GameWriteError =>
  error instanceof GameWriteError && (code === undefined || error.code === code);

/** Mismo rango que la 1.x (`setSteamAppId.ts`, `createGameWithDetails.ts`): entero de 32 bits sin signo. */
export function assertSteamAppId(appId: number): void {
  if (!Number.isSafeInteger(appId) || appId < 1 || appId > 0xffffffff) {
    throw new GameWriteError('invalid_input', 'Invalid Steam App ID.');
  }
}
