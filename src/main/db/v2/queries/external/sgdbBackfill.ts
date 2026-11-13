import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { gameMetadata, games, planEntries } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';
import { fillAutoSgdbId, readLiveIdentity, recordCheck } from './internal';
import { isFailure, type RefreshScope, type SourceFailure } from './types';

// El relleno de ids de SteamGridDB de los que no lo tienen
// (`external/sgdbBackfill.ts`, `fillMissingSgdbIds`).
//
//   1. `selectSgdbCandidates(scope)`.
//   2. Red, en serie con pausa y freno (eso se queda en el llamador).
//   3. `applySgdbResult` por juego: relee que SIGUE sin id. La 1.x escribía
//      sin releer (`sgdbBackfill.ts:100-105`) y podía pisar el id que acababas
//      de elegir en el CoverPicker durante la pasada.
//
// Un "no lo tengo" de SGDB deja ya marca (`sgdb` = empty, §3.5), pero no
// cambia a quién se pregunta: la selección sigue siendo "sin id", sin mirar
// `external_checks`, porque ese "no" caduca (SGDB no tiene arte el día que se
// anuncia un juego).

export interface SgdbCandidate {
  readonly gameId: string;
  readonly title: string;
  readonly releaseYear: number | null;
  readonly steamAppId: number | null;
}

/** Juegos vivos del alcance sin id de SteamGridDB (y sin una elección manual). */
export function selectSgdbCandidates(ctx: QueryContext, scope: RefreshScope): SgdbCandidate[] {
  const missing = and(alive(games), isNull(games.sgdbId)) as SQL;
  const base = ctx.db
    .select({
      gameId: games.id,
      title: games.title,
      releaseYear: gameMetadata.releaseYear,
      steamAppId: games.steamAppId,
      sgdbIdSource: games.sgdbIdSource,
    })
    .from(games)
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)));
  const rows =
    scope === 'plan'
      ? base
          .innerJoin(planEntries, and(eq(planEntries.gameId, games.id), alive(planEntries)))
          .where(missing)
          .orderBy(asc(games.syncCreated), asc(games.id))
          .all()
      : base.where(missing).orderBy(asc(games.syncCreated), asc(games.id)).all();
  return rows
    .filter((row) => row.sgdbIdSource !== 'manual')
    .map(({ gameId, title, releaseYear, steamAppId }) => ({
      gameId,
      title,
      releaseYear,
      steamAppId,
    }));
}

export type SgdbOutcome = 'filled' | 'not-found' | 'failed' | 'skipped';

/**
 * Apunta lo que dijo SteamGridDB: un id (se escribe con `sgdbIdSource =
 * 'auto'` y `sgdb` ok), `null` (`sgdb` empty) o un fallo. `skipped` = borrado
 * o ya tiene id.
 */
export function applySgdbResult(
  ctx: QueryContext,
  gameId: string,
  result: number | null | SourceFailure,
): SgdbOutcome {
  return ctx.store.transaction((): SgdbOutcome => {
    const current = readLiveIdentity(ctx, gameId);
    if (!current || current.sgdbId !== null || current.sgdbIdSource === 'manual') return 'skipped';
    if (isFailure(result)) {
      recordCheck(ctx, gameId, 'sgdb', 'error', { error: result.error });
      return 'failed';
    }
    if (result === null) {
      recordCheck(ctx, gameId, 'sgdb', 'empty');
      return 'not-found';
    }
    fillAutoSgdbId(ctx, current, result);
    recordCheck(ctx, gameId, 'sgdb', 'ok');
    return 'filled';
  });
}
