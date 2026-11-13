import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { LEGACY_DEVICE_SHORT_ID, parseClock } from '../../../../../shared/sync/clock';
import { gameIdForIgdb } from '../../../../../shared/sync/ids';
import { syncedEntries } from '../../registry';
import type { LocalDatabase } from '../../connection';
import {
  ImportBlockedError,
  ImportValidationError,
  importLegacyDatabase,
  legacyUuid,
  planLegacyImport,
  type ImportReport,
} from '..';
import { validateImport } from '../validate';
import { DAY, LegacyDb, openTarget, seedDefault, T } from './fixture';

// El importador sobre bases 1.x SINTÉTICAS: cada regla con su caso, los raros
// incluidos, más idempotencia, determinismo, que la validación detecta una
// diferencia provocada y que no se pisa una fila editada en el destino.

const open: { close(): void }[] = [];
const track = <T extends { close(): void }>(value: T): T => {
  open.push(value);
  return value;
};
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

type Raw = Record<string, unknown>;
const row = (target: LocalDatabase, table: string, id: string): Raw | undefined => {
  const found = target.db.$client.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
  return found ? { ...found } : undefined;
};
const rows = (target: LocalDatabase, table: string, where = '1 = 1'): Raw[] =>
  target.db.$client
    .prepare(`SELECT * FROM "${table}" WHERE ${where} ORDER BY id`)
    .all()
    .map((r) => ({ ...r }));
const importInto = (
  db: LegacyDb,
  target: LocalDatabase,
  extra: Partial<Parameters<typeof importLegacyDatabase>[0]> = {},
): ImportReport => importLegacyDatabase({ source: db.client, target, ...extra });

/** Volcado de todas las columnas sincronizadas (sin syncDirty) de todas las tablas. */
const dump = (target: LocalDatabase, withLocal = false): string => {
  const out: Record<string, Raw[]> = {};
  for (const entry of syncedEntries) {
    out[entry.name] = rows(target, entry.name).map((r) => {
      // syncDirty es solo local: no forma parte de lo que viaja.
      const copy = { ...r };
      delete copy.syncDirty;
      return copy;
    });
  }
  if (withLocal)
    out.local_legacy_ids = target.db.$client
      .prepare('SELECT * FROM local_legacy_ids ORDER BY legacyTable, legacyId')
      .all()
      .map((r) => ({ ...r }));
  return JSON.stringify(out);
};

