import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';
import { MAX_AHEAD_MS, parseClock } from '../../../../../shared/sync/clock';
import { maxStoredClock } from '../../connection';
import { openTestDb, tempDir } from '../../__tests__/helpers';
import { ImportBlockedError, LegacyNulTextError, importLegacyDatabase, planLegacyImport } from '..';
import { readLegacyData } from '../source';
import { copySourceConsistently } from '../sourceCopy';
import { DAY, LegacyDb } from './fixture';

// Lo que el importador comprueba del ORIGEN antes de construir el plan, y cómo
// lo lee y lo copia (revisión: hallazgos 1 y 2 y las sospechas sobre
// source.ts, build.ts, index.ts y el script). Bases 1.x sintéticas.

/** "Ahora" del PC que importa. */
const NOW = Date.UTC(2026, 10, 14);

const open: { close(): void }[] = [];
const track = <V extends { close(): void }>(value: V): V => {
  open.push(value);
  return value;
};
const dirs: { cleanup(): void }[] = [];
afterEach(() => {
  for (const item of open.splice(0)) item.close();
  for (const dir of dirs.splice(0)) dir.cleanup();
});
const newDir = (): string => {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
};

// Revisión, hallazgo 1 (venía de __review__/importer.review.test.ts).
describe('importador: sellos de máquina de la 1.x en el futuro', () => {
  it('lo importado no arrastra el reloj del dispositivo por delante de la hora real', () => {
    // La 1.x se usó un día con la hora del PC adelantada (BIOS sin pila, o la
    // hora cambiada a mano para un juego): el alta de un juego quedó sellada en
    // 2028. Sesiones y altas normales, en el pasado.
    const legacy = track(new LegacyDb());
    const ok = legacy.game({ title: 'Normal', addedAt: NOW - 30 * DAY });
    const it1 = legacy.iteration(ok);
    legacy.session(it1, NOW - 10 * DAY, 2);
    const future = Date.UTC(2028, 0, 1);
    legacy.game({ title: 'Con la hora mal', addedAt: future, steamAppIdCheckedAt: future });

    const target = track(openTestDb({ wall: () => NOW }));
    const report = importLegacyDatabase({ source: legacy.client, target, now: NOW });

    // Al abrir la base la próxima vez, el reloj arranca en el mayor reloj guardado.
    const max = parseClock(maxStoredClock(target.db)).ms;
    assert.ok(
      max <= NOW + MAX_AHEAD_MS,
      `el reloj importado está en ${new Date(max).toISOString()}: todas las escrituras ` +
        'locales posteriores saldrían con ese reloj',
    );
    // El techo es el mayor sello que no pasa de ahora (el final de la sesión).
    assert.ok(max <= NOW - 10 * DAY + 2 * 3_600_000);
    // Se cuentan en el informe…
    assert.equal(report.sourceChecks.futureStamps, 2);
    assert.deepEqual(report.sourceChecks.futureStampsByColumn, {
      'games.addedAt': 1,
      'games.steamAppIdCheckedAt': 1,
    });
    assert.equal(report.sourceChecks.nulTexts, 0);
    // …y los DATOS se conservan tal cual: solo se recorta el reloj.
    const added = target.db.$client.prepare(`SELECT max("addedAt") AS m FROM games`).get() as {
      m: number;
    };
    assert.equal(Number(added.m), future);
  });

  it('sin sellos futuros, el techo no depende de la hora de la importación (determinista)', () => {
    const legacy = track(new LegacyDb());
    const game = legacy.game({ addedAt: NOW - 30 * DAY });
    legacy.session(legacy.iteration(game), NOW - 10 * DAY, 2);
    const a = planLegacyImport(legacy.client, { now: NOW });
    const b = planLegacyImport(legacy.client, { now: NOW + 400 * DAY });
    assert.equal(a.context.data.ceilingMs, b.context.data.ceilingMs);
    assert.deepEqual(a.context.data.futureStamps, {});
  });
});

