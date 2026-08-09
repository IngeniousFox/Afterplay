import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { planMailboxTable } from '../../../src/main/db/schema';
import type { PlanMailboxEntry } from '../../../src/shared/planMailbox';
import type { TenantDb } from '../db';

// El buzón visto desde el Worker: encolar y leer lo pendiente.
//
// Es la ÚNICA tabla en la que la web escribe (§6.2). Es desechable a
// propósito: un bug aquí deja una orden que no se aplica, no una biblioteca
// corrupta.

// Lo que llega del navegador es texto sin ninguna garantía, y de aquí sale
// directo a una tabla que el ESCRITORIO va a leer y ejecutar. Si dejo pasar un
// payload con la forma torcida, el fallo no ocurre aquí —donde se vería— sino
// dentro del drenado, en la máquina de otro, days después y sin nadie mirando.
// Así que se valida entero, campo a campo, en vez de confiar en el tipo.
const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const parseEntry = (raw: unknown): PlanMailboxEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;

  if (entry.type === 'add') {
    const source = entry.source as Record<string, unknown> | undefined;
    if (typeof source !== 'object' || source === null) return null;
    // Excluyentes: o viene de IGDB (lo normal) o de Steam. Nunca los dos.
    const hasIgdb = isPositiveInt(source.igdbId);
    const hasSteam = isPositiveInt(source.steamAppId);
    if (hasIgdb === hasSteam) return null;
    if (typeof entry.title !== 'string' || entry.title.trim() === '') return null;

    return {
      type: 'add',
      source: hasIgdb
        ? { igdbId: source.igdbId as number }
        : { steamAppId: source.steamAppId as number },
      title: entry.title.slice(0, 300),
      coverUrl: typeof entry.coverUrl === 'string' ? entry.coverUrl.slice(0, 500) : null,
      note:
        typeof entry.note === 'string' && entry.note.trim() !== ''
          ? entry.note.slice(0, 500)
          : null,
    };
  }

  if (entry.type === 'pin') {
    if (!isPositiveInt(entry.gameId) || !isTimestamp(entry.pinnedAt)) return null;
    return { type: 'pin', gameId: entry.gameId, pinnedAt: entry.pinnedAt };
  }

  if (entry.type === 'unpin') {
    if (!isPositiveInt(entry.gameId)) return null;
    return { type: 'unpin', gameId: entry.gameId };
  }

  if (entry.type === 'reorder') {
    // Solo IDS: las marcas de tiempo las reparte el escritorio con
    // reorderUpNext(), que reutiliza las que ya existen en vez de inventarlas.
    if (!Array.isArray(entry.orderedIds) || entry.orderedIds.length < 2) return null;
    // Un reorden con cientos de entradas no es un gesto de usuario, es alguien
    // probando qué aguanta.
    if (entry.orderedIds.length > 200) return null;
    if (!entry.orderedIds.every(isPositiveInt)) return null;
    // Un id repetido dejaría el reparto de marcas sin sentido.
    if (new Set(entry.orderedIds).size !== entry.orderedIds.length) return null;
    return { type: 'reorder', orderedIds: entry.orderedIds as number[] };
  }

  return null;
};

// Los `add` que siguen en la cola, por igdbId y appid. La guarda de duplicados
// del router mira la tabla `games`, pero un juego encolado TODAVÍA no es un
// juego: sin esto puedes encolar Celeste dos veces antes de que el escritorio
// drene, y la segunda revienta contra el UNIQUE al aplicarse — que es el bug
// que la guarda existía para cerrar.
export const pendingAddKeys = async (
  db: TenantDb,
): Promise<{ igdbIds: Set<number>; steamAppIds: Set<number> }> => {
  const rows = await db
    .select({ payload: planMailboxTable.payload })
    .from(planMailboxTable)
    .where(and(isNull(planMailboxTable.processedAt), eq(planMailboxTable.type, 'add')));

  const igdbIds = new Set<number>();
  const steamAppIds = new Set<number>();
  for (const row of rows) {
    const entry = row.payload;
    if (entry.type !== 'add') continue;
    if ('igdbId' in entry.source) igdbIds.add(entry.source.igdbId);
    else steamAppIds.add(entry.source.steamAppId);
  }
  return { igdbIds, steamAppIds };
};

export const enqueue = async (
  db: TenantDb,
  entry: PlanMailboxEntry,
  requestedBy: string,
): Promise<{ id: number }> => {
  const [row] = await db
    .insert(planMailboxTable)
    .values({
      type: entry.type,
      payload: entry,
      createdAt: new Date(),
      requestedBy,
    })
    .returning({ id: planMailboxTable.id });

  return { id: row.id };
};

export type PendingEntry = {
  id: number;
  createdAt: number;
  entry: PlanMailboxEntry;
};

// Lo que todavía no ha drenado el escritorio. La PWA lo pinta ENCIMA de lo que
// lee (§6.3): sin esto, pinear desde el móvil no haría nada visible hasta que
// abrieras el PC, y eso se siente como gritarle al vacío.
export const listPending = async (db: TenantDb): Promise<PendingEntry[]> => {
  const rows = await db
    .select({
      id: planMailboxTable.id,
      createdAt: planMailboxTable.createdAt,
      payload: planMailboxTable.payload,
    })
    .from(planMailboxTable)
    .where(isNull(planMailboxTable.processedAt))
    .orderBy(asc(planMailboxTable.id));

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.getTime(),
    entry: row.payload,
  }));
};

// Las últimas órdenes que SÍ se drenaron y fallaron. Sin esto, una orden que
// revienta desaparece en silencio: deja de estar pendiente, nunca se aplicó, y
// no hay nada en pantalla que lo explique.
// Descartar un fallo. Borra SOLO el mensaje de error de una fila que ya está
// procesada: no reencola nada, no toca ninguna tabla real, y no puede
// resucitar una orden (processedAt sigue puesto).
//
// Existe porque sin esto un fallo era permanente: se quedaba en pantalla hasta
// que veinte órdenes nuevas lo empujaran fuera de la ventana. Un aviso que no
// se puede quitar deja de ser un aviso y pasa a ser decoración — y a la
// tercera vez que lo ves ya no lo lees.
export const dismissFailure = async (db: TenantDb, id: number): Promise<boolean> => {
  const rows = await db
    .update(planMailboxTable)
    .set({ error: null })
    .where(and(eq(planMailboxTable.id, id), isNotNull(planMailboxTable.processedAt)))
    .returning({ id: planMailboxTable.id });

  return rows.length > 0;
};

export const listRecentFailures = async (
  db: TenantDb,
): Promise<{ id: number; entry: PlanMailboxEntry; error: string }[]> => {
  const rows = await db
    .select({
      id: planMailboxTable.id,
      payload: planMailboxTable.payload,
      error: planMailboxTable.error,
    })
    .from(planMailboxTable)
    // El filtro va en SQL y NO después del limit, que es como estaba: cogía las
    // 20 últimas filas y solo entonces se quedaba con las que tenían error. El
    // drenado aplica hasta 25 por pasada, así que un fin de semana de altas
    // empujaba cualquier fallo fuera de la ventana al instante y desaparecía
    // sin dejar rastro — justo lo que esta función existe para evitar.
    .where(isNotNull(planMailboxTable.error))
    .orderBy(desc(planMailboxTable.id))
    .limit(20);

  return rows.map((row) => ({
    id: row.id,
    entry: row.payload,
    error: row.error as string,
  }));
};
