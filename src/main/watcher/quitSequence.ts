// El cierre ordenado de la app (AFTERPLAY-2.0.md §10.6). Vive aparte de
// main/index.ts para poder probarlo con pasos de mentira: lo que importa es el
// ORDEN y los TOPES, y ninguno de los dos se ve desde dentro de un
// `app.on('before-quit')`.
//
//   1. Cerrar las sesiones propias abiertas a la hora actual.
//   2. Lanzar ya los backups de partidas pendientes y esperarlos, con tope.
//   3. Subida final al hub (su propio tope, 5 s).
//   4. Salir, haya terminado o no: lo que no dio tiempo se recupera en el
//      siguiente arranque, como hoy.
//
// Nada de esto lanza ni rechaza: un paso que falla se anota y el siguiente
// corre igual. Y la secuencia entera tiene un tope global, así que una
// promesa colgada no puede dejar la app sin cerrar.

/** Tope de los backups de partidas pendientes (paso 2). */
export const SAVE_BACKUPS_QUIT_MS = 4000;
/** Tope de toda la secuencia: pase lo que pase, la app sale. */
export const QUIT_TOTAL_MS = 10_000;

export interface QuitSteps {
  /** Paso 1. Síncrono en la app: cierra las sesiones propias abiertas. */
  readonly closeSessions: () => void | Promise<void>;
  /**
   * Paso 2, opcional: lanza ya los backups de partidas pendientes y resuelve
   * cuando acaban. Se le pasa el tope, pero la secuencia lo impone también por
   * su cuenta. Sin él (hoy: la función la escribe el bloque de partidas
   * guardadas) el paso se salta.
   */
  readonly flushSaveBackups?: (timeoutMs: number) => Promise<void>;
  /** Paso 3. La subida final al hub, con su propio tope. */
  readonly flushSync: () => Promise<unknown>;
}

export interface QuitOptions {
  readonly saveBackupsTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly warn?: (message: string, error?: unknown) => void;
}

/** `done`: todos los pasos terminaron. `timeout`: se agotó el tope global. */
export type QuitOutcome = 'done' | 'timeout';

// Espera a `work` hasta `ms`; si se agota, sigue (el trabajo queda en segundo
// plano). Nunca rechaza. El temporizador se cancela siempre al acabar.
const settleWithin = async (work: Promise<unknown>, ms: number): Promise<'settled' | 'timeout'> => {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<'timeout'>((resolve) => {
    handle = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([
      work.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      limit,
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
};

/** Corre el cierre ordenado. Resuelve siempre; el llamante hace `app.quit()` después. */
export async function runQuitSequence(
  steps: QuitSteps,
  options: QuitOptions = {},
): Promise<QuitOutcome> {
  const warn = options.warn ?? ((message, error) => console.warn(message, error));
  const saveBackupsMs = options.saveBackupsTimeoutMs ?? SAVE_BACKUPS_QUIT_MS;

  // Cada paso en su try/catch: un fallo se anota y no impide los siguientes.
  const guarded = async (name: string, step: () => unknown): Promise<void> => {
    try {
      await step();
    } catch (error) {
      warn(`[quit] el paso "${name}" fallo (sigo igualmente):`, error);
    }
  };

  const sequence = (async (): Promise<void> => {
    await guarded('cerrar sesiones', steps.closeSessions);
    const flushSaveBackups = steps.flushSaveBackups;
    if (flushSaveBackups) {
      const result = await settleWithin(
        guarded('backups de partidas', () => flushSaveBackups(saveBackupsMs)),
        saveBackupsMs,
      );
      if (result === 'timeout') warn('[quit] los backups de partidas no acabaron a tiempo');
    }
    await guarded('subida final', steps.flushSync);
  })();

  const outcome = await settleWithin(sequence, options.totalTimeoutMs ?? QUIT_TOTAL_MS);
  if (outcome === 'timeout') warn('[quit] el cierre ordenado agoto su tope: salgo igualmente');
  return outcome === 'timeout' ? 'timeout' : 'done';
}
