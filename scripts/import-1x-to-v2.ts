import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openLocalDatabase } from '../src/main/db/v2/connection';
import {
  EXPECTED_QUERY_DIFFERENCES,
  ImportBlockedError,
  ImportValidationError,
  importLegacyDatabase,
  type ImportReport,
  type LegacyQueryViews,
} from '../src/main/db/v2/importer';
import { isInsideAppData, isLiveDatabase } from '../src/main/db/v2/importer/appData';
import { copySourceConsistently, removeDatabaseFiles } from '../src/main/db/v2/importer/sourceCopy';

// IMPORTA UNA COPIA DE UNA BASE 1.x A UNA BASE 2.0 NUEVA (AFTERPLAY-2.0.md §19.5).
//
//   npm run db:v2:import -- --out C:\ruta\Afterplay2.db
//   npm run db:v2:import -- --from C:\ruta\copia.db --out C:\ruta\Afterplay2.db
//   ... --device-id <machineId> --claim-installs --dev-close-open-sessions
//   ... --skip-query-validation
//
// Sin --from usa la copia de seguridad más reciente de la app instalada
// (userData/backups/Afterplay-*.db), como seed-dev-profile.ts.
//
// PROTECCIONES, como audit-1x-data.ts:
// - Nunca lee la base EN USO de la app (`Afterplay.db` de su carpeta de datos
//   o de un perfil de desarrollo): solo copias. Y ni siquiera abre la copia en
//   su sitio: la copia antes a la carpeta temporal y trabaja sobre esa.
// - Nunca escribe dentro de la carpeta de datos de la app ni de sus perfiles.
// - Las dos reglas viven en importer/appData.ts y el propio importador las
//   vuelve a comprobar (revisión, sospecha sobre importer/index.ts).
//
// COPIA CONSISTENTE: se copian el `.db` y su `-wal`/`-journal` y se lee una
// copia de un solo fichero sacada con `VACUUM INTO`, sin abrir el origen
// (importer/sourceCopy.ts; revisión, sospecha sobre este script).
//
// VALIDACIÓN CON CONSULTAS (importer/queryValidation.ts): por defecto, antes
// de importar se toma la foto de las lecturas 1.x sobre la copia, con su
// propio código, y el importador la compara con las consultas 2.0. Cuesta unos
// segundos (una ficha por juego) en una operación que se hace una vez, así que
// va siempre salvo `--skip-query-validation` (para iterar rápido en
// desarrollo). Las consultas 1.x necesitan sustituir `src/main/db/index.ts`
// con `mock.module` (legacyQueryHost.ts), que exige
// `--experimental-test-module-mocks`: si falta, el script se relanza con ella.
//
// Imprime recuentos, comprobaciones y diferencias: nunca títulos, notas ni
// rutas personales. Sale con código distinto de cero si la validación falla.

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | null => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const withQueries = !flag('--skip-query-validation');
// `--expose-gc`: la conexión de `@libsql/client` no suelta el fichero hasta
// que el recolector finaliza sus sentencias, y en Windows la copia temporal no
// se podría borrar (legacyQueryHost.ts fuerza esa recolección al cerrar).
const MOCKS = '--experimental-test-module-mocks';
const GC = '--expose-gc';
const missing = [MOCKS, GC].filter((f) => !process.execArgv.includes(f));
if (withQueries && missing.length > 0) {
  // Relanzarse con la opción, con el mismo cargador de tsx y los mismos argumentos.
  const child = spawnSync(
    process.execPath,
    [...missing, ...process.execArgv, ...process.argv.slice(1)],
    {
      stdio: 'inherit',
    },
  );
  process.exit(child.status ?? 1);
}

const fail = (message: string): never => {
  console.error(`\n[import] ${message}\n`);
  process.exit(1);
};