/** Una base 1.x con un caso de cada regla. */
function richSource(): { db: LegacyDb; ids: Record<string, number> } {
  const db = track(new LegacyDb());
  const ids: Record<string, number> = {};

  // Juego normal con dos playthroughs, horas manuales Y sesiones, overrides,
  // sellos de comprobación y gastos.
  ids.game = db.game({
    title: 'Repetido',
    igdbId: 100,
    coverUrl: 'https://img/cover.jpg',
    heroUrl: 'https://img/hero.jpg',
    developer: 'Estudio',
    publisher: 'Editora',
    genres: '["RPG","Acción"]',
    notes: 'nota del juego',
    sgdbId: 55,
    steamAppId: 4242,
    steamAppIdManual: 1,
    steamAppIdCheckedAt: T + 5 * DAY,
    achievementsSyncedAt: T + 6 * DAY,
    achievementsUnlocksSyncedAt: T + 7 * DAY,
    raGameId: 77,
    raCheckedAt: T + 8 * DAY,
    curiositiesGeneratedAt: T + 9 * DAY,
    steamTags: '[{"name":"Metroidvania","votes":10}]',
  });
  ids.pt1 = db.iteration(ids.game, { manualTotalPlayed: 12.5, rating: 4, extraContent: 1 });
  ids.pt2 = db.iteration(ids.game, { label: 'Segunda vuelta' });
  db.event(ids.pt1, 'started', T + DAY);
  db.event(ids.pt1, 'completed', T + 3 * DAY, { note: 'terminado' });
  db.event(ids.pt2, 'started', T + 10 * DAY);
  // Dos eventos a la misma hora: el desempate es el id antiguo.
  db.event(ids.pt2, 'on_hold', T + 12 * DAY);
  db.event(ids.pt2, 'started', T + 12 * DAY);
  ids.session = db.session(ids.pt1, T + 2 * DAY, 1.5, { note: 'dónde lo dejé' });
  db.session(ids.pt2, T + 11 * DAY, 2);
  db.session(ids.pt2, T + 13 * DAY, 0.25, { isManual: 1 });
  db.insert('spend_events', {
    gameId: ids.game,
    type: 'purchase',
    amount: 19.99,
    occurredAt: T,
    datePrecision: 'day',
  });
  db.insert('spend_events', {
    gameId: ids.game,
    type: 'ingame_spend',
    amount: 4.5,
    occurredAt: T + 11 * DAY,
    datePrecision: 'day',
    note: 'DLC',
  });
  db.insert('curiosities', { gameId: ids.game, text: 'primera' });
  db.insert('curiosities', { gameId: ids.game, text: 'segunda' });
  // Catálogo mixto Steam/RA y desbloqueos de las tres fuentes.
  ids.steamAch = db.insert('achievements', {
    gameId: ids.game,
    apiName: 'ACH_WIN',
    displayName: 'Ganar',
    iconUrl: 'https://shared.akamai.steamstatic.com/a.jpg',
    sortIndex: 0,
    globalPercent: 12.5,
  });
  ids.steamAch2 = db.insert('achievements', {
    gameId: ids.game,
    apiName: 'ACH_HIDDEN',
    displayName: 'Oculto',
    hidden: 1,
    sortIndex: 1,
  });
  ids.raAch = db.insert('achievements', {
    gameId: ids.game,
    apiName: '9001',
    displayName: 'RA',
    iconUrl: 'https://media.retroachievements.org/Badge/1.png',
    sortIndex: 0,
  });
  db.insert('achievement_unlocks', {
    achievementId: ids.steamAch,
    unlockedAt: T + 2 * DAY,
    source: 'steam',
    iterationId: ids.pt1,
    sessionId: ids.session,
  });
  db.insert('achievement_unlocks', {
    achievementId: ids.steamAch,
    unlockedAt: T + 2 * DAY + 5,
    source: 'emu',
    dateReliable: 0,
  });
  db.insert('achievement_unlocks', {
    achievementId: ids.steamAch2,
    unlockedAt: T + 3 * DAY,
    source: 'emu',
  });
  db.insert('achievement_unlocks', {
    achievementId: ids.raAch,
    unlockedAt: T + 4 * DAY,
    source: 'ra',
  });

  // Otro juego con el MISMO título, sin igdbId; alta con evento-artefacto.
  ids.noIgdb = db.game({ title: 'Repetido', addedAt: T + 20 * DAY });
  ids.noIgdbPt = db.iteration(ids.noIgdb, { manualTotalPlayed: 90 });
  db.event(ids.noIgdbPt, 'completed', T + 20 * DAY + 30, { datePrecision: 'datetime' });

  // Planeado con su iteración vacía, fijado en Up next y con nota.
  ids.planned = db.game({
    title: 'Planeado',
    igdbId: 200,
    planned: 1,
    planPinnedAt: T + 31 * DAY,
    addedAt: T + 30 * DAY,
  });
  ids.plannedPt = db.iteration(ids.planned);
  db.event(ids.plannedPt, 'plan_to_play', T + 30 * DAY, {
    datePrecision: 'datetime',
    note: 'por qué lo quiero',
  });
  db.insert('spend_events', {
    gameId: ids.planned,
    type: 'purchase',
    amount: 5,
    occurredAt: T + 30 * DAY,
    datePrecision: 'day',
  });

  // Promocionado que conserva su plan_to_play con nota.
  ids.promoted = db.game({
    title: 'Promocionado',
    igdbId: 300,
    addedAt: T + 40 * DAY,
    promotedAt: T + 50 * DAY,
  });
  ids.promotedPt = db.iteration(ids.promoted, { label: 'Playthrough 3' });
  db.event(ids.promotedPt, 'plan_to_play', T + 40 * DAY, {
    datePrecision: 'datetime',
    note: 'nota del plan',
  });
  db.event(ids.promotedPt, 'completed', T + 50 * DAY + 100, { datePrecision: 'datetime' });

  // Juego solo de RA (sello de desbloqueos sin Steam).
  ids.raOnly = db.game({
    title: 'Retro',
    igdbId: 400,
    raGameId: 88,
    achievementsSyncedAt: T + DAY,
    achievementsUnlocksSyncedAt: T + DAY,
  });

  // Emulador y una sesión suya sin asignar.
  ids.emulator = db.insert('emulators', { name: 'Emu', executablePath: 'C:/emu/emu.exe' });
  ids.pending = db.session(null, T + 60 * DAY, 1, { emulatorId: ids.emulator });

  db.insert('generated_memories', {
    scopeType: 'month',
    scopeKey: '2024-01',
    payload: '{"title":"Enero","body":"x"}',
    sourceHash: 'abc',
    model: 'm',
    promptVersion: 3,
    createdAt: T + 70 * DAY,
  });
  db.insert('radar_games', { igdbId: 999, title: 'Secuela', discoveredAt: T + 80 * DAY });
  db.insert('save_backups', {
    gameId: ids.game,
    backupName: 'b.zip',
    r2Key: 'saves/100/m/b.zip',
    ludusaviName: 'L',
    machineId: 'm',
    machineName: 'PC',
    machineHome: 'C:/Users/x',
    createdAt: T + 90 * DAY,
  });
  db.insert('plan_mailbox', {
    type: 'pin',
    payload: '{}',
    createdAt: T + 91 * DAY,
    processedAt: T + 91 * DAY,
  });
  return { db, ids };
}

