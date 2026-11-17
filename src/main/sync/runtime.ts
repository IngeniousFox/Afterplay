import type { HybridClock } from '../../shared/sync/clock';
import {
  parseCredentialsBundle,
  type CredentialsBundle,
} from '../../shared/sync/credentialsBundle';
import { checkHubUrl } from '../../shared/sync/hubUrl';
import {
  PROTOCOL_VERSION,
  SyncRequestError,
  type EnrollResponse,
  isEnrollSecretShape,
  type SyncTransport,
} from '../../shared/sync/protocol';
import {
  describePairError,
  describeSyncProblem,
  type PairRequest,
  type SyncStatus,
} from '../../shared/sync/status';
import { APP_SCHEMA_VERSION } from '../db/v2/schemaVersion';
import type { LocalDb, WriteStore } from '../db/v2/store';
import {
  createSyncEngine,
  type CycleResult,
  type SyncChange,
  type SyncEngine,
  type SyncLogger,
} from './engine';
import {
  enroll as httpEnroll,
  createHttpTransport,
  exchangeCredentials as httpExchangeCredentials,
  requestEnrollSecret as httpRequestEnrollSecret,
} from './httpTransport';
import { SyncScheduler, type FlushOutcome, type SchedulerTimers } from './scheduler';
import { applyEnrollment, readSyncState } from './state';

// El sync dentro de la app (AFTERPLAY-2.0.md §8.5, §9.3): une el motor, el
// planificador y las credenciales con lo que de verdad hay en el PC. No sabe
// nada de Electron: todo lo que toca el sistema (credenciales cifradas, perfil
// de desarrollo, modo E2E, avisos a la ventana) entra por `SyncRuntimeDeps`,
// para poder probarlo con una base en memoria y un hub falso.
//
// REGLAS QUE ESTE MÓDULO GARANTIZA:
//   · Sin hub emparejado no se crea nada (ni transporte, ni temporizadores):
//     la app se comporta exactamente como sin sync.
//   · En un test E2E el sync no existe: ni arranca ni deja emparejar.
//   · Un perfil de desarrollo no sincroniza con un hub que no sea de
//     desarrollo (la copia de datos reales no puede hablar con producción).
//   · El token y el código de emparejado jamás van al log.

export interface SyncCredentialsStore {
  read(): { hubUrl: string; token: string } | null;
  write(credentials: { hubUrl: string; token: string }): void;
  clear(): void;
}

/**
 * Las credenciales de servicios de ESTE PC, tal como las ve el sync: lo que se
 * sube al hub y dónde se aplica lo que llega de él. El runtime no sabe de
 * `credentials.json` ni de config.json; eso lo cablea `appRuntime.ts`.
 */
export interface CredentialsSource {
  /** Entradas de las claves que tienen valor o sello (sin sello = `updatedAt` 0). */
  readBundle(): CredentialsBundle;
  /** Escribe lo que el hub tenía más nuevo, con los sellos de origen. */
  apply(changes: CredentialsBundle): void;
}

export type CredentialsSyncResult = 'synced' | 'applied' | 'not-paired' | 'failed' | 'busy';

/** Cada cuánto, como mucho, un ciclo de sync correcto repite el intercambio de credenciales. */
export const CREDENTIALS_SYNC_INTERVAL_MS = 10 * 60_000;

