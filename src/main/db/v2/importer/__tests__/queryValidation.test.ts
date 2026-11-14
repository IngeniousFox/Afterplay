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
import { expectedCases, validateWithQueries } from '../queryValidation';
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

/**
 * Los casos que destapó el ensayo con datos reales (inventados aquí): un
 * promocionado sin `promotedAt` con su plan_to_play, un juego con Steam y RA
 * cuyos sellos escribieron fuentes distintas, uno de la biblioteca sin
 * playthroughs, un catálogo mezclado, y catálogo y curiosidades sin sello.
 */
function realCases(): { db: LegacyDb; ids: Record<string, number> } {
  const db = track(new LegacyDb());
  const ids: Record<string, number> = {};
  // 1. Promocionado antes de existir `promotedAt`.
  ids.oldPromoted = db.game({ title: 'Antiguo', igdbId: 50, addedAt: T });
  const pt = db.iteration(ids.oldPromoted);
  db.event(pt, 'plan_to_play', T + 5, { datePrecision: 'datetime', note: 'del Plan' });
  db.event(pt, 'started', T + 3 * DAY);
  // 2. Steam y RA: RA sincroniza (los dos sellos) y Steam pregunta después
  //    sin encontrar logros (solo el de catálogo).
  ids.both = db.game({ title: 'Dos fuentes', igdbId: 60, steamAppId: 600, raGameId: 61 });
  for (const [i, api] of ['101', '102'].entries()) {
    db.insert('achievements', {
      gameId: ids.both,
      apiName: api,
      displayName: `RA ${api}`,
      iconUrl: `https://media.retroachievements.org/Badge/${api}.png`,
      sortIndex: i,
    });
  }
  db.client.exec(
    `UPDATE games SET achievementsUnlocksSyncedAt = ${T + 20 * DAY}, achievementsSyncedAt = ${T + 20 * DAY + 245_000} WHERE id = ${ids.both}`,
  );
  // 3. De la biblioteca, sin ninguna iteración ni registro.
  ids.empty = db.game({ title: 'Vacío', igdbId: 70, promotedAt: T + DAY });
  // 4. Catálogo mezclado, intercalado por sortIndex, con los dos sellos iguales.
  ids.mixed = db.game({ title: 'Mezclado', igdbId: 80, steamAppId: 800, raGameId: 81 });
  for (const [api, sortIndex, ra] of [
    ['WIN', 0, false],
    ['901', 1, true],
    ['LOSE', 2, false],
    ['902', 3, true],
  ] as const) {
    db.insert('achievements', {
      gameId: ids.mixed,
      apiName: api,
      displayName: api,
      iconUrl: ra ? `https://media.retroachievements.org/Badge/${api}.png` : null,
      sortIndex,
    });
  }
  db.client.exec(
    `UPDATE games SET achievementsSyncedAt = ${T + 30 * DAY}, achievementsUnlocksSyncedAt = ${T + 30 * DAY} WHERE id = ${ids.mixed}`,
  );
  // 5. Catálogo de Steam sin achievementsSyncedAt.
  ids.noStamp = db.game({ title: 'Sin sello', igdbId: 90, steamAppId: 900, addedAt: T + 2 * DAY });
  db.insert('achievements', { gameId: ids.noStamp, apiName: 'A', displayName: 'A', sortIndex: 0 });
  // 6. Curiosidades sin curiositiesGeneratedAt.
  ids.trivia = db.game({ title: 'Curioso', igdbId: 95, addedAt: T + 4 * DAY });
  db.insert('curiosities', { gameId: ids.trivia, text: 'una' });
  return { db, ids };
}

const checkRow = (target: LocalDatabase, id: string): Record<string, unknown> | undefined => {
  const row = target.db.$client
    .prepare('SELECT status, checkedAt FROM external_checks WHERE id = ?')
    .get(id);
  return row ? { ...row } : undefined;
};

