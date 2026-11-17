// PUENTE 1.x → L3: este módulo desaparece en la tanda de limpieza L3
// (AFTERPLAY-2.0.md, Apéndice C) junto con el importador y `legacyCutover.ts`.
//
// EL ORQUESTADOR DEL CORTE 1.x → 2.0 (§19.6). Una máquina de estados que
// compone las piezas ya hechas: el puente de Turso (`legacyCutover.ts`), el
// importador (`db/v2/runtime.ts`), el sync (`sync/runtime.ts`) y la migración
// local. Es PURA respecto a Electron, Turso y el disco: todo lo que toca el
// mundo entra por `CutoverDeps`, así que se prueba con dobles.
//
// DOS CAMINOS (el estado que ve la pantalla está en `shared/cutover.ts`):
//
//   MIGRADOR (la fila `cutover` no existe y este PC la reclama):
//     reclamar → [pregunta de rezagados] → importar y validar → abrir la base
//     → pasos locales → emparejar con el hub → sembrar (subir todo) → pedir el
//     secreto de alta y `cutover = done`.
//
//   SECUNDARIO (`cutover = done`, o `migrating` de otro PC y se espera):
//     abrir una base VACÍA → emparejar con el secreto que dejó el migrador (o
//     pedir un código si caducó) → bajar todo → migración local (mapa de ids,
//     instalaciones, ubicaciones de restauración, índice de partidas).
//
//   SIN TURSO configurado (un solo PC, §19.5): importar y migrar en local, sin
//   reclamo ni hub. El emparejado se hace después desde Ajustes.
//
// CÓMO SE REANUDA. Cada paso que no se puede rehacer a ciegas deja una marca
// en `CutoverProgress` (un fichero JSON local, fuera de la base: la base 2.0
// no existe todavía en los primeros pasos). Al arrancar se vuelve a llamar a
// `run()`: lee la marca y salta lo hecho. Los pasos son idempotentes o se
// reinician enteros (la importación borra la base y empieza de cero). Que la
// importación sea lo único que "se borra y se repite" es lo que da la garantía
// de §19.9: si falla, no queda nada a medias.
//
// CÓMO SE SIEMBRA. No hay un "subir todo" aparte: al emparejar con un hub que
// este PC no conoce, el primer ciclo del motor marca todas las filas como
// pendientes y las sube por el camino normal, en lotes (`engine.checkIdentity`).
// El orquestador solo MIRA: la siembra termina cuando el motor ya habló con el
// hub (`hubKnown`) y no quedan filas pendientes. Si el hub dice "cuota
// agotada" el motor reintenta solo con espera creciente; el orquestador solo
// enseña el problema y le da un toque (`syncNow`) de vez en cuando.
//
// NUNCA se registra un token, un secreto de alta ni nada de Turso: solo
// códigos de error y recuentos.

import {
  CUTOVER_STALE_AFTER_MS,
  type CutoverAction,
  type CutoverErrorCode,
  type CutoverLaggingDevice,
  type CutoverState,
} from '../../shared/cutover';
import {
  findLaggingDevices,
  LegacyCutoverError,
  type CutoverSelf,
  type DeviceStatus,
  type LegacyCutover,
} from './legacyCutover';

// ── Constantes de tiempo ────────────────────────────────────────────────────

/** Cada cuánto se mira el progreso del sync (siembra y bajada). */
export const CUTOVER_POLL_MS = 2_000;
/** Cada cuánto se vuelve a mirar si otro PC sigue migrando. */
export const CUTOVER_WAIT_OTHER_MS = 10_000;
/** Cada cuánto se comprueba solo si los PCs rezagados ya han informado. */
export const CUTOVER_LAGGING_RECHECK_MS = 30_000;
/** Cada cuánto se da un toque al sync si va parado (levanta una pausa). */
export const CUTOVER_SYNC_NUDGE_MS = 60_000;

// ── Marca de progreso (local) ───────────────────────────────────────────────

export interface CutoverProgress {
  readonly version: 1;
  /** Qué papel tiene este PC en el corte. */
  readonly role: 'migrator' | 'secondary' | 'local';
  readonly startedAt: number;
  /** La importación terminó y validó: `Afterplay2.db` vale. */
  readonly imported?: boolean;
  /** La persona eligió seguir sin los PCs rezagados (no se vuelve a preguntar). */
  readonly laggingAck?: boolean;
  /** Los pasos locales posteriores a la importación / la bajada están hechos. */
  readonly localDone?: boolean;
  /** La siembra del hub terminó. */
  readonly seeded?: boolean;
  /** El corte terminó en este PC: no vuelve a arrancar. */
  readonly completed?: boolean;
}

