import type { QueryContext } from '../common/context';
import { readLiveIdentity } from './internal';
import { applyHltb } from './refreshPass';
import { readExternalSnapshot } from './snapshot';
import type { HltbTimesData, SourceFailure } from './types';

// `hltb:refreshGame` (`ipc/hltb.ts:33`): volver a preguntar a HowLongToBeat
// por UN juego ya dado de alta.
//
//   1. `readHltbRefreshTarget` (título y año).
//   2. Red: `getHltbTimes(title, releaseYear)`.
//   3. `applyHltbRefreshResult`: transacción que relee (juego vivo) y escribe.
//
// Cambio de comportamiento, a propósito: la 1.x escribía los tres tramos en
// bloque (`ipc/hltb.ts:50-59`) y un match parcial borraba con null los tramos
// que ya había. Aquí, como en el botón "actualízalo todo"
// (`refreshGame.ts:163-176`), solo se escriben los tramos que HLTB supo.

export interface HltbRefreshTarget {
  readonly gameId: string;
  readonly title: string;
  readonly releaseYear: number | null;
}

/** null = el juego no existe o está borrado (el handler devuelve null). */
export function readHltbRefreshTarget(ctx: QueryContext, gameId: string): HltbRefreshTarget | null {
  const snapshot = readExternalSnapshot(ctx, gameId);
  return snapshot
    ? { gameId: snapshot.gameId, title: snapshot.title, releaseYear: snapshot.releaseYear }
    : null;
}

/**
 * Escribe los tramos que HLTB supo y apunta `hltb` (ok / empty / error).
 * Devuelve false si el juego se borró durante la red (no escribe nada).
 */
export function applyHltbRefreshResult(
  ctx: QueryContext,
  gameId: string,
  result: HltbTimesData | null | SourceFailure,
): boolean {
  return ctx.store.transaction(() => {
    const current = readLiveIdentity(ctx, gameId);
    if (!current) return false;
    applyHltb(ctx, current, result);
    return true;
  });
}
