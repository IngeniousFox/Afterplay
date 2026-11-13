import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { openLocalDatabase } from '../src/main/db/v2/connection';
import {
  ImportBlockedError,
  ImportValidationError,
  importLegacyDatabase,
  type ImportReport,
} from '../src/main/db/v2/importer';

// IMPORTA UNA COPIA DE UNA BASE 1.x A UNA BASE 2.0 NUEVA (AFTERPLAY-2.0.md §19.5).
//
//   npm run db:v2:import -- --out C:\ruta\Afterplay2.db
//   npm run db:v2:import -- --from C:\ruta\copia.db --out C:\ruta\Afterplay2.db
//   ... --device-id <machineId> --claim-installs --dev-close-open-sessions
//
// Sin --from usa la copia de seguridad más reciente de la app instalada
// (userData/backups/Afterplay-*.db), como seed-dev-profile.ts.
//
// PROTECCIONES, como audit-1x-data.ts:
// - Nunca lee la base EN USO de la app (`Afterplay.db` de su carpeta de datos
//   o de un perfil de desarrollo): solo copias. Y ni siquiera lee la copia en
//   su sitio: la copia antes a una carpeta temporal y trabaja sobre esa.
// - Nunca escribe dentro de la carpeta de datos de la app ni de sus perfiles.
//
// Imprime recuentos, comprobaciones y diferencias: nunca títulos, notas ni
// rutas personales. Sale con código distinto de cero si la validación falla.

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | null => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const fail = (message: string): never => {
  console.error(`\n[import] ${message}\n`);
  process.exit(1);
};

// Carpetas de datos de la app: `Afterplay` y los perfiles `Afterplay-dev-*`.
const APP_FOLDER = /^afterplay(-dev-.*)?$/i;
const isInsideAppData = (path: string): boolean =>
  resolve(path)
    .split(sep)
    .some((part) => APP_FOLDER.test(part));
const isLiveDatabase = (path: string): boolean =>
  /^afterplay2?\.db$/i.test(basename(path)) && APP_FOLDER.test(basename(dirname(resolve(path))));

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

// Un solo fichero en la carpeta temporal del sistema (no una carpeta: la
// limpieza de los tests, `pretest`, solo conoce carpetas de fixtures y esto no
// lo es). Se abre en solo lectura, así que SQLite no le deja ficheros al lado,
// y se borra en el finally pase lo que pase.
const copy = join(tmpdir(), `afterplay-import-${randomUUID()}.db`);
let exitCode = 0;
try {
  copyFileSync(from, copy);
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
      devCloseOpenSessions: flag('--dev-close-open-sessions'),
      devIgnorePendingMailbox: flag('--dev-ignore-pending-mailbox'),
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
} finally {
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    rmSync(`${copy}${suffix}`, { force: true });
}
process.exit(exitCode);

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
  console.log(`\n  tiempo del importador: ${report.elapsedMs} ms`);
}
