import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { AddStateEventInput, StateEvent } from '../../../../../shared/dto';
import { closesOpenSession, latestRealStateEvent } from '../../../../../shared/playthroughState';
import type { StateEventSummary, UpdateStateEventPatch } from '../../../../../shared/types';
import {
  STATE_EVENT_TYPES,
  playthroughs,
  stateEvents,
  type StateEventDatePrecision,
  type StateEventType,
} from '../../schema';
import { StoreError, alive, type PatchValues } from '../../store';
import { liveStateEvent } from '../common/alive';
import type { QueryContext } from '../common/context';
import {
  effectivePlaythroughLabel,
  playthroughCreationOrder,
  playthroughPositions,
} from '../common/labels';
import { closeOpenOwnSessions } from '../common/sessionsClose';
import {
  gameFacts,
  playthroughState,
  readStateEvent,
  stateEventState,
  storeErrorFor,
} from './read';

// El log de estados de un playthrough sobre el esquema 2.0 (CONSULTAS.md §2.2
// "stateEvents"). Las reglas de qué significa cada tipo y cuál es "el último
// estado real" son las de `shared/playthroughState.ts`: aquí no se reescriben.

// Notas de las pausas automáticas: las mismas palabras que la 1.x, porque el
// historial importado ya las tiene y el Journey las enseña tal cual.
const AUTO_PAUSE_NOTE = 'Pausado automáticamente al empezar otro playthrough.';
const AUTO_REST_NOTE = 'Puesto a descansar automáticamente.';

const VALID_TYPES: ReadonlySet<string> = new Set(STATE_EVENT_TYPES);

/**
 * `plan_to_play` ya no es una fila de `state_events` (§1.2): el paso por el
 * Plan vive en `plan_entries`. El esquema tampoco lo admite, pero se comprueba
 * ANTES de la transacción para que un tipo inválido no deje media auto-pausa
 * escrita ni dependa del mensaje de la puerta.
 */
function assertWritableType(type: string): asserts type is StateEventType {
  if (!VALID_TYPES.has(type)) {
    throw new StoreError(
      'invalid_value',
      `state_events.type: '${type}' no es un estado que se pueda guardar en 2.0`,
    );
  }
}

/**
 * stateEvents:add. Apila un evento en el log de un playthrough. Es la
 * escritura por la que pasa todo cambio de estado (menú Status, Edit, alta,
 * watcher) y hace tres tramos en UNA transacción, como la 1.x:
 *
 *   1. Auto-pausa (SPEC 4.5, "como mucho un playthrough activo por juego"). Si
 *      es un `started`, cada hermano vivo cuyo último estado real sea
 *      `started` y no posterior a este recibe un `on_hold` (`resting` si el
 *      juego es endless) en el mismo instante y con la misma precisión, y se le
 *      cierran sus sesiones abiertas PROPIAS.
 *   2. El evento.
 *   3. Si el tipo cierra sesión (`closesOpenSession`), se cierran las sesiones
 *      abiertas PROPIAS del playthrough que empezaron en el instante del hito o
 *      antes (`closeOpenOwnSessions`, corte `>=`).
 *
 * El orden de 1 y 2 importa: la pausa se crea ANTES que el evento, así que a
 * igual instante el evento nuevo es el más reciente por creación y el juego se
 * sigue leyendo Playing (desempate de `latestRealStateEvent`).
 *
 * Cambios del 2.0:
 * - `type = 'plan_to_play'` → `StoreError('invalid_value')`.
 * - "Sin fecha real" es `datePrecision = 'unknown'` (R-07): se guarda tal
 *   cual. Si además no viene `occurredAt`, la fecha es la de la promoción o la
 *   del alta del juego (§1.1.8), no "ahora": "no consta cuándo" no puede
 *   fingir que pasó en este momento. Con cualquier otra precisión, sin
 *   `occurredAt` es "ahora" (`ctx.now()`), resuelto UNA vez y compartido por
 *   la pausa, el evento y los cierres.
 * - Solo se cierran las sesiones abiertas de ESTE dispositivo (R-10); las de
 *   otro PC se quedan abiertas hasta que su dueño las cierre (fase 4). Los
 *   cierres llevan `closedBy = 'user'` (R-12): los pide una persona al marcar
 *   un estado.
 * - `deviceId` del evento (y de las pausas) = este dispositivo (informativo).
 *
 * Errores: playthrough inexistente → `StoreError('not_found')`; borrado (o su
 * juego, F-11) → `StoreError('deleted')`. En los dos casos no se escribe nada.
 * Un cierre de sesión que la puerta rechace no tumba el evento (lo captura
 * `closeOpenOwnSessions`, ver su contrato).
 */