export interface ProgressStore {
  read(): CutoverProgress | null;
  write(progress: CutoverProgress): void;
  clear(): void;
}

// ── Dependencias ────────────────────────────────────────────────────────────

/** Lo que el orquestador necesita saber del sync en curso. */
export interface CutoverSyncProgress {
  /** El motor ya habló con el hub (hay `hubId`): marcó todo como pendiente. */
  readonly hubKnown: boolean;
  /** Filas pendientes de subir; antes de `hubKnown`, todas las filas. */
  readonly rowsPending: number;
  /** Filas que hay en las tablas sincronizadas. */
  readonly rowsLocal: number;
  /** Ya terminó una bajada completa. */
  readonly pulled: boolean;
  /** La frase del motor si va parado o reintentando (cuota, red, hub de producción…). */
  readonly problem: string | null;
}

export interface CutoverSync {
  isPaired(): boolean;
  /** Arranca el motor con las credenciales ya guardadas (no hace nada si ya corre). */
  start(): Promise<void>;
  pair(request: { hubUrl: string; code: string }): Promise<PairOutcome>;
  pairWithSecret(request: { hubUrl: string; enrollSecret: string }): Promise<PairOutcome>;
  requestEnrollSecret(): Promise<EnrollOutcome>;
  /** Ciclo ya, levantando una pausa. */
  syncNow(): void;
  progress(): CutoverSyncProgress;
}

export type PairOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };
export type EnrollOutcome =
  | {
      readonly ok: true;
      readonly grant: { url: string; enrollSecret: string; expiresAt: number };
    }
  | { readonly ok: false; readonly message: string };

export interface CutoverDeps {
  readonly self: CutoverSelf;
  readonly now: () => number;
  /** Espera `ms`. Los tests la sustituyen para no esperar. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
  readonly progress: ProgressStore;
  /**
   * El puente de Turso. Lanza `LegacyCutoverError('not-configured')` si no hay
   * credenciales: entonces se migra solo en local.
   */
  readonly openBridge: () => Promise<LegacyCutover>;
  /** Borra `Afterplay2.db` y su marcador (la base no está abierta). */
  readonly removeLocalDatabase: () => void;
  /**
   * Copia consistente de la 1.x, importa y valida en `Afterplay2.db`. Con las
   * sesiones abiertas cerradas en su último latido. Si falla, lanza (el
   * orquestador borra la base y suelta el reclamo).
   */
  readonly importLegacy: () => Promise<void>;
  /**
   * Abre la base 2.0 y crea el sync de la app. `fresh` crea una base vacía
   * junto a la 1.x (secundario). Idempotente.
   */
  readonly openDatabase: (mode: 'existing' | 'fresh') => void;
  /** Tras importar: marca el reindexado de partidas y mueve las ubicaciones de restauración. */
  readonly afterImport: () => void;
  /** Secundario, tras bajar: mapa de ids, instalaciones, ubicaciones, índice de partidas. */
  readonly migrateSecondaryLocal: () => Promise<void> | void;
  readonly sync: CutoverSync;
  readonly timing?: Partial<{
    pollMs: number;
    waitOtherMs: number;
    laggingRecheckMs: number;
    syncNudgeMs: number;
    staleAfterMs: number;
  }>;
}

// ── Errores ─────────────────────────────────────────────────────────────────

/** Un fallo con su código y una frase para la persona (sin secretos). */
export class CutoverFailure extends Error {
  readonly code: CutoverErrorCode;
  constructor(code: CutoverErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CutoverFailure';
    this.code = code;
  }
}

const describeError = (error: unknown): { code: CutoverErrorCode; message: string } => {
  if (error instanceof CutoverFailure) return { code: error.code, message: error.message };
  if (error instanceof LegacyCutoverError) {
    switch (error.code) {
      case 'missing-table':
        return {
          code: 'bridge-missing',
          message:
            'The shared library has not been prepared for Afterplay 2 yet. Update Afterplay 1.x on every PC first, open it once, and try again.',
        };
      case 'not-owner':
        return {
          code: 'not-owner',
          message: 'Another PC took over the migration. Try again to see where it stands.',
        };
      case 'not-configured':
      case 'malformed':
        return {
          code: 'bridge-failed',
          message: "Couldn't read the migration state from the shared library.",
        };
    }
  }
  // Un error que no es nuestro puede llevar rutas o direcciones: no se repite el texto.
  return {
    code: 'unexpected',
    message: 'Something went wrong during the migration. Try again.',
  };
};