// Revisión, hallazgo 2 (venía de __review__/importer.review.test.ts). El test
// de la revisión admitía "llega entera o la importación se niega": se niega,
// porque ni este driver ni el de la 1.x pueden leer el texto entero.
describe('importador: textos con carácter NUL en la 1.x', () => {
  it('se niega a importar, dice cuántos y dónde, y no vuelca el contenido', () => {
    const legacy = track(new LegacyDb());
    const note = 'parte 1\u0000parte secreta que se perdería';
    legacy.game({ title: 'Juego', addedAt: NOW - DAY, notes: note });
    legacy.game({ title: 'Otro\u0000', addedAt: NOW - DAY });
    const sourceBytes = Number(
      (
        legacy.client.prepare('SELECT length(CAST(notes AS BLOB)) AS n FROM games').get() as {
          n: number;
        }
      ).n,
    );
    assert.ok(sourceBytes > 'parte 1'.length, 'el origen guarda el texto entero');

    const target = track(openTestDb({ wall: () => NOW }));
    let thrown: unknown = null;
    try {
      importLegacyDatabase({ source: legacy.client, target, now: NOW });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof LegacyNulTextError);
    assert.ok(thrown instanceof ImportBlockedError, 'el script lo trata como un bloqueo');
    assert.deepEqual(thrown.counts, { 'games.title': 1, 'games.notes': 1 });
    assert.match(thrown.message, /2 texto\(s\)/);
    assert.match(thrown.message, /games\.notes: 1/);
    assert.doesNotMatch(thrown.message, /secreta|parte 1|Otro/);
    // No se ha escrito nada.
    assert.equal(
      Number(
        (target.db.$client.prepare('SELECT count(*) AS n FROM games').get() as { n: number }).n,
      ),
      0,
    );
  });

  it('el driver corta al leer: por eso no basta con comparar lo leído', () => {
    const db = track(new DatabaseSync(':memory:'));
    db.exec('CREATE TABLE t (x TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('a\u0000b');
    const row = db.prepare('SELECT x, length(CAST(x AS BLOB)) AS n FROM t').get() as {
      x: string;
      n: number;
    };
    assert.equal(row.x, 'a');
    assert.equal(Number(row.n), 3);
  });
});

// Revisión, sospecha "lectura del origen sin foto coherente" (source.ts).
describe('importador: lectura del origen en una sola transacción', () => {
  it('una escritura de otro proceso a mitad de la lectura no se ve', () => {
    const dir = newDir();
    const path = join(dir, 'origen.db');
    const seed = new LegacyDb();
    const game = seed.game({ addedAt: NOW - 30 * DAY });
    const iteration = seed.iteration(game);
    seed.session(iteration, NOW - 10 * DAY, 1);
    seed.client.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    seed.close();

    const writer = track(new DatabaseSync(path));
    writer.exec('PRAGMA journal_mode = WAL');
    const reader = track(new DatabaseSync(path, { readOnly: true }));
    // Tras leer los juegos, "otro proceso" añade una sesión: sin transacción,
    // la SELECT de sesiones (posterior) la vería.
    let poked = false;
    const spy = new Proxy(reader, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!sql.includes('FROM "games" ORDER BY')) return statement;
            return {
              all: () => {
                const result = statement.all();
                if (!poked) {
                  poked = true;
                  writer
                    .prepare(
                      `INSERT INTO sessions ("iterationId", "startedAt", "endedAt", "durationSec",
                         "lastHeartbeatAt", "startedBy", "datePrecision")
                       VALUES (?, ?, ?, 60, ?, 'watcher', 'datetime')`,
                    )
                    .run(iteration, NOW - DAY, NOW - DAY + 60_000, NOW - DAY + 60_000);
                }
                return result;
              },
            };
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const data = readLegacyData(spy, { now: NOW });
    assert.ok(poked, 'la escritura de "otro proceso" ocurrió a mitad de la lectura');
    assert.equal(data.sessions.length, 1, 'la lectura ve la foto de su inicio');
    assert.equal(reader.isTransaction, false, 'la transacción de lectura se cierra');
    const after = reader.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number };
    assert.equal(Number(after.n), 2);
  });
});

