// Tipos de la API v2 de la PWA. Escrituras: plan (fijar, soltar, reordenar, añadir) y cronómetro (§13.3).
// Ninguno lleva rutas locales de un PC (F-31).
//
// Las fechas viajan como ISO 8601. Los errores esperados (juego duplicado,
// cronómetro en marcha, juego en vivo en otro dispositivo) son respuestas de
// error del protocolo (`conflict`, `not_found`, `invalid_request`), no cuerpos
// de éxito.

// ---------- Plan ----------

/** `POST /plan/pin` y `POST /plan/unpin`. */
export interface PlanPinRequest {
  readonly gameId: string;
}

export interface PlanPinResponse {
  readonly gameId: string;
  /** Cómo queda: true tras fijar, false tras soltar. */
  readonly pinned: boolean;
}

/** `POST /plan/reorder`: los ids de "Up next" en el orden nuevo. */
export interface PlanReorderRequest {
  readonly orderedIds: readonly string[];
}

export interface PlanReorderResponse {
  /** false si no había nada que repartir (menos de dos fijados entre los ids). */
  readonly applied: boolean;
}

/**
 * `POST /plan/add`: lo que da una búsqueda de IGDB. El resto de la ficha lo
 * completa un PC después.
 */
export interface PlanAddRequest {
  readonly igdbId: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly releaseYear?: number | null;
}

export interface PlanAddResponse {
  readonly gameId: string;
}

// ---------- Cronómetro ----------

/** El cronómetro en marcha (`GET /timer` devuelve esto o null). */
export interface ActiveTimerDto {
  readonly sessionId: string;
  readonly gameId: string;
  readonly title: string;
  readonly startedAt: string;
  /** Última señal de vida; si no ha latido aún, `startedAt`. */
  readonly lastSeenAt: string;
}

export type TimerResponse = ActiveTimerDto | null;

/** `POST /timer/start`. */
export interface TimerStartRequest {
  readonly gameId: string;
}

/** `POST /timer/stop` y `POST /timer/beat`. */
export interface TimerSessionRequest {
  readonly sessionId: string;
}

export interface TimerStopResponse {
  readonly sessionId: string;
  readonly gameId: string;
  readonly title: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSec: number;
  /** false si ya estaba parado (otro dispositivo lo paró antes). */
  readonly stoppedNow: boolean;
}

export interface TimerBeatResponse {
  /** false: el cronómetro ya no existe o está cerrado; la PWA deja de latir. */
  readonly alive: boolean;
}