describe('validación con consultas: los casos del ensayo real', () => {
  it('cero diferencias, cada diferencia decidida contada en su caso exacto', async () => {
    const { db } = realCases();
    const views = await legacyViews(db);
    const target = track(openTarget());
    const report = importWith(db, target, views);
    const q = report.queryValidation;
    assert.ok(q);
    assert.deepEqual(q.differences, []);
    assert.equal(report.validation.columns.differences, 0);
    // Todos los de la biblioteca sin iteraciones ni registros (los cinco de logros y curiosidades también).
    assert.equal(q.expected.zeroPlaythroughsMoveToPlan, 5);
    assert.equal(q.expected.mixedCatalogOrder, 1);
    // Ficha de logros y recuento de sincronizados.
    assert.equal(q.expected.catalogWithoutStamp, 2);
    // Ficha y recuento de generados.
    assert.equal(q.expected.curiositiesWithoutStamp, 2);
    assert.equal(report.facts['sellos de logros: cierto'], 1);
    assert.equal(
      report.facts[
        'sellos de logros: ambiguo: Steam o RA escribieron el sello (las dos con su hora)'
      ],
      1,
    );

    const ctx = createQueryContext(target, { now: () => new Date(NOW) });
    const { getGameById } = await import('../../queries/library');
    const { getGameAchievements } = await import('../../queries/achievements');
    // 1. "Añadido al Plan" con fecha y nota; la salida no se sabe.
    assert.deepEqual(getGameById(ctx, gameIdForIgdb(50))?.planHistory, {
      plannedAt: new Date(T + 5),
      note: 'del Plan',
      leftAt: null,
    });
    // 2. Cada sello en su fuente; las dos lecturas enseñan los de la 1.x.
    const both = gameIdForIgdb(60);
    assert.deepEqual(checkRow(target, `${both}:steam_achievements`), {
      status: 'empty',
      checkedAt: T + 20 * DAY + 245_000,
    });
    assert.deepEqual(checkRow(target, `${both}:ra_achievements`), {
      status: 'ok',
      checkedAt: T + 20 * DAY,
    });
    assert.equal(checkRow(target, `${both}:steam_unlocks`), undefined);
    assert.deepEqual(getGameById(ctx, both)?.achievementsUnlocksSyncedAt, new Date(T + 20 * DAY));
    assert.deepEqual(getGameAchievements(ctx, both).unlocksSyncedAt, new Date(T + 20 * DAY));
  });

  it('el orden por bloques exige el orden de la 1.x DENTRO de cada fuente', async () => {
    const { db } = realCases();
    const views = await legacyViews(db);
    const target = track(openTarget());
    importWith(db, target, views);
    // Se invierte el orden del catálogo de Steam del juego mezclado en el
    // destino (sus sortIndex): los bloques siguen bien, pero dentro no.
    const id = `${gameIdForIgdb(80)}:steam`;
    const client = target.db.$client;
    const stored = client.prepare('SELECT items FROM achievement_catalogs WHERE id = ?').get(id);
    const items = JSON.parse(String(stored?.items)) as { sortIndex: number }[];
    const reversed = items.map((item, i) => ({ ...item, sortIndex: items.length - i }));
    client
      .prepare('UPDATE achievement_catalogs SET items = ? WHERE id = ?')
      .run(JSON.stringify(reversed), id);
    const q = validateWithQueries({
      target,
      context: planLegacyImport(db.client).context,
      legacy: views,
      memories: new Map(),
      now: new Date(NOW),
    });
    assert.equal(q.checks['logros (ficha): entries{orden}'].differences, 1);
    assert.equal(q.expected.mixedCatalogOrder, undefined);
  });

  it('emuladores, bandeja Pending, escaneo y watcher, con instalaciones reclamadas', async () => {
    const db = track(new LegacyDb());
    // Ejecutable y carpeta aquí; solo la carpeta; nada (de otro PC); emulado.
    const both = db.game({
      title: 'Aquí',
      executablePath: 'C:\\Juegos\\aqui\\Aqui.exe',
      installDirectory: 'C:\\Juegos\\aqui',
      installSizeBytes: 1000,
    });
    db.iteration(both);
    db.iteration(
      db.game({
        title: 'Solo carpeta',
        executablePath: 'C:\\Juegos\\carpeta\\Borrado.exe',
        installDirectory: 'C:\\Juegos\\carpeta',
      }),
    );
    db.iteration(db.game({ title: 'Otro PC', executablePath: 'D:\\Otro\\otro.exe' }));
    db.game({ title: 'Emulado', isEmulated: 1, executablePath: 'C:\\Juegos\\aqui\\Aqui.exe' });
    const emu = db.insert('emulators', { name: 'Emu', executablePath: 'C:\\Emus\\emu.exe' });
    db.insert('emulators', { name: 'emu lejos', executablePath: 'D:\\Otro\\emu.exe' });
    db.session(null, T + DAY, 1, { emulatorId: emu, startedBy: 'watcher' });
    db.session(null, T + 2 * DAY, 2, { emulatorId: emu, startedBy: 'watcher' });
    const views = await legacyViews(db);
    const target = track(openTarget());
    const report = importLegacyDatabase({
      source: db.client,
      target,
      legacyQueryViews: views,
      now: NOW,
      claimInstalls: true,
      pathExists: (path) => path.startsWith('C:\\') && !path.endsWith('Borrado.exe'),
    });
    const q = report.queryValidation;
    assert.ok(q);
    assert.deepEqual(q.differences, []);
    assert.equal(q.checks['watcher: {presente}'].compared, 2, 'un juego y un emulador');
    assert.equal(q.checks['emuladores: {presente}'].compared, 2);
    assert.equal(q.checks['sesiones (pendientes): {presente}'].compared, 2);
    assert.equal(q.checks['escaneo (juegos de la colección): {presente}'].compared, 4);
    assert.ok((q.expected.installPaths ?? 0) > 0);
  });

  it('cero playthroughs solo cuenta si no hay ningún registro de partida', () => {
    const db = track(new LegacyDb());
    const clean = db.game({ title: 'Limpio' });
    const withSpend = db.game({ title: 'Con gasto' });
    db.insert('spend_events', {
      gameId: withSpend,
      type: 'ingame_spend',
      amount: 5,
      occurredAt: T,
      datePrecision: 'day',
    });
    db.game({ title: 'Planeado', planned: 1 });
    db.iteration(db.game({ title: 'Con playthrough' }));
    const cases = expectedCases(planLegacyImport(db.client).context);
    assert.deepEqual([...cases.zeroPlaythroughs], [clean]);
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

  // Revisión, sospecha sobre memorySignatures.ts.
  it('no reescribe la firma de un recap que ya estaba en la base antes de esta ejecución', async () => {
    const { db } = scenario();
    await withMemories(db);
    const target = track(openTarget());
    importLegacyDatabase({ source: db.client, target, now: NOW });
    // El recap de enero "llega por sync" (o se restaura) con la firma 1.x y
    // los relojes de otro PC: ya no es una fila de esta importación.
    const legacyHash = (
      db.client
        .prepare(`SELECT sourceHash FROM generated_memories WHERE scopeKey = '2024-01'`)
        .get() as { sourceHash: string }
    ).sourceHash;
    target.db.$client
      .prepare(
        `UPDATE generated_memories SET sourceHash = ?, syncDirty = 0 WHERE id = 'month:2024-01'`,
      )
      .run(legacyHash);
    const before = {
      ...target.db.$client
        .prepare(`SELECT * FROM generated_memories WHERE id = 'month:2024-01'`)
        .get(),
    };
    const again = importLegacyDatabase({ source: db.client, target, now: NOW });
    const after = {
      ...target.db.$client
        .prepare(`SELECT * FROM generated_memories WHERE id = 'month:2024-01'`)
        .get(),
    };
    assert.deepEqual(after, before, 'la fila que ya estaba no se toca (ni firma ni syncDirty)');
    assert.equal(again.memorySignatures.resealed, 0);
    assert.equal(again.memorySignatures.notResealedPreexisting, 1);
    assert.deepEqual(again.memorySignatures.matches, { 'legacy:noAchievements': 1 });
    // La conciliación espera la firma que quedó, no la que se habría puesto.
    assert.equal(again.validation.columns.tables.generated_memories.sourceHash.differences, 0);
  });
});
