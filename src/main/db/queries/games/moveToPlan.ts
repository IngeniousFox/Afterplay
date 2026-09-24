import { and, eq, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameRow } from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { gamesTable, iterationsTable, stateEventsTable } from '../../schema';

// Unplayed por sí solo no basta: una partida puede tener horas, sesiones,
// logros o copias aunque nunca se haya elegido un estado en el dropdown.
// La misma condición se usa para mostrar el gesto y para autorizar el UPDATE
// dentro de la transacción, por si el juego cambia con la ficha abierta.
export const canMoveToPlanWhere = (gameId: number): SQL => sql`
  (select count(*) from iterations i where i.gameId = ${gameId}) = 1
  and not exists (
    select 1 from iterations i where i.gameId = ${gameId}
      and (coalesce(i.manualTotalPlayed, 0) <> 0 or i.rating is not null or i.extraContent <> 0)
  )
  and not exists (
    select 1 from sessions s join iterations i on i.id = s.iterationId
    where i.gameId = ${gameId}
  )
  and not exists (
    select 1 from state_events se join iterations i on i.id = se.iterationId
    where i.gameId = ${gameId} and se.type <> 'plan_to_play'
  )
  and not exists (
    select 1 from spend_events sp
    where sp.gameId = ${gameId} and sp.type <> 'purchase'
  )
  and not exists (
    select 1 from achievement_unlocks au
    join achievements a on a.id = au.achievementId
    where a.gameId = ${gameId}
  )
  and not exists (select 1 from save_backups sb where sb.gameId = ${gameId})
`;

// Se conserva la fila del juego, su fecha de alta, su iteración, las compras
// y cualquier entrada anterior del Plan. Si vino directamente de Library,
// esta es su primera entrada al Plan y la fecha de espera empieza hoy.
export const moveToPlan = async (gameId: number): Promise<GameRow> => {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [game] = await tx
      .update(gamesTable)
      .set({ planned: true, promotedAt: null, planPinnedAt: null })
      .where(
        and(eq(gamesTable.id, gameId), eq(gamesTable.planned, false), canMoveToPlanWhere(gameId)),
      )
      .returning(gameColumns);
    if (!game) throw new Error('This game has play records or is already in Plan to Play.');

    const [iteration] = await tx
      .select({ id: iterationsTable.id })
      .from(iterationsTable)
      .where(eq(iterationsTable.gameId, gameId))
      .limit(1);
    if (!iteration) throw new Error('This game has no playthrough.');

    const [firstPlanEvent] = await tx
      .select({ id: stateEventsTable.id })
      .from(stateEventsTable)
      .where(
        and(
          eq(stateEventsTable.iterationId, iteration.id),
          eq(stateEventsTable.type, 'plan_to_play'),
        ),
      )
      .limit(1);
    if (!firstPlanEvent) {
      await tx.insert(stateEventsTable).values({
        iterationId: iteration.id,
        type: 'plan_to_play',
        datePrecision: 'datetime',
        occurredAt: new Date(),
      });
    }

    return game;
  });
};