const BRIDGE_UNREACHABLE =
  "Couldn't reach the shared library. Check your connection and try again.";

/**
 * El puente con los fallos de Turso ya convertidos en `CutoverFailure`: un error
 * de red de Turso puede llevar la dirección de la base, así que no se repite su
 * texto. Los errores del propio puente (`LegacyCutoverError`) pasan tal cual.
 */
const guardBridge = (bridge: LegacyCutover): LegacyCutover => {
  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof LegacyCutoverError) throw error;
      throw new CutoverFailure('bridge-failed', BRIDGE_UNREACHABLE, { cause: error });
    }
  };
  return {
    readCutover: () => guard(() => bridge.readCutover()),
    claimCutover: (self) => guard(() => bridge.claimCutover(self)),
    releaseCutover: (deviceId) => guard(() => bridge.releaseCutover(deviceId)),
    completeCutover: (deviceId, hub) => guard(() => bridge.completeCutover(deviceId, hub)),
    readDeviceStatuses: () => guard(() => bridge.readDeviceStatuses()),
    readHubEnrollment: () => guard(() => bridge.readHubEnrollment()),
    close: () => bridge.close(),
  };
};

// ── El orquestador ──────────────────────────────────────────────────────────

export type CutoverListener = (state: CutoverState) => void;

export class CutoverController {
  private current: CutoverState = { kind: 'idle' };
  private readonly listeners = new Set<CutoverListener>();
  private queue: CutoverAction[] = [];
  private wake: (() => void) | null = null;
  private running = false;
  private lastNudgeAt = 0;

  constructor(private readonly deps: CutoverDeps) {}

  get state(): CutoverState {
    return this.current;
  }

