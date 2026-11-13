// Los ids de las entidades, con nombre.
//
// En la 1.x todos son enteros autoincrementales; en la 2.0 son texto (UUIDv7,
// UUIDv5 o compuestos — AFTERPLAY-2.0.md §7.2), porque dos PCs que crean filas
// offline no pueden repartirse una secuencia (F-07). El cambio de tipo cruza
// toda la app: IPC, consultas, cachés del renderer, rutas.
//
// Este fichero existe para que ese cambio sea UNA línea y no setecientas: todo
// el código nombra el tipo del id (`GameId`, `SessionId`…) en vez de escribir
// `number`, y las tres cosas que dependen de la representación —leerlo de una
// ruta o de un atributo del DOM, y desempatar por "el creado más tarde"— pasan
// por las funciones de abajo. El día del cambio de esquema se cambia `EntityId`
// y el cuerpo de esas funciones; lo demás no se entera.
//
// Los alias son documentación, no una barrera: para TypeScript `GameId` y
// `SessionId` son el mismo tipo. Dicen qué viaja por cada parámetro, que es lo
// que se perdía con `number`.

/** La representación de un id. Hoy entero (1.x); en la 2.0, texto. */
export type EntityId = number;

export type GameId = EntityId;
export type IterationId = EntityId;
export type SessionId = EntityId;
export type StateEventId = EntityId;
export type SpendEventId = EntityId;
export type EmulatorId = EntityId;
export type SaveBackupId = EntityId;
export type AchievementId = EntityId;
export type AchievementUnlockId = EntityId;
export type CuriosityId = EntityId;
export type GeneratedMemoryId = EntityId;
export type RadarGameId = EntityId;

/**
 * Lee un id que llega como texto: un parámetro de ruta, un `data-*` del DOM.
 * Devuelve null si no es un id válido, para que quien llama decida qué enseñar
 * en vez de consultar con `NaN`.
 */
export const parseEntityId = (raw: string | null | undefined): EntityId | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/** El id como texto, para una ruta o un atributo del DOM. Inversa de `parseEntityId`. */
export const entityIdToString = (id: EntityId): string => String(id);

/** ¿Es este valor un id? Para distinguirlo de otras cosas en una clave de consulta. */
export const isEntityId = (value: unknown): value is EntityId =>
  typeof value === 'number' && Number.isSafeInteger(value);

/**
 * Orden por creación: negativo si `a` se creó antes que `b`. Solo como
 * DESEMPATE entre filas de la misma tabla con ids aleatorios (eventos,
 * sesiones, gastos, playthroughs): hoy es el orden del autoincremental y en la
 * 2.0 será el del UUIDv7, que también ordena por creación. No sirve para
 * juegos: su id 2.0 es determinista (sale del igdbId) y no dice nada de cuándo
 * se añadieron — para eso está `addedAt`.
 */
export const compareByCreation = (a: EntityId, b: EntityId): number => a - b;

/**
 * Un orden TOTAL y estable entre ids, sin ningún significado: para desempates
 * que solo existen para que el resultado no dependa del orden en que llegaron
 * las filas (juegos con las mismas horas, la firma canónica de un recap…). No
 * dice nada de creación —para eso, `compareByCreation`— y el orden concreto
 * cambiará con la representación: hoy el numérico, en la 2.0 el del texto.
 */
export const compareEntityIds = (a: EntityId, b: EntityId): number => a - b;

/**
 * Un entero estable derivado del id, para semillas deterministas (rotar las
 * redacciones de una frase según el juego…). Hoy es el propio id; en la 2.0
 * será un hash del texto. No identifica ni ordena: dos ids distintos pueden
 * dar el mismo número.
 */
export const entityIdSeed = (id: EntityId): number => id;
