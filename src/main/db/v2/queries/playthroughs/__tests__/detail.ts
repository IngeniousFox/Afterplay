import { and, asc, eq } from 'drizzle-orm';
import { deriveGameDetail } from '../../../../../../shared/domain/gameDetail';
import { playthroughs, sessions, spendEvents, stateEvents } from '../../../schema';
import { livePlaythrough, liveSession, liveSpendEvent, liveStateEvent } from '../../common/alive';
import type { QueryContext } from '../../common/context';

// El estado derivado de un juego para los tests de P3.
//
// Los tests 1.x comprobaban el resultado a través de `getGameById`, porque lo
// que importa no es la fila escrita sino lo que la ficha ENSEÑA después. La
// ficha 2.0 es de P1 (`library/`) y no se puede importar desde aquí, así que
// esto lee las filas vivas (F-11) de un juego y aplica la MISMA regla
// compartida que usará la ficha (`deriveGameDetail`). Solo para tests.

/** Lo que los tests miran de la ficha derivada. */
export interface DerivedForTests {
  readonly iterations: readonly {
    readonly currentState: string | null;
    readonly startedAt: Date | null;
    readonly endedAt: Date | null;
    readonly endEvent: { readonly id: string } | null;
  }[];
  readonly totalHours: number;
  readonly totalSpend: number;
  readonly currentState: string | null;
  readonly isLive: boolean;
}

export function derivedDetail(ctx: QueryContext, gameId: string): DerivedForTests {
  const iterations = ctx.db
    .select({ id: playthroughs.id, manualTotalPlayed: playthroughs.manualHours })
    .from(playthroughs)
    .where(and(eq(playthroughs.gameId, gameId), livePlaythrough()))
    .orderBy(asc(playthroughs.syncCreated), asc(playthroughs.id))
    .all();

  const sessionRows = ctx.db
    .select({
      iterationId: sessions.playthroughId,
      source: sessions.source,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(and(eq(playthroughs.gameId, gameId), liveSession()))
    .all()
    .map(({ source, ...row }) => ({ ...row, isManual: source === 'legacy_manual' }));

  const events = ctx.db
    .select({
      id: stateEvents.id,
      iterationId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
    })
    .from(stateEvents)
    .innerJoin(playthroughs, eq(playthroughs.id, stateEvents.playthroughId))
    .where(and(eq(playthroughs.gameId, gameId), liveStateEvent()))
    .all();

  const spends = ctx.db
    .select({ amount: spendEvents.amount, occurredAt: spendEvents.occurredAt })
    .from(spendEvents)
    .where(and(eq(spendEvents.gameId, gameId), liveSpendEvent()))
    .all();

  return deriveGameDetail({
    iterations,
    sessions: sessionRows,
    stateEvents: events,
    spendEvents: spends,
  });
}
