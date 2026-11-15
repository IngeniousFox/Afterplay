import type { CycleResult, SyncLogger } from './engine';

// Cuándo se dispara un ciclo de sync (§8.5). Es una clase pequeña con los
// temporizadores inyectados para poder probarla con un reloj falso; no sabe
// nada del motor más que "una función que corre un ciclo".
//
//   Arranque        `start()`: primer ciclo con límite de tiempo, antes de las
//                   tareas de fondo.
//   Cambio local    `notifyLocalChange()`: 2 s después del último cambio.
//   Periódico       cada 60 s tras el último ciclo.
//   Despertar       `wake()`: vuelta de suspensión, desbloqueo, red de vuelta.
//   Cierre          `flushOnQuit()`: subida final con tope de 5 s (§10.6).
//
// Reglas: nunca dos ciclos a la vez; tras un fallo con reintento, espera
// creciente (dobla cada vez hasta un tope); un resultado que no se arregla
// solo (app vieja, token revocado, reinicio pendiente) PAUSA el planificador
// hasta `resume()`.

/** Tope del ciclo rápido antes de crear un playthrough (§10.7, prevención). */
export const CREATE_SYNC_LIMIT_MS = 3000;

export interface SchedulerTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Temporizadores reales. No retienen el proceso: un sync pendiente no impide salir. */
export const realTimers: SchedulerTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SyncSchedulerOptions {
  readonly runCycle: () => Promise<CycleResult>;
  readonly timers?: SchedulerTimers;
  /** Hora de pared en ms (para la espera tras un fallo). */
  readonly now?: () => number;
  /** Agrupa los cambios locales: tras este silencio se sube. Por defecto 2 s. */
  readonly debounceMs?: number;
  /** Tiempo entre ciclos con todo en orden. Por defecto 60 s. */
  readonly intervalMs?: number;
  /** Primera espera tras un fallo y su tope. Por defecto 5 s y 5 min. */
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  /** Cada resultado de ciclo, para que la app avise a la interfaz. */
  readonly onResult?: (result: CycleResult) => void;
  readonly logger?: SyncLogger;
}

export interface FlushOptions {
  /** Tope de la subida final. Por defecto 5 s (§10.6). */
  readonly timeoutMs?: number;
}

/** `flushed`: el último ciclo terminó. `timeout`: se agotó el tope. `skipped`: nada que hacer. */
export type FlushOutcome = 'flushed' | 'timeout' | 'skipped';

export class SyncScheduler {
  private readonly runCycle: () => Promise<CycleResult>;
  private readonly timers: SchedulerTimers;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly intervalMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly onResult: ((result: CycleResult) => void) | undefined;
  private readonly logger: SyncLogger | undefined;

  private debounceHandle: unknown = null;
  private nextHandle: unknown = null;
  private running: Promise<void> | null = null;
  /** Se pidió un ciclo mientras corría otro: se repite al terminar. */
  private rerun = false;
  private failures = 0;
  private backoffUntil = 0;
  private paused = false;
  private stopped = false;
  private started = false;

  constructor(options: SyncSchedulerOptions) {
    this.runCycle = options.runCycle;
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? Date.now;
    this.debounceMs = options.debounceMs ?? 2000;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 5000;
    this.backoffMaxMs = options.backoffMaxMs ?? 5 * 60_000;
    this.onResult = options.onResult;
    this.logger = options.logger;
  }

