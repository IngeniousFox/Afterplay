import { and, isNull, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// "Solo filas vivas" para las consultas de lectura (§7.3, §7.7).
//
// El borrado es lógico: una fila borrada sigue en la tabla con `syncDeleted`
// puesto (las lápidas no se purgan, D-25). Cada consulta que olvide filtrarla
// enseña datos borrados, así que el filtro se escribe en un solo sitio y de
// una sola forma: así se puede buscar quién no lo usa.
//
// Ojo: esto filtra la FILA. La regla de §7.7 "un hijo cuyo padre está borrado
// se trata como borrado" (F-11) es aparte y la aplica cada consulta en sus
// uniones, porque depende de qué padre mira.

type WithTombstone = { readonly syncDeleted: AnySQLiteColumn };

/** Condición `syncDeleted IS NULL` de una tabla sincronizada. */
export function alive(table: WithTombstone): SQL {
  return isNull(table.syncDeleted);
}

/** `syncDeleted IS NULL AND …`: la condición de vida unida a las demás. */
export function whereAlive(table: WithTombstone, ...conditions: (SQL | undefined)[]): SQL {
  // `and` solo devuelve undefined sin condiciones, y aquí siempre hay una.
  return and(alive(table), ...conditions) as SQL;
}
