// PUENTE 1.x → L3: este módulo desaparece en la tanda de limpieza L3
// (AFTERPLAY-2.0.md, Apéndice C) junto con el importador.
//
// Es el ÚNICO sitio del proceso principal 2.0 que habla con Turso, y solo para
// el corte de la 1.x (§19.3.1, §19.6): reclamarlo con una escritura
// condicional en la base que comparten todos los PCs de la 1.x, publicar el
// hub al terminar, y leer lo que dejó el migrador. Todo va contra la tabla
// `app_meta` que crea la 1.8.
//
// El cliente se carga con `import('@libsql/client/web')` (HTTP puro, sin
// binarios nativos) bajo demanda, para que no cuente en el arranque.
// noTursoInMain.test.ts permite ese import dinámico desde este fichero y desde
// ningún otro. Los tests inyectan un cliente `file:` ya abierto.
//
// Este módulo no se conecta a nada por su cuenta: lo orquesta otra pieza.

import type { Client, InStatement, ResultSet } from '@libsql/client';
import { z } from 'zod';

export type LegacyCutoverErrorCode =
  | 'not-configured' // faltan databaseUrl / databaseAuthToken
  | 'missing-table' // ninguna 1.8 ha creado `app_meta` todavía
  | 'malformed' // una fila con JSON que no cumple el contrato
  | 'not-owner'; // `completeCutover` sin ser el `migrating` de este PC

export class LegacyCutoverError extends Error {
  readonly code: LegacyCutoverErrorCode;
  constructor(code: LegacyCutoverErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LegacyCutoverError';
    this.code = code;
  }
}

const cutoverSchema = z.object({
  state: z.enum(['migrating', 'done']),
  deviceId: z.string().min(1),
  deviceName: z.string(),
  appVersion: z.string(),
  at: z.number(),
});
export type CutoverValue = z.infer<typeof cutoverSchema>;

const hubSchema = z.object({
  url: z.string().min(1),
  enrollSecret: z.string().min(1),
  expiresAt: z.number(),
});
export type HubEnrollment = z.infer<typeof hubSchema>;

const deviceStatusSchema = z.object({
  deviceName: z.string(),
  appVersion: z.string(),
  lastPushOkAt: z.number().nullable(),
  pendingChanges: z.number(),
  at: z.number(),
});
export type DeviceStatusValue = z.infer<typeof deviceStatusSchema>;
export type DeviceStatus = DeviceStatusValue & { deviceId: string };

export interface CutoverSelf {
  deviceId: string;
  deviceName: string;
  appVersion: string;
}

export type ClaimResult =
  { outcome: 'won' } | { outcome: 'already-mine' } | { outcome: 'lost'; holder: CutoverValue };

const CUTOVER_KEY = 'cutover';
const HUB_KEY = 'hub';
const STATUS_PREFIX = 'device_status:';

export interface LegacyCutover {
  readCutover(): Promise<CutoverValue | null>;
  claimCutover(self: CutoverSelf): Promise<ClaimResult>;
  releaseCutover(deviceId: string): Promise<boolean>;
  completeCutover(deviceId: string, hub: HubEnrollment): Promise<void>;
  readDeviceStatuses(): Promise<DeviceStatus[]>;
  readHubEnrollment(): Promise<HubEnrollment | null>;
  close(): void;
}

const isMissingTable = (error: unknown): boolean => {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if (/no such table:\s*app_meta/i.test(at.message)) return true;
  }
  return false;
};

const missingTable = (cause: unknown): LegacyCutoverError =>
  new LegacyCutoverError('missing-table', 'app_meta no existe: la 1.8 no está instalada', {
    cause,
  });

const parseValue = <T>(key: string, raw: unknown, schema: z.ZodType<T>): T => {
  try {
    return schema.parse(JSON.parse(String(raw)));
  } catch (cause) {
    throw new LegacyCutoverError('malformed', `app_meta: el valor de «${key}» no es válido`, {
      cause,
    });
  }
};

