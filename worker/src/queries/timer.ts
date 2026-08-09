import { and, desc, eq, isNull } from 'drizzle-orm';
import { gamesTable, iterationsTable, sessionsTable } from '../../../src/main/db/schema';
import { computeDurationSec } from '../../../src/main/db/queries/sessions/sessionDuration';
import { endsPlaythrough, latestRealStateEvent } from '../../../src/shared/playthroughState';
import { stateEventsTable } from '../../../src/main/db/schema';
import type { ActiveTimer } from '../api-types';
import type { TenantDb } from '../db';

// EL CRONÓMETRO (REMOTO.md §7).
//
// Jugar en una Switch o una PS5 es hoy invisible para la app: no hay proceso
// que vigilar. Esto lo tapa — y de regalo cubre GeForce Now, los juegos de
// navegador y cualquier cosa que el watcher no pille.
//
// Lo que abre son SESIONES NORMALES (§7.1): `startedAt` y `endedAt` reales,
// `durationSec` real, `isManual: false`. Cuentan en el heatmap, las rachas, el
// histograma de duración, la franja horaria y los momentos igual que
// cualquier otra. La única diferencia es quién aprieta el botón — tú, en vez
// del vigilante de procesos — y eso se marca en `startedBy` para que la
// reconciliación del watcher no las mate (§7.3).
//
// POR QUÉ ESTO NO VA POR EL BUZÓN, a diferencia del Plan: una sesión en marcha
// tiene que existir AHORA. Una orden que el escritorio drena al arrancar no
// puede encender un "jugando ahora" ni recibir latidos. Es la única escritura
// de la web sobre una tabla real, y se limita a lo que no tiene alternativa:
// un INSERT sin enriquecimiento y dos UPDATEs sobre esa misma fila.

export class TimerError extends Error {}

// El playthrough al que colgar la sesión.
//
// Se exige uno YA ABIERTO. Decidir si hay que crear un playthrough nuevo o
// reanudar uno aparcado es justo lo que hace resolveIterationForPlay en el
// escritorio, con sus reglas (SPEC 4.5), y copiarlo aquí sería tener dos
// versiones de la misma decisión. Esto responde además la pregunta abierta del
// §9: el cronómetro NO elige playthrough, usa el activo — y si no hay ninguno
// utilizable, lo dice en vez de inventarse uno.
const resolveOpenIteration = async (db: TenantDb, gameId: number): Promise<number> => {
  const iterations = await db
    .select({ id: iterationsTable.id })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(desc(iterationsTable.id))
    .limit(1);

  const iteration = iterations[0];
  if (!iteration) {
    throw new TimerError('este juego todavía no tiene ningún playthrough — ábrelo en tu PC');
  }

  const events = await db
    .select({
      id: stateEventsTable.id,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
    })
    .from(stateEventsTable)
    .where(eq(stateEventsTable.iterationId, iteration.id));

  // La MISMA regla que usa el escritorio para saber si un playthrough se
  // cerró para siempre (completed/dropped). On Hold y Resting quedan fuera a
  // propósito: son pausas, y seguir jugándolas es seguir el mismo recorrido.
  const latest = latestRealStateEvent(events);
  if (endsPlaythrough(latest?.type)) {
    throw new TimerError('este playthrough ya está cerrado — empieza otro desde tu PC');
  }

  return iteration.id;
};