  /** ¿Hay un ciclo en marcha? */
  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Pausado por un resultado que no se arregla solo. Ver `resume`. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Fallos seguidos (0 tras un ciclo correcto). */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /**
   * Primer ciclo. Devuelve cuando termina o cuando pasan `limitMs` (lo que
   * antes ocurra) para que el arranque no espere a una red lenta; el ciclo
   * sigue en segundo plano. Después empieza el periódico.
   */
  async start(limitMs = 10_000): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    const first = this.requestRun(true);
    let handle: unknown = null;
    const limit = new Promise<void>((resolve) => {
      handle = this.timers.setTimeout(resolve, limitMs);
    });
    try {
      await Promise.race([first, limit]);
    } finally {
      this.timers.clearTimeout(handle);
    }
  }

  /** Hubo un cambio local: sube 2 s después del último. */
  notifyLocalChange(): void {
    if (this.stopped || this.paused) return;
    if (this.debounceHandle !== null) this.timers.clearTimeout(this.debounceHandle);
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      void this.requestRun(false);
    }, this.debounceMs);
  }

  /**
   * Vuelta de suspensión, desbloqueo o red de vuelta: ciclo YA y se olvida la
   * espera acumulada (lo que causó los fallos probablemente ya pasó).
   */
  wake(): void {
    if (this.stopped) return;
    this.failures = 0;
    this.backoffUntil = 0;
    void this.requestRun(true);
  }

  /** Levanta una pausa (app actualizada, PC re-emparejado) y lanza un ciclo. */
  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    this.failures = 0;
    this.backoffUntil = 0;
    void this.requestRun(true);
  }

  /** Para todo y no deja nada pendiente. Un ciclo en marcha termina solo. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  /**
   * Cierre de la app (§10.6): deja de planificar, espera al ciclo en marcha y
   * corre uno último que suba lo pendiente, con un tope de `timeoutMs`. Si el
   * tope se agota, la app puede salir: lo pendiente sigue marcado `syncDirty`
   * y subirá en el siguiente arranque.
   */
  async flushOnQuit(options: FlushOptions = {}): Promise<FlushOutcome> {
    const timeoutMs = options.timeoutMs ?? 5000;
    this.stopped = true;
    this.clearTimers();
    if (this.paused) return 'skipped';
    const work = (async (): Promise<FlushOutcome> => {
      if (this.running) await this.running;
      // El ciclo que acaba de terminar pudo empezar antes del último cambio:
      // uno nuevo, con el cuerpo de `requestRun` pero ignorando `stopped`.
      await this.execute();
      return 'flushed';
    })();
    let handle: unknown = null;
    const limit = new Promise<FlushOutcome>((resolve) => {
      handle = this.timers.setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      return await Promise.race([work, limit]);
    } finally {
      this.timers.clearTimeout(handle);
    }
  }

  /**
   * Un ciclo "ahora", con tope (§10.7, prevención): lo usa quien está a punto
   * de crear algo que dos PCs podrían crear a la vez (un playthrough) para
   * traerse antes lo que el otro ya haya subido. Resuelve cuando el ciclo
   * termina o pasan `limitMs`, lo que antes ocurra; el ciclo sigue en segundo
   * plano. NUNCA lanza.
   *
   * Respeta la espera tras un fallo y la pausa (no es `force`): con la red
   * caída cada apertura de juego no debe costar `limitMs`; "sin red se decide
   * con lo que hay" y se sale en el acto. Parado (cierre de la app) tampoco
   * hace nada. Si ya hay un ciclo en marcha, espera a ese y a uno más (el
   * que estaba corriendo pudo empezar antes de la última subida del otro PC).
   */
  async runOnceWithin(limitMs: number): Promise<void> {
    if (this.stopped || this.paused) return;
    let handle: unknown = null;
    const limit = new Promise<void>((resolve) => {
      handle = this.timers.setTimeout(resolve, limitMs);
    });
    try {
      await Promise.race([this.requestRun(false).catch(() => {}), limit]);
    } catch {
      // El tope y el ciclo no lanzan; la red de seguridad es por contrato.
    } finally {
      this.timers.clearTimeout(handle);
    }
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private clearTimers(): void {
    if (this.debounceHandle !== null) this.timers.clearTimeout(this.debounceHandle);
    if (this.nextHandle !== null) this.timers.clearTimeout(this.nextHandle);
    this.debounceHandle = null;
    this.nextHandle = null;
  }

  /**
   * Pide un ciclo. `force` ignora la espera tras un fallo (arranque, `wake`,
   * `resume`); el resto (cambio local, periódico) la respeta: con la red caída
   * cada edición no debe lanzar un intento de 30 s.
   */
  private requestRun(force: boolean): Promise<void> {
    if (this.stopped || this.paused) return Promise.resolve();
    if (!force && this.now() < this.backoffUntil) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    return this.execute();
  }

  private execute(): Promise<void> {
    if (this.running) return this.running;
    const run = this.loop().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async loop(): Promise<void> {
    do {
      this.rerun = false;
      let result: CycleResult | null = null;
      try {
        result = await this.runCycle();
      } catch (error) {
        // El motor no lanza; si pasa, es un fallo como cualquier otro.
        this.logger?.error('el ciclo de sync lanzó una excepción', error);
      }
      this.settle(result);
      // Un cambio llegó mientras corría: se repite enseguida, salvo que el ciclo
      // haya fallado (la espera manda) o esté todo parado.
      if (!result || result.status !== 'ok') this.rerun = false;
    } while (this.rerun && !this.stopped && !this.paused);
  }

  /** Anota el resultado, decide la espera y arma el siguiente ciclo periódico. */
  private settle(result: CycleResult | null): void {
    if (result) {
      try {
        this.onResult?.(result);
      } catch (error) {
        this.logger?.error('onResult del planificador falló', error);
      }
    }
    if (result?.status === 'ok') {
      this.failures = 0;
      this.backoffUntil = 0;
    } else if (result && !result.retry) {
      // App vieja, token revocado o reinicio pendiente: reintentar no sirve.
      this.paused = true;
      this.failures = 0;
      this.backoffUntil = 0;
    } else {
      this.failures += 1;
      const wait = Math.min(
        this.backoffMaxMs,
        this.backoffBaseMs * 2 ** Math.min(this.failures - 1, 30),
      );
      this.backoffUntil = this.now() + wait;
    }
    this.armNext(result?.status === 'ok' ? this.intervalMs : this.backoffUntil - this.now());
  }

  private armNext(delayMs: number): void {
    if (this.nextHandle !== null) this.timers.clearTimeout(this.nextHandle);
    this.nextHandle = null;
    if (this.stopped || this.paused) return;
    this.nextHandle = this.timers.setTimeout(
      () => {
        this.nextHandle = null;
        void this.requestRun(false);
      },
      Math.max(0, delayMs),
    );
  }
}
