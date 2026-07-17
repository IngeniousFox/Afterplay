import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { CreateGameWithDetailsInput } from '../../../../shared/types';
import { iterationsTable, sessionsTable, spendEventsTable, stateEventsTable } from '../../schema';

// El `tx` de una transacción de drizzle — mismo query builder que la
// conexión, tipado desde ella para no importar internos de drizzle.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

// Sesiones marcadoras de borde (arrancan y terminan en el mismo instante,
// duración 0) — solo existen para anclar start/endSessionId de la iteración
// y así derivar sus fechas (SPEC 4). endedAt NO puede quedar null o
// getGames() la contaría como sesión abierta ("en marcha").
type EdgeMilestone = 'completed' | 'dropped' | 'on_hold';

// 'started' (sigue jugándolo) y 'resting' (solo endless) se quedan fuera a
// propósito: ninguno de los dos es un punto de fin válido — 'started' porque
// todavía no se ha dejado de jugar (el renderer ya no manda `finished` en
// ese caso, esto es cinturón y tirantes), y 'resting' porque ni siquiera
// existe en sessionsTable.milestone. Exportado porque promotePlannedGame
// (pasar un Plan to Play a la biblioteca) aplica exactamente la misma regla.
export const STATUS_TO_MILESTONE: Record<string, EdgeMilestone | undefined> = {
  completed: 'completed',
  dropped: 'dropped',
  on_hold: 'on_hold',
};

// Subconjunto de CreateGameWithDetailsInput/PromotePlannedGameInput que
// describe el playthrough inicial (fechas de borde, gasto, log de estado) —
// el resto de cada input (igdbId, iteration, gameId...) ya se resolvió antes
// de llegar aquí.
export type WriteInitialPlaythroughInput = Pick<
  CreateGameWithDetailsInput,
  'started' | 'finished' | 'initialStatus' | 'note' | 'moneySpent' | 'moneySpentDate'
>;

// Guion compartido por createGameWithDetails (alta normal) y
// promotePlannedGame (pasar un Plan to Play a la biblioteca): sesiones
// marcadoras de borde para las fechas, gasto inicial y el log de estados
// (con 'started' por delante de un estado terminal, SPEC 4.5). Quien llama
// SIEMPRE está ya dentro de su propia transacción.
export const writeInitialPlaythrough = async (
  tx: Tx,
  gameId: number,
  iterationId: number,
  input: WriteInitialPlaythroughInput,
): Promise<void> => {
  const started = input.started;
  const finished = input.finished;

  if (started) {
    const [session] = await tx
      .insert(sessionsTable)
      .values({
        iterationId,
        startedAt: started.date,
        endedAt: started.date,
        durationSec: 0,
        datePrecision: started.precision,
        milestone: 'started',
      })
      .returning({ id: sessionsTable.id });
    await tx
      .update(iterationsTable)
      .set({ startSessionId: session.id })
      .where(eq(iterationsTable.id, iterationId));
  }

  // El milestone de la sesión de fin representa CÓMO terminó (completed/
  // dropped/on_hold) — si el estado elegido es "started" (sigue jugando) o
  // "resting" (solo endless, que ni siquiera muestra este campo), no hay un
  // punto de fin que anclar, así que se ignora aunque venga texto.
  const endMilestone = input.initialStatus ? STATUS_TO_MILESTONE[input.initialStatus] : undefined;
  if (finished && endMilestone) {
    const [session] = await tx
      .insert(sessionsTable)
      .values({
        iterationId,
        startedAt: finished.date,
        endedAt: finished.date,
        durationSec: 0,
        datePrecision: finished.precision,
        milestone: endMilestone,
      })
      .returning({ id: sessionsTable.id });
    await tx
      .update(iterationsTable)
      .set({ endSessionId: session.id })
      .where(eq(iterationsTable.id, iterationId));
  }

  if (input.moneySpent) {
    await tx.insert(spendEventsTable).values({
      gameId,
      type: 'purchase',
      amount: input.moneySpent,
      // undefined (no null) para que $defaultFn del schema caiga a HOY si
      // por lo que sea no llega fecha — mismo patrón que el resto de este
      // archivo (ver el occurredAt de más abajo).
      occurredAt: input.moneySpentDate?.date,
      datePrecision: input.moneySpentDate?.precision ?? 'day',
    });
  }

  if (input.initialStatus) {
    // SPEC 4.5 — el log de una iteración siempre debe arrancar por
    // "started" antes de un estado terminal (completed/dropped/on_hold/
    // resting); si no, el historial empezaría directo en "Completado" sin
    // haber pasado nunca por "Jugando".
    if (input.initialStatus !== 'started' && started) {
      await tx.insert(stateEventsTable).values({
        iterationId,
        type: 'started',
        occurredAt: started.date,
        datePrecision: started.precision,
        note: null,
      });
    }

    const occurredAt = finished?.date ?? started?.date ?? undefined;
    const datePrecision = finished?.precision ?? started?.precision ?? 'day';
    await tx.insert(stateEventsTable).values({
      iterationId,
      type: input.initialStatus,
      occurredAt,
      datePrecision,
      note: input.note,
    });
  }
};
