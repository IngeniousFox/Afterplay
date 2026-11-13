import { eq } from 'drizzle-orm';
import type { Session } from '../../../../../shared/dto';
import { sessions, type SessionRow } from '../../schema';
import type { QueryContext } from '../common';

// El DTO de sesión que devuelve este paquete (CONSULTAS.md §1.2 "Session").
//
// En la fase 2 los DTO solo GANAN campos (decisión "DTO" de §5.0). `deviceId`
// y `closedBy` son de la fase 4 en la interfaz (§10.8), pero salen ya de aquí:
// con ids de texto forman parte de `Session<string>` (`SessionOwnership` de
// `shared/dto.ts`), y el renderer que no los conoce los ignora.

/**
 * Fila 2.0 → DTO de hoy. `isManual` se deriva de `source` (en la fase 2 es
 * siempre `false`: `legacy_manual` solo lo escribe el importador) y
 * `lastHeartbeatAt` es la señal de vida SINCRONIZADA (`lastSeenAt`, cada
 * ≥60 s): el latido de 5 s es local y no forma parte de la sesión
 * (§10.3). En el renderer solo lo lee un fixture de tests.
 */
export function toSessionDto(row: SessionRow): Session<string> {
  return {
    id: row.id,
    iterationId: row.playthroughId,
    emulatorId: row.emulatorId,
    isManual: row.source === 'legacy_manual',
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    lastHeartbeatAt: row.lastSeenAt,
    startedBy: row.startedBy,
    datePrecision: row.datePrecision,
    note: row.note,
    deviceId: row.deviceId,
    closedBy: row.closedBy,
  };
}

/** La fila tal cual, con lápida o sin ella. */
export function readSessionRow(ctx: QueryContext, sessionId: string): SessionRow | undefined {
  return ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
}

/** Relee una fila que acaba de escribirse en la misma operación. */
export function rereadSession(ctx: QueryContext, sessionId: string): Session<string> {
  const row = readSessionRow(ctx, sessionId);
  if (!row) throw new Error(`sessions: la fila ${sessionId} desapareció al releerla`);
  return toSessionDto(row);
}
