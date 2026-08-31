import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import {
  applyRemotePending,
  listRemotePending,
  pushPendingMigrations,
  readLocalMigrations,
  REBUILD_MARKER,
  selectPendingByName,
} from '../migrationSync';

// QUE LE FALTA A UNA BASE — el criterio compartido por las tres puertas que
// deciden si una migracion esta pendiente: el push al remoto
// (listRemotePending), el guardarrail de reconstrucciones de db/index.ts y el
// migrador de drizzle que acaba corriendo.
//
// Sin base de datos y sin electron a proposito: lo que se prueba aqui es la
// DECISION, y la decision solo mira la carpeta de migraciones y la lista de
// nombres ya aplicados. Las carpetas son de mentira (un migration.sql con dos
// lineas), que es exactamente lo que readLocalMigrations lee.

const carpetasCreadas: string[] = [];

const carpetaDeMigraciones = (migraciones: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-migrations-'));
  carpetasCreadas.push(dir);
  for (const [nombre, sql] of Object.entries(migraciones)) {
    mkdirSync(join(dir, nombre));
    writeFileSync(join(dir, nombre, 'migration.sql'), sql);
  }
  return dir;
};

// El "remoto" para listRemotePending/applyRemotePending: un fichero SQLite de
// verdad (no un doble de Client), en su propia carpeta temporal. Es el mismo
// truco que el andamio de DB (harness.ts) por el mismo motivo — un mock de
// Client comprobaría que se llamó a execute() con el texto esperado, no que
// el DDL de verdad dejó la base en el estado correcto, que es justo lo que
// aquí importa (la tabla puente que sobrevive, el registro que no debe
// escribirse a medias).
const remotosCreados: ReturnType<typeof createClient>[] = [];

const remotoDeMentira = (): ReturnType<typeof createClient> => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-remoto-'));
  carpetasCreadas.push(dir);
  const client = createClient({ url: `file:${join(dir, 'remoto.db')}` });
  remotosCreados.push(client);
  return client;
};

const MIGRATIONS_TABLE = '__drizzle_migrations';

after(() => {
  // Cerrar el cliente ANTES de borrar la carpeta: el mismo orden que
  // harness.ts documenta para el binding nativo de SQLite.
  for (const client of remotosCreados) {
    try {
      client.close();
    } catch {
      // Ya cerrado o medio muerto: solo importaba soltarlo.
    }
  }
  for (const dir of carpetasCreadas) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Un fichero de SQLite que el binding nativo de Windows tarda un
      // instante en soltar tras close() no puede tumbar el resultado de la
      // suite: como mucho queda un temporal huérfano que el SO limpia solo.
    }
  }
});

// Una reconstruccion de tabla, tal cual la escribe drizzle-kit: la tabla
// puente con el prefijo que busca el guardarrail.
const RECONSTRUCCION = `CREATE TABLE \`${REBUILD_MARKER}games\` (\`id\` integer PRIMARY KEY);
--> statement-breakpoint
INSERT INTO \`${REBUILD_MARKER}games\` SELECT * FROM \`games\`;`;

const ADITIVA = 'ALTER TABLE `games` ADD `promoted_at` integer;';

