// Transporte de proceso para el arnés de convergencia (§17.2).
//
// Hace lo mismo que el camino HTTP real, sin red:
// - Cada petición y cada respuesta pasan por JSON (`JSON.parse(JSON.stringify)`),
//   así que cliente y hub nunca comparten referencias a objetos, igual que con
//   `fetch`.
// - El token se valida con `TenantHub.authenticateToken`, como hará el Worker.
// - Un `HubError` se convierte en `SyncRequestError` con el código del
//   protocolo, el estado HTTP que le asigna el Worker (`statusFor`, importado de
//   `hub/worker/src/errors.ts` para no copiar la tabla)
//   y el cuerpo `SyncErrorBody`, que es lo que reconstruye `httpTransport.ts`.
// - Cualquier OTRA excepción del hub sería un 500 en el Worker, que el cliente
//   ve como `network`. Aquí se hace igual pero además se anota en `faults`:
//   un fallo interno del hub no debe quedar escondido tras un reintento.

import { statusFor } from '../worker/src/errors';
import { HubError, type HubDevice, type TenantHub } from '../core/hub';
import {
  SyncRequestError,
  type ClientVersion,
  type EnrollRequest,
  type EnrollResponse,
  type JobClaimRequest,
  type JobClaimResponse,
  type JobDoneRequest,
  type JobDoneResponse,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type StatusResponse,
  type SyncTransport,
} from '../../src/shared/sync/protocol';

/** Copia por JSON: lo que llega al otro lado de un `fetch`. */
export const wireCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface TransportCall {
  kind: 'status' | 'push' | 'pull' | 'claim' | 'done' | 'enroll';
  /** Filas que viajaron (subida: las enviadas; bajada: las recibidas). */
  rows: number;
}

export interface InProcessTransportOptions {
  /** El hub vigente: es una función para poder sustituirlo (hub nuevo, E-24). */
  hub: () => TenantHub;
  /** El token que lleva este dispositivo; null = aún sin emparejar. */
  token: () => string | null;
  /** ¿Hay red? Con false toda petición falla como `network`. */
  online: () => boolean;
  /** Excepciones que no eran `HubError` (un 500 del Worker). */
  faults: unknown[];
}

export interface InProcessTransport extends SyncTransport {
  /** Registro de peticiones que llegaron al hub (las cortadas por la red no cuentan). */
  readonly calls: TransportCall[];
}

export function createInProcessTransport(options: InProcessTransportOptions): InProcessTransport {
  const calls: TransportCall[] = [];

  async function handle<T>(
    kind: TransportCall['kind'],
    fn: (hub: TenantHub, device: HubDevice) => T,
    rowsOf: (result: T) => number = () => 0,
  ): Promise<T> {
    if (!options.online()) {
      throw new SyncRequestError('network', 'no se pudo contactar con el hub: sin red (simulado)');
    }
    try {
      const hub = options.hub();
      const device = await hub.authenticateToken(options.token() ?? '');
      const result = wireCopy(fn(hub, device));
      calls.push({ kind, rows: rowsOf(result) });
      return result;
    } catch (error) {
      if (error instanceof HubError) {
        throw new SyncRequestError(
          error.code,
          error.message,
          statusFor(error.code),
          wireCopy(error.toBody()),
        );
      }
      options.faults.push(error);
      throw new SyncRequestError(
        'network',
        `el hub respondió 500: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }

  return {
    calls,
    status: (version: ClientVersion): Promise<StatusResponse> => {
      const request = wireCopy(version);
      return handle('status', (hub) => hub.status(request));
    },
    push: (request: PushRequest): Promise<PushResponse> => {
      const body = wireCopy(request);
      return handle(
        'push',
        (hub) => hub.push(body),
        () => body.rows.length,
      );
    },
    pull: (since: number, limit: number, version: ClientVersion): Promise<PullResponse> => {
      const request = wireCopy(version);
      return handle(
        'pull',
        (hub) => hub.pull(since, limit, request),
        (page) => page.rows.length,
      );
    },
    claimJob: (request: JobClaimRequest): Promise<JobClaimResponse> => {
      const body = wireCopy(request);
      return handle('claim', (hub, device) => hub.claimJob(device, body));
    },
    doneJob: (request: JobDoneRequest): Promise<JobDoneResponse> => {
      const body = wireCopy(request);
      return handle('done', (hub, device) => hub.doneJob(device, body));
    },
  };
}

/**
 * `POST /enroll`: la única ruta sin token. Mismo trato de errores que el resto.
 * Se separa de `SyncTransport` porque el contrato del cliente no la incluye
 * (`httpTransport.enroll` es una función aparte).
 */
export async function enrollInProcess(
  hub: TenantHub,
  online: boolean,
  request: EnrollRequest,
  faults: unknown[],
): Promise<EnrollResponse> {
  if (!online) {
    throw new SyncRequestError('network', 'no se pudo contactar con el hub: sin red (simulado)');
  }
  const body = wireCopy(request);
  try {
    return wireCopy(await hub.enroll(body));
  } catch (error) {
    if (error instanceof HubError) {
      throw new SyncRequestError(
        error.code,
        error.message,
        statusFor(error.code),
        wireCopy(error.toBody()),
      );
    }
    faults.push(error);
    throw new SyncRequestError('network', 'el hub respondió 500', 500);
  }
}
