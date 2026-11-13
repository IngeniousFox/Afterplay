import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
// Primero el anfitrión: sustituye `src/main/db/index.ts` antes de que nada
// cargue una consulta 1.x (ver legacyQueryHost.ts).
import { collectLegacyViewsFrom } from '../legacyQueryHost';
import { buildChapter, type ChapterScope } from '../../../../../shared/memory/chapters';
import { deriveMoments } from '../../../../../shared/memory/moments';
import { gameIdForIgdb } from '../../../../../shared/sync/ids';
import { chapterHash } from '../../../../memories/hash';
import { tempDir } from '../../__tests__/helpers';
import type { LocalDatabase } from '../../connection';
import { createQueryContext } from '../../queries/common';
import { chapterSignature, loadMemoryFactsSnapshot, memoryChapterFor } from '../../queries/loop';
import {
  importLegacyDatabase,
  ImportValidationError,
  planLegacyImport,
  type ImportReport,
} from '..';
import type { LegacyQueryViews } from '../legacyQueries';
import { validateWithQueries } from '../queryValidation';
import { DAY, LegacyDb, openTarget, seedDefault, T } from './fixture';

// La validación con las consultas de verdad (queryValidation.ts) y el
// recálculo de las firmas de los recaps (memorySignatures.ts), sobre bases 1.x
// SINTÉTICAS. Las lecturas 1.x corren con su propio código sobre una copia en
// fichero de la base (el driver de sus tests, `@libsql/client`).

const open: { close(): void }[] = [];
const track = <V extends { close(): void }>(value: V): V => {
  open.push(value);
  return value;
};
const dirs: { cleanup(): void }[] = [];
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});
after(() => {
  // La conexión de libsql puede tener el fichero cogido hasta salir del
  // proceso (Windows): lo que no se deje borrar lo recoge `posttest`.
  for (const dir of dirs.splice(0)) {
    try {
      dir.cleanup();
    } catch {
      // EBUSY: ver arriba.
    }
  }
});

const NOW = Date.UTC(2027, 0, 1);

/** Las lecturas 1.x sobre una copia en fichero de la base sintética. */
async function legacyViews(db: LegacyDb): Promise<LegacyQueryViews> {
  const dir = tempDir();
  dirs.push(dir);
  const path = join(dir.path, `legacy-${dirs.length}.db`);
  db.client.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  try {
    return await collectLegacyViewsFrom(path);
  } finally {
    try {
      rmSync(path, { force: true });
    } catch {
      // EBUSY: ver `after`.
    }
  }
}

const importWith = (db: LegacyDb, target: LocalDatabase, views: LegacyQueryViews): ImportReport =>
  importLegacyDatabase({ source: db.client, target, legacyQueryViews: views, now: NOW });

/** La semilla de los e2e con los sellos de logros que la app pone al sincronizar. */
function seeded(): LegacyDb {
  const db = track(new LegacyDb());
  seedDefault(db);
  db.client.exec(
    `UPDATE games SET achievementsSyncedAt = ${Date.UTC(2026, 0, 1)}, achievementsUnlocksSyncedAt = ${Date.UTC(2026, 0, 1)}
     WHERE id IN (SELECT gameId FROM achievements)`,
  );
  return db;
}