/** Abre el puente sobre un cliente ya creado (tests, o `openLegacyCutover`). */
export const createLegacyCutover = (
  client: Client,
  now: () => number = Date.now,
): LegacyCutover => {
  const run = async (statement: InStatement): Promise<ResultSet> => {
    try {
      return await client.execute(statement);
    } catch (cause) {
      throw isMissingTable(cause) ? missingTable(cause) : cause;
    }
  };

  const readRow = async (key: string): Promise<string | null> => {
    const result = await run({ sql: 'SELECT value FROM app_meta WHERE key = ?', args: [key] });
    return result.rows.length > 0 ? String(result.rows[0].value) : null;
  };

  const readCutover = async (): Promise<CutoverValue | null> => {
    const raw = await readRow(CUTOVER_KEY);
    return raw === null ? null : parseValue(CUTOVER_KEY, raw, cutoverSchema);
  };

  const claimCutover = async (self: CutoverSelf): Promise<ClaimResult> => {
    const value: CutoverValue = { state: 'migrating', ...self, at: now() };
    // §19.3.1 «Reclamar»: gana quien ve rowsAffected = 1.
    const result = await run({
      sql: `INSERT INTO app_meta (key, value, updatedAt) VALUES (?, ?, ?)
            ON CONFLICT (key) DO NOTHING`,
      args: [CUTOVER_KEY, JSON.stringify(value), value.at],
    });
    if (result.rowsAffected === 1) return { outcome: 'won' };
    const holder = await readCutover();
    // Si la fila desapareció entre las dos sentencias (alguien la soltó),
    // se vuelve a intentar el reclamo entero.
    if (!holder) return claimCutover(self);
    if (holder.state === 'migrating' && holder.deviceId === self.deviceId) {
      return { outcome: 'already-mine' };
    }
    return { outcome: 'lost', holder };
  };

  return {
    readCutover,
    claimCutover,

    // §19.3.1 «Soltar»: solo borra el `migrating` de este PC.
    async releaseCutover(deviceId) {
      const result = await run({
        sql: `DELETE FROM app_meta WHERE key = ?
                AND json_extract(value, '$.state') = 'migrating'
                AND json_extract(value, '$.deviceId') = ?`,
        args: [CUTOVER_KEY, deviceId],
      });
      return result.rowsAffected === 1;
    },

    // §19.3.1 «Terminar»: en una transacción, cutover → done y se escribe hub.
    async completeCutover(deviceId, hub) {
      const checked = hubSchema.parse(hub);
      const at = now();
      const tx = await client.transaction('write').catch((cause: unknown) => {
        throw isMissingTable(cause) ? missingTable(cause) : cause;
      });
      try {
        const promoted = await tx.execute({
          sql: `UPDATE app_meta SET value = json_set(value, '$.state', 'done'), updatedAt = ?
                  WHERE key = ?
                    AND json_extract(value, '$.state') = 'migrating'
                    AND json_extract(value, '$.deviceId') = ?`,
          args: [at, CUTOVER_KEY, deviceId],
        });
        if (promoted.rowsAffected !== 1) {
          throw new LegacyCutoverError(
            'not-owner',
            'El corte no está en «migrating» a nombre de este PC',
          );
        }
        await tx.execute({
          sql: `INSERT INTO app_meta (key, value, updatedAt) VALUES (?, ?, ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
          args: [HUB_KEY, JSON.stringify(checked), at],
        });
        await tx.commit();
      } catch (error) {
        await tx.rollback().catch(() => undefined);
        throw isMissingTable(error) ? missingTable(error) : error;
      } finally {
        tx.close();
      }
    },

    async readDeviceStatuses() {
      const result = await run({
        sql: 'SELECT key, value FROM app_meta WHERE substr(key, 1, ?) = ? ORDER BY key',
        args: [STATUS_PREFIX.length, STATUS_PREFIX],
      });
      return result.rows.map((row) => ({
        deviceId: String(row.key).slice(STATUS_PREFIX.length),
        ...parseValue(String(row.key), row.value, deviceStatusSchema),
      }));
    },

    // Solo con `cutover = done`: antes de eso el hub aún no está listo.
    async readHubEnrollment() {
      const cutover = await readCutover();
      if (cutover?.state !== 'done') return null;
      const raw = await readRow(HUB_KEY);
      return raw === null ? null : parseValue(HUB_KEY, raw, hubSchema);
    },

    close: () => client.close(),
  };
};

/** Abre el puente con la URL y el token de Turso de la 1.x (HTTP). */
export const openLegacyCutover = async (
  config?: { url: string; authToken: string },
  now?: () => number,
): Promise<LegacyCutover> => {
  let target = config;
  if (!target) {
    // Dinámico: credentials.ts importa electron y no debe cargarse con el módulo.
    const { getCredentials } = await import('../config/credentials');
    const stored = getCredentials();
    if (stored.databaseUrl && stored.databaseAuthToken) {
      target = { url: stored.databaseUrl, authToken: stored.databaseAuthToken };
    }
  }
  if (!target?.url || !target.authToken) {
    throw new LegacyCutoverError('not-configured', 'No hay credenciales de Turso configuradas');
  }
  const { createClient } = await import('@libsql/client/web');
  return createLegacyCutover(createClient(target), now);
};

export interface LaggingDevice {
  deviceId: string;
  deviceName: string;
  reason: 'pending-changes' | 'stale';
}

/**
 * La pregunta del §19.6 paso 2: ¿qué OTROS PCs tienen cambios sin subir o no
 * han informado en `staleAfterMs`? Vacío = se puede migrar sin preguntar.
 */
export const findLaggingDevices = (
  statuses: readonly DeviceStatus[],
  selfDeviceId: string,
  nowMs: number,
  staleAfterMs: number,
): LaggingDevice[] =>
  statuses.flatMap((status): LaggingDevice[] => {
    if (status.deviceId === selfDeviceId) return [];
    const base = { deviceId: status.deviceId, deviceName: status.deviceName };
    if (status.pendingChanges > 0) return [{ ...base, reason: 'pending-changes' }];
    if (nowMs - status.at > staleAfterMs) return [{ ...base, reason: 'stale' }];
    return [];
  });
