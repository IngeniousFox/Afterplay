import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { EXTERNAL_CHECK_SOURCES, games } from '../../../schema';
import { count, rawRow } from '../../../__tests__/helpers';
import {
  CHECK_POLICIES,
  RA_REMATCH_AFTER_MS,
  checkIsDue,
  clearCheck,
  externalCheckId,
  isCheckDue,
  nextCheckAtFor,
  readCheck,
  writeCheck,
} from '../checks';
import { T0, at, day, openQueryDb, seedGame, type QueryFixture } from './fixtures';

// La política de `external_checks` (CONSULTAS.md §3.5).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('política', () => {
  it('hay política para todas las fuentes del esquema, steam_unlocks incluida', () => {
    assert.deepEqual(Object.keys(CHECK_POLICIES).sort(), [...EXTERNAL_CHECK_SOURCES].sort());
  });

  it('respuestas: solo a mano; fallos: pendientes ya (como "sin sello" en la 1.x)', () => {
    const checkedAt = new Date(T0);
    for (const source of EXTERNAL_CHECK_SOURCES) {
      if (source === 'ra_match') continue;
      assert.equal(nextCheckAtFor(source, 'ok', checkedAt), null, source);
      assert.equal(nextCheckAtFor(source, 'empty', checkedAt), null, source);
      assert.equal(nextCheckAtFor(source, 'error', checkedAt)?.getTime(), T0, source);
    }
  });

  it('ra_match: con set, hecho; sin set o con fallo, a los 4 días (REMATCH_AFTER_MS)', () => {
    const checkedAt = new Date(T0);
    assert.equal(RA_REMATCH_AFTER_MS, 4 * 24 * 60 * 60 * 1000);
    assert.equal(nextCheckAtFor('ra_match', 'ok', checkedAt), null);
    assert.equal(nextCheckAtFor('ra_match', 'empty', checkedAt)?.getTime(), day(4).getTime());
    assert.equal(nextCheckAtFor('ra_match', 'error', checkedAt)?.getTime(), day(4).getTime());
  });
});

describe('writeCheck', () => {
  it('escribe la fila compuesta con la política y la sobrescribe', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(writeCheck(fx.ctx, gameId, 'ra_match', 'empty'), true);
    let check = readCheck(fx.ctx, gameId, 'ra_match');
    assert.equal(check?.id, externalCheckId(gameId, 'ra_match'));
    assert.equal(check?.status, 'empty');
    assert.equal(check?.checkedAt.getTime(), T0);
    assert.equal(check?.nextCheckAt?.getTime(), day(4).getTime());

    fx.wall.advance(1000);
    writeCheck(fx.ctx, gameId, 'ra_match', 'error', { error: 'HTTP 429' });
    check = readCheck(fx.ctx, gameId, 'ra_match');
    assert.equal(check?.status, 'error');
    assert.equal(check?.error, 'HTTP 429');
    assert.equal(check?.checkedAt.getTime(), T0 + 1000);

    // Una respuesta buena borra el error anterior.
    writeCheck(fx.ctx, gameId, 'ra_match', 'ok');
    check = readCheck(fx.ctx, gameId, 'ra_match');
    assert.equal(check?.error, null);
    assert.equal(check?.nextCheckAt, null);
    assert.equal(count(fx.local, 'external_checks'), 1);
  });

  it('no deja filas de un juego borrado o inexistente (R-15)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    fx.ctx.store.remove('games', gameId);
    assert.equal(writeCheck(fx.ctx, gameId, 'hltb', 'ok'), false);
    assert.equal(writeCheck(fx.ctx, 'no-existe', 'hltb', 'ok'), false);
    assert.equal(count(fx.local, 'external_checks'), 0);
  });

  it('repetir la misma respuesta con la misma fecha no escribe (F-33)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    writeCheck(fx.ctx, gameId, 'hltb', 'empty');
    fx.local.db.$client.prepare('UPDATE external_checks SET syncDirty = 0').run();
    writeCheck(fx.ctx, gameId, 'hltb', 'empty');
    assert.equal(
      rawRow(fx.local, 'external_checks', externalCheckId(gameId, 'hltb'))?.syncDirty,
      0,
    );
  });

  it('clearCheck la deja "nunca preguntada" y resucita al volver a escribir', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    writeCheck(fx.ctx, gameId, 'steam_store', 'ok');
    clearCheck(fx.ctx, gameId, 'steam_store');
    clearCheck(fx.ctx, gameId, 'steam_store'); // idempotente
    clearCheck(fx.ctx, gameId, 'sgdb'); // inexistente: no falla
    assert.equal(readCheck(fx.ctx, gameId, 'steam_store'), undefined);
    writeCheck(fx.ctx, gameId, 'steam_store', 'ok');
    assert.equal(readCheck(fx.ctx, gameId, 'steam_store')?.status, 'ok');
  });
});

describe('¿toca preguntar?', () => {
  it('isCheckDue: sin fila, con lápida o vencida', () => {
    const now = new Date(T0);
    assert.equal(isCheckDue(undefined, now), true);
    assert.equal(isCheckDue({ nextCheckAt: null, syncDeleted: 'x' }, now), true);
    assert.equal(isCheckDue({ nextCheckAt: null, syncDeleted: null }, now), false);
    assert.equal(isCheckDue({ nextCheckAt: at(1), syncDeleted: null }, now), false);
    assert.equal(isCheckDue({ nextCheckAt: at(0), syncDeleted: null }, now), true);
  });

  it('checkIsDue elige candidatos en SQL con la misma regla', () => {
    seedGame(fx.ctx, { title: 'Nunca preguntado' });
    const answered = seedGame(fx.ctx, { title: 'Respondido' });
    const failed = seedGame(fx.ctx, { title: 'Falló' });
    const later = seedGame(fx.ctx, { title: 'Sin set en RA' });
    const cleared = seedGame(fx.ctx, { title: 'Olvidado' });
    writeCheck(fx.ctx, answered, 'ra_match', 'ok');
    writeCheck(fx.ctx, failed, 'hltb', 'error');
    writeCheck(fx.ctx, later, 'ra_match', 'empty');
    writeCheck(fx.ctx, cleared, 'ra_match', 'ok');
    clearCheck(fx.ctx, cleared, 'ra_match');

    const due = (source: 'ra_match' | 'hltb', now: Date): string[] =>
      fx.ctx.db
        .select({ title: games.title })
        .from(games)
        .where(checkIsDue(source, now))
        .all()
        .map((row) => row.title)
        .sort();

    assert.deepEqual(due('ra_match', new Date(T0)), ['Falló', 'Nunca preguntado', 'Olvidado']);
    assert.deepEqual(due('ra_match', day(4)), [
      'Falló',
      'Nunca preguntado',
      'Olvidado',
      'Sin set en RA',
    ]);
    // El fallo de HLTB queda pendiente ya; los demás nunca preguntaron a HLTB.
    assert.equal(due('hltb', new Date(T0)).length, 5);
  });
});