export interface SyncRuntimeDeps {
  /** La base abierta: la lectura, la puerta de escritura y el reloj compartido. */
  readonly local: {
    readonly db: LocalDb;
    readonly store: Pick<WriteStore, 'onChange'>;
    readonly clock: HybridClock;
    readonly deviceId: string;
  };
  readonly deviceName: string;
  /** Modo E2E (src/main/lib/e2e.ts): el sync no debe existir. */
  readonly isE2E: boolean;
  /** ¿Prohíbe el perfil de desarrollo hablar con este hub? */
  readonly isHubBlocked: (hubUrl: string) => boolean;
  readonly credentials: SyncCredentialsStore;
  /** Sin esto, el PC no intercambia credenciales con el hub. */
  readonly credentialsSource?: CredentialsSource;
  /** Lo que la descarga cambió: la ventana refresca sus consultas. */
  readonly onChange: (change: SyncChange) => void;
  /** El estado cambió (ciclo terminado, emparejado, desemparejado). */
  readonly onStatus: () => void;
  readonly logger: SyncLogger;
  readonly now?: () => number;
  // Para los tests.
  readonly enroll?: typeof httpEnroll;
  readonly exchangeCredentials?: typeof httpExchangeCredentials;
  readonly requestEnrollSecret?: typeof httpRequestEnrollSecret;
  readonly createTransport?: (options: { baseUrl: string; token: string }) => SyncTransport;
  readonly timers?: SchedulerTimers;
  readonly schedulerOptions?: { debounceMs?: number; intervalMs?: number };
}

/** Lo que el PC migrador deja para los demás (§19.3.1). El secreto jamás va al log. */
export interface EnrollSecretGrant {
  readonly url: string;
  readonly enrollSecret: string;
  readonly expiresAt: number;
}

export type EnrollSecretResult =
  | { readonly ok: true; readonly grant: EnrollSecretGrant }
  | { readonly ok: false; readonly message: string };

export type PairResult =
  | { readonly ok: true; readonly status: SyncStatus }
  | { readonly ok: false; readonly message: string };

/** Tope del primer ciclo del arranque: las tareas de fondo no esperan a una red lenta (§8.5). */
export const START_LIMIT_MS = 10_000;
/** Tope de la subida final al cerrar (§10.6). */
export const QUIT_FLUSH_MS = 5000;

interface Active {
  readonly hubUrl: string;
  readonly transport: SyncTransport;
  readonly engine: SyncEngine;
  readonly scheduler: SyncScheduler;
  readonly unsubscribe: () => void;
}

export class SyncRuntime {
  private active: Active | null = null;
  private disabledReason: string | null = null;
  private pairing = false;
  private syncingCredentials = false;
  private lastCredentialsSyncAt = 0;
  /** Para no repetir en el log el mismo fallo cada reintento. */
  private lastLogged = '';

  constructor(private readonly deps: SyncRuntimeDeps) {}

  /**
   * Arranque: si hay un hub emparejado, crea el motor y lanza el primer ciclo
   * con tope de tiempo (§8.5). Devuelve cuando termina o se agota el tope; el
   * ciclo sigue en segundo plano. Sin emparejado, o en E2E, no hace nada.
   */
  async start(limitMs: number = START_LIMIT_MS): Promise<void> {
    if (this.deps.isE2E || this.active) return;
    const credentials = this.deps.credentials.read();
    if (!credentials) return;
    if (!this.activate(credentials.hubUrl, credentials.token)) return;
    void this.syncCredentials();
    await this.current()?.scheduler.start(limitMs);
  }

  /**
   * El transporte del hub activo para pedir y cerrar concesiones de trabajo
   * (§14.3), o null sin hub emparejado (o en E2E). Lo usa `jobClaims.ts`.
   */
  jobTransport(): Pick<SyncTransport, 'claimJob' | 'doneJob'> | null {
    return this.active?.transport ?? null;
  }

  /** ¿Hay un hub emparejado y funcionando? */
  get isActive(): boolean {
    return this.active !== null;
  }

  status(): SyncStatus {
    if (this.deps.isE2E) return { ...EMPTY_STATUS, available: false };
    const credentials = this.deps.credentials.read();
    if (!credentials) return EMPTY_STATUS;
    const state = readSyncState(this.deps.local.db);
    // Un bloqueo guardado manda sobre el último error: es lo que de verdad
    // impide sincronizar, aunque el último ciclo haya fallado por otra cosa.
    const blocked = state.blockedMinSchema !== null && state.blockedMinSchema > APP_SCHEMA_VERSION;
    return {
      available: true,
      paired: true,
      hubUrl: credentials.hubUrl,
      running: this.active?.engine.running ?? false,
      lastPushAt: state.lastPushAt,
      lastPullAt: state.lastPullAt,
      problem: describeSyncProblem(
        blocked ? 'schema_too_old' : state.lastErrorCode,
        state.lastError,
      ),
      disabledReason: this.disabledReason,
    };
  }