const newestBackup = (): string => {
  const appData = process.env.APPDATA;
  if (!appData) return fail('No encuentro %APPDATA%: indica la copia con --from.');
  const backupsDir = join(appData, 'Afterplay', 'backups');
  if (!existsSync(backupsDir)) return fail('La app instalada no tiene copias de seguridad.');
  const candidates = readdirSync(backupsDir)
    .filter((name) => /^Afterplay-.*\.db$/.test(name))
    .map((name) => ({
      path: join(backupsDir, name),
      mtime: statSync(join(backupsDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) return fail('No hay ninguna copia Afterplay-*.db en backups/.');
  return candidates[0].path;
};

const from = option('--from') ?? newestBackup();
const out = option('--out') ?? fail('Falta --out <fichero 2.0>.');
if (!existsSync(from)) fail('No existe la copia indicada en --from.');
if (isLiveDatabase(from)) fail('Esa es una base EN USO de la app. Usa una copia de seguridad.');
if (isInsideAppData(out))
  fail('--out no puede estar dentro de la carpeta de datos de la app ni de sus perfiles.');
if (!existsSync(dirname(resolve(out)))) fail('La carpeta de --out no existe.');

// Ficheros sueltos en la carpeta temporal del sistema (no una carpeta: la
// limpieza de los tests, `pretest`, solo conoce carpetas de fixtures y esto no
// lo es): la copia literal (`.raw.db` y sus acompañantes) y la consistente
// (`.db`), que se abre en solo lectura. Todo se borra en el finally pase lo
// que pase.
const stem = join(tmpdir(), `afterplay-import-${randomUUID()}`);
const raw = `${stem}.raw.db`;
const copy = `${stem}.db`;
void main().then((code) => process.exit(code));

async function main(): Promise<number> {
  let exitCode: number;
  try {
    copySourceConsistently(from, raw, copy);
    // La foto 1.x primero (asíncrona, conexión propia que se cierra al acabar);
    // después la importación, que abre la copia en solo lectura.
    let legacyQueryViews: LegacyQueryViews | undefined;
    if (withQueries) {
      const { collectLegacyViewsFrom } = await import('../src/main/db/v2/importer/legacyQueryHost');
      legacyQueryViews = await collectLegacyViewsFrom(copy);
      console.log(`\n[import] lecturas 1.x tomadas en ${legacyQueryViews.elapsedMs} ms`);
    }
    exitCode = runImport(legacyQueryViews);
  } finally {
    await removeCopy();
  }
  return exitCode;
}

/**
 * Borra la copia temporal. La conexión de `@libsql/client` de la foto 1.x no
 * suelta el fichero hasta que el recolector finaliza sus sentencias (en
 * Windows, EBUSY): se reintenta forzando la recolección (`--expose-gc`).
 */
async function removeCopy(): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  for (let attempt = 0; ; attempt++) {
    try {
      for (const file of [copy, raw]) removeDatabaseFiles(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt >= 20) throw error;
      gc?.();
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}

function runImport(legacyQueryViews: LegacyQueryViews | undefined): number {
  let exitCode = 0;
  const target = openLocalDatabase({
    path: resolve(out),
    deviceId: option('--device-id') ?? randomUUID(),
    migrationsFolder: resolve('drizzle-v2'),
  });
  try {
    const report = importLegacyDatabase({
      source: copy,
      target,
      claimInstalls: flag('--claim-installs'),
      closeOpenSessions: flag('--dev-close-open-sessions'),
      devIgnorePendingMailbox: flag('--dev-ignore-pending-mailbox'),
      legacyQueryViews,
    });
    print(report);
    console.log('\n[import] validación correcta.');
  } catch (error) {
    if (error instanceof ImportValidationError) {
      print(error.report);
      console.error(`\n[import] ${error.message}`);
      exitCode = 2;
    } else if (error instanceof ImportBlockedError) {
      console.error(`\n[import] ${error.message}`);
      exitCode = 3;
    } else {
      throw error;
    }
  } finally {
    target.close();
  }
  return exitCode;
}

function print(report: ImportReport): void {
  const line = (label: string, value: unknown): void =>
    console.log(`  ${label.padEnd(64)} ${String(value)}`);
  console.log('\n── Origen 1.x: leídas / importadas / descartadas');
  for (const [table, c] of Object.entries(report.source)) {
    line(table, `${c.read} / ${c.imported}`);
    for (const [reason, n] of Object.entries(c.discarded))
      if (n > 0) line(`    descartadas: ${reason}`, n);
  }
  console.log('\n── Destino 2.0: previstas / insertadas / ya presentes (distintas)');
  for (const [table, c] of Object.entries(report.target)) {
    if (c.planned === 0) continue;
    line(
      table,
      `${c.planned} / ${c.inserted} / ${c.alreadyPresent} (${c.alreadyPresentDifferent})`,
    );
  }
  console.log('\n── Hechos');
  for (const [name, n] of Object.entries(report.facts)) line(name, n);
  const sc = report.sourceChecks;
  console.log('\n── Comprobaciones del origen');
  line('sellos de máquina en el futuro (fuera del techo de relojes)', sc.futureStamps);
  for (const [column, n] of Object.entries(sc.futureStampsByColumn)) line(`    ${column}`, n);
  line('textos con NUL', sc.nulTexts);
  if (report.installs) {
    console.log('\n── Instalaciones reclamadas');
    for (const [name, n] of Object.entries(report.installs)) line(name, n);
  }
  const v = report.validation;
  console.log('\n── Validación: comprobaciones (comparadas / diferencias)');
  for (const [check, c] of Object.entries(v.checks))
    line(check, `${c.compared} / ${c.differences}`);
  for (const [name, n] of Object.entries(v.totals)) line(name, n);
  if (v.differences.length > 0) {
    console.log(
      `\n── Diferencias en valores derivados (${v.differenceCount}; primeras ${v.differences.length})`,
    );
    for (const d of v.differences) console.log(`  ${JSON.stringify(d)}`);
  }
  console.log(
    '\n── Conciliación columna a columna: filas / comparados / coinciden / diferencias / descartes',
  );
  for (const [table, columns] of Object.entries(v.columns.tables)) {
    for (const [column, c] of Object.entries(columns)) {
      const discards = Object.entries(c.discarded)
        .map(([reason, n]) => `${n} (${reason})`)
        .join('; ');
      line(
        `${table}.${column} [${c.fate}]`,
        `${c.rows} / ${c.compared} / ${c.matches} / ${c.differences}${discards ? ` / ${discards}` : ''}`,
      );
    }
  }
  if (v.columns.sample.length > 0) {
    console.log(
      `\n── Diferencias columna a columna (${v.columns.differences}; primeras ${Math.min(40, v.columns.sample.length)})`,
    );
    for (const d of v.columns.sample.slice(0, 40)) console.log(`  ${JSON.stringify(d)}`);
  }
  const m = report.memorySignatures;
  console.log(`\n── Firmas de los recaps (zona horaria ${m.timeZone})`);
  line('recaps comprobados', m.checked);
  for (const [outcome, n] of Object.entries(m.outcomes)) line(`  ${outcome}`, n);
  for (const [kind, n] of Object.entries(m.matches)) line(`    casan (${kind})`, n);
  line('firmas reescritas con ids 2.0', m.resealed);
  line('no reescritas: el recap ya estaba en la base', m.notResealedPreexisting);
  line('no casan con juegos sin id 1.x', m.mismatchWithUnmappedGames);

  const q = report.queryValidation;
  if (q) {
    console.log(
      '\n── Validación con consultas: comprobaciones con diferencias (diferencias / comparadas)',
    );
    for (const [check, c] of Object.entries(q.checks))
      if (c.differences > 0) line(check, `${c.differences} / ${c.compared}`);
    line('valores comparados', q.compared);
    line('diferencias', q.differenceCount);
    line('tiempo de la comparación (ms)', q.elapsedMs);
    for (const [name, n] of Object.entries(q.totals)) line(name, n);
    console.log('\n── Diferencias esperadas aplicadas (regla: veces)');
    for (const [rule, n] of Object.entries(q.expected)) line(rule, n);
    for (const [rule, why] of Object.entries(EXPECTED_QUERY_DIFFERENCES))
      console.log(`    ${rule}: ${why}`);
    console.log('\n── Campos solo en la 2.0 (no se comparan)');
    for (const field of q.onlyInTarget) console.log(`  ${field}`);
    if (q.differences.length > 0) {
      console.log(
        `\n── Diferencias con consultas (${q.differenceCount}; primeras ${q.differences.length})`,
      );
      for (const d of q.differences) console.log(`  ${JSON.stringify(d)}`);
    }
  }
  console.log(`\n  tiempo del importador: ${report.elapsedMs} ms`);
}