describe('importador 1.x → 2.0: reglas', () => {
  it('importa la semilla de los e2e y la validación pasa', () => {
    const db = track(new LegacyDb());
    seedDefault(db);
    const target = track(openTarget());
    const report = importInto(db, target);
    assert.equal(report.validation.ok, true);
    assert.ok(report.validation.columns.compared > 1000);
    assert.equal(report.validation.columns.differences, 0);
  });

  it('ids: naturales donde los hay, UUIDv7 deterministas en el resto; mapa de ids antiguos', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const game = gameIdForIgdb(100);
    assert.ok(row(target, 'games', game));
    assert.ok(row(target, 'game_metadata', game));
    assert.ok(
      row(target, 'games', legacyUuid('games', ids.noIgdb)),
      'sin igdbId: UUIDv7 determinista',
    );
    assert.equal(
      rows(target, 'games', `title = 'Repetido'`).length,
      2,
      'dos juegos con el mismo título',
    );
    assert.ok(row(target, 'playthroughs', legacyUuid('iterations', ids.pt1)));
    assert.ok(row(target, 'radar_games', 'igdb:999'));
    assert.ok(row(target, 'generated_memories', 'month:2024-01'));
    assert.ok(row(target, 'external_checks', `${game}:steam_appid`));
    const map = target.db.$client
      .prepare(`SELECT newId FROM local_legacy_ids WHERE legacyTable = 'sessions' AND legacyId = ?`)
      .get(ids.session);
    assert.equal(map?.newId, legacyUuid('sessions', ids.session));
  });

  it('relojes: antiguos, firmados legacy, todas las columnas explícitas, syncDirty = 1', () => {
    const { db } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const now = target.clock.now();
    for (const entry of syncedEntries) {
      for (const r of rows(target, entry.name)) {
        assert.equal(parseClock(String(r.syncCreated)).dev, LEGACY_DEVICE_SHORT_ID);
        assert.ok(String(r.syncUpdated) < now, `${entry.name}: una edición de la 2.0 gana`);
        assert.equal(r.syncDirty, 1);
      }
    }
    // Las columnas sin origen llevan BOTTOM; las demás, el reloj de la fila.
    const session = rows(target, 'sessions')[0];
    assert.deepEqual(Object.keys(JSON.parse(String(session.syncFields))), ['closedBy']);
    const game = row(target, 'games', gameIdForIgdb(100)) as Raw;
    assert.equal(game.syncFields, '{}');
  });

  it('playthroughs: orden de syncCreated = id antiguo; etiqueta propia solo si no es la automática', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const pt1 = row(target, 'playthroughs', legacyUuid('iterations', ids.pt1)) as Raw;
    const pt2 = row(target, 'playthroughs', legacyUuid('iterations', ids.pt2)) as Raw;
    assert.ok(String(pt1.syncCreated) < String(pt2.syncCreated));
    assert.equal(pt1.customLabel, null);
    assert.equal(pt2.customLabel, 'Segunda vuelta');
    // "Playthrough 3" en la posición 1 se conserva como etiqueta propia.
    assert.equal(
      (row(target, 'playthroughs', legacyUuid('iterations', ids.promotedPt)) as Raw).customLabel,
      'Playthrough 3',
    );
  });

  it('horas manuales con sesiones: el total que enseña la 1.x se conserva', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    const report = importInto(db, target);
    assert.equal(
      (row(target, 'playthroughs', legacyUuid('iterations', ids.pt1)) as Raw).manualHours,
      12.5,
    );
    assert.equal(report.validation.checks['playthrough: horas'].differences, 0);
    assert.ok(report.validation.checks['playthrough: horas'].compared >= 4);
  });

  it('plan: planeado → plan_entries viva sin su iteración vacía; promocionado → con lápida', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    const report = importInto(db, target);
    const planned = row(target, 'plan_entries', gameIdForIgdb(200)) as Raw;
    assert.equal(planned.syncDeleted, null);
    assert.equal(planned.plannedAt, T + 30 * DAY);
    assert.equal(planned.pinnedAt, T + 31 * DAY);
    assert.equal(planned.note, 'por qué lo quiero');
    assert.equal(planned.sortKey, null);
    assert.equal(row(target, 'playthroughs', legacyUuid('iterations', ids.plannedPt)), undefined);
    assert.equal(
      report.source.iterations.discarded[
        'iteración vacía de un juego planeado (la sustituye plan_entries, F-12)'
      ],
      1,
    );

    const promoted = row(target, 'plan_entries', gameIdForIgdb(300)) as Raw;
    assert.ok(promoted.syncDeleted !== null, 'con lápida');
    assert.ok(String(promoted.syncDeleted) > String(promoted.syncCreated));
    assert.equal(promoted.note, 'nota del plan');
    assert.equal(promoted.plannedAt, T + 40 * DAY);
    assert.equal(rows(target, 'state_events', `type = 'plan_to_play'`).length, 0);
  });

  it('fecha desconocida: el artefacto del alta pasa a datePrecision = unknown, una vez', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const [event] = rows(
      target,
      'state_events',
      `playthroughId = '${legacyUuid('iterations', ids.noIgdbPt)}'`,
    );
    assert.equal(event.datePrecision, 'unknown');
    // El completed de la promoción también (cae junto a promotedAt).
    const [promoted] = rows(
      target,
      'state_events',
      `playthroughId = '${legacyUuid('iterations', ids.promotedPt)}'`,
    );
    assert.equal(promoted.datePrecision, 'unknown');
  });

  it('sesiones: deviceId legacy, isManual → legacy_manual, latido → lastSeenAt; la de emulador sin asignar', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    assert.ok(row(target, 'devices', 'legacy'));
    const pending = row(target, 'sessions', legacyUuid('sessions', ids.pending)) as Raw;
    assert.equal(pending.playthroughId, null);
    assert.equal(pending.emulatorId, legacyUuid('emulators', ids.emulator));
    assert.equal(pending.deviceId, 'legacy');
    assert.equal(pending.closedBy, null);
    assert.equal(rows(target, 'sessions', `source = 'legacy_manual'`).length, 1);
    const s = row(target, 'sessions', legacyUuid('sessions', ids.session)) as Raw;
    assert.equal(s.lastSeenAt, s.endedAt);
  });

  it('logros: catálogo mixto separado por fuente, desbloqueos de las tres fuentes', () => {
    const { db } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const game = gameIdForIgdb(100);
    const steam = JSON.parse(
      String((row(target, 'achievement_catalogs', `${game}:steam`) as Raw).items),
    ) as Raw[];
    const ra = JSON.parse(
      String((row(target, 'achievement_catalogs', `${game}:ra`) as Raw).items),
    ) as Raw[];
    assert.deepEqual(
      steam.map((i) => i.apiName),
      ['ACH_WIN', 'ACH_HIDDEN'],
    );
    assert.equal(steam[1].hidden, true);
    assert.deepEqual(
      ra.map((i) => i.apiName),
      ['9001'],
    );
    const origins = rows(target, 'achievement_unlocks')
      .map((u) => `${String(u.source)}/${String(u.origin)}`)
      .sort();
    assert.deepEqual(origins, ['ra/ra', 'steam/emu@legacy', 'steam/emu@legacy', 'steam/steam']);
    assert.ok(row(target, 'achievement_unlocks', `${game}:steam:ACH_WIN:emu@legacy`));
    // Las comprobaciones de catálogo, por la fuente cuyo catálogo existe.
    assert.ok(row(target, 'external_checks', `${game}:steam_achievements`));
    assert.ok(row(target, 'external_checks', `${game}:ra_achievements`));
    assert.ok(row(target, 'external_checks', `${game}:steam_unlocks`));
    // Solo RA: el sello de desbloqueos lo cubre ra_achievements.
    assert.equal(row(target, 'external_checks', `${gameIdForIgdb(400)}:steam_unlocks`), undefined);
    assert.equal(
      (row(target, 'external_checks', `${gameIdForIgdb(400)}:ra_achievements`) as Raw).status,
      'empty',
    );
  });

  it('overrides en games y en game_metadata; curiosidades y recaps', () => {
    const { db } = richSource();
    const target = track(openTarget());
    const report = importInto(db, target);
    const id = gameIdForIgdb(100);
    const game = row(target, 'games', id) as Raw;
    const meta = row(target, 'game_metadata', id) as Raw;
    assert.equal(game.coverOverride, 'https://img/cover.jpg');
    assert.equal(meta.coverUrl, 'https://img/cover.jpg');
    assert.equal(game.genresOverride, '["RPG","Acción"]');
    assert.equal(game.steamAppIdSource, 'manual');
    assert.equal(game.sgdbIdSource, 'manual');
    assert.equal(game.saveKey, '100');
    assert.equal((row(target, 'game_curiosities', id) as Raw).items, '["primera","segunda"]');
    assert.equal(report.facts['recaps con sourceHash 1.x sin recalcular (pendiente)'], 1);
    assert.equal(report.source.save_backups.read, 1);
    assert.equal(rows(target, 'save_backups').length, 0);
  });

  it('instalaciones: solo con claimInstalls y solo las rutas que existen, por la puerta', () => {
    const { db } = richSource();
    db.game({
      title: 'Instalado',
      igdbId: 500,
      executablePath: 'C:/juego/j.exe',
      installDirectory: 'C:/juego',
      installSizeBytes: 123,
    });
    db.game({ title: 'De otro PC', igdbId: 600, executablePath: 'D:/otro/o.exe' });
    const target = track(openTarget());
    const exists = (p: string): boolean => p.startsWith('C:/');
    const report = importInto(db, target, { claimInstalls: true, pathExists: exists, now: T });
    assert.deepEqual(report.installs, { games: 1, emulators: 1, missing: 1, alreadyPresent: 0 });
    const install = rows(target, 'game_installs')[0];
    assert.equal(install.deviceId, target.deviceId);
    assert.equal(install.installSizeBytes, 123);
    assert.notEqual(
      parseClock(String(install.syncCreated)).dev,
      LEGACY_DEVICE_SHORT_ID,
      'reloj de ahora',
    );
    // Volver a importar no toca lo reclamado.
    const again = importInto(db, target, { claimInstalls: true, pathExists: exists, now: T + DAY });
    assert.equal(again.installs?.alreadyPresent, 2);
    assert.equal(rows(target, 'game_installs')[0].lastVerifiedAt, T);
  });
});

