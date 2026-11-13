import type { StateEventPrecision } from '../../../../../shared/dto';
import type { GameDetail, IterationDetail, IterationEdgeEvent } from '../../../../../shared/types';

// Tipos propios del paquete P1 (biblioteca y ficha) que TODAVÍA no están en
// `src/shared/`. Este paquete no puede tocar `shared/` (CONSULTAS.md §4), así
// que los define aquí con su forma exacta y el informe los pide como "cambio
// pedido". Al integrarlos en P9, cada uno sustituye a su equivalente de
// `shared/types.ts` y este fichero desaparece.

// ── El paso por el Plan (decisión R-06) ─────────────────────────────────────
//
// En la 1.x el historial y el Journey contaban "Planeado el X" con el evento
// `plan_to_play` de la iteración vacía. El 2.0 ya no tiene ese evento: el Plan
// es `plan_entries` (una fila por juego, id = gameId), y promocionar le pone
// la lápida y fija `games.promotedAt`. Pero el usuario quiere seguir viendo
// los dos hitos, así que la ficha los expone DERIVADOS, de solo lectura (no
// son filas de `state_events` y no se editan desde el historial):
//
//   "Añadido al Plan" = `plan_entries.plannedAt` + su `note`, esté la entrada
//                       viva (sigue en el Plan) o con lápida (ya salió).
//   "Salió del Plan"  = `games.promotedAt`, solo cuando la entrada tiene
//                       lápida (se promocionó a la biblioteca).
//
// Como devolver un juego al Plan RESUCITA la misma fila con un `plannedAt`
// nuevo y deja `promotedAt` a null (P2), esto describe siempre el ÚLTIMO paso
// por el Plan, que es lo que decidió R-06.
//
// Forma mínima a propósito: un objeto o null, sin sintetizar eventos con un
// `type` falso. Así el renderer decide cómo pintarlos en el historial y en el
// Journey sin que un evento inventado se cuele en las reglas que recorren
// `stateHistory` (estado actual, ventanas de gasto, "Last played").
export type PlanHistory = {
  /** "Añadido al Plan": cuándo entró (la última vez). Precisión de instante. */
  plannedAt: Date;
  /** El porqué que se apuntó al planearlo (`plan_entries.note`). */
  note: string | null;
  /**
   * "Salió del Plan": `games.promotedAt` si la entrada tiene lápida y el juego
   * se promocionó. Null mientras siga en el Plan (o si la entrada tiene lápida
   * sin promoción, un caso que la app no produce).
   */
  leftAt: Date | null;
};

// ── La ficha con ids de texto ───────────────────────────────────────────────
//
// `IterationEdgeEvent.datePrecision` es hoy `EventDatePrecision` a secas, sin
// el `'unknown'` del 2.0 (R-07). Pero el borde de un playthrough SÍ puede ser
// un evento `'unknown'`: dar de alta un juego como "jugando" sin fecha escribe
// un `started` con esa precisión, y es su `startEvent`. Con ids de texto el
// tipo tiene que admitirlo, igual que `StateEvent.datePrecision` ya hace con
// `StateEventPrecision<Id>`.
//
// CAMBIO PEDIDO en `shared/types.ts`:
//   export type IterationEdgeEvent<Id …> = {
//     id: StateEventId<Id>;
//     occurredAt: Date;
//     datePrecision: StateEventPrecision<Id>;   // antes: EventDatePrecision
//   };
// Con `Id = number` sigue siendo `EventDatePrecision` (no cambia nada en 1.x).
export type IterationEdgeEventV2 = Omit<IterationEdgeEvent<string>, 'datePrecision'> & {
  datePrecision: StateEventPrecision<string>;
};

export type IterationDetailV2 = Omit<IterationDetail<string>, 'startEvent' | 'endEvent'> & {
  startEvent: IterationEdgeEventV2 | null;
  endEvent: IterationEdgeEventV2 | null;
};

// CAMBIO PEDIDO en `shared/types.ts`: `GameDetail` gana el campo opcional
// `planHistory: PlanHistory | null` (null = el juego nunca pasó por el Plan),
// y `iterations` pasa a usar el `IterationEdgeEvent` corregido de arriba.
export type GameDetailV2 = Omit<GameDetail<string>, 'iterations'> & {
  iterations: IterationDetailV2[];
  planHistory: PlanHistory | null;
};

// ── Lo que el escaneo necesita saber de la colección ───────────────────────
//
// En la 1.x vive en `db/queries/games/getOwnedGames.ts` con `id: number`. Con
// ids de texto. CAMBIO PEDIDO: el tipo pasa a ser genérico en el id (o a
// `string` en el cambio final) y a vivir donde lo importe `ipc/scan.ts`.
export type OwnedGameRef = {
  id: string;
  igdbId: number | null;
  title: string;
  planned: boolean;
};
