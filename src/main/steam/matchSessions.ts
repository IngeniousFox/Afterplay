import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { iterationsTable, sessionsTable } from '../db/schema';

// Colgar cada desbloqueo del rato en que pasó (LOGROS.md §4).
//
// Es lo que separa a Afterplay de una lista de logros: Steam sabe QUÉ
// desbloqueaste y CUÁNDO, pero solo esta app sabe que esa madrugada estabas
// en tu tercera sesión de Hollow Knight. Cruzando la fecha del desbloqueo con
// tus sesiones, un logro deja de ser una casilla y pasa a ser un momento —
// que es lo que luego pueden contar el Journey y los recaps del Loop.

export type SessionWindow = {
  sessionId: number;
  iterationId: number;
  startedAt: Date;
  // null en una sesión todavía abierta (estás jugando ahora mismo).
  endedAt: Date | null;
};

export type UnlockPlacement = {
  sessionId: number | null;
  iterationId: number | null;
};

// Margen de gracia al cerrar la sesión. El watcher cierra la sesión cuando el
// proceso muere, pero Steam sella el logro cuando el juego lo reporta — y
// entre las dos cosas hay unos segundos (pantallas de cierre, guardado). Sin
// este colchón, los logros sacados justo al final de la partida (que son
// muchos: acabas el jefe y sales) se quedaban huérfanos.
const GRACE_MS = 2 * 60 * 1000;

// Las sesiones de un juego, con el playthrough al que pertenecen.
export const getSessionWindows = async (gameId: number): Promise<SessionWindow[]> => {
  const rows = await getDb()
    .select({
      sessionId: sessionsTable.id,
      iterationId: iterationsTable.id,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .where(eq(iterationsTable.gameId, gameId));

  return rows;
};

// ¿En qué sesión cae este desbloqueo? null en las dos claves si no cae en
// ninguna — que es lo normal y correcto en un montón de casos: lo sacaste
// antes de usar Afterplay, o jugando en otro PC, o sin que la app mirara. El
// desbloqueo sigue siendo cierto; simplemente no sabemos a qué rato pegarlo,
// y eso es mejor que inventarse uno.
export const placeUnlock = (unlockedAt: Date | null, windows: SessionWindow[]): UnlockPlacement => {
  if (!unlockedAt) return { sessionId: null, iterationId: null };

  const time = unlockedAt.getTime();
  for (const window of windows) {
    const start = window.startedAt.getTime();
    // Una sesión abierta llega hasta ahora mismo.
    const end = (window.endedAt?.getTime() ?? Date.now()) + GRACE_MS;
    if (time >= start && time <= end) {
      return { sessionId: window.sessionId, iterationId: window.iterationId };
    }
  }

  return { sessionId: null, iterationId: null };
};