describe('importador 1.x → 2.0: bloqueos (§19.7)', () => {
  it('sesión abierta: aborta diciendo cuántas, salvo la opción de desarrollo', () => {
    const { db, ids } = richSource();
    db.insert('sessions', {
      iterationId: ids.pt1,
      startedAt: T + 100 * DAY,
      lastHeartbeatAt: T + 100 * DAY + 60_000,
      startedBy: 'watcher',
      datePrecision: 'datetime',
    });
    const target = track(openTarget());
    assert.throws(
      () => importInto(db, target),
      (e: unknown) => e instanceof ImportBlockedError && /1 sesión/.test((e as Error).message),
    );
    assert.equal(rows(target, 'games').length, 0);
    const report = importInto(db, target, { devCloseOpenSessions: true });
    assert.equal(report.validation.ok, true);
    const closed = rows(target, 'sessions', `startedAt = ${T + 100 * DAY}`)[0];
    assert.equal(closed.endedAt, T + 100 * DAY + 60_000);
    assert.equal(closed.durationSec, 60);
  });

  it('buzón con órdenes pendientes: aborta, salvo la opción de desarrollo', () => {
    const { db } = richSource();
    db.insert('plan_mailbox', { type: 'pin', payload: '{}', createdAt: T });
    const target = track(openTarget());
    assert.throws(() => importInto(db, target), ImportBlockedError);
    assert.equal(importInto(db, target, { devIgnorePendingMailbox: true }).validation.ok, true);
  });
});

