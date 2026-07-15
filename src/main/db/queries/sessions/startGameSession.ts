import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session, StateEvent } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';

// "Empezar a jugar" un juego desde el main (lo usa el watcher al detectar un
// arranque). Equivale a pulsar Play: garantiza que haya un playthrough activo
// —creando uno nuevo o reanudando un on_hold/resting, misma regla que
// ActionBar/StatusCard— y cuelga de él una sesión trackeada abierta.
//
// Devuelve null si el juego ya tenía una sesión abierta (Play manual o una
// detección previa): no se duplica.
export const startGameSession = async (gameId: number): Promise<Session | null> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. Dedup: ¿ya hay una sesión abierta en alguna iteración del juego?
    const [alreadyOpen] = await tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .where(and(eq(iterationsTable.gameId, gameId), isNull(sessionsTable.endedAt)))
      .limit(1);
    if (alreadyOpen) return null;

    // 2. Iteraciones del juego + su último estado, para decidir dónde cuelga.
    const iterations = await tx
      .select({ id: iterationsTable.id, startSessionId: iterationsTable.startSessionId })
      .from(iterationsTable)
      .where(eq(iterationsTable.gameId, gameId))
      .orderBy(asc(iterationsTable.id));

    const latestTypeByIteration = new Map<number, StateEvent['type']>();
    if (iterations.length > 0) {
      const events = await tx
        .select({ iterationId: stateEventsTable.iterationId, type: stateEventsTable.type })
        .from(stateEventsTable)
        .where(
          inArray(
            stateEventsTable.iterationId,
            iterations.map((iteration) => iteration.id),
          ),
        )
        .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));
      for (const event of events) {
        // 'plan_to_play' es solo historial (ver schema.ts), no estado — sin
        // esto, un juego recién pasado del Plan a la biblioteca tendría el
        // plan como "último estado" y confundiría la lógica de abajo.
        if (event.type === 'plan_to_play') continue;
        latestTypeByIteration.set(event.iterationId, event.type);
      }
    }

    const now = new Date();
    const activeIteration = iterations.find(
      (iteration) => latestTypeByIteration.get(iteration.id) === 'started',
    );

    let targetIterationId: number;
    // Si la iteración destino ya tiene sesión de inicio, su "Started At" está
    // fijado y no se toca; si no, esta sesión pasa a ser su inicio. Cubre los
    // tres casos: iteración nueva, iteración reanudada que nunca se ancló
    // (Playthrough recién creado por Add Game, sin sesiones), y por robustez
    // una activa a la que le faltara.
    let targetHasStartSession: boolean;

    if (activeIteration) {
      // Ya está "Playing": solo falta colgar la sesión.
      targetIterationId = activeIteration.id;
      targetHasStartSession = activeIteration.startSessionId != null;
    } else {
      const lastIteration = iterations[iterations.length - 1];
      const lastType = lastIteration ? latestTypeByIteration.get(lastIteration.id) : undefined;
      const lastIsTerminal = lastType === 'completed' || lastType === 'dropped';

      if (!lastIteration || lastIsTerminal) {
        // Sin iteraciones o la última terminó (Beaten/Dropped): retomar es un
        // playthrough NUEVO (SPEC 4).
        const [game] = await tx
          .select({ officialPlatforms: gamesTable.officialPlatforms })
          .from(gamesTable)
          .where(eq(gamesTable.id, gameId))
          .limit(1);

        const [created] = await tx
          .insert(iterationsTable)
          .values({
            gameId,
            label: `Playthrough ${iterations.length + 1}`,
            playedPlatform: game?.officialPlatforms?.[0] ?? 'PC',
            origin: 'Purchased',
            format: 'digital',
          })
          .returning({ id: iterationsTable.id });
        targetIterationId = created.id;
        targetHasStartSession = false; // su inicio = esta primera sesión
      } else {
        // Reanudar la última iteración: un on_hold/resting (ya tiene su inicio)
        // o un Playthrough recién creado por Add Game que nunca se tocó (sin
        // sesiones → se anclará abajo).
        targetIterationId = lastIteration.id;
        targetHasStartSession = lastIteration.startSessionId != null;
      }

      // Evento 'started' para dejar el playthrough activo. No hay hermano
      // activo que pausar (acabamos de comprobar que no hay iteración activa),
      // así que basta el insert directo sin la lógica de pausa de addStateEvent.
      await tx.insert(stateEventsTable).values({
        iterationId: targetIterationId,
        type: 'started',
        occurredAt: now,
        datePrecision: 'datetime',
        note: null,
      });
    }

    // 3. Sesión trackeada abierta.
    const [session] = await tx
      .insert(sessionsTable)
      .values({
        iterationId: targetIterationId,
        isManual: false,
        startedAt: now,
        endedAt: null,
        durationSec: null,
        datePrecision: 'datetime',
        milestone: null,
      })
      .returning(sessionColumns);

    if (!targetHasStartSession) {
      await tx
        .update(iterationsTable)
        .set({ startSessionId: session.id })
        .where(eq(iterationsTable.id, targetIterationId));
    }

    return session;
  });
};