  /** "Sincronizar ahora": ciclo YA, levantando una pausa si la había. */
  syncNow(): void {
    const scheduler = this.active?.scheduler;
    if (!scheduler) return;
    if (scheduler.isPaused) scheduler.resume();
    else scheduler.wake();
  }

  /** Vuelta de suspensión, desbloqueo o red de vuelta (§8.5). */
  wake(): void {
    this.active?.scheduler.wake();
  }

  async pair(request: PairRequest): Promise<PairResult> {
    const code = request.code.trim();
    if (code === '') return fail('Enter the pairing code shown in the web app.');
    return this.pairWith(request.hubUrl, { code });
  }

  /**
   * Empareja con el secreto de alta que dejó el primer PC (§9.3, §19.6): sin
   * teclear nada. Es el mismo camino que `pair`; el hub crea un token NUEVO
   * para este PC igual que con un código.
   */
  async pairWithSecret(request: { hubUrl: string; enrollSecret: string }): Promise<PairResult> {
    const enrollSecret = request.enrollSecret.trim();
    // La forma se comprueba aquí para no gastar un intento del bloqueo del hub
    // con basura; el mensaje no repite lo recibido.
    if (!isEnrollSecretShape(enrollSecret)) {
      return fail('The enrollment secret is not valid.');
    }
    return this.pairWith(request.hubUrl, { enrollSecret });
  }

  /**
   * Pide al hub un secreto de alta (solo emparejado y con el hub activo). Lo
   * emite el hub con el token de este PC; sustituye al anterior. NUNCA lanza.
   */
  async requestEnrollSecret(): Promise<EnrollSecretResult> {
    if (this.deps.isE2E) return fail('Sync is turned off while running tests.');
    const credentials = this.deps.credentials.read();
    if (!credentials || !this.active) return fail('This PC is not paired with a hub.');
    try {
      const response = await (this.deps.requestEnrollSecret ?? httpRequestEnrollSecret)({
        baseUrl: credentials.hubUrl,
        token: credentials.token,
      });
      if (
        !isEnrollSecretShape(response?.enrollSecret) ||
        typeof response.expiresAt !== 'number' ||
        !Number.isFinite(response.expiresAt)
      ) {
        return fail("That hub's reply was not understood.");
      }
      return {
        ok: true,
        grant: {
          url: credentials.hubUrl,
          enrollSecret: response.enrollSecret,
          expiresAt: response.expiresAt,
        },
      };
    } catch (error) {
      const known = error instanceof SyncRequestError;
      this.deps.logger.warn(
        `no se pudo pedir el secreto de alta: ${known ? error.code : 'error inesperado'}`,
      );
      return fail(
        known
          ? describePairError(error.code, error.message)
          : "Couldn't ask the hub for an enrollment secret.",
      );
    }
  }