export function addStateEvent(
  ctx: QueryContext,
  input: AddStateEventInput<string>,
): StateEvent<string> {
  assertWritableType(input.type);
  const id = ctx.store.transaction(() => {
    const target = playthroughState(ctx, input.iterationId);
    if (target.state !== 'alive') {
      throw storeErrorFor('playthroughs', input.iterationId, target.state);
    }
    if (target.gameId === null) throw new Error('playthroughs: fila viva sin juego');
    const game = gameFacts(ctx, target.gameId);
    const occurredAt =
      input.occurredAt ??
      (input.datePrecision === 'unknown' ? (game.promotedAt ?? game.addedAt) : null) ??
      ctx.now();

    if (input.type === 'started') {
      pauseActiveSiblings(ctx, {
        gameId: target.gameId,
        playthroughId: input.iterationId,
        endless: game.endless,
        occurredAt,
        datePrecision: input.datePrecision,
      });
    }

    const { id: eventId } = ctx.store.create('state_events', {
      playthroughId: input.iterationId,
      type: input.type,
      occurredAt,
      datePrecision: input.datePrecision,
      deviceId: ctx.deviceId,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });

    if (closesOpenSession(input.type)) {
      closeOpenOwnSessions(ctx, input.iterationId, { endedAt: occurredAt, closedBy: 'user' });
    }
    return eventId;
  });
  const event = readStateEvent(ctx, id);
  if (!event) throw new Error(`state_events: la fila ${id} desapareció al crearla`);
  return event;
}

interface PauseSiblingsInput {
  readonly gameId: string;
  readonly playthroughId: string;
  readonly endless: boolean;
  readonly occurredAt: Date;
  readonly datePrecision: StateEventDatePrecision;
}

/**
 * Tramo 1 de `addStateEvent`. Recorre TODOS los hermanos (un historial que ya
 * venía con dos activos se arregla entero, no a medias).
 */
function pauseActiveSiblings(ctx: QueryContext, input: PauseSiblingsInput): void {
  // `alive()` a secas: el juego ya se ha comprobado vivo dentro de esta misma
  // transacción, así que es lo mismo que `livePlaythrough()` sin el EXISTS.
  const siblings = ctx.db
    .select({ id: playthroughs.id })
    .from(playthroughs)
    .where(
      and(
        eq(playthroughs.gameId, input.gameId),
        ne(playthroughs.id, input.playthroughId),
        alive(playthroughs),
      ),
    )
    // En orden de creación: las pausas se escriben en un orden estable, que es
    // el que verá el sync.
    .orderBy(...playthroughCreationOrder)
    .all();
  if (siblings.length === 0) return;

  const events = ctx.db
    .select({
      id: stateEvents.id,
      playthroughId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
    })
    .from(stateEvents)
    .where(
      and(
        inArray(
          stateEvents.playthroughId,
          siblings.map((sibling) => sibling.id),
        ),
        alive(stateEvents),
      ),
    )
    .all();

  const bySibling = new Map<string, typeof events>();
  for (const event of events) {
    const list = bySibling.get(event.playthroughId);
    if (list) list.push(event);
    else bySibling.set(event.playthroughId, [event]);
  }

  for (const sibling of siblings) {
    const latest = latestRealStateEvent(bySibling.get(sibling.id) ?? []);
    if (!latest || latest.type !== 'started') continue;
    // Un `started` del PASADO (apuntar una partida de 2019) no pausa nada del
    // presente. El corte es `<=`: a igual instante, sí pausa.
    if (latest.occurredAt.getTime() > input.occurredAt.getTime()) continue;

    // La pausa habla el vocabulario del juego: un endless no tiene `on_hold`
    // en su selector, su pausa es `resting`.
    ctx.store.create('state_events', {
      playthroughId: sibling.id,
      type: input.endless ? 'resting' : 'on_hold',
      occurredAt: input.occurredAt,
      datePrecision: input.datePrecision,
      note: input.endless ? AUTO_REST_NOTE : AUTO_PAUSE_NOTE,
      deviceId: ctx.deviceId,
    });
    // Y se le cierran sus sesiones abiertas propias, como si la pausa la
    // hubieras escrito tú: si no, quedaba un On Hold con una sesión viva y el
    // juego "en vivo".
    closeOpenOwnSessions(ctx, sibling.id, { endedAt: input.occurredAt, closedBy: 'user' });
  }
}