// Revisión, sospecha sobre build.ts: `Math.min(...filas)` desbordaba la pila.
describe('importador: orígenes grandes', () => {
  it('construye el plan con más filas de las que caben como argumentos', () => {
    const legacy = track(new LegacyDb());
    const game = legacy.game({ addedAt: NOW - 400 * DAY });
    const iteration = legacy.iteration(game);
    const insert = legacy.client.prepare(
      `INSERT INTO sessions ("iterationId", "startedAt", "endedAt", "durationSec",
         "lastHeartbeatAt", "startedBy", "datePrecision", "isManual")
       VALUES (?, ?, ?, 60, ?, 'watcher', 'datetime', 0)`,
    );
    legacy.client.exec('BEGIN');
    // Más de lo que admite `Math.min(...array)` en V8 (~120 000 argumentos).
    const n = 160_000;
    for (let i = 0; i < n; i++) {
      const start = NOW - 300 * DAY + i * 120_000;
      insert.run(iteration, start, start + 60_000, start + 60_000);
    }
    legacy.client.exec('COMMIT');
    const plan = planLegacyImport(legacy.client, { now: NOW });
    assert.equal(plan.rows.get('sessions')?.length, n);
    const device = plan.rows.get('devices')?.[0];
    assert.equal(device?.values.firstSeenAt, NOW - 400 * DAY);
  });
});

// Revisión, sospecha sobre importer/index.ts: la protección del script, en la función.
describe('importador: no toca los datos de la app instalada', () => {
  it('no lee la base EN USO de la app', () => {
    const dir = newDir();
    const appFolder = join(dir, 'Afterplay');
    mkdirSync(appFolder);
    const target = track(openTestDb({ wall: () => NOW }));
    for (const name of ['Afterplay.db', 'afterplay2.db']) {
      assert.throws(
        () => importLegacyDatabase({ source: join(appFolder, name), target, now: NOW }),
        /EN USO/,
      );
    }
    // Tampoco abierta ya: se mira su ruta.
    const live = join(dir, 'Afterplay-dev-x');
    mkdirSync(live);
    const seed = new LegacyDb();
    seed.client.exec(`VACUUM INTO '${join(live, 'Afterplay.db').replace(/'/g, "''")}'`);
    seed.close();
    const opened = track(new DatabaseSync(join(live, 'Afterplay.db'), { readOnly: true }));
    assert.throws(() => importLegacyDatabase({ source: opened, target, now: NOW }), /EN USO/);
    assert.equal(existsSync(join(appFolder, 'Afterplay.db')), false, 'ni se ha creado');
  });

  it('no escribe una base 2.0 dentro de la carpeta de datos de la app ni de sus perfiles', () => {
    const dir = newDir();
    const profile = join(dir, 'Afterplay-dev-v2');
    mkdirSync(profile);
    const target = track(openTestDb({ path: join(profile, 'Afterplay2.db'), wall: () => NOW }));
    const legacy = track(new LegacyDb());
    legacy.game({ addedAt: NOW - DAY });
    assert.throws(
      () => importLegacyDatabase({ source: legacy.client, target, now: NOW }),
      /carpeta de datos de la app/,
    );
    assert.equal(
      Number(
        (target.db.$client.prepare('SELECT count(*) AS n FROM games').get() as { n: number }).n,
      ),
      0,
    );
  });
});