  private async pairWith(
    hubUrl: string,
    credential: { code: string } | { enrollSecret: string },
  ): Promise<PairResult> {
    if (this.deps.isE2E) return fail('Sync is turned off while running tests.');
    if (this.pairing) return fail('Pairing is already in progress.');
    if (this.active || this.deps.credentials.read()) {
      return fail('This PC is already paired. Unpair it first to use a different hub.');
    }
    const check = checkHubUrl(hubUrl);
    if (!check.ok) return fail(check.message);
    if (this.deps.isHubBlocked(check.url)) {
      return fail('This development profile can only pair with a development hub.');
    }

    this.pairing = true;
    try {
      let response: EnrollResponse;
      try {
        const enroll = this.deps.enroll ?? httpEnroll;
        response = await enroll(check.url, {
          ...credential,
          deviceId: this.deps.local.deviceId,
          deviceName: this.deps.deviceName,
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: APP_SCHEMA_VERSION,
        });
      } catch (error) {
        const known = error instanceof SyncRequestError;
        this.deps.logger.warn(
          `no se pudo emparejar con ${check.host}: ${known ? error.code : 'error inesperado'}`,
        );
        return fail(
          describePairError(
            known ? error.code : null,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      if (typeof response.token !== 'string' || !response.token.startsWith('ap1.')) {
        return fail("That hub's reply was not understood. Check the address.");
      }

      // Una biblioteca importada de la 1.x no se mezcla con un hub que ya tiene
      // datos de otra biblioteca: las filas no se corresponden (§19.6).
      const conflict = await this.importedLibraryConflict(check.url, response);
      if (conflict) return fail(conflict);

      // Primero el id de reloj y luego el token: si lo segundo falla la app
      // queda sin emparejar pero con un id válido (inofensivo); al revés
      // quedaría emparejada firmando con un id que el hub no conoce.
      try {
        applyEnrollment(this.deps.local.db, response, this.deps.local.clock);
        this.deps.credentials.write({ hubUrl: check.url, token: response.token });
      } catch (error) {
        this.deps.logger.error('no se pudo guardar el emparejado', error);
        return fail("Couldn't save the pairing on this PC. Create a new code and try again.");
      }
      this.disabledReason = null;
      this.deps.logger.info(`emparejado con ${check.host} (id corto ${response.shortDeviceId})`);
      if (this.activate(check.url, response.token)) {
        void this.syncCredentials();
        void this.current()?.scheduler.start(0);
      }
      this.deps.onStatus();
      return { ok: true, status: this.status() };
    } finally {
      this.pairing = false;
    }
  }

  /**
   * Si este PC tiene una biblioteca importada de la 1.x y el hub ya tiene datos
   * (y no es un hub con el que este PC ya sincronizó), la frase para rechazar el
   * emparejado; si no, null. El secundario del corte no entra aquí: empareja con
   * una base vacía, sin importar nada. Ante la duda (no se pudo mirar el hub) se
   * rechaza.
   */
  private async importedLibraryConflict(
    hubUrl: string,
    response: EnrollResponse,
  ): Promise<string | null> {
    const { db } = this.deps.local;
    if (!hasImportedLibrary(db)) return null;
    if (readSyncState(db).hubId === response.hubId) return null;
    try {
      const transport = (this.deps.createTransport ?? createHttpTransport)({
        baseUrl: hubUrl,
        token: response.token,
      });
      const hub = await transport.status({
        protocolVersion: PROTOCOL_VERSION,
        schemaVersion: APP_SCHEMA_VERSION,
      });
      if (!(hub.seq > 0)) return null;
    } catch (error) {
      this.deps.logger.warn(
        `no se pudo comprobar si el hub está vacío: ${error instanceof SyncRequestError ? error.code : 'error inesperado'}`,
      );
      return "Couldn't check whether that hub is empty, so this library was not paired. Try again.";
    }
    this.deps.logger.warn('emparejado rechazado: biblioteca importada y hub con datos');
    return IMPORTED_LIBRARY_CONFLICT;
  }

  /**
   * Olvida el hub en ESTE PC: borra el token y para el planificador. No avisa
   * al hub: revocar el dispositivo se hace desde la web (§9.2).
   */
  unpair(): SyncStatus {
    this.deactivate();
    this.disabledReason = null;
    this.deps.credentials.clear();
    this.lastCredentialsSyncAt = 0;
    this.lastLogged = '';
    this.deps.logger.info('desemparejado de este PC');
    this.deps.onStatus();
    return this.status();
  }

  /**
   * Un ciclo de sync rápido antes de crear algo que otro PC podría crear a la
   * vez (§10.7: un playthrough). Resuelve cuando el ciclo acaba o pasan
   * `limitMs`. Sin hub emparejado y activo (o en E2E) resuelve al instante.
   * NUNCA lanza: lo peor que pasa es decidir con lo que hay.
   */
  async syncOnceWithin(limitMs: number): Promise<void> {
    const scheduler = this.active?.scheduler;
    if (!scheduler) return;
    try {
      await scheduler.runOnceWithin(limitMs);
    } catch (error) {
      this.deps.logger.warn(
        `el sync rapido antes de crear fallo: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  /**
   * Intercambia las credenciales con el hub en una sola vuelta: sube las de este
   * PC y recibe las fusionadas. Donde el hub tiene algo MÁS NUEVO (o igual de
   * nuevo pero distinto: los empates los gana el hub para que todos converjan)
   * se aplica aquí; lo demás ya lo tiene el hub. Se llama al arrancar
   * emparejado, al emparejar, al cambiar las claves en Ajustes y, como mucho
   * cada 10 minutos, tras un ciclo correcto. NUNCA lanza ni registra valores:
   * solo códigos y NÚMERO de claves.
   */
  async syncCredentials(): Promise<CredentialsSyncResult> {
    const source = this.deps.credentialsSource;
    const credentials = this.deps.credentials.read();
    if (!source || !credentials || this.deps.isE2E || this.deps.isHubBlocked(credentials.hubUrl)) {
      return 'not-paired';
    }
    if (this.syncingCredentials) return 'busy';
    this.syncingCredentials = true;
    this.lastCredentialsSyncAt = (this.deps.now ?? Date.now)();
    try {
      let hubEntries: CredentialsBundle;
      try {
        const response = await (this.deps.exchangeCredentials ?? httpExchangeCredentials)(
          { baseUrl: credentials.hubUrl, token: credentials.token },
          { entries: source.readBundle() },
        );
        hubEntries = parseCredentialsBundle(response?.entries);
      } catch (error) {
        this.deps.logger.warn(
          `no se pudieron intercambiar las credenciales con el hub: ${error instanceof SyncRequestError ? error.code : 'error inesperado'}`,
        );
        return 'failed';
      }
      // Si se desemparejó mientras esperábamos, lo que llegó ya no es de este PC.
      if (this.deps.credentials.read()?.token !== credentials.token) return 'not-paired';

      // Se compara con lo de AHORA, no con lo que se subió: si la persona cambió
      // una clave durante la espera, esa edición manda.
      const changes = hubWins(source.readBundle(), hubEntries);
      if (Object.keys(changes).length === 0) return 'synced';
      try {
        source.apply(changes);
      } catch {
        this.deps.logger.warn('no se pudieron aplicar las credenciales recibidas del hub');
        return 'failed';
      }
      return 'applied';
    } finally {
      this.syncingCredentials = false;
    }
  }

  /** Subida final al cerrar la app, con tope de 5 s (§10.6). */
  async flushOnQuit(timeoutMs: number = QUIT_FLUSH_MS): Promise<FlushOutcome> {
    const active = this.active;
    if (!active) return 'skipped';
    const outcome = await active.scheduler.flushOnQuit({ timeoutMs });
    this.deps.logger.info(`subida final al cerrar: ${outcome}`);
    this.deactivate();
    return outcome;
  }

  /** Para todo sin subir nada (cierre sin sync, o tests). */
  stop(): void {
    this.deactivate();
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  // Lee `active` sin el estrechamiento de tipos de la función que acaba de llamar a `activate`.
  private current(): Active | null {
    return this.active;
  }

  private activate(hubUrl: string, token: string): boolean {
    if (this.deps.isHubBlocked(hubUrl)) {
      this.disabledReason =
        'This development profile only syncs with a development hub, so sync is off.';
      this.deps.logger.warn('el hub emparejado no es de desarrollo: el sync queda apagado');
      return false;
    }
    const { local, logger } = this.deps;
    const transport = (this.deps.createTransport ?? createHttpTransport)({
      baseUrl: hubUrl,
      token,
    });
    const engine = createSyncEngine({
      local,
      transport,
      now: this.deps.now ?? Date.now,
      onChange: (change) => this.deps.onChange(change),
      logger,
    });
    const scheduler = new SyncScheduler({
      runCycle: () => engine.runCycle(),
      timers: this.deps.timers,
      now: this.deps.now,
      logger,
      onResult: (result) => this.onResult(result),
      ...this.deps.schedulerOptions,
    });
    // Cada transacción confirmada en una tabla sincronizada (§8.6) arma la
    // subida en 2 s. Las escrituras del propio motor no pasan por la puerta,
    // así que bajar filas no dispara una subida.
    const unsubscribe = local.store.onChange(() => scheduler.notifyLocalChange());
    this.active = { hubUrl, transport, engine, scheduler, unsubscribe };
    return true;
  }

  private deactivate(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.unsubscribe();
    active.scheduler.stop();
  }

  /** Tras un ciclo correcto: repite el intercambio, pero no más de una vez cada 10 minutos. */
  private maybeSyncCredentials(): void {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.lastCredentialsSyncAt < CREDENTIALS_SYNC_INTERVAL_MS) return;
    void this.syncCredentials();
  }

  private onResult(result: CycleResult): void {
    // Concisión: un ciclo sin nada que contar no se escribe (pasa cada minuto).
    if (result.status === 'ok') {
      this.lastLogged = '';
      this.maybeSyncCredentials();
      if (result.pushed > 0 || result.applied > 0 || result.reset) {
        this.deps.logger.info(
          `ciclo ok: subidas ${result.pushed}, bajadas ${result.applied}` +
            (result.reset ? ` (reinicio: ${result.reset})` : ''),
        );
      }
    } else {
      const key = `${result.status}:${result.error?.code ?? ''}`;
      if (key !== this.lastLogged) {
        this.lastLogged = key;
        this.deps.logger.warn(
          `ciclo ${result.status}${result.error ? `: ${result.error.code}` : ''}`,
        );
      }
    }
    this.deps.onStatus();
  }
}

export const IMPORTED_LIBRARY_CONFLICT =
  'This library was imported from Afterplay 1.x on this PC and the hub already has data, so pairing would mix two unrelated libraries. Pair with an empty hub instead.';

/** ¿Tiene esta base filas importadas de la 1.x? (dispositivo `legacy` o mapa de ids). */
function hasImportedLibrary(db: LocalDb): boolean {
  const client = db.$client;
  const legacyDevice = client
    .prepare(
      `SELECT 1 AS found FROM "devices" WHERE "kind" = 'legacy' AND "syncDeleted" IS NULL LIMIT 1`,
    )
    .get();
  if (legacyDevice) return true;
  return client.prepare('SELECT 1 AS found FROM "local_legacy_ids" LIMIT 1').get() !== undefined;
}

const EMPTY_STATUS: SyncStatus = {
  available: true,
  paired: false,
  hubUrl: null,
  running: false,
  lastPushAt: null,
  lastPullAt: null,
  problem: null,
  disabledReason: null,
};

/**
 * Las entradas del hub que deben ganar aquí: este PC no tiene la clave, o la del
 * hub es más nueva, o es igual de nueva pero con otro valor (empate: el hub).
 */
function hubWins(local: CredentialsBundle, hub: CredentialsBundle): CredentialsBundle {
  const out: CredentialsBundle = {};
  for (const key of Object.keys(hub) as (keyof CredentialsBundle)[]) {
    const theirs = hub[key];
    if (!theirs) continue;
    const mine = local[key];
    if (!mine) {
      // Un borrado de algo que aquí nunca existió no cambia nada.
      if (theirs.value !== null) out[key] = theirs;
    } else if (
      theirs.updatedAt > mine.updatedAt ||
      (theirs.updatedAt === mine.updatedAt && theirs.value !== mine.value)
    ) {
      out[key] = theirs;
    }
  }
  return out;
}

const fail = (message: string): { readonly ok: false; readonly message: string } => ({
  ok: false,
  message,
});
