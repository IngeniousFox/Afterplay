import type { JobKind, SyncTransport } from '../../shared/sync/protocol';
import { getSyncRuntime } from './instance';

// Concesiones de trabajo del cliente (AFTERPLAY-2.0.md §14.3, F-32, F-33).
//
// Los trabajos de fondo que cuestan dinero o cuota no deben correr en dos PCs
// a la vez, ni repetirse porque el otro PC aún no ha bajado el resultado. El
// hub concede el par `(kind, key)` a un solo dispositivo; este módulo es el
// lado del cliente: pide la concesión, decide si el trabajo corre o no, y la
// cierra al terminar.
//
// REGLAS (§14.3), las que este módulo garantiza:
//   · Con hub, los trabajos de PAGO (`memory`, `curiosities`) EXIGEN la
//     concesión: con el hub sin responder no se ejecutan (mejor un día de
//     retraso que pagar dos veces).
//   · Los demás (`radar`, `refresh_all`, `enrich`) corren en local si el hub
//     no responde: son idempotentes y el peor caso es trabajo repetido.
//   · Sin hub emparejado (un solo PC) no hay concesiones y todo corre como
//     siempre.
//   · Un trabajo terminado, con éxito o con fallo, sigue ocupando su par en el
//     hub hasta que caduca la concesión: así un rechazo del modelo no se
//     repaga a diario. Por eso los plazos son largos (horas).
//
// NUNCA lanza por culpa del hub: un fallo al pedir o al cerrar se traduce en
// `unavailable` o se anota en el log. Lo único que se propaga es el error del
// propio trabajo.

/** Lo único que hace falta del transporte: pedir y cerrar concesiones. */
export type JobTransport = Pick<SyncTransport, 'claimJob' | 'doneJob'>;

export type ClaimResult =
  | { readonly status: 'granted'; readonly leaseId: string; readonly expiresAt: number }
  /** Otro PC la tiene, o ya terminó y su concesión sigue viva. */
  | {
      readonly status: 'denied';
      readonly holderDeviceId: string;
      readonly expiresAt: number;
    }
  /** Hay hub emparejado pero no contesta (red, 5xx, token revocado, versión...). */
  | { readonly status: 'unavailable'; readonly reason: string }
  /** Sin hub emparejado: no hay concesiones. */
  | { readonly status: 'no_hub' };

/** Los trabajos que cuestan dinero: exigen concesión cuando hay hub. */
export const PAID_JOB_KINDS: readonly JobKind[] = ['memory', 'curiosities'];

export const isPaidJob = (kind: JobKind): boolean => PAID_JOB_KINDS.includes(kind);

const HOUR_SEC = 60 * 60;

/**
 * Plazo de cada tipo. El hub admite hasta 24 h. Largo a propósito: la
 * concesión cerrada sigue ocupando el par hasta caducar (ver arriba), y esa es
 * la protección contra repagar. Los de pago, horas; `enrich` es barato y su
 * resultado baja por sync, así que basta un plazo medio.
 */
export const JOB_TTL_SEC: { readonly [K in JobKind]: number } = {
  memory: 24 * HOUR_SEC,
  curiosities: 12 * HOUR_SEC,
  radar: 24 * HOUR_SEC,
  refresh_all: 24 * HOUR_SEC,
  enrich: 6 * HOUR_SEC,
};

/** `month:2026-06` o `year:2026`: la clave de un recap (§14.3). `scopeKey` es la de `scopeKeyOf`. */
export const memoryJobKey = (scopeType: 'month' | 'year', scopeKey: string): string =>
  `${scopeType}:${scopeKey}`;

/**
 * La semana ISO (`2026-W46`) de un instante, contada en UTC para que todos los
 * PCs de una persona coincidan aunque estén en husos distintos.
 */
