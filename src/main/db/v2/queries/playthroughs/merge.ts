import { and, asc, eq } from 'drizzle-orm';
import { latestRealStateEvent } from '../../../../../shared/playthroughState';
import { achievementUnlocks, playthroughs, sessions, spendEvents, stateEvents } from '../../schema';
import { alive } from '../../store';
import { livePlaythrough } from '../common/alive';
import type { QueryContext } from '../common/context';
import {
  effectivePlaythroughLabel,
  playthroughCreationOrder,
  playthroughPositions,
} from '../common/labels';
import { playthroughState, storeErrorFor } from './read';

// Dos playthroughs activos del mismo juego (AFTERPLAY-2.0.md §10.7, F-09, R-10).
//
// Dos PCs sin red pueden crear cada uno su playthrough y ponerlo en marcha. La
// base no lo puede impedir entre dispositivos, así que la derivación de estado
// lo tolera (el vigente es el de `syncCreated` más reciente) y la ficha ofrece
// REPARARLO: `findConcurrentActivePlaythroughs` dice si pasa y
// `mergePlaythroughs` los junta.

export type PlaythroughMergeErrorCode =
  /** `keepId` y `dropId` son el mismo playthrough. */
  | 'same_playthrough'
  /** No son del mismo juego: fusionarlos mezclaría el historial de dos juegos. */
  | 'different_game';

/**
 * Error de NEGOCIO de la fusión. Que el playthrough no exista o esté borrado
 * (F-11 incluida) es un `StoreError('not_found' | 'deleted')`, como en el resto
 * del paquete; lo que se define aquí son las dos reglas que la puerta no
 * conoce. Lleva un `code` estable para que el IPC y la interfaz distingan los
 * casos sin leer el texto.
 */
export class PlaythroughMergeError extends Error {
  readonly code: PlaythroughMergeErrorCode;

  constructor(code: PlaythroughMergeErrorCode, message: string) {
    super(message);
    this.name = 'PlaythroughMergeError';
    this.code = code;
  }
}

export const isPlaythroughMergeError = (
  error: unknown,
  code?: PlaythroughMergeErrorCode,
): error is PlaythroughMergeError =>
  error instanceof PlaythroughMergeError && (code === undefined || error.code === code);

// ── Lectura ─────────────────────────────────────────────────────────────────

export interface ActivePlaythrough {
  readonly id: string;
  /** La etiqueta que enseña la app ("Playthrough N" o la del usuario). */
  readonly label: string;
  readonly syncCreated: string;
  /** El vigente: el de `syncCreated` más reciente (§10.7). Solo uno por juego. */
  readonly current: boolean;
}

/**
 * Los playthroughs ACTIVOS HOY de un juego (su último estado real es
 * `started`), en orden de creación, cuando hay MÁS DE UNO; si no, una lista
 * vacía. Es lo que necesita la ficha para decir "hay dos playthroughs en
 * curso" y ofrecer fusionarlos. Un juego inexistente o borrado devuelve vacía.
 *
 * Mismo criterio de "activo" que `resolvePlaythroughForPlay`: el último evento
 * real (ignorando `plan_to_play`, desempatado por `syncCreated`), sin mirar la
 * fecha: un `started` de mañana ya cuenta.
 */
export function findConcurrentActivePlaythroughs(
  ctx: QueryContext,
  gameId: string,
): ActivePlaythrough[] {
  const rows = ctx.db
    .select({
      id: playthroughs.id,
      customLabel: playthroughs.customLabel,
      syncCreated: playthroughs.syncCreated,
    })
    .from(playthroughs)
    // `livePlaythrough` exige también el juego vivo (F-11).
    .where(and(eq(playthroughs.gameId, gameId), livePlaythrough()))
    .orderBy(...playthroughCreationOrder)
    .all();
  if (rows.length < 2) return [];

  const events = ctx.db
    .select({
      id: stateEvents.id,
      syncCreated: stateEvents.syncCreated,
      playthroughId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
    })
    .from(stateEvents)
    .innerJoin(playthroughs, eq(playthroughs.id, stateEvents.playthroughId))
    .where(and(eq(playthroughs.gameId, gameId), alive(stateEvents)))
    .all();
  const byPlaythrough = new Map<string, typeof events>();
  for (const event of events) {
    const list = byPlaythrough.get(event.playthroughId);
    if (list) list.push(event);
    else byPlaythrough.set(event.playthroughId, [event]);
  }

  const active = rows.filter(
    (row) => latestRealStateEvent(byPlaythrough.get(row.id) ?? [])?.type === 'started',
  );
  if (active.length < 2) return [];

  // Las posiciones cuentan también los borrados (R-03): una consulta aparte.
  const positions = playthroughPositions(ctx, [gameId]);
  return active.map((row, index) => ({
    id: row.id,
    label: effectivePlaythroughLabel(row.customLabel, positions.get(row.id) ?? 1),
    syncCreated: row.syncCreated,
    current: index === active.length - 1,
  }));
}

// ── Fusión ──────────────────────────────────────────────────────────────────

export interface MergePlaythroughsInput {
  /** El que se queda: recibe todo lo del otro. */
  readonly keepId: string;
  /** El sobrante: queda con lápida cuando se ha movido todo. */
  readonly dropId: string;
}

export interface MergePlaythroughsResult {
  readonly keepId: string;
  readonly dropId: string;
  /** Filas hijas movidas, por tabla. Solo cuentan las vivas. */
  readonly moved: {
    readonly sessions: number;
    readonly stateEvents: number;
    readonly spendEvents: number;
    readonly achievementUnlocks: number;
  };
  /**
   * Las horas manuales del sobrante, sumadas al que se queda (0 si no tenía).
   * Se suman y no se descartan porque `totalHours` del juego ya cuenta las
   * de los dos: así la fusión no cambia el total.
   */
  readonly manualHoursAdded: number;
}