/** Un caso de cada regla visible en las lecturas, con un recap vigente y otro no. */
function scenario(): { db: LegacyDb; ids: Record<string, number> } {
  const db = track(new LegacyDb());
  const ids: Record<string, number> = {};
  ids.game = db.game({ title: 'Jugado', igdbId: 10, notes: 'nota', steamAppId: 7 });
  ids.pt1 = db.iteration(ids.game, { manualTotalPlayed: 3 });
  ids.pt2 = db.iteration(ids.game, { label: 'Otra vuelta', rating: 4 });
  db.event(ids.pt1, 'started', T + DAY);
  db.event(ids.pt1, 'completed', T + 5 * DAY, { note: 'fin' });
  db.event(ids.pt2, 'started', T + 6 * DAY);
  ids.session = db.session(ids.pt1, T + 2 * DAY, 2, { note: 'sesión' });
  db.session(ids.pt2, T + 7 * DAY, 1);
  db.insert('spend_events', {
    gameId: ids.game,
    type: 'purchase',
    amount: 20,
    occurredAt: T,
    datePrecision: 'day',
  });
  // Alta con el evento de papeleo (fecha = alta): pasa a 'unknown'.
  ids.paper = db.game({ title: 'Papeleo', addedAt: T + 3 * DAY });
  ids.paperPt = db.iteration(ids.paper);
  db.event(ids.paperPt, 'completed', T + 3 * DAY + 10, { datePrecision: 'datetime' });
  // Planeado con nota y fijado; promocionado con su plan_to_play.
  ids.planned = db.game({
    title: 'Planeado',
    igdbId: 20,
    planned: 1,
    planPinnedAt: T + 9 * DAY,
    addedAt: T + 8 * DAY,
  });
  db.event(db.iteration(ids.planned), 'plan_to_play', T + 8 * DAY, {
    datePrecision: 'datetime',
    note: 'porque sí',
  });
  ids.promoted = db.game({
    title: 'Promocionado',
    igdbId: 30,
    addedAt: T + 10 * DAY,
    promotedAt: T + 12 * DAY,
  });
  ids.promotedPt = db.iteration(ids.promoted);
  db.event(ids.promotedPt, 'plan_to_play', T + 10 * DAY, {
    datePrecision: 'datetime',
    note: 'nota del plan',
  });
  db.session(ids.promotedPt, T + 13 * DAY, 1.5);
  // Logros de Steam con un desbloqueo en una sesión.
  const ach = db.insert('achievements', {
    gameId: ids.game,
    apiName: 'ACH_A',
    displayName: 'A',
    sortIndex: 0,
    globalPercent: 3,
  });
  db.insert('achievements', {
    gameId: ids.game,
    apiName: 'ACH_B',
    displayName: 'B',
    sortIndex: 1,
    globalPercent: 50,
  });
  db.insert('achievement_unlocks', {
    achievementId: ach,
    unlockedAt: T + 2 * DAY + 3_600_000,
    source: 'steam',
    sessionId: ids.session,
    iterationId: ids.pt1,
  });
  db.client.exec(
    `UPDATE games SET achievementsSyncedAt = ${T + 20 * DAY}, achievementsUnlocksSyncedAt = ${T + 20 * DAY} WHERE id = ${ids.game}`,
  );
  // La app pone el sello al guardar las curiosidades.
  db.client.exec(
    `UPDATE games SET curiositiesGeneratedAt = ${T + 21 * DAY} WHERE id = ${ids.game}`,
  );
  db.insert('curiosities', { gameId: ids.game, text: 'una' });
  db.insert('curiosities', { gameId: ids.game, text: 'dos' });
  db.insert('radar_games', { igdbId: 999, title: 'Secuela', discoveredAt: T + 30 * DAY });
  return { db, ids };
}

/** El hash 1.x (status.ts) del capítulo de un periodo, con los hechos de la 1.x. */
function legacyHash(views: LegacyQueryViews, scope: ChapterScope): string {
  const facts = views.memoryFacts;
  const chapter = buildChapter(
    scope,
    facts.sessions,
    facts.events,
    facts.titlesByGame,
    deriveMoments(facts.sessions, facts.manualHoursByGame),
    new Date(NOW),
    facts.manualBlocks,
    facts.unlocks,
  );
  assert.ok(chapter, 'el periodo tiene capítulo');
  return chapterHash(chapter);
}

/** Inserta los recaps: enero con su firma 1.x de verdad y el año con una caducada. */
async function withMemories(db: LegacyDb): Promise<LegacyQueryViews> {
  const before = await legacyViews(db);
  const memory = (scopeType: string, scopeKey: string, sourceHash: string): void => {
    db.insert('generated_memories', {
      scopeType,
      scopeKey,
      payload: '{"title":"t","body":"b"}',
      sourceHash,
      model: 'm',
      promptVersion: 3,
      createdAt: T + 40 * DAY,
    });
  };
  memory('month', '2024-01', legacyHash(before, { type: 'month', year: 2024, month: 0 }));
  memory('year', '2024', 'firma-caducada');
  memory('month', '2020-01', 'sin-actividad');
  memory('month', '2024-13', 'clave-imposible');
  return legacyViews(db);
}