describe('que migraciones estan pendientes', () => {
  it('lo decide el NOMBRE, no la fecha de la carpeta', () => {
    // El caso que rompia el guardarrail: la carpeta de febrero se aplica
    // DESPUES de la de marzo (dos ramas fusionadas, o dos maquinas). Con el
    // criterio viejo —folderMillis por encima del max(created_at) aplicado— la
    // de febrero quedaba por debajo del ultimo aplicado y salia como "no
    // pendiente", asi que su reconstruccion se colaba por el migrador a pelo,
    // sin copia previa ni conteo de filas. Drizzle si la aplica: filtra por
    // nombre.
    const carpeta = carpetaDeMigraciones({
      '20260101000000_primera': ADITIVA,
      '20260201000000_rezagada': RECONSTRUCCION,
      '20260301000000_ultima': ADITIVA,
    });

    const locales = readLocalMigrations(carpeta);
    const aplicadas = new Set(['20260101000000_primera', '20260301000000_ultima']);
    const pendientes = selectPendingByName(locales, aplicadas);

    assert.deepEqual(
      pendientes.map((migracion) => migracion.name),
      ['20260201000000_rezagada'],
    );
    // Y la prueba de que el criterio viejo la habria perdido: su carpeta es
    // ANTERIOR a una que ya esta aplicada.
    const rezagada = locales[1];
    const ultima = locales[2];
    assert.ok(rezagada.folderMillis < ultima.folderMillis);
    // Que es justo la que reconstruye una tabla: lo que el guardarrail busca.
    assert.ok(
      pendientes.some((migracion) =>
        migracion.statements.some((sentencia) => sentencia.includes(REBUILD_MARKER)),
      ),
    );
  });

  it('dos carpetas del MISMO segundo no se tapan la una a la otra', () => {
    // El otro borde del criterio por fecha: la comparacion era estricta (`>`),
    // asi que un empate al segundo dejaba fuera a la segunda — y drizzle,
    // yendo por nombre, la aplicaba igual.
    const carpeta = carpetaDeMigraciones({
      '20260101000000_gemela_a': ADITIVA,
      '20260101000000_gemela_b': RECONSTRUCCION,
    });

    const locales = readLocalMigrations(carpeta);
    assert.equal(locales[0].folderMillis, locales[1].folderMillis);

    const pendientes = selectPendingByName(locales, new Set(['20260101000000_gemela_a']));
    assert.deepEqual(
      pendientes.map((migracion) => migracion.name),
      ['20260101000000_gemela_b'],
    );
  });

  it('sin nada aplicado, todo esta pendiente — que es como falla cerrado el guardarrail', () => {
    // db/index.ts usa este mismo camino cuando NO puede leer __drizzle_migrations
    // por un motivo que no sea "no existe la tabla": da por aplicado nada y
    // enruta por la via verificada. Aqui se fija que ese conjunto es todo.
    const carpeta = carpetaDeMigraciones({
      '20260101000000_primera': ADITIVA,
      '20260201000000_segunda': RECONSTRUCCION,
    });

    const pendientes = selectPendingByName(readLocalMigrations(carpeta), new Set<string>());
    assert.equal(pendientes.length, 2);
  });

  it('lo ya aplicado no vuelve a salir aunque cambie de orden en la carpeta', () => {
    const carpeta = carpetaDeMigraciones({
      '20260101000000_primera': ADITIVA,
      '20260201000000_segunda': ADITIVA,
    });

    const pendientes = selectPendingByName(
      readLocalMigrations(carpeta),
      new Set(['20260201000000_segunda', '20260101000000_primera']),
    );
    assert.deepEqual(pendientes, []);
  });
});

// Migraciones de mentira para las dos fases de abajo. `demo` hace de tabla de
// negocio cualquiera — lo que importa no es el esquema, es la FORMA del SQL:
// una reconstrucción de drizzle-kit (tabla puente __new_* + copia + drop +
// rename) y sus dos desenlaces posibles.
const CREA_DEMO = 'CREATE TABLE `demo` (`id` integer PRIMARY KEY, `val` text);';

const RECONSTRUYE_BIEN = `CREATE TABLE \`${REBUILD_MARKER}demo\` (\`id\` integer PRIMARY KEY, \`val\` text, \`extra\` text);
--> statement-breakpoint
INSERT INTO \`${REBUILD_MARKER}demo\` (\`id\`, \`val\`) SELECT \`id\`, \`val\` FROM \`demo\`;
--> statement-breakpoint
DROP TABLE \`demo\`;
--> statement-breakpoint
ALTER TABLE \`${REBUILD_MARKER}demo\` RENAME TO \`demo\`;`;

// La reconstrucción que se queda A MEDIAS: crea la tabla puente y copia, pero
// falta el DROP + RENAME final — el olvido real que deja un `__new_*` vivo en
// sqlite_master sin que client.migrate() lance ningún error (el SQL es
// perfectamente válido, solo que incompleto).
const RECONSTRUYE_A_MEDIAS = `CREATE TABLE \`${REBUILD_MARKER}demo\` (\`id\` integer PRIMARY KEY, \`val\` text);
--> statement-breakpoint
INSERT INTO \`${REBUILD_MARKER}demo\` SELECT * FROM \`demo\`;`;

// SQL con un error de sintaxis real: hace que client.migrate() lance.
const ROTA = 'CREATE TABLE demo_rota (;';

const NUNCA_DEBERIA_EXISTIR = 'CREATE TABLE `nunca_deberia_existir` (`id` integer PRIMARY KEY);';

