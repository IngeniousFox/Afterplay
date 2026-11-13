// Los ids de las entidades, con nombre.
//
// En la 1.x todos son enteros autoincrementales; en la 2.0 son texto (UUIDv7,
// UUIDv5 o compuestos — AFTERPLAY-2.0.md §7.2), porque dos PCs que crean filas
// offline no pueden repartirse una secuencia (F-07). El cambio de tipo cruza
// toda la app: IPC, consultas, cachés del renderer, rutas.
//
// Este fichero existe para que ese cambio sea UNA línea y no setecientas: todo
// el código nombra el tipo del id (`GameId`, `SessionId`…) en vez de escribir
// `number`, y las cosas que dependen de la representación —leerlo de una ruta
// o de un atributo del DOM, y desempatar por "el creado más tarde"— pasan por
// las funciones de abajo. El día del cambio de esquema se cambia `EntityId` y
// el cuerpo de `parseEntityId`/`isEntityId`; lo demás no se entera.
//
// LAS DOS REPRESENTACIONES CONVIVEN durante la fase 2 (§20.3.1), y en dos
// momentos distintos:
//   · Antes del cambio, las consultas nuevas contra el esquema 2.0
//     (main/db/v2) se escriben y prueban con ids de texto mientras la app
//     sigue con `EntityId = number`.
//   · Después del cambio, el Worker sigue sobre el esquema 1.x (ids numéricos)
//     hasta la fase 5, con `EntityId = string`.
// En los dos, las MISMAS reglas de shared/domain y los MISMOS DTOs tienen que
// servir a las dos representaciones. Por eso los tipos que llevan ids son
// genéricos en `Id extends EntityIdLike` con `EntityId` por defecto (el uso
// sin parámetro significa exactamente lo de siempre), las reglas infieren `Id`
// de sus argumentos, y las funciones de abajo que no dependen de la
// representación aceptan las dos.
//
// Los alias son documentación, no una barrera: para TypeScript `GameId` y
// `SessionId` son el mismo tipo. Dicen qué viaja por cada parámetro, que es lo
// que se perdía con `number`. Llevan el mismo parámetro opcional que los DTOs
// (`GameId<Id>`) para que un tipo genérico pueda seguir diciendo QUÉ id es
// cada campo sin fijar su representación.

/** La representación de un id. Hoy entero (1.x); en la 2.0, texto. */
export type EntityId = number;

/**
 * Cualquiera de las dos representaciones. Es la restricción de los parámetros
 * genéricos `Id` de los DTOs y las reglas compartidas, no un tipo para guardar
 * ids: un valor concreto es siempre de una u otra.
 */
export type EntityIdLike = string | number;

export type GameId<Id extends EntityIdLike = EntityId> = Id;
export type IterationId<Id extends EntityIdLike = EntityId> = Id;
export type SessionId<Id extends EntityIdLike = EntityId> = Id;
export type StateEventId<Id extends EntityIdLike = EntityId> = Id;
export type SpendEventId<Id extends EntityIdLike = EntityId> = Id;
export type EmulatorId<Id extends EntityIdLike = EntityId> = Id;
export type SaveBackupId<Id extends EntityIdLike = EntityId> = Id;
export type AchievementId<Id extends EntityIdLike = EntityId> = Id;
export type AchievementUnlockId<Id extends EntityIdLike = EntityId> = Id;
export type CuriosityId<Id extends EntityIdLike = EntityId> = Id;
export type GeneratedMemoryId<Id extends EntityIdLike = EntityId> = Id;
export type RadarGameId<Id extends EntityIdLike = EntityId> = Id;

/**
 * Lee un id que llega como texto: un parámetro de ruta, un `data-*` del DOM.
 * Devuelve null si no es un id válido, para que quien llama decida qué enseñar
 * en vez de consultar con `NaN`.
 *
 * Ligada a `EntityId` y no a `EntityIdLike` a propósito: es una de las dos
 * funciones cuyo CUERPO cambia el día del cambio de esquema (de "entero
 * positivo" a "texto con forma de id"), y tiene que devolver la representación
 * que usa la app, no cualquiera.
 */
export const parseEntityId = (raw: string | null | undefined): EntityId | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * El id como texto, para una ruta o un atributo del DOM. Inversa de
 * `parseEntityId`. Acepta las dos representaciones: `String()` ya es la
 * conversión correcta para las dos.
 */
export const entityIdToString = (id: EntityIdLike): string => String(id);

/**
 * ¿Es este valor un id? Para distinguirlo de otras cosas en una clave de
 * consulta. Ligada a `EntityId`, como `parseEntityId`: su cuerpo cambia el día
 * del cambio de esquema, porque lo que pregunta es "¿es un id DE LA APP?".
 */
export const isEntityId = (value: unknown): value is EntityId =>
  typeof value === 'number' && Number.isSafeInteger(value);

// Comparación con `<`/`>` y no con la resta: la resta solo existe para
// números. Para enteros da el mismo SIGNO que `a - b` (que es todo lo que mira
// un comparador de `sort` o un `> 0`), y para texto es el orden por unidades
// de código, que en un UUIDv7 en minúsculas es el orden de creación (el
// instante va delante, en hexadecimal de ancho fijo). Genérica en `Id` para
// que mezclar las dos representaciones en una misma comparación no compile:
// `1 < 'a'` no significa nada.
const compareIds = <Id extends EntityIdLike>(a: Id, b: Id): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Orden por creación: negativo si `a` se creó antes que `b`. Solo como
 * DESEMPATE entre filas de la misma tabla con ids aleatorios (eventos,
 * sesiones, gastos, playthroughs): hoy es el orden del autoincremental y en la
 * 2.0 será el del UUIDv7, que también ordena por creación. No sirve para
 * juegos: su id 2.0 es determinista (sale del igdbId) y no dice nada de cuándo
 * se añadieron — para eso está `addedAt`.
 */
export const compareByCreation = <Id extends EntityIdLike>(a: Id, b: Id): number =>
  compareIds(a, b);

/**
 * Un orden TOTAL y estable entre ids, sin ningún significado: para desempates
 * que solo existen para que el resultado no dependa del orden en que llegaron
 * las filas (juegos con las mismas horas, la firma canónica de un recap…). No
 * dice nada de creación —para eso, `compareByCreation`— y el orden concreto
 * cambia con la representación: con enteros el numérico, con texto el del
 * texto.
 */
export const compareEntityIds = <Id extends EntityIdLike>(a: Id, b: Id): number => compareIds(a, b);

/**
 * Un entero estable derivado del id, para semillas deterministas (rotar las
 * redacciones de una frase según el juego…). Un entero es su propia semilla;
 * un texto da un hash FNV-1a de 32 bits sin signo (sin dependencias, el mismo
 * en el main, el renderer y el Worker). No identifica ni ordena: dos ids
 * distintos pueden dar el mismo número.
 */
export const entityIdSeed = (id: EntityIdLike): number => {
  if (typeof id === 'number') return id;
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};