describe('validación con consultas (1.x frente a 2.0)', () => {
  it('la semilla de los e2e: todas las lecturas coinciden salvo las diferencias esperadas', async () => {
    const db = seeded();
    const views = await legacyViews(db);
    const target = track(openTarget());
    const report = importWith(db, target, views);
    const q = report.queryValidation;
    assert.ok(q);
    assert.deepEqual(
      q.differences.map((d) => `${d.check} #${String(d.legacyId)}`),
      [],
    );
    assert.equal(q.ok, true);
    assert.ok(q.compared > 2000, `comparados: ${q.compared}`);
    assert.equal(
      q.totals['fichas comparadas'],
      db.client.prepare('SELECT id FROM games').all().length,
    );
    // Los planeados de la semilla: sin su iteración vacía y sin plan_to_play.
    assert.ok((q.expected.emptyPlannedIteration ?? 0) > 0);
    assert.ok((q.expected.planToPlay ?? 0) > 0);
  });

  it('un caso de cada regla: Plan, papeleo, logros, curiosidades, radar y recaps', async () => {
    const { db, ids } = scenario();
    const views = await withMemories(db);
    const target = track(openTarget());
    const report = importWith(db, target, views);
    const q = report.queryValidation;
    assert.ok(q);
    assert.deepEqual(q.differences, []);
    assert.equal(
      q.expected.unknownPrecision,
      3,
      'ficha, borde del playthrough y lectura de estados',
    );
    assert.equal(q.expected.ids, 1, 'el radar');
    assert.equal(q.expected.resealedSignature, 1);
    assert.ok(q.onlyInTarget.includes('logros (ficha): completion'));

    // La ficha del promocionado enseña su paso por el Plan con fecha y nota.
    const ctx = createQueryContext(target, { now: () => new Date(NOW) });
    const { getGameById } = await import('../../queries/library');
    const promoted = getGameById(ctx, gameIdForIgdb(30));
    assert.deepEqual(promoted?.planHistory, {
      plannedAt: new Date(T + 10 * DAY),
      note: 'nota del plan',
      leftAt: new Date(T + 12 * DAY),
    });
    assert.ok(ids.promoted);
  });

  it('detecta lo que solo se ve en las lecturas, y el informe no lleva contenido', async () => {
    const { db, ids } = scenario();
    const views = await legacyViews(db);
    const target = track(openTarget());
    importWith(db, target, views);
    const client = target.db.$client;
    // Una nota del Plan y la precisión de un evento que no es papeleo.
    client
      .prepare(`UPDATE plan_entries SET note = 'otra nota secreta' WHERE id = ?`)
      .run(gameIdForIgdb(20));
    client
      .prepare(
        `UPDATE state_events SET datePrecision = 'unknown' WHERE type = 'started' AND occurredAt = ?`,
      )
      .run(T + DAY);
    const plan = planLegacyImport(db.client);
    const q = validateWithQueries({
      target,
      context: plan.context,
      legacy: views,
      memories: new Map(),
      now: new Date(NOW),
    });
    assert.equal(q.ok, false);
    const checks = Object.entries(q.checks)
      .filter(([, c]) => c.differences > 0)
      .map(([check]) => check)
      .sort();
    assert.deepEqual(checks, [
      'estados: [].datePrecision',
      'ficha: iterations[].startEvent.datePrecision',
      'ficha: planHistory.note',
      'ficha: stateHistory[].datePrecision',
      'plan (extras): [].planNote',
      // El evento pasa a contar como papeleo: el Loop deja de contarlo.
      'recaps (capítulos): hechos canónicos (full)',
      'recaps (capítulos): hechos canónicos (noAchievements)',
      'recaps (hechos) events: [].paperwork',
    ]);
    const where = q.differences.find((d) => d.check === 'ficha: planHistory.note');
    assert.equal(where?.legacyId, ids.planned);
    assert.ok(!JSON.stringify(q.differences).includes('secreta'));
    assert.ok(!JSON.stringify(q.differences).includes('porque'));
  });

  it('una diferencia con las consultas aborta la importación y no deja nada', async () => {
    const { db } = scenario();
    const views = await legacyViews(db);
    // La foto 1.x dice otra cosa de lo que hay en el origen: un hallazgo.
    const altered: LegacyQueryViews = {
      ...views,
      games: views.games.map((g, i) => (i === 0 ? { ...g, totalHours: g.totalHours + 1 } : g)),
    };
    const target = track(openTarget());
    assert.throws(
      () => importWith(db, target, altered),
      (e: unknown) =>
        e instanceof ImportValidationError &&
        e.report.queryValidation?.checks['biblioteca: [].totalHours'].differences === 1,
    );
    assert.equal(target.db.$client.prepare('SELECT count(*) AS n FROM games').get()?.n, 0);
  });
});

