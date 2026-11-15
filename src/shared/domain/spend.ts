import {
  endsPlaythrough,
  latestRealStateEvent,
  type RealStateEventCandidate,
} from '../playthroughState';
import type { EntityId, EntityIdLike, IterationId } from '../entityIds';
import type { StateEvent } from '../types';
import { compareRowsByCreation } from './creationOrder';

// EL GASTO DE UN JUEGO Y SU REPARTO ENTRE PLAYTHROUGHS, escrito UNA vez
// (AFTERPLAY-2.0.md §15.2, F-26).
//
// Estaba copiado en getGameById.ts y en worker/src/queries/game.ts, y la copia
// del Worker divergió DOS veces —el escritorio corrigió y el puerto se quedó
// con la versión vieja—: la misma ficha repartía el dinero distinto en el
// móvil que en el PC. Ahora los dos llaman aquí.

// Lo mínimo de un evento de estado para cerrar (o no) la ventana de gasto.
export type SpendStateEvent<Id extends EntityIdLike = EntityId> = RealStateEventCandidate<Id> & {
  type: StateEvent['type'];
};
export type SpendRow = { amount: number; occurredAt: Date };

// Cuándo se CERRÓ un playthrough, o null si sigue abierto. Sale del último
// estado REAL (latestRealStateEvent) y no de la última fila del log: ignora
// 'plan_to_play' (historial de intención, nunca estado) y desempata por id,
// así que no depende del ORDER BY de nadie. Con la última fila a secas,
// cualquier juego promovido desde el Plan tenía su plan_to_play —fechado AHORA
// por createPlannedGame— tapando el completed/dropped tecleado con fecha del
// pasado: la ventana del Playthrough 1 no se cerraba nunca y todo el gasto
// posterior (el DLC de años después) se le colgaba a él.
//
// on_hold y resting NO cierran: son pausas, y retomarlas es seguir el mismo
// playthrough (mismo criterio que resolveIterationForPlay).
export const playthroughClosedAt = <Id extends EntityIdLike>(
  events: readonly SpendStateEvent<Id>[],
): Date | null => {
  const latest = latestRealStateEvent(events);
  return latest && endsPlaythrough(latest.type) ? latest.occurredAt : null;
};

// Reparto del gasto entre playthroughs. Los gastos NO llevan iterationId
// (SPEC 4: el gasto es del juego, no de un recorrido concreto), así que se
// infiere por fecha: cada gasto cae en el PRIMER playthrough que seguía
// abierto en su fecha. Uno ya cerrado no puede reclamar gasto ESTRICTAMENTE
// posterior a su cierre — eso pasa al siguiente (o al último si no hay más).
// Un gasto anterior al primer playthrough (el juego comprado semanas antes de
// arrancarlo) cae en ese primero.
//
// El instante del cierre entra TODAVÍA en su propia ventana ('<=' y no '<'),
// y eso es una corrección, no un detalle: la fecha del completed y la del
// gasto se teclean las dos con precisión de día (medianoche), así que comprar
// el DLC el mismo día que te pasas el juego empata exacto. Con el '<' estricto
// ese dinero se le colgaba al playthrough siguiente, que ese día ni existía.
//
// `iterations` tiene que llegar en orden cronológico de creación, que en la
// 2.0 es el de `syncCreated` (F-09: el id no dice cuál se creó después entre
// dos PCs) y en la 1.x, sin `syncCreated`, el de id; se ordena aquí por si
// acaso, para que la regla no dependa del ORDER BY de quien llama. Sin
// playthroughs no hay a quién atribuir nada y el mapa sale vacío (el total del
// juego sigue contando, ver totalSpendOf).
export const splitSpendByPlaythrough = <Id extends EntityIdLike>(
  iterations: readonly { id: IterationId<Id>; syncCreated?: string | null }[],
  eventsByIteration: ReadonlyMap<IterationId<Id>, readonly SpendStateEvent<Id>[]>,
  spends: readonly SpendRow[],
): Map<IterationId<Id>, number> => {
  const ordered = [...iterations].sort(compareRowsByCreation);
  const closedAt = ordered.map((iteration) =>
    playthroughClosedAt(eventsByIteration.get(iteration.id) ?? []),
  );

  const spendByIteration = new Map<IterationId<Id>, number>();
  if (ordered.length === 0) return spendByIteration;
  for (const spend of spends) {
    let chosen = ordered[0];
    for (let index = 0; index < ordered.length; index++) {
      chosen = ordered[index];
      const terminalAt = closedAt[index];
      if (terminalAt === null || spend.occurredAt.getTime() <= terminalAt.getTime()) break;
    }
    spendByIteration.set(chosen.id, (spendByIteration.get(chosen.id) ?? 0) + spend.amount);
  }
  return spendByIteration;
};

// El gasto total del juego: TODOS sus gastos, tenga playthroughs o no. Un
// juego comprado y sin tocar ha costado dinero aunque no haya a quién
// atribuírselo.
export const totalSpendOf = (spends: readonly { amount: number }[]): number => {
  let total = 0;
  for (const spend of spends) total += spend.amount;
  return total;
};

// Sin horas no hay coste por hora: dividir entre cero daría Infinity, que en
// pantalla es peor que un guion.
export const costPerHourOf = (totalSpend: number, totalHours: number): number | null =>
  totalHours > 0 ? totalSpend / totalHours : null;
