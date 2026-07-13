import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type {
  CreateGameInput,
  CreateGameWithDetailsInput,
  GameRow,
} from '../../../../shared/types';
import { getGameDetails } from '../../../igdb/api';
import { getHltbTimes } from '../../../hltb/api';
import { sgdbSearch } from '../../../sgdb/api';
import { gameColumns } from '../../projections';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../schema';

// Sesiones marcadoras de borde (arrancan y terminan en el mismo instante,
// duración 0) — solo existen para anclar start/endSessionId de la iteración
// y así derivar sus fechas (SPEC 4). endedAt NO puede quedar null o
// getGames() la contaría como sesión abierta ("en marcha").
type EdgeMilestone = 'completed' | 'dropped' | 'on_hold';

// 'started' (sigue jugándolo) y 'resting' (solo endless) se quedan fuera a
// propósito: ninguno de los dos es un punto de fin válido — 'started' porque
// todavía no se ha dejado de jugar (el renderer ya no manda `finished` en
// ese caso, esto es cinturón y tirantes), y 'resting' porque ni siquiera
// existe en sessionsTable.milestone.
const STATUS_TO_MILESTONE: Record<string, EdgeMilestone | undefined> = {
  completed: 'completed',
  dropped: 'dropped',
  on_hold: 'on_hold',
};

// El main resuelve TODO lo que hace falta de fuentes externas (IGDB, HLTB,
// SteamGridDB) ANTES de abrir la transacción — así ninguna llamada de red
// queda a medias dentro de un db.transaction, que debe ser rápido y solo
// tocar la base de datos.
export const createGameWithDetails = async (
  input: CreateGameWithDetailsInput,
): Promise<GameRow> => {
  const detail = await getGameDetails(input.igdbId);
  if (!detail) {
    throw new Error(`No se encontró el juego de IGDB ${input.igdbId} (¿lo quitaron del catálogo?)`);
  }

  const [hltb, steamGridDbId] = await Promise.all([
    getHltbTimes(detail.title, detail.releaseYear),
    sgdbSearch(detail.title, detail.releaseYear),
  ]);

  const willCreateStateEvent = input.initialStatus !== null;
  // Si no va a haber evento de estado inicial (juego normal añadido como
  // Unplayed, sin marcar "jugado antes"), la nota del usuario no tiene dónde
  // colgarse — se guarda como nota general del juego en vez de perderse.
  const notesFallback = !willCreateStateEvent && input.note ? input.note : null;

  const gameInput: CreateGameInput = {
    title: detail.title,
    coverUrl: input.coverUrl ?? detail.covers[0] ?? null,
    heroUrl: input.heroUrl ?? detail.heroes[0] ?? null,
    igdbId: detail.igdbId,
    steamGridDbId,
    officialPlatforms: detail.platforms.length > 0 ? detail.platforms : null,
    hltbMain: hltb?.hltbMain ?? null,
    hltbMainExtras: hltb?.hltbMainExtras ?? null,
    hltbCompletionist: hltb?.hltbCompletionist ?? null,
    notes: notesFallback,
    executablePath: input.executablePath,
    endless: input.endless,
  };

  const started = input.started;
  const finished = input.finished;

  const db = getDb();

  return db.transaction(async (tx) => {
    const [game] = await tx.insert(gamesTable).values(gameInput).returning(gameColumns);

    const [iteration] = await tx
      .insert(iterationsTable)
      .values({
        gameId: game.id,
        label: 'Playthrough 1',
        playedPlatform: input.iteration.playedPlatform,
        origin: input.iteration.origin,
        format: input.iteration.format,
        manualTotalPlayed: input.hoursPlayed,
      })
      .returning({ id: iterationsTable.id });

    if (started) {
      const [session] = await tx
        .insert(sessionsTable)
        .values({
          iterationId: iteration.id,
          startedAt: started.date,
          endedAt: started.date,
          durationSec: 0,
          datePrecision: started.precision,
          milestone: 'started',
        })
        .returning({ id: sessionsTable.id });
      await tx
        .update(iterationsTable)
        .set({ startSessionId: session.id })
        .where(eq(iterationsTable.id, iteration.id));
    }

    // El milestone de la sesión de fin representa CÓMO terminó (completed/
    // dropped/on_hold) — si el estado elegido es "started" (sigue jugando) o
    // "resting" (solo endless, que ni siquiera muestra este campo), no hay un
    // punto de fin que anclar, así que se ignora aunque venga texto.
    const endMilestone = input.initialStatus ? STATUS_TO_MILESTONE[input.initialStatus] : undefined;
    if (finished && endMilestone) {
      const [session] = await tx
        .insert(sessionsTable)
        .values({
          iterationId: iteration.id,
          startedAt: finished.date,
          endedAt: finished.date,
          durationSec: 0,
          datePrecision: finished.precision,
          milestone: endMilestone,
        })
        .returning({ id: sessionsTable.id });
      await tx
        .update(iterationsTable)
        .set({ endSessionId: session.id })
        .where(eq(iterationsTable.id, iteration.id));
    }

    if (input.moneySpent) {
      await tx.insert(spendEventsTable).values({
        gameId: game.id,
        type: 'purchase',
        amount: input.moneySpent,
        datePrecision: 'day',
      });
    }

    if (input.initialStatus) {
      const occurredAt = finished?.date ?? started?.date ?? undefined;
      const datePrecision = finished?.precision ?? started?.precision ?? 'day';
      await tx.insert(stateEventsTable).values({
        iterationId: iteration.id,
        type: input.initialStatus,
        occurredAt,
        datePrecision,
        note: input.note,
      });
    }

    return game;
  });
};