// Fase 10 (§19.6): la única excepción, explícita y estrecha.
describe('importador: el corte escribe solo Afterplay2.db de la carpeta de datos', () => {
  const countGames = (target: ReturnType<typeof openTestDb>): number =>
    Number((target.db.$client.prepare('SELECT count(*) AS n FROM games').get() as { n: number }).n);

  it('con cutover importa en <carpeta de datos>/Afterplay2.db desde una copia', () => {
    const dir = newDir();
    const userData = join(dir, 'Afterplay');
    mkdirSync(join(userData, 'backups'), { recursive: true });
    const copy = join(userData, 'backups', 'Afterplay-precutover.db');
    const seed = new LegacyDb();
    seed.game({ addedAt: NOW - DAY });
    seed.client.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    seed.close();
    const target = track(openTestDb({ path: join(userData, 'Afterplay2.db'), wall: () => NOW }));
    importLegacyDatabase({ source: copy, target, now: NOW, cutover: { userDataDir: userData } });
    assert.equal(countGames(target), 1);
  });

  it('con cutover sigue sin aceptar la base en uso como origen', () => {
    const dir = newDir();
    const userData = join(dir, 'Afterplay');
    mkdirSync(userData);
    const target = track(openTestDb({ path: join(userData, 'Afterplay2.db'), wall: () => NOW }));
    assert.throws(
      () =>
        importLegacyDatabase({
          source: join(userData, 'Afterplay.db'),
          target,
          now: NOW,
          cutover: { userDataDir: userData },
        }),
      /EN USO/,
    );
    assert.equal(existsSync(join(userData, 'Afterplay.db')), false, 'ni se ha creado');
  });

  it('con cutover rechaza cualquier otro destino', () => {
    const dir = newDir();
    const userData = join(dir, 'Afterplay');
    const other = join(dir, 'Afterplay-dev-v2');
    mkdirSync(join(userData, 'backups'), { recursive: true });
    mkdirSync(other);
    const legacy = track(new LegacyDb());
    legacy.game({ addedAt: NOW - DAY });
    const cases = [
      join(userData, 'backups', 'Afterplay2.db'), // otra ruta dentro de la carpeta
      join(userData, 'otra.db'),
      join(other, 'Afterplay2.db'), // la base de OTRO perfil
    ];
    for (const path of cases) {
      const target = track(openTestDb({ path, wall: () => NOW }));
      assert.throws(
        () =>
          importLegacyDatabase({
            source: legacy.client,
            target,
            now: NOW,
            cutover: { userDataDir: userData },
          }),
        /ninguna otra/,
      );
      assert.equal(countGames(target), 0);
    }
    // En memoria tampoco: el corte escribe un fichero real.
    const memory = track(openTestDb({ wall: () => NOW }));
    assert.throws(
      () =>
        importLegacyDatabase({
          source: legacy.client,
          target: memory,
          now: NOW,
          cutover: { userDataDir: userData },
        }),
      /ninguna otra/,
    );
  });

  it('cutover solo vale para una carpeta de datos de la app', () => {
    const dir = newDir();
    const target = track(openTestDb({ path: join(dir, 'Afterplay2.db'), wall: () => NOW }));
    const legacy = track(new LegacyDb());
    assert.throws(
      () =>
        importLegacyDatabase({
          source: legacy.client,
          target,
          now: NOW,
          cutover: { userDataDir: dir },
        }),
      /carpeta de datos de la app/,
    );
  });
});

// Revisión, sospecha sobre scripts/import-1x-to-v2.ts: copiaba solo el `.db`.
describe('importador: copia consistente del origen', () => {
  it('lo confirmado que aún vive en el -wal llega a la copia', () => {
    const dir = newDir();
    const from = join(dir, 'copia.db');
    const writer = track(new DatabaseSync(from));
    writer.exec('PRAGMA journal_mode = WAL');
    // Sin checkpoints automáticos: lo confirmado se queda en el -wal.
    writer.exec('PRAGMA wal_autocheckpoint = 0');
    writer.exec('CREATE TABLE t (x INTEGER)');
    writer.exec('INSERT INTO t VALUES (1), (2), (3)');
    assert.ok(existsSync(`${from}-wal`));

    const raw = join(dir, 'raw.db');
    const copy = join(dir, 'consistente.db');
    copySourceConsistently(from, raw, copy);
    assert.equal(existsSync(raw), false, 'la copia literal se borra');
    assert.equal(existsSync(`${copy}-wal`), false, 'la copia es un solo fichero');
    const read = track(new DatabaseSync(copy, { readOnly: true }));
    const n = read.prepare('SELECT count(*) AS n FROM t').get() as { n: number };
    assert.equal(Number(n.n), 3);
  });
});