const hayTabla = async (
  client: ReturnType<typeof createClient>,
  nombre: string,
): Promise<boolean> => {
  const { rows } = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [nombre],
  });
  return rows.length > 0;
};

// applyRemotePending() por sí sola NUNCA crea la tabla de control — eso es
// trabajo de listRemotePending (fase 1). En producción las dos fases siempre
// van pegadas (pushPendingMigrations, o el arranque que llama a la primera
// para conseguir la lista que le pasa a la segunda), así que un test que
// llame a applyRemotePending SOLA tiene que sentar la tabla ella misma —
// exactamente lo que hace este helper, con el mismo DDL que usa la función
// real.
const conTablaDeControl = async (client: ReturnType<typeof createClient>): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT
    )
  `);
};

const filasRegistradas = async (
  client: ReturnType<typeof createClient>,
): Promise<{ name: unknown; hash: unknown; applied_at: unknown }[]> => {
  const { rows } = await client.execute(`SELECT name, hash, applied_at FROM ${MIGRATIONS_TABLE}`);
  return rows.map((row) => ({ name: row.name, hash: row.hash, applied_at: row.applied_at }));
};

describe('listRemotePending contra un remoto real', () => {
  // QUÉ BLINDA: que la fase de LECTURA hable con una base de verdad — crea su
  // propia tabla de control si hace falta y decide lo pendiente por el mismo
  // criterio (nombre) que selectPendingByName, ya probado arriba en aislado.
  // QUÉ ES REAL Y QUÉ ES DOBLE: el "remoto" es un fichero SQLite real vía
  // @libsql/client (el mismo tipo Client que recibe la función en
  // producción); nada de esto está doblado.
  it('sin tabla de control todavía, la crea y todo sale pendiente', async () => {
    const client = remotoDeMentira();
    const carpeta = carpetaDeMigraciones({ '20260101000000_crea_demo': CREA_DEMO });

    const pendientes = await listRemotePending(client, carpeta);

    assert.deepEqual(
      pendientes.map((m) => m.name),
      ['20260101000000_crea_demo'],
    );
    assert.ok(await hayTabla(client, MIGRATIONS_TABLE));
  });

  it('con una ya registrada en el remoto, solo salen las que faltan por NOMBRE', async () => {
    const client = remotoDeMentira();
    const carpeta = carpetaDeMigraciones({
      '20260101000000_crea_demo': CREA_DEMO,
      '20260201000000_reconstruye': RECONSTRUYE_BIEN,
    });

    // Se marca la primera como ya aplicada a mano, sin de verdad ejecutar su
    // DDL — lo único que listRemotePending mira es el nombre en la tabla de
    // control, no si la tabla `demo` existe.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT
      )
    `);
    await client.execute({
      sql: `INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)`,
      args: ['hash-de-mentira', 0, '20260101000000_crea_demo', '2026-01-01T00:00:00.000Z'],
    });

    const pendientes = await listRemotePending(client, carpeta);
    assert.deepEqual(
      pendientes.map((m) => m.name),
      ['20260201000000_reconstruye'],
    );
  });
});

