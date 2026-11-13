import { leavesEndDate } from '../../../../../shared/playthroughState';
import type { CreateGameWithDetailsInput } from '../../../../../shared/types';
import type { StateEventType } from '../../schema';
import type { QueryContext } from '../common';
import { GameWriteError } from './errors';

// El primer playthrough de un juego y su papeleo: el gasto inicial y el log de
// estados (CONSULTAS.md §1.4, `writeInitialPlaythrough`). Es la 2.0 de
// `db/queries/games/writeInitialPlaythrough.ts`, compartida por el alta normal
// y la promoción desde el Plan.
//
// Crear un playthrough también lo hace el paquete de playthroughs (P3,
// `createIteration`); aquí se escribe aparte a propósito, porque las carpetas
// hermanas no se importan entre sí. Duplicación apuntada en el informe.

/** Lo que describe el playthrough inicial en los inputs del alta y de la promoción. */
export type InitialPlaythroughInput = Pick<
  CreateGameWithDetailsInput,
  | 'iteration'
  | 'hoursPlayed'
  | 'started'
  | 'finished'
  | 'initialStatus'
  | 'note'
  | 'moneySpent'
  | 'moneySpentDate'
>;

/**
 * `plan_to_play` ya no es un estado (F-12): lo cubre `plan_entries`. Se
 * comprueba ANTES de escribir nada, para no dejar media alta.
 */
export function assertInitialStatus(
  status: InitialPlaythroughInput['initialStatus'],
): StateEventType | null {
  if (status === 'plan_to_play') {
    throw new GameWriteError(
      'invalid_input',
      'plan_to_play is not a playthrough state: add the game to Plan to Play instead.',
    );
  }
  return status;
}

/** Los valores de un playthrough nuevo a partir del input (sin etiqueta: es automática, §7.4). */
export function initialPlaythroughValues(input: InitialPlaythroughInput): {
  playedPlatform: string;
  origin: string;
  format: 'digital' | 'physical';
  manualHours?: number;
} {
  return {
    playedPlatform: input.iteration.playedPlatform,
    origin: input.iteration.origin,
    format: input.iteration.format,
    // Sin horas no consta nada: se omite (H-2).
    ...(input.hoursPlayed !== null ? { manualHours: input.hoursPlayed } : {}),
  };
}

export interface WriteInitialPapersInput {
  readonly gameId: string;
  readonly playthroughId: string;
  /**
   * La fecha con la que se escriben los eventos SIN fecha real: `addedAt` en
   * el alta, `promotedAt` en la promoción (§1.1.8). Va con
   * `datePrecision = 'unknown'` (R-07): es papeleo, nunca una fecha inventada.
   */
  readonly anchor: Date;
  /** Moneda del gasto inicial (D-23): la de la configuración, la decide quien llama. */
  readonly currency: string;
  readonly input: InitialPlaythroughInput;
}

/**
 * Escribe el gasto inicial y el log de estados del playthrough. Dentro de la
 * transacción de quien llama.
 *
 * - Gasto: solo si hubo (`moneySpent` distinto de 0/null). Sin fecha, "ahora"
 *   explícito con precisión de día, como el DEFAULT de la 1.x.
 * - Estados (SPEC 4.5): un estado distinto de `started` con fecha de inicio
 *   estrena antes un `started` en esa fecha. El estado elegido va en la fecha
 *   de fin (si el estado deja fecha de fin), si no en la de inicio, y si no
 *   hay ninguna, en el ancla con precisión `unknown`. La nota va en el estado
 *   elegido, no en el `started` fabricado.
 */
export function writeInitialPapers(ctx: QueryContext, papers: WriteInitialPapersInput): void {
  const { input, gameId, playthroughId, anchor } = papers;
  const status = assertInitialStatus(input.initialStatus);

  if (input.moneySpent) {
    ctx.store.create('spend_events', {
      gameId,
      type: 'purchase',
      amount: input.moneySpent,
      currency: papers.currency,
      occurredAt: input.moneySpentDate?.date ?? ctx.now(),
      datePrecision: input.moneySpentDate?.precision ?? 'day',
    });
  }

  if (status === null) return;
  if (status !== 'started' && input.started) {
    ctx.store.create('state_events', {
      playthroughId,
      type: 'started',
      occurredAt: input.started.date,
      datePrecision: input.started.precision,
      deviceId: ctx.deviceId,
    });
  }
  // Un `finished` con un estado que no deja fecha de fin (p. ej. Playing) se
  // ignora: no hay final que registrar.
  const real = (leavesEndDate(status) ? input.finished : null) ?? input.started;
  ctx.store.create('state_events', {
    playthroughId,
    type: status,
    occurredAt: real?.date ?? anchor,
    datePrecision: real?.precision ?? 'unknown',
    deviceId: ctx.deviceId,
    ...(input.note !== null ? { note: input.note } : {}),
  });
}
