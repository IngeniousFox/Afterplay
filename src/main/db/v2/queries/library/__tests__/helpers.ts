import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { StateEventDatePrecision, StateEventType } from '../../../schema';
import {
  insertSynced,
  seedSession,
  seedStateEvent,
  type QueryFixture,
  type SeedSessionOptions,
} from '../../common/__tests__/fixtures';
import type { QueryContext } from '../../common/context';
import { computeDurationSec } from '../../common/sessionsClose';

// Ayudas de los tests de P1. Las fábricas de la 1.x (`makeSession`,
// `makeOpenSession`, `makeStateEvent`) hablaban en fechas ISO y horas; estas
// hacen lo mismo encima de los `seed*` comunes, para portar los casos sin
// reescribir cada fecha. Todo con datos inventados.

const HOUR_MS = 3_600_000;

/** Una sesión medida de ESTE PC: `hours` fija el fin y la duración a la vez. */
export function session(
  ctx: QueryContext,
  playthroughId: string,
  startedAt: string,
  hours: number,
  extra: Omit<SeedSessionOptions, 'playthroughId' | 'startedAt' | 'endedAt'> = {},
): string {
  const start = new Date(startedAt);
  return seedSession(ctx, {
    playthroughId,
    startedAt: start,
    endedAt: new Date(start.getTime() + hours * HOUR_MS),
    ...extra,
  });
}

/** Una sesión ABIERTA de este PC (jugando ahora). */
export function openSession(ctx: QueryContext, playthroughId: string, startedAt: string): string {
  return seedSession(ctx, { playthroughId, startedAt: new Date(startedAt), endedAt: null });
}

/**
 * Una sesión "llegada por sync" de este mismo PC, por debajo de la puerta: la
 * forma de tener dos abiertas del mismo juego (la puerta no deja crear la
 * segunda) o una `legacy_manual` (solo la escribe el importador).
 */
export function syncedSession(
  ctx: QueryContext,
  playthroughId: string,
  startedAt: string,
  hours: number | null,
  source: 'measured' | 'legacy_manual' = 'measured',
): string {
  const start = new Date(startedAt);
  const end = hours === null ? null : new Date(start.getTime() + hours * HOUR_MS);
  return insertSynced(ctx, 'sessions', {
    playthroughId,
    deviceId: ctx.deviceId,
    startedBy: 'watcher',
    source,
    startedAt: start,
    endedAt: end,
    durationSec: end === null ? null : computeDurationSec(start, end),
    datePrecision: 'datetime',
    lastSeenAt: end ?? start,
    closedBy: end === null ? null : 'owner',
  });
}

/** Un evento de estado. Por defecto con precisión de instante, como la fábrica 1.x. */
export function event(
  ctx: QueryContext,
  playthroughId: string,
  type: StateEventType,
  occurredAt: string | Date,
  options: { datePrecision?: StateEventDatePrecision; note?: string | null } = {},
): string {
  return seedStateEvent(ctx, {
    playthroughId,
    type,
    occurredAt: typeof occurredAt === 'string' ? new Date(occurredAt) : occurredAt,
    datePrecision: options.datePrecision ?? 'datetime',
    note: options.note ?? null,
  });
}

export const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

// ── El contador de trabajo (presupuestos) ───────────────────────────────────
//
// El equivalente 2.0 del `measure` del andamio 1.x (db/__tests__/harness.ts):
// cuenta CONSULTAS y FILAS que cruzan el driver, que es lo determinista y lo
// que un refactor empeora sin querer (un N+1, un select de la tabla entera).
// No cronometra.
//
// Drizzle (`node-sqlite/session.js`) llama a `client.prepare(sql)` en cada
// consulta y luego a `all`/`get`/`run` del statement. Se envuelve `prepare` de
// ESTA conexión (propiedad propia de la instancia, sin tocar el prototipo) y
// cada statement con un Proxy que cuenta. Las sentencias que preparan los
// propios contadores no existen: no se cuenta nada fuera de `measure`.

export type QueryStats = { queries: number; rows: number };

export interface WorkCounter {
  measure<T>(fn: () => T): [T, QueryStats];
  restore(): void;
}

export function countWork(fx: QueryFixture): WorkCounter {
  const client = fx.local.db.$client as DatabaseSync;
  const original = client.prepare;
  const stats: QueryStats = { queries: 0, rows: 0 };
  const count = (rows: number): void => {
    stats.queries += 1;
    stats.rows += rows;
  };
  const wrap = (stmt: StatementSync): StatementSync =>
    new Proxy(stmt, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        const fn = value as (...args: unknown[]) => unknown;
        if (prop === 'all') {
          return (...args: unknown[]) => {
            const rows = fn.apply(target, args) as unknown[];
            count(rows.length);
            return rows;
          };
        }
        if (prop === 'get') {
          return (...args: unknown[]) => {
            const row = fn.apply(target, args);
            count(row === undefined ? 0 : 1);
            return row;
          };
        }
        if (prop === 'run') {
          return (...args: unknown[]) => {
            const result = fn.apply(target, args);
            count(0);
            return result;
          };
        }
        return fn.bind(target);
      },
    });
  client.prepare = ((sqlText: string) => wrap(original.call(client, sqlText))) as typeof original;
  return {
    measure<T>(fn: () => T): [T, QueryStats] {
      const before = { ...stats };
      const value = fn();
      return [value, { queries: stats.queries - before.queries, rows: stats.rows - before.rows }];
    },
    restore() {
      client.prepare = original;
    },
  };
}