describe('applyRemotePending contra un remoto real', () => {
  // QUÉ BLINDA: las tres decisiones documentadas encima de applyRemotePending
  // — el registro NUNCA viaja en el mismo lote que el DDL, la verificación de
  // tablas puente huérfanas frena el registro aunque client.migrate() no haya
  // lanzado ningún error, y un fallo de SQL dentro de una migración no deja
  // rastro ni deja que las siguientes se intenten.
  // QUÉ ES REAL Y QUÉ ES DOBLE: DDL de verdad contra un SQLite de verdad — el
  // mismo camino (client.migrate + verificación + INSERT aparte) que corre
  // contra Turso en producción. Nada doblado aquí tampoco.

  it('aplica el DDL de verdad y registra hash/nombre/fecha SOLO tras verificar', async () => {
    const client = remotoDeMentira();
    await conTablaDeControl(client);
    const carpeta = carpetaDeMigraciones({ '20260101000000_crea_demo': CREA_DEMO });
    const [migracion] = readLocalMigrations(carpeta);

    const resultado = await applyRemotePending(client, [migracion]);

    assert.deepEqual(resultado.applied, ['20260101000000_crea_demo']);
    assert.ok(await hayTabla(client, 'demo'), 'el DDL de verdad se ejecutó');
    const filas = await filasRegistradas(client);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].name, '20260101000000_crea_demo');
    assert.equal(filas[0].hash, migracion.hash);
    assert.ok(filas[0].applied_at, 'se sella con fecha de aplicación');
  });

  it('una reconstrucción que SÍ termina en RENAME no deja tabla puente y SÍ se registra', async () => {
    // El caso que la verificación no debe confundir con "a medias": una
    // migración de reconstrucción bien escrita crea `__new_demo` de paso,
    // pero la deja renombrada a `demo` antes de terminar — cero rastro en
    // sqlite_master del prefijo, así que debe pasar limpia.
    const client = remotoDeMentira();
    await conTablaDeControl(client);
    const carpeta = carpetaDeMigraciones({
      '20260101000000_crea_demo': CREA_DEMO,
      '20260201000000_reconstruye_bien': RECONSTRUYE_BIEN,
    });
    const migraciones = readLocalMigrations(carpeta);

    await applyRemotePending(client, migraciones);

    assert.ok(await hayTabla(client, 'demo'));
    assert.ok(!(await hayTabla(client, `${REBUILD_MARKER}demo`)), 'sin tabla puente colgando');
    const filas = await filasRegistradas(client);
    assert.deepEqual(
      filas.map((f) => f.name),
      ['20260101000000_crea_demo', '20260201000000_reconstruye_bien'],
    );
  });

  it('una reconstrucción a medias deja `__new_*` vivo: NO se registra y el error lo dice', async () => {
    // El bug real que esta verificación existe para atrapar: client.migrate()
    // no lanza (el SQL es válido), pero la migración olvidó el DROP+RENAME
    // final. Sin este chequeo, se registraría como aplicada con la base
    // partida en dos tablas a medio copiar.
    const client = remotoDeMentira();
    await conTablaDeControl(client);
    const carpeta = carpetaDeMigraciones({
      '20260101000000_crea_demo': CREA_DEMO,
      '20260201000000_a_medias': RECONSTRUYE_A_MEDIAS,
    });
    const migraciones = readLocalMigrations(carpeta);

    await assert.rejects(
      () => applyRemotePending(client, migraciones),
      /20260201000000_a_medias.*A MEDIAS.*__new_demo/s,
    );

    assert.ok(
      await hayTabla(client, `${REBUILD_MARKER}demo`),
      'la tabla puente sigue ahí, sin tocar',
    );
    const filas = await filasRegistradas(client);
    // Ni rastro del registro: ni de la que se quedó a medias NI de la
    // anterior, que sí se aplicó bien — applyRemotePending() no vuelve a
    // tocar la primera, pero tampoco es su trabajo deshacerla.
    assert.deepEqual(
      filas.map((f) => f.name),
      ['20260101000000_crea_demo'],
    );
  });

  it('un fallo de SQL no registra nada y la migración SIGUIENTE ni se intenta', async () => {
    const client = remotoDeMentira();
    const carpeta = carpetaDeMigraciones({
      '20260101000000_rota': ROTA,
      '20260201000000_nunca_deberia_existir': NUNCA_DEBERIA_EXISTIR,
    });
    const migraciones = readLocalMigrations(carpeta);

    await assert.rejects(
      () => applyRemotePending(client, migraciones),
      /fallo aplicando 20260101000000_rota contra Turso/,
    );

    assert.ok(
      !(await hayTabla(client, 'nunca_deberia_existir')),
      'el for se para en el primer fallo: la segunda migración nunca corre',
    );
    const { rows } = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = '${MIGRATIONS_TABLE}'`,
    );
    // La tabla de control puede ni existir todavía (nadie llamó a
    // listRemotePending en este test) — lo único que importa es que si
    // existe, está vacía.
    if (rows.length > 0) {
      const filas = await filasRegistradas(client);
      assert.deepEqual(filas, []);
    }
  });

  it('pushPendingMigrations encadena las dos fases: aplicada, deja de salir como pendiente', async () => {
    const client = remotoDeMentira();
    const carpeta = carpetaDeMigraciones({ '20260101000000_crea_demo': CREA_DEMO });

    const resultado = await pushPendingMigrations(client, carpeta);
    assert.deepEqual(resultado.applied, ['20260101000000_crea_demo']);

    const pendientesTrasAplicar = await listRemotePending(client, carpeta);
    assert.deepEqual(pendientesTrasAplicar, []);
  });
});
