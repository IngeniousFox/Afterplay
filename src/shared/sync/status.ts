// Lo que el proceso principal le cuenta a la interfaz del sync (§9.3, §16):
// el estado del emparejado y del último ciclo, con el fallo ya traducido a una
// frase que se pueda leer sin saber qué es un hub. Sin electron ni red: lo
// usan main, preload y renderer.

export interface SyncProblem {
  /** El código del motor o del protocolo (`clock_ahead`, `unauthorized`…). */
  readonly code: string;
  /** La frase para el usuario, en inglés como el resto de la interfaz. */
  readonly message: string;
  /** ¿Se arregla solo? false = hace falta que el usuario haga algo. */
  readonly retrying: boolean;
}

export interface SyncStatus {
  /** false en un test E2E: el sync no existe en ese proceso. */
  readonly available: boolean;
  readonly paired: boolean;
  readonly hubUrl: string | null;
  /** Hay un ciclo en marcha ahora mismo. */
  readonly running: boolean;
  readonly lastPushAt: number | null;
  readonly lastPullAt: number | null;
  readonly problem: SyncProblem | null;
  /** Emparejado pero parado a propósito (un perfil de desarrollo con un hub de producción). */
  readonly disabledReason: string | null;
}

export interface PairRequest {
  readonly hubUrl: string;
  readonly code: string;
}

/** Los códigos que no se arreglan reintentando, con su frase. */
const BLOCKING: Readonly<Record<string, string>> = {
  clock_ahead:
    "This PC's clock is ahead of the real time. Fix the date and time in Windows and Afterplay will sync again.",
  schema_too_old: 'Update Afterplay to keep syncing.',
  protocol_mismatch: 'Update Afterplay to keep syncing.',
  unauthorized: 'This PC is no longer authorized. Unpair it and pair it again with a new code.',
  restart_required: 'Restart Afterplay to keep syncing.',
};

/**
 * Traduce un fallo de ciclo a una frase. `clock_ahead` se reintenta solo (el
 * usuario corrige la hora y el siguiente ciclo pasa), pero hace falta que lo
 * sepa, así que se cuenta entre los que piden una acción.
 */
export function describeSyncProblem(
  code: string | null,
  rawMessage: string | null,
): SyncProblem | null {
  if (code === null && rawMessage === null) return null;
  const key = code ?? 'internal';
  const blocking = BLOCKING[key];
  if (blocking) return { code: key, message: blocking, retrying: key === 'clock_ahead' };
  switch (key) {
    case 'network':
      return {
        code: key,
        message: "Can't reach the hub. Afterplay will keep trying.",
        retrying: true,
      };
    case 'quota_exceeded':
      return {
        code: key,
        message: 'The hub is over its storage or request quota. Afterplay will keep trying.',
        retrying: true,
      };
    case 'hub_behind':
      return {
        code: key,
        message: 'The hub has not been updated for this version of Afterplay yet.',
        retrying: true,
      };
    default:
      return {
        code: key,
        message: `Sync failed${rawMessage ? `: ${rawMessage}` : ''}. Afterplay will try again.`,
        retrying: true,
      };
  }
}

/** Frase para un fallo AL EMPAREJAR (el hub contestó o no). */
export function describePairError(code: string | null, rawMessage: string): string {
  switch (code) {
    case 'enroll_code_invalid':
      return 'That code is not valid or has expired. Create a new one in the web app and try again.';
    case 'network':
      return "Couldn't reach the hub. Check the address and your connection.";
    case 'schema_too_old':
    case 'protocol_mismatch':
      return 'This version of Afterplay is too old for that hub. Update Afterplay first.';
    case 'invalid_request':
      return 'The hub did not accept the request. Check the address and the code.';
    case 'not_found':
      return "That address doesn't look like an Afterplay hub.";
    default:
      return rawMessage;
  }
}