/**
 * stateEvents:update. Corrección de una errata del historial: fecha, precisión,
 * nota y, desde la corrección de playthrough del Edit, el tipo (Beaten →
 * Dropped). No auto-pausa ni cierra sesiones: corregir el pasado no es un
 * cambio de estado de ahora (igual que la 1.x).
 *
 * - Null si el evento no existe o está borrado (F-11 incluida).
 * - `type: 'plan_to_play'` → `StoreError('invalid_value')`.
 * - Patch vacío o sin cambios: no escribe (F-33) y devuelve el evento.
 */
export function updateStateEvent(
  ctx: QueryContext,
  eventId: string,
  patch: UpdateStateEventPatch<string>,
): StateEvent<string> | null {
  if (patch.type !== undefined) assertWritableType(patch.type);
  const updated = ctx.store.transaction(() => {
    if (stateEventState(ctx, eventId) !== 'alive') return false;
    const changes: PatchValues<'state_events'> = {};
    if (patch.type !== undefined) changes.type = patch.type;
    if (patch.occurredAt !== undefined) changes.occurredAt = patch.occurredAt;
    if (patch.datePrecision !== undefined) changes.datePrecision = patch.datePrecision;
    if (patch.note !== undefined) changes.note = patch.note;
    if (Object.keys(changes).length > 0) ctx.store.patch('state_events', eventId, changes);
    return true;
  });
  return updated ? readStateEvent(ctx, eventId) : null;
}

/**
 * stateEvents:delete. Lápida al evento. El estado y las fechas del playthrough
 * se derivan del log al leer, así que borrar el `completed` "reabre" el
 * playthrough solo, sin reparar nada. El playthrough se queda aunque se vacíe
 * (recién creado sin tocar es un estado legítimo).
 *
 * Devuelve true si lo ha borrado esta llamada; false si no existía o ya estaba
 * borrado (F-11 incluida).
 */
export function deleteStateEvent(ctx: QueryContext, eventId: string): boolean {
  return ctx.store.transaction(() => {
    if (stateEventState(ctx, eventId) !== 'alive') return false;
    return ctx.store.remove('state_events', eventId).removed.length > 0;
  });
}

/**
 * stateEvents:getAll. Todos los eventos vivos (F-11: con su playthrough y su
 * juego vivos), con el juego y la etiqueta efectiva del playthrough
 * ("Playthrough N" derivada, §1.1.6). Para el desglose de estados de Stats y la
 * galería de completados.
 *
 * Orden estable por `occurredAt` y creación (la 1.x no ordenaba; quien lo usa
 * agrupa o filtra, así que un orden fijo solo quita aleatoriedad).
 */
export function getAllStateEvents(ctx: QueryContext): StateEventSummary<string>[] {
  const rows = ctx.db
    .select({
      id: stateEvents.id,
      gameId: playthroughs.gameId,
      iterationId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
      customLabel: playthroughs.customLabel,
    })
    .from(stateEvents)
    // `liveStateEvent()` ya exige el playthrough y el juego vivos; la unión es
    // solo para leer sus columnas.
    .innerJoin(playthroughs, eq(playthroughs.id, stateEvents.playthroughId))
    .where(liveStateEvent())
    .orderBy(asc(stateEvents.occurredAt), asc(stateEvents.syncCreated), asc(stateEvents.id))
    .all();
  if (rows.length === 0) return [];

  // Las posiciones contando los playthroughs borrados (R-03). Una consulta para
  // todos, sin lista de juegos: es un listado de toda la biblioteca y así no
  // hay un IN con cientos de parámetros.
  const positions = playthroughPositions(ctx);
  return rows.map(({ customLabel, ...row }) => ({
    ...row,
    iterationLabel: effectivePlaythroughLabel(customLabel, positions.get(row.iterationId) ?? 1),
  }));
}