describe('firmas de los recaps', () => {
  it('casa la vigente (se resella con ids 2.0 y relojes antiguos); el resto se queda', async () => {
    const { db } = scenario();
    const views = await withMemories(db);
    const plan = planLegacyImport(db.client);
    const target = track(openTarget());
    const report = importWith(db, target, views);
    const m = report.memorySignatures;
    assert.equal(m.checked, 4);
    assert.deepEqual(m.outcomes, { match: 1, mismatch: 1, no_chapter: 1, invalid_scope: 1 });
    assert.deepEqual(m.matches, { 'legacy:noAchievements': 1 });
    assert.equal(m.resealed, 1);
    assert.deepEqual(m.mismatchScopes, ['year:2024']);

    const row = (id: string): Record<string, unknown> => ({
      ...target.db.$client.prepare('SELECT * FROM generated_memories WHERE id = ?').get(id),
    });
    const january = row('month:2024-01');
    // La firma nueva es la de los hechos 2.0 del capítulo.
    const ctx = createQueryContext(target, { now: () => new Date(NOW) });
    const chapter = memoryChapterFor(
      loadMemoryFactsSnapshot(ctx),
      { type: 'month', year: 2024, month: 0 },
      new Date(NOW),
    );
    assert.ok(chapter);
    assert.equal(january.sourceHash, chapterSignature(chapter, 'noAchievements'));
    // Relojes intactos: los del plan (antiguos), no los de ahora.
    const planned = (plan.rows.get('generated_memories') ?? []).find(
      (r) => r.id === 'month:2024-01',
    );
    assert.equal(january.syncCreated, planned?.values.syncCreated);
    assert.equal(january.syncUpdated, planned?.values.syncUpdated);
    assert.equal(january.syncFields, planned?.values.syncFields);
    // Las que no casan conservan su firma 1.x.
    assert.equal(row('year:2024').sourceHash, 'firma-caducada');
    assert.equal(row('month:2020-01').sourceHash, 'sin-actividad');
    // Y la vigencia que enseña la 2.0 es la de la 1.x.
    assert.equal(report.queryValidation?.checks['recaps: vigente'].differences, 0);
    assert.equal(report.queryValidation?.totals['recaps vigentes en la 2.0'], 1);
    // La conciliación espera la firma recalculada.
    assert.equal(report.validation.columns.tables.generated_memories.sourceHash.differences, 0);
  });

  it('idempotente y determinista: la segunda vez ya casa con ids 2.0 y no cambia nada', async () => {
    const { db } = scenario();
    const views = await withMemories(db);
    const a = track(openTarget());
    const b = track(openTarget());
    importWith(db, a, views);
    importWith(db, b, views);
    const dump = (target: LocalDatabase): string =>
      JSON.stringify(
        target.db.$client.prepare('SELECT * FROM generated_memories ORDER BY id').all(),
      );
    assert.equal(dump(a), dump(b));
    const first = dump(a);
    const again = importWith(db, a, views);
    assert.equal(dump(a), first);
    assert.deepEqual(again.memorySignatures.matches, { 'v2:noAchievements': 1 });
    assert.equal(again.memorySignatures.resealed, 0);
    assert.equal(again.target.generated_memories.alreadyPresentDifferent, 0);
    assert.equal(again.queryValidation?.ok, true);
  });
});
