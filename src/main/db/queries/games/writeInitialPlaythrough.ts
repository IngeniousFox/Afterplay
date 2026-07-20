import { getDb } from '../..';
import type { CreateGameWithDetailsInput } from '../../../../shared/types';
import { spendEventsTable, stateEventsTable } from '../../schema';

// El `tx` de una transacción de drizzle — mismo query builder que la
// conexión, tipado desde ella para no importar internos de drizzle.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

// Estados que marcan un punto de FIN de playthrough. 'started' (sigue
// jugándolo) y 'resting' (solo endless) quedan fuera: ninguno es un final.
const TERMINAL_STATES = new Set(['completed', 'dropped', 'on_hold']);

// Subconjunto de CreateGameWithDetailsInput/PromotePlannedGameInput que
// describe el playthrough inicial (fechas de borde, gasto, log de estado) —
// el resto de cada input (igdbId, iteration, gameId...) ya se resolvió antes
// de llegar aquí.
export type WriteInitialPlaythroughInput = Pick<
  CreateGameWithDetailsInput,
  'started' | 'finished' | 'initialStatus' | 'note' | 'moneySpent' | 'moneySpentDate'
>;

// Guion compartido por createGameWithDetails (alta normal) y
// promotePlannedGame (pasar un Plan to Play a la biblioteca): gasto inicial
// y el log de estados del playthrough (con 'started' por delante de un
// estado terminal, SPEC 4.5). Modelo v2: las fechas de inicio/fin viven SOLO
// en los eventos — ya no se crean sesiones marcadoras ni anclas; las fechas
// del playthrough se derivan del log al leer (getGameById). Quien llama
// SIEMPRE está ya dentro de su propia transacción.
export const writeInitialPlaythrough = async (
  tx: Tx,
  gameId: number,
  iterationId: number,
  input: WriteInitialPlaythroughInput,
): Promise<void> => {
  if (input.moneySpent) {
    await tx.insert(spendEventsTable).values({
      gameId,
      type: 'purchase',
      amount: input.moneySpent,
      // undefined (no null) para que $defaultFn del schema caiga a HOY si
      // por lo que sea no llega fecha — mismo patrón que el occurredAt de
      // más abajo.
      occurredAt: input.moneySpentDate?.date,
      datePrecision: input.moneySpentDate?.precision ?? 'day',
    });
  }

  if (input.initialStatus) {
    // SPEC 4.5 — el log de una iteración siempre debe arrancar por
    // "started" antes de un estado terminal (completed/dropped/on_hold/
    // resting); si no, el historial empezaría directo en "Completado" sin
    // haber pasado nunca por "Jugando". Este evento ES además la fecha de
    // inicio del playthrough (modelo v2).
    if (input.initialStatus !== 'started' && input.started) {
      await tx.insert(stateEventsTable).values({
        iterationId,
        type: 'started',
        occurredAt: input.started.date,
        datePrecision: input.started.precision,
        note: null,
      });
    }

    // El evento del estado elegido. Su fecha: la de fin si el estado marca
    // un final y hay fecha de fin; si no, la de inicio; si no, hoy. Un
    // "finished" con estado no terminal (p. ej. Playing) se ignora — no hay
    // final que registrar (el renderer ya no lo manda en ese caso; esto es
    // cinturón y tirantes).
    const isTerminal = TERMINAL_STATES.has(input.initialStatus);
    const finished = isTerminal ? input.finished : null;
    const occurredAt = finished?.date ?? input.started?.date ?? undefined;
    const datePrecision = finished?.precision ?? input.started?.precision ?? 'day';
    await tx.insert(stateEventsTable).values({
      iterationId,
      type: input.initialStatus,
      occurredAt,
      datePrecision,
      note: input.note,
    });
  }
};
