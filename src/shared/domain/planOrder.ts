import type { EntityId, EntityIdLike, GameId } from '../entityIds';

// EL ORDEN DEL PLAN ("Up next"), escrito UNA vez (AFTERPLAY-2.0.md §15.2, F-26).
//
// Estaba tres veces: reorderUpNext en el escritorio (vía shared/planPinOrder),
// `redistribute` copiado a mano en web/src/lib/planPending.ts —el propio
// comentario lo confesaba— y la condición de "marca creíble" repetida en el
// drenado del buzón (pinStamp) y en el Worker (isTimestamp). Si dos de ellas
// discrepan, la vista previa del móvil promete un orden y el drenado escribe
// otro: la fila "salta" justo cuando el escritorio aplica la orden.
//
// Funciones puras sobre datos planos: milisegundos y no Date, porque los
// milisegundos son lo único que comparten el SQLite del escritorio (que los
// adapta en su borde), el JSON del Worker y la PWA. Sin base, sin drizzle, sin
// React: el escritorio, el Worker y la PWA importan este mismo fichero.

// Lo mínimo que hay que saber de un juego para repartir marcas: su id y su
// marca de fijado (null = no está en Up next).
//
// Genérico en la representación del id (ver entityIds.ts): el reparto solo usa
// el id como clave.
export type PinnedPlanRow<Id extends EntityIdLike = EntityId> = {
  id: GameId<Id>;
  pinnedAt: number | null;
};

// ── REPARTO DE MARCAS AL REORDENAR ─────────────────────────────────────────

// Reordenar es REPARTIR las marcas que YA existen entre los ids, en el orden
// nuevo. Nada se inventa ni deriva hacia el futuro: el multiset de fechas es el
// mismo, solo cambia a quién le toca cada una (por eso no hace falta columna de
// orden y la columna sigue sincronizando igual).
//
// Devuelve id → marca nueva SOLO para los ids que cambian de mano. Un mapa vacío
// significa "no hay reorden que aplicar", y el escritorio lo traduce a `false`,
// que el buzón lee como fallo (drainMailbox.ts).
export const redistributePinStamps = <Id extends EntityIdLike>(
  rows: readonly PinnedPlanRow<Id>[],
  orderedIds: readonly GameId<Id>[],
): Map<GameId<Id>, number> => {
  const byId = new Map(rows.map((row) => [row.id, row.pinnedAt]));
  // Solo los que SIGUEN fijados: entre el gesto y el commit pudo pasar
  // cualquier cosa (un unpin desde otra máquina vía sync), y los ids
  // desconocidos se ignoran en vez de reventar el gesto entero.
  //
  // Y REPETIDOS fuera antes de contar (el Set): sin deduplicar, un [A, A] con un
  // solo juego fijado medía 2, pasaba el guardián de abajo y daba por aplicada
  // una orden sin estantería que reordenar. El Set conserva la PRIMERA
  // aparición, que es la posición que el usuario soltó.
  const ids = [...new Set(orderedIds)].filter((id) => byId.get(id) != null);
  if (ids.length < 2) return new Map();

  const stamps = ids.map((id) => byId.get(id) as number).sort((a, b) => a - b);
  // Estrictamente crecientes: dos fijados en el mismo milisegundo (lo que pasa
  // al drenar de golpe dos pines) empatarían, y el desempate por título de
  // sortUpNext podría deshacer el orden recién elegido.
  for (let index = 1; index < stamps.length; index++) {
    if (stamps[index] <= stamps[index - 1]) stamps[index] = stamps[index - 1] + 1;
  }
  return new Map(ids.map((id, index) => [id, stamps[index]]));
};

// ── LA MARCA DE UN PIN QUE VIENE DEL MÓVIL ─────────────────────────────────

// ¿Es `value` un instante con el que se puede sellar un pin? Lo usan los TRES
// lados con el mismo criterio: el Worker 1.x para rechazar la orden al
// encolarla y el drenado del buzón para decidir si sella con la marca del
// teléfono o cae a "ahora". La vista previa del buzón en la PWA desapareció con
// la API v2, que escribe directamente.
//
// El futuro NO se recorta a propósito: un teléfono con el reloj adelantado deja
// su juego al final de Up next, que es raro pero es SU orden, y reordenar desde
// cualquiera de los dos lados lo arregla repartiendo las marcas existentes.
export const isCrediblePinStamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

// ── DESDE CUÁNDO ESPERA UN PLANEADO ────────────────────────────────────────

// La fecha con la que un planeado "espera" en el Plan: la del PRIMER evento
// plan_to_play si existe, y si no, el alta del juego. Así un juego devuelto de
// Library al Plan conserva su primera fecha allí, y uno que nunca estuvo empieza
// a esperar desde su alta sin tocar esa fecha original.
//
// `firstPlanAt` llega de una subconsulta SQL cruda, que el driver puede
// devolver como número o como texto según el motor: por eso el Number().
export const planWaitingSince = (addedAt: number, firstPlanAt: number | string | null): number =>
  firstPlanAt === null ? addedAt : Number(firstPlanAt);