describe('importador 1.x → 2.0: idempotencia, determinismo y validación', () => {
  it('dos ejecuciones sobre el mismo destino lo dejan idéntico', () => {
    const { db } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const first = dump(target, true);
    const second = importInto(db, target);
    assert.equal(dump(target, true), first);
    for (const [table, c] of Object.entries(second.target)) {
      assert.equal(c.inserted, 0, table);
      assert.equal(c.alreadyPresentDifferent, 0, table);
    }
  });

  it('dos destinos distintos desde el mismo origen: filas sincronizadas idénticas byte a byte', () => {
    const { db } = richSource();
    const a = track(openTarget());
    const b = track(openTarget());
    importInto(db, a);
    importInto(db, b);
    assert.equal(dump(a), dump(b));
  });

  it('la validación detecta un valor derivado alterado a propósito (horas)', () => {
    const { db } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    target.db.$client
      .prepare(
        `UPDATE sessions SET durationSec = durationSec + 1 WHERE playthroughId IS NOT NULL AND source = 'measured' AND durationSec = 5400`,
      )
      .run();
    const report = validateImport(target.db.$client, planLegacyImport(db.client));
    assert.equal(report.ok, false);
    assert.ok(report.checks['playthrough: horas'].differences >= 1);
    assert.ok(report.checks['sesiones: segundos totales'].differences === 1);
    assert.ok(report.columns.tables.sessions.durationSec.differences === 1);
  });

  it('la conciliación columna a columna detecta una nota, una valoración y un logro del catálogo alterados', () => {
    const { db, ids } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const client = target.db.$client;
    client.prepare(`UPDATE games SET notes = 'otra' WHERE id = ?`).run(gameIdForIgdb(100));
    client
      .prepare(`UPDATE playthroughs SET rating = 2 WHERE id = ?`)
      .run(legacyUuid('iterations', ids.pt1));
    const catalogId = `${gameIdForIgdb(100)}:steam`;
    const items = JSON.parse(
      String((row(target, 'achievement_catalogs', catalogId) as Raw).items),
    ) as Raw[];
    items[0].displayName = 'Cambiado';
    client
      .prepare('UPDATE achievement_catalogs SET items = ? WHERE id = ?')
      .run(JSON.stringify(items), catalogId);

    const report = validateImport(client, planLegacyImport(db.client));
    assert.equal(report.ok, false);
    // Nada de esto entra en un cálculo: solo lo ve la conciliación.
    assert.equal(report.differenceCount, 0);
    assert.equal(report.columns.differences, 3);
    assert.equal(report.columns.tables.games.notes.differences, 1);
    assert.equal(report.columns.tables.iterations.rating.differences, 1);
    assert.equal(report.columns.tables.achievements.displayName.differences, 1);
    const sample = report.columns.sample
      .map((d) => `${d.legacyTable}.${d.column}#${String(d.legacyId)}`)
      .sort();
    assert.deepEqual(sample, [
      `achievements.displayName#${ids.steamAch}`,
      `games.notes#${ids.game}`,
      `iterations.rating#${ids.pt1}`,
    ]);
    // El informe no lleva contenido.
    assert.ok(!JSON.stringify(report.columns.sample).includes('Cambiado'));
  });

  it('nunca pisa una fila ya editada en el destino: la conserva y la validación lo dice', () => {
    const { db } = richSource();
    const target = track(openTarget());
    importInto(db, target);
    const id = gameIdForIgdb(100);
    target.store.patch('games', id, { notes: 'editada en la 2.0' });
    const before = dump(target, true);
    assert.throws(
      () => importInto(db, target),
      (e: unknown) =>
        e instanceof ImportValidationError &&
        e.report.target.games.alreadyPresentDifferent === 1 &&
        e.report.validation.columns.tables.games.notes.differences === 1,
    );
    assert.equal((row(target, 'games', id) as Raw).notes, 'editada en la 2.0');
    assert.equal(dump(target, true), before, 'la transacción fallida no deja nada');
  });

  it('una referencia rota en el origen aborta sin escribir', () => {
    const { db } = richSource();
    db.client.exec('PRAGMA foreign_keys = OFF');
    db.insert('state_events', {
      iterationId: 9999,
      type: 'started',
      occurredAt: T,
      datePrecision: 'day',
    });
    const target = track(openTarget());
    assert.throws(() => importInto(db, target), /referencias rotas.*state_events.iterationId: 1/);
    assert.equal(rows(target, 'games').length, 0);
  });
});