  onState(listener: CutoverListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Una respuesta de la persona. La que no toca al estado actual se ignora. */
  dispatch(action: CutoverAction): void {
    this.queue.push(action);
    this.wake?.();
  }

  /**
   * Lleva el corte hasta el final. Resuelve cuando el estado es `done`; un fallo
   * no lo hace rechazar: pasa a `error` y espera `retry`. Una sola a la vez.
   */
  async run(): Promise<void> {
    if (this.running) throw new Error('el corte ya está en marcha');
    this.running = true;
    try {
      for (;;) {
        try {
          await this.attempt();
          this.setState({ kind: 'done' });
          return;
        } catch (error) {
          const info = describeError(error);
          // Solo el código y la frase ya redactada: el mensaje de un error de
          // red puede llevar una dirección.
          this.deps.log(`[cutover] fallo (${info.code}): ${info.message}`);
          await this.ask({ kind: 'error', ...info }, ['retry']);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ── Un intento entero ─────────────────────────────────────────────────────

  private async attempt(): Promise<void> {
    this.setState({ kind: 'checking' });
    const progress = this.deps.progress.read();
    if (progress?.completed) return;

    let bridge: LegacyCutover | null = null;
    try {
      bridge = guardBridge(await this.deps.openBridge());
    } catch (error) {
      if (!(error instanceof LegacyCutoverError && error.code === 'not-configured')) {
        throw error instanceof LegacyCutoverError
          ? error
          : new CutoverFailure('bridge-failed', BRIDGE_UNREACHABLE, { cause: error });
      }
    }
    try {
      if (bridge === null) {
        if (progress && progress.role !== 'local') {
          throw new CutoverFailure(
            'bridge-failed',
            'The shared library credentials are missing, so this migration cannot continue. Add them in Settings and try again.',
          );
        }
        await this.runLocalOnly();
      } else {
        await this.runWithBridge(bridge);
      }
    } finally {
      bridge?.close();
    }
  }

  // ── Un solo PC, sin Turso ─────────────────────────────────────────────────

  private async runLocalOnly(): Promise<void> {
    this.update({ role: 'local' });
    if (!this.progress().imported) await this.importStep(null);
    this.openDatabase('existing');
    if (!this.progress().localDone) {
      this.setState({ kind: 'local-migration' });
      this.deps.afterImport();
      this.update({ localDone: true });
    }
    this.update({ completed: true });
  }

  // ── Con Turso: ¿migrador o secundario? ────────────────────────────────────

  private async runWithBridge(bridge: LegacyCutover): Promise<void> {
    const self = this.deps.self;
    if (this.progress(false)?.role === 'secondary') return this.runSecondary(bridge);

    for (;;) {
      const claim = await bridge.claimCutover(self);
      if (claim.outcome !== 'lost') return this.runMigrator(bridge);
      const holder = claim.holder;
      if (holder.state === 'done') {
        if (holder.deviceId === self.deviceId) return this.finishAfterCrash();
        return this.runSecondary(bridge);
      }
      // Otro PC está migrando: se espera a que acabe, o a que suelte el reclamo.
      this.setState({ kind: 'waiting-other', deviceName: holder.deviceName, since: holder.at });
      for (;;) {
        await this.deps.sleep(this.timing().waitOtherMs);
        let now: Awaited<ReturnType<LegacyCutover['readCutover']>>;
        try {
          now = await bridge.readCutover();
        } catch {
          continue; // una caída de red mientras se espera no es un fallo
        }
        if (now === null) break; // lo soltó (falló): se vuelve a intentar reclamar
        if (now.state === 'done') {
          if (now.deviceId === self.deviceId) return this.finishAfterCrash();
          return this.runSecondary(bridge);
        }
      }
    }
  }

  /** Este PC ya escribió `done` y se cerró antes de anotarlo: solo falta cerrar en local. */
  private async finishAfterCrash(): Promise<void> {
    this.update({ role: 'migrator', imported: true, seeded: true });
    this.openDatabase('existing');
    if (!this.progress().localDone) {
      this.deps.afterImport();
      this.update({ localDone: true });
    }
    this.update({ completed: true });
  }

  // ── Camino del migrador ───────────────────────────────────────────────────

  private async runMigrator(bridge: LegacyCutover): Promise<void> {
    this.update({ role: 'migrator' });

    if (!this.progress().imported) {
      // Hasta que la importación valida, un fallo suelta el reclamo: la 1.x
      // sigue como estaba (§19.9).
      try {
        await this.laggingGate(bridge);
        await this.importStep(bridge);
      } catch (error) {
        await this.release(bridge);
        throw error;
      }
    }

    this.openDatabase('existing');
    if (!this.progress().localDone) {
      this.setState({ kind: 'local-migration' });
      try {
        this.deps.afterImport();
      } catch (cause) {
        throw new CutoverFailure(
          'local-migration-failed',
          "Couldn't finish setting up this PC after the import.",
          { cause },
        );
      }
      this.update({ localDone: true });
    }

    await this.pairStep();
    if (!this.progress().seeded) {
      await this.seedStep();
      this.update({ seeded: true });
    }
    await this.finishStep(bridge);
  }

  /** §19.6 paso 2: LA pregunta. Vuelve cuando no hay rezagados o la persona sigue. */
  private async laggingGate(bridge: LegacyCutover): Promise<void> {
    if (this.progress().laggingAck) return;
    const { deps } = this;
    const lagging = async (): Promise<CutoverLaggingDevice[]> => {
      const statuses = await bridge.readDeviceStatuses();
      return describeLagging(
        statuses,
        findLaggingDevices(statuses, deps.self.deviceId, deps.now(), this.timing().staleAfterMs),
      );
    };

    let devices = await lagging();
    let rechecking = false;
    while (devices.length > 0) {
      const action = await this.ask(
        { kind: 'question-lagging', devices, rechecking },
        ['continue', 'wait'],
        this.timing().laggingRecheckMs,
      );
      if (action?.type === 'continue') {
        this.update({ laggingAck: true });
        return;
      }
      // `wait` o el tiempo: se vuelve a mirar. Una caída de red aquí no hace
      // que se migre sin preguntar: se sigue esperando con lo último que se vio.
      rechecking = action?.type === 'wait';
      if (rechecking) this.setState({ kind: 'question-lagging', devices, rechecking });
      try {
        devices = await lagging();
      } catch {
        // se conserva la lista anterior
      }
      rechecking = false;
    }
  }

  private async importStep(bridge: LegacyCutover | null): Promise<void> {
    this.setState({ kind: 'importing' });
    this.deps.removeLocalDatabase();
    try {
      await this.deps.importLegacy();
    } catch (error) {
      this.deps.removeLocalDatabase();
      const blocked = importBlocked(error);
      throw new CutoverFailure(
        blocked ? 'import-blocked' : 'import-failed',
        blocked
          ? `${blocked} Nothing has been changed: fix that in Afterplay 1.x and try again.`
          : "The migration didn't pass its checks, so nothing was changed. Your library is still safe in Afterplay 1.x.",
        { cause: error },
      );
    }
    this.update({ imported: true });
    if (bridge === null) this.deps.log('[cutover] importación local terminada (sin Turso)');
  }

  private async release(bridge: LegacyCutover): Promise<void> {
    try {
      await bridge.releaseCutover(this.deps.self.deviceId);
      this.deps.progress.clear();
    } catch {
      // Sin red: el reclamo queda a nombre de este PC y se reanuda (`already-mine`).
      this.deps.log('[cutover] no se pudo soltar el reclamo ahora; se reanudará');
    }
  }

  private async finishStep(bridge: LegacyCutover): Promise<void> {
    this.setState({ kind: 'finishing' });
    const secret = await this.deps.sync.requestEnrollSecret();
    if (!secret.ok) throw new CutoverFailure('finish-failed', secret.message);
    await bridge.completeCutover(this.deps.self.deviceId, secret.grant);
    this.update({ completed: true });
  }

  // ── Camino del secundario ─────────────────────────────────────────────────

  private async runSecondary(bridge: LegacyCutover): Promise<void> {
    this.update({ role: 'secondary' });
    this.openDatabase('fresh');

    if (this.deps.sync.isPaired()) await this.deps.sync.start();
    else await this.secondaryPairing(bridge);

    for (;;) {
      const p = this.deps.sync.progress();
      if (p.hubKnown && p.pulled) break;
      this.setState({ kind: 'pulling', rowsLocal: p.rowsLocal, problem: p.problem });
      this.nudge();
      await this.deps.sleep(this.timing().pollMs);
    }

    if (!this.progress().localDone) {
      this.setState({ kind: 'local-migration' });
      try {
        await this.deps.migrateSecondaryLocal();
      } catch (cause) {
        throw new CutoverFailure(
          'local-migration-failed',
          "Couldn't finish setting up this PC after downloading your library.",
          { cause },
        );
      }
      this.update({ localDone: true });
    }
    this.update({ completed: true });
  }

  /** §9.3: con el secreto que dejó el migrador; si caducó o falla, un código. */
  private async secondaryPairing(bridge: LegacyCutover): Promise<void> {
    let useSecret = true;
    let reason: 'secret-expired' | 'secret-failed' = 'secret-expired';
    let error: string | null = null;
    for (;;) {
      const enrollment = await bridge.readHubEnrollment();
      const usable = enrollment !== null && enrollment.expiresAt > this.deps.now();
      if (usable && useSecret) {
        this.setState({ kind: 'pairing' });
        const result = await this.deps.sync.pairWithSecret({
          hubUrl: enrollment.url,
          enrollSecret: enrollment.enrollSecret,
        });
        if (result.ok) return;
        reason = 'secret-failed';
        error = result.message;
      } else if (!usable) {
        reason = 'secret-expired';
      }
      const action = await this.ask(
        {
          kind: 'needs-pairing',
          reason,
          hubUrl: enrollment?.url ?? null,
          error,
          canRetrySecret: usable,
        },
        usable ? ['submit-pairing', 'retry'] : ['submit-pairing'],
      );
      if (action?.type === 'retry') {
        useSecret = true;
        continue;
      }
      if (action?.type !== 'submit-pairing') continue;
      this.setState({ kind: 'pairing' });
      const result = await this.deps.sync.pair({ hubUrl: action.hubUrl, code: action.code });
      if (result.ok) return;
      useSecret = false;
      error = result.message;
    }
  }

  // ── Piezas comunes ────────────────────────────────────────────────────────

  /** Emparejar con un código (el primer PC de una persona, §9.3), o seguir si ya lo está. */
  private async pairStep(): Promise<void> {
    if (this.deps.sync.isPaired()) {
      await this.deps.sync.start();
      return;
    }
    let error: string | null = null;
    for (;;) {
      const action = await this.ask(
        { kind: 'needs-pairing', reason: 'first-pc', hubUrl: null, error, canRetrySecret: false },
        ['submit-pairing'],
      );
      if (action?.type !== 'submit-pairing') continue;
      this.setState({ kind: 'pairing' });
      const result = await this.deps.sync.pair({ hubUrl: action.hubUrl, code: action.code });
      if (result.ok) return;
      error = result.message;
    }
  }

  /** §19.7: la siembra termina cuando no quedan filas pendientes tras hablar con el hub. */
  private async seedStep(): Promise<void> {
    for (;;) {
      const p = this.deps.sync.progress();
      if (p.hubKnown && p.rowsPending === 0) return;
      this.setState({
        kind: 'seeding',
        rowsLeft: p.rowsPending,
        rowsTotal: Math.max(p.rowsLocal, p.rowsPending),
        problem: p.problem,
      });
      this.nudge();
      await this.deps.sleep(this.timing().pollMs);
    }
  }

  private openDatabase(mode: 'existing' | 'fresh'): void {
    try {
      this.deps.openDatabase(mode);
    } catch (cause) {
      throw new CutoverFailure('database-failed', "Couldn't open this PC's library.", { cause });
    }
  }

  private nudge(): void {
    const now = this.deps.now();
    if (now - this.lastNudgeAt < this.timing().syncNudgeMs) return;
    this.lastNudgeAt = now;
    this.deps.sync.syncNow();
  }

  private timing(): Required<NonNullable<CutoverDeps['timing']>> {
    const t = this.deps.timing ?? {};
    return {
      pollMs: t.pollMs ?? CUTOVER_POLL_MS,
      waitOtherMs: t.waitOtherMs ?? CUTOVER_WAIT_OTHER_MS,
      laggingRecheckMs: t.laggingRecheckMs ?? CUTOVER_LAGGING_RECHECK_MS,
      syncNudgeMs: t.syncNudgeMs ?? CUTOVER_SYNC_NUDGE_MS,
      staleAfterMs: t.staleAfterMs ?? CUTOVER_STALE_AFTER_MS,
    };
  }

  // ── Marca de progreso ─────────────────────────────────────────────────────

  /** La marca actual; si no hay, la crea (salvo `create = false`). */
  private progress(create?: true): CutoverProgress;
  private progress(create: false): CutoverProgress | null;
  private progress(create = true): CutoverProgress | null {
    const stored = this.deps.progress.read();
    if (stored || !create) return stored;
    return { version: 1, role: 'migrator', startedAt: this.deps.now() };
  }

  private update(patch: Partial<Omit<CutoverProgress, 'version' | 'startedAt'>>): void {
    const base = this.progress();
    this.deps.progress.write({ ...base, ...patch });
  }

  // ── Estado y preguntas ────────────────────────────────────────────────────

  private setState(next: CutoverState): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  /**
   * Enseña `state` y espera una de las acciones admitidas. Con `timeoutMs`
   * devuelve null si pasa el tiempo sin respuesta. Las acciones que llegaron
   * antes de enseñar el estado se descartan: contestaban a otra cosa.
   */
  private async ask(
    state: CutoverState,
    accept: readonly CutoverAction['type'][],
    timeoutMs?: number,
  ): Promise<CutoverAction | null> {
    this.queue = [];
    this.setState(state);
    for (;;) {
      const at = this.queue.findIndex((action) => accept.includes(action.type));
      if (at >= 0) {
        const [action] = this.queue.splice(at, 1);
        this.queue = [];
        return action;
      }
      this.queue = [];
      let timedOut = false;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        if (timeoutMs !== undefined) {
          void this.deps.sleep(timeoutMs).then(() => {
            timedOut = true;
            resolve();
          });
        }
      });
      this.wake = null;
      if (timedOut && this.queue.length === 0) return null;
    }
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const describeLagging = (
  statuses: readonly DeviceStatus[],
  lagging: readonly { deviceId: string; deviceName: string; reason: 'pending-changes' | 'stale' }[],
): CutoverLaggingDevice[] =>
  lagging.map((device) => {
    const status = statuses.find((s) => s.deviceId === device.deviceId);
    return {
      ...device,
      lastReportAt: status?.at ?? 0,
      pendingChanges: status?.pendingChanges ?? 0,
    };
  });

/** Si el fallo es un bloqueo de la importación (§19.7), su frase; si no, null. */
const importBlocked = (error: unknown): string | null => {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if (at.name === 'ImportBlockedError' || at.name === 'LegacyNulTextError') return at.message;
  }
  return null;
};