export const isoWeekKey = (at: Date | number): string => {
  const date = new Date(typeof at === 'number' ? at : at.getTime());
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // El jueves de la semana decide a qué año ISO pertenece.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

export interface JobClaimsLogger {
  warn: (message: string) => void;
}

export interface JobClaims {
  /** Pide la concesión. Nunca lanza. */
  claim(kind: JobKind, key: string, ttlSec?: number): Promise<ClaimResult>;
  /** Cierra una concesión PROPIA. Nunca lanza: si falla, caduca sola. */
  done(leaseId: string, outcome: 'ok' | 'failed', reason?: string): Promise<void>;
}

export interface JobClaimsDeps {
  /** El transporte del hub emparejado y activo, o null si no lo hay. */
  readonly transport: () => JobTransport | null;
  readonly logger?: JobClaimsLogger;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : 'error desconocido';

export function createJobClaims(deps: JobClaimsDeps): JobClaims {
  const warn = (message: string): void => deps.logger?.warn(message);
  return {
    async claim(kind, key, ttlSec = JOB_TTL_SEC[kind]) {
      const transport = deps.transport();
      if (!transport) return { status: 'no_hub' };
      try {
        const response = await transport.claimJob({ kind, key, ttlSec });
        return response.granted
          ? { status: 'granted', leaseId: response.leaseId, expiresAt: response.expiresAt }
          : {
              status: 'denied',
              holderDeviceId: response.holderDeviceId,
              expiresAt: response.expiresAt,
            };
      } catch (error) {
        return { status: 'unavailable', reason: describeError(error) };
      }
    },
    async done(leaseId, outcome, reason) {
      const transport = deps.transport();
      if (!transport) return;
      try {
        await transport.doneJob({ leaseId, outcome, ...(reason ? { reason } : {}) });
      } catch (error) {
        warn(`no se pudo cerrar la concesion ${leaseId}: ${describeError(error)}`);
      }
    },
  };
}

/** Lo que se hace con el resultado de pedir la concesión (§14.3). Pura. */
export type StartDecision = 'run' | 'skip_denied' | 'skip_unavailable' | 'skip_no_hub';

export function decideStart(
  kind: JobKind,
  claim: ClaimResult,
  options: { readonly requireHub?: boolean } = {},
): StartDecision {
  switch (claim.status) {
    case 'granted':
      return 'run';
    case 'denied':
      return 'skip_denied';
    case 'unavailable':
      return isPaidJob(kind) ? 'skip_unavailable' : 'run';
    case 'no_hub':
      // Solo un trabajo que nace del sync (enrich) no tiene sentido sin hub.
      return options.requireHub ? 'skip_no_hub' : 'run';
  }
}

export interface LeasedJob {
  readonly kind: JobKind;
  readonly key: string;
  readonly ttlSec?: number;
  /** El trabajo solo existe con hub (p. ej. `enrich`): sin él no corre. */
  readonly requireHub?: boolean;
}

export type LeasedRun<T> =
  | { readonly ran: true; readonly value: T; readonly claim: ClaimResult }
  | {
      readonly ran: false;
      readonly reason: Exclude<StartDecision, 'run'>;
      readonly claim: ClaimResult;
    };

/**
 * Corre `work` bajo una concesión:
 *   · pide la concesión y decide con `decideStart`;
 *   · si hay concesión, la cierra al acabar: `ok`, o `failed` con el motivo
 *     si `work` lanza o si `failureOf` ve en lo que devolvió un fallo (el
 *     rechazo del modelo, que no lanza);
 *   · el error de `work` se relanza después de cerrar.
 */
export async function runLeased<T>(
  claims: JobClaims,
  job: LeasedJob,
  work: () => Promise<T>,
  failureOf?: (value: T) => string | null,
): Promise<LeasedRun<T>> {
  const claim = await claims.claim(job.kind, job.key, job.ttlSec);
  const decision = decideStart(job.kind, claim, { requireHub: job.requireHub });
  if (decision !== 'run') return { ran: false, reason: decision, claim };

  const leaseId = claim.status === 'granted' ? claim.leaseId : null;
  let value: T;
  try {
    value = await work();
  } catch (error) {
    if (leaseId) await claims.done(leaseId, 'failed', describeError(error));
    throw error;
  }
  if (leaseId) {
    const reason = failureOf?.(value) ?? null;
    if (reason !== null) await claims.done(leaseId, 'failed', reason);
    else await claims.done(leaseId, 'ok');
  }
  return { ran: true, value, claim };
}

// La instancia de ESTA app: usa el transporte del sync activo en cada llamada,
// así que sigue válida si el PC se empareja o desempareja con la app abierta.
let shared: JobClaims | null = null;

export function appJobClaims(): JobClaims {
  shared ??= createJobClaims({
    transport: () => getSyncRuntime()?.jobTransport() ?? null,
    logger: { warn: (message) => console.warn(`[jobs] ${message}`) },
  });
  return shared;
}
