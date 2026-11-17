import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';

// LA 2.0 NO IMPORTA CÓDIGO 1.x (AFTERPLAY-2.0.md, Apéndice C, §C.5).
//
// Lo que queda de la 1.x en esta rama —su esquema y sus lecturas— está
// congelado y solo lo necesita el importador
// (`src/main/db/v2/importer/`), que lee la base 1.x y comprueba que la 2.0
// enseña lo mismo. Si cualquier otro fichero empieza a importarlo, volvemos a
// mantener dos versiones a la vez, y el día de borrar la 1.x ya no se puede.
//
// A diferencia de noTursoInMain.test.ts, aquí también cuentan los imports de
// solo tipos: un tipo del esquema 1.x en la app es igual de mala señal.
//
// PUENTE 1.x → L3: este test se va con el importador.

const ROOT = process.cwd();

// Dónde vive el código de la 2.0.
const SCANNED = ['src', 'web/src', 'hub', 'e2e', 'scripts'];

// El código 1.x: nadie de fuera puede importarlo.
const LEGACY = [
  'src/main/db/schema.ts',
  'src/main/db/index.ts',
  'src/main/db/projections.ts',
  'src/main/db/queries',
  'src/main/db/__tests__/harness.ts',
];

// Quién sí puede: el propio código 1.x, el importador y sus herramientas.
const ALLOWED = [
  ...LEGACY,
  'src/main/db/v2/importer',
  'scripts/import-1x-to-v2.ts',
  'scripts/audit-1x-data.ts',
  'scripts/gen-e2e-seed.ts',
  // Monta bases 1.x de prueba para comprobar la apertura y la importación.
  'src/main/db/v2/__tests__',
  'src/main/db/__tests__',
];

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const posix = (file: string): string => relative(ROOT, file).split(sep).join('/');

const under = (file: string, roots: readonly string[]): boolean =>
  roots.some((root) => file === root || file.startsWith(`${root}/`));

const resolveLocal = (fromFile: string, specifier: string): string | null => {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

describe('la 2.0 no importa código 1.x', () => {
  it('solo el importador y sus herramientas llegan al esquema y a las lecturas de la 1.x', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of SCANNED) {
      for (const file of sourceFiles(resolve(ROOT, root))) {
        const from = posix(file);
        if (under(from, ALLOWED)) continue;
        scanned += 1;
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const match of source.matchAll(IMPORT_RE)) {
          const specifier = match[1] ?? match[2];
          if (!specifier.startsWith('.')) continue;
          const target = resolveLocal(file, specifier);
          if (target && under(posix(target), LEGACY)) {
            offenders.push(`${from} -> ${posix(target)}`);
          }
        }
      }
    }
    assert.ok(scanned > 500, `solo se han mirado ${scanned} ficheros: ¿ha cambiado la estructura?`);
    assert.deepEqual(offenders, []);
  });

  it('las piezas 1.x vigiladas existen (si se borran, se quitan de la lista)', () => {
    const missing = LEGACY.filter((path) => !existsSync(resolve(ROOT, path)));
    assert.deepEqual(missing, []);
  });
});

describe('el Worker de la 1.x no vuelve a esta rama', () => {
  // `worker/` (la web móvil 1.x) salió de la rama v2 en L1. Vive en `main`
  // hasta que se retire el Worker desplegado (L2). Si reaparece, ha llegado por
  // una fusión: el hub tiene su propio `hub/worker`. Se mira el código y no la
  // carpeta: quien cambie desde `main` conserva en `worker/` lo que git ignora
  // (`node_modules`, `.dev.vars`), y eso no es código.
  it('no hay código de worker/', () => {
    assert.equal(existsSync(resolve(ROOT, 'worker/src')), false);
    assert.equal(existsSync(resolve(ROOT, 'worker/package.json')), false);
  });
});