// La sesión de cronómetro abierta ahora mismo, si la hay. Como mucho una: el
// §7 no contempla cronometrar dos juegos a la vez, y permitirlo sería casi
// siempre un despiste, no una intención.
export const getActiveTimer = async (db: TenantDb): Promise<ActiveTimer | null> => {
  const rows = await db
    .select({
      sessionId: sessionsTable.id,
      gameId: iterationsTable.gameId,
      gameTitle: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(and(isNull(sessionsTable.endedAt), eq(sessionsTable.startedBy, 'timer')))
    .orderBy(desc(sessionsTable.id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.sessionId,
    gameId: row.gameId,
    gameTitle: row.gameTitle,
    coverUrl: row.coverUrl,
    startedAt: row.startedAt.getTime(),
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.getTime() : null,
  };
};

export const startTimer = async (
  db: TenantDb,
  gameId: number,
  now: number,
): Promise<ActiveTimer> => {
  // Una cualquiera abierta —del watcher o de otro cronómetro— bloquea: dos
  // sesiones vivas del mismo juego serían horas contadas dos veces, y de
  // juegos distintos casi siempre es un cronómetro que se te olvidó parar.
  const [anyOpen] = await db
    .select({ id: sessionsTable.id, startedBy: sessionsTable.startedBy })
    .from(sessionsTable)
    .where(isNull(sessionsTable.endedAt))
    .limit(1);

  if (anyOpen) {
    throw new TimerError(
      anyOpen.startedBy === 'timer'
        ? 'ya tienes un cronómetro en marcha'
        : 'ya hay una sesión en marcha en tu PC',
    );
  }

  const iterationId = await resolveOpenIteration(db, gameId);
  const startedAt = new Date(now);

  const [session] = await db
    .insert(sessionsTable)
    .values({
      iterationId,
      // Tiempo medido de verdad, igual que la del watcher. Lo único distinto
      // es quién apretó el botón.
      isManual: false,
      startedAt,
      endedAt: null,
      durationSec: null,
      // El primer latido es el propio arranque: si el móvil se queda mudo
      // desde el minuto uno, la reconciliación tiene de dónde agarrarse.
      lastHeartbeatAt: startedAt,
      startedBy: 'timer',
      datePrecision: 'datetime',
    })
    .returning({ id: sessionsTable.id });

  const active = await getActiveTimer(db);
  if (!active) throw new TimerError(`no se pudo abrir la sesión ${session.id}`);
  return active;
};

// El latido. Frecuencia de ~1 por minuto: una sesión de tres horas son 180
// peticiones, nada frente a las 100.000 diarias del plan gratuito. El watcher
// late cada ~5s porque puede; aquí sería quemar peticiones sin ganar nada.
export const beatTimer = async (db: TenantDb, sessionId: number, now: number): Promise<boolean> => {
  const rows = await db
    .update(sessionsTable)
    .set({ lastHeartbeatAt: new Date(now) })
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        isNull(sessionsTable.endedAt),
        eq(sessionsTable.startedBy, 'timer'),
      ),
    )
    .returning({ id: sessionsTable.id });

  return rows.length > 0;
};

// Parar. El §7.5 en una línea: el "parar" explícito MANDA sobre el latido.
//
// Los navegadores móviles suspenden las pestañas de fondo, así que es probable
// que el latido se haya parado hace rato aunque siguieras jugando. Por eso el
// fin es AHORA y no el último latido: el latido solo decide cuando nunca
// llegaste a pararlo.
export const stopTimer = async (
  db: TenantDb,
  sessionId: number,
  now: number,
): Promise<{ durationSec: number }> => {
  const [session] = await db
    .select({
      id: sessionsTable.id,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      startedBy: sessionsTable.startedBy,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  if (!session) throw new TimerError('esa sesión no existe');
  if (session.startedBy !== 'timer') {
    throw new TimerError('esa sesión no la abrió el cronómetro');
  }
  // Ya cerrada. No se reabre, y NO se afirma por qué: aquí no hay forma de
  // saber si la paraste tú desde otra pestaña o si el escritorio la recogió
  // por llevar horas muda. Decir lo segundo cuando fue lo primero —que es lo
  // que hacía— es inventarse una explicación delante del usuario.
  if (session.endedAt !== null) {
    throw new TimerError('esa sesión ya estaba parada');
  }

  const endedAt = new Date(now);
  // La MISMA función que usa closeSession en el escritorio: nunca negativa y
  // redondeada al segundo.
  const durationSec = computeDurationSec(session.startedAt, endedAt);

  await db
    .update(sessionsTable)
    .set({ endedAt, durationSec })
    .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.endedAt)));

  return { durationSec };
};
