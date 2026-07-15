import { getDb } from '../..';
import type { CreatePlannedGameInput, GameRow } from '../../../../shared/types';
import { getGameDetails } from '../../../igdb/api';
import { getHltbTimes } from '../../../hltb/api';
import { sgdbSearch } from '../../../sgdb/api';
import { gameColumns } from '../../projections';
import { gamesTable, iterationsTable, stateEventsTable } from '../../schema';

// Alta en Plan to Play — la versión reducida de createGameWithDetails: mismo
// enriquecimiento externo (IGDB/HLTB/SteamGridDB, resuelto ANTES de abrir la
// transacción), pero sin nada de playthrough real: ni fechas, ni horas, ni
// gasto, ni exe. El juego nace con planned=true, una iteración por defecto
// (los stateEvents cuelgan de iteraciones, así que hace falta una para el
// historial) y el evento 'plan_to_play' que deja constancia de cuándo — y,
// con la nota, de por qué — lo planeaste.
export const createPlannedGame = async (input: CreatePlannedGameInput): Promise<GameRow> => {
  const detail = await getGameDetails(input.igdbId);
  if (!detail) {
    throw new Error(`No se encontró el juego de IGDB ${input.igdbId} (¿lo quitaron del catálogo?)`);
  }

  const [hltb, steamGridDbId] = await Promise.all([
    getHltbTimes(detail.title, detail.releaseYear),
    sgdbSearch(detail.title, detail.releaseYear),
  ]);

  const db = getDb();

  return db.transaction(async (tx) => {
    const [game] = await tx
      .insert(gamesTable)
      .values({
        title: detail.title,
        coverUrl: input.coverUrl ?? detail.covers[0] ?? null,
        heroUrl: input.heroUrl ?? detail.heroes[0] ?? null,
        developer: detail.developer,
        publisher: detail.publisher,
        genres: detail.genres.length > 0 ? detail.genres : null,
        igdbId: detail.igdbId,
        steamGridDbId,
        officialPlatforms: detail.platforms.length > 0 ? detail.platforms : null,
        releaseYear: detail.releaseYear,
        hltbMain: hltb?.hltbMain ?? null,
        hltbMainExtras: hltb?.hltbMainExtras ?? null,
        hltbCompletionist: hltb?.hltbCompletionist ?? null,
        notes: input.gameNotes,
        planned: true,
      })
      .returning(gameColumns);

    const [iteration] = await tx
      .insert(iterationsTable)
      .values({
        gameId: game.id,
        label: 'Playthrough 1',
        // Valores neutros — el playthrough real se define al pasar el juego a
        // la biblioteca (promotePlannedGame), donde el modal ya pregunta la
        // plataforma/origen/formato de verdad.
        playedPlatform: detail.platforms[0] ?? 'PC',
        origin: 'Purchased',
        format: 'digital',
      })
      .returning({ id: iterationsTable.id });

    await tx.insert(stateEventsTable).values({
      iterationId: iteration.id,
      type: 'plan_to_play',
      datePrecision: 'datetime',
      note: input.note,
    });

    return game;
  });
};
