import { compareByCreation } from '../entityIds';
import type { EntityIdLike } from '../entityIds';

// EL ORDEN DE CREACIÓN DE LAS FILAS (AFTERPLAY-2.0.md §10.7 y F-09).
//
// En la 1.x el id es un autoincremental y ordena por creación. En la 2.0 el id
// es un UUIDv7 que sale del reloj de pared de QUIEN crea la fila: dos PCs
// offline crean cada uno su playthrough y el id solo dice qué reloj de pared
// iba más adelantado, no qué se creó después en el conjunto de dispositivos. El
// orden causal es `syncCreated`, el reloj lógico de creación de la fila: texto
// de ancho fijo, comparable como string (shared/sync/clock.ts).
//
// `syncCreated` es OPCIONAL en todos los tipos de entrada que lo llevan: el
// esquema 1.x y el Worker no lo tienen y siguen ordenando por id. Sin él (en
// cualquiera de las dos filas) manda el id, que es exactamente el orden de
// siempre. Las dos filas de una comparación vienen de la misma tabla y del
// mismo lado, así que o las dos lo traen o ninguna: el caso mixto no se da,
// pero el resultado es igualmente el orden por id.

/** Lo que hace falta de una fila para ordenarla por creación. */
export type CreationOrdered<Id extends EntityIdLike = EntityIdLike> = {
  id: Id;
  syncCreated?: string | null;
};

/**
 * Comparador de orden de creación: negativo si `a` se creó antes que `b`.
 * Primero `syncCreated` (texto, con `<`), y el id solo desempata (o decide si
 * falta `syncCreated`).
 */
export const compareRowsByCreation = <Id extends EntityIdLike>(
  a: CreationOrdered<Id>,
  b: CreationOrdered<Id>,
): number => {
  const first = a.syncCreated;
  const second = b.syncCreated;
  if (first && second && first !== second) return first < second ? -1 : 1;
  return compareByCreation(a.id, b.id);
};