/**
 * Fusiona dos playthroughs vivos del MISMO juego: mueve al que se queda todo
 * lo que cuelga del sobrante y después le pone lápida (§10.7, "reparación").
 *
 * Qué se mueve, repasando el registro (`registry.ts`):
 * - `sessions`, también las de OTROS dispositivos y las abiertas:
 *   `playthroughId` es de los campos que cualquier PC puede escribir en una
 *   sesión ajena (`SESSION_FIELDS_ANY_DEVICE`). El objetivo de la regla "una
 *   abierta por dispositivo" es el juego, que no cambia.
 * - `state_events`: el log de los dos queda en el del que se queda, y el
 *   estado derivado sale del último evento real de los dos.
 * - `spend_events` y `achievement_unlocks` con `playthroughId`: si no, al
 *   borrar el sobrante la puerta los anularía (`nullify`) y perderían la
 *   atribución.
 * - `manualHours` del sobrante se SUMA al del que se queda (ver el resultado).
 *
 * Solo se mueven las filas VIVAS: las que ya tienen lápida se quedan con el
 * sobrante, que también la recibe. Lo que no se mueve y se pierde con el
 * sobrante: su etiqueta propia, valoración, formato y plataforma (el que se
 * queda conserva los suyos).
 *
 * Una transacción de la puerta: o se mueve todo y se borra el sobrante, o no
 * se toca nada. Ningún cambio de la puerta ni de reglas: cada escritura es un
 * `patch` normal con el reloj por campo.
 *
 * Errores: playthrough inexistente o borrado (F-11 incluida) → `StoreError`
 * `not_found` / `deleted`; el mismo playthrough dos veces o de juegos
 * distintos → `PlaythroughMergeError`. En todos los casos no se escribe nada.
 */
export function mergePlaythroughs(
  ctx: QueryContext,
  input: MergePlaythroughsInput,
): MergePlaythroughsResult {
  const { keepId, dropId } = input;
  return ctx.store.transaction((): MergePlaythroughsResult => {
    if (keepId === dropId) {
      throw new PlaythroughMergeError(
        'same_playthrough',
        `playthroughs: no se puede fusionar ${keepId} consigo mismo`,
      );
    }
    for (const id of [keepId, dropId]) {
      const { state } = playthroughState(ctx, id);
      if (state !== 'alive') throw storeErrorFor('playthroughs', id, state);
    }
    const keep = ctx.db.select().from(playthroughs).where(eq(playthroughs.id, keepId)).get();
    const drop = ctx.db.select().from(playthroughs).where(eq(playthroughs.id, dropId)).get();
    if (!keep || !drop) throw new Error('playthroughs: fila viva que no se puede releer');
    if (keep.gameId !== drop.gameId) {
      throw new PlaythroughMergeError(
        'different_game',
        `playthroughs: ${keepId} y ${dropId} son de juegos distintos`,
      );
    }

    // Los ids de las hijas vivas, leídos ANTES de mover nada. En orden de
    // creación: el sync verá las escrituras en un orden estable.
    const sessionIds = ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.playthroughId, dropId), alive(sessions)))
      .orderBy(asc(sessions.syncCreated), asc(sessions.id))
      .all();
    const eventIds = ctx.db
      .select({ id: stateEvents.id })
      .from(stateEvents)
      .where(and(eq(stateEvents.playthroughId, dropId), alive(stateEvents)))
      .orderBy(asc(stateEvents.syncCreated), asc(stateEvents.id))
      .all();
    const spendIds = ctx.db
      .select({ id: spendEvents.id })
      .from(spendEvents)
      .where(and(eq(spendEvents.playthroughId, dropId), alive(spendEvents)))
      .orderBy(asc(spendEvents.syncCreated), asc(spendEvents.id))
      .all();
    const unlockIds = ctx.db
      .select({ id: achievementUnlocks.id })
      .from(achievementUnlocks)
      .where(and(eq(achievementUnlocks.playthroughId, dropId), alive(achievementUnlocks)))
      .orderBy(asc(achievementUnlocks.syncCreated), asc(achievementUnlocks.id))
      .all();

    for (const { id } of sessionIds) ctx.store.patch('sessions', id, { playthroughId: keepId });
    for (const { id } of eventIds) ctx.store.patch('state_events', id, { playthroughId: keepId });
    for (const { id } of spendIds) ctx.store.patch('spend_events', id, { playthroughId: keepId });
    for (const { id } of unlockIds) {
      ctx.store.patch('achievement_unlocks', id, { playthroughId: keepId });
    }

    const manualHoursAdded = drop.manualHours ?? 0;
    if (drop.manualHours !== null) {
      ctx.store.patch('playthroughs', keepId, {
        manualHours: (keep.manualHours ?? 0) + manualHoursAdded,
      });
    }

    // Ya sin hijas vivas debajo: la lápida solo debe alcanzar al propio
    // sobrante (las hijas que ya estaban borradas no cuentan, no son filas
    // vivas). Si arrastrase o anulase algo más sería un fallo de esta función,
    // y la transacción lo deshace.
    const removal = ctx.store.remove('playthroughs', dropId);
    if (removal.removed.length !== 1 || removal.nullified.length > 0) {
      throw new Error(
        `playthroughs: la fusión de ${dropId} arrastró filas inesperadas (${JSON.stringify(removal)})`,
      );
    }

    return {
      keepId,
      dropId,
      moved: {
        sessions: sessionIds.length,
        stateEvents: eventIds.length,
        spendEvents: spendIds.length,
        achievementUnlocks: unlockIds.length,
      },
      manualHoursAdded,
    };
  });
}
