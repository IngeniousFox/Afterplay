import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';

// UN BUILD 2.0 NUNCA ABRE TURSO (R-14, src/main/db/v2/CONSULTAS.md).
//
// El escritorio 2.0 dejó de sincronizar con Turso: la base es la 2.0 local
// (db/v2/appDb.ts) y el sync nuevo es otra fase. Las credenciales de Turso
// siguen en el almacén de credenciales —el Worker y la PWA las usan hasta la
// fase 5—, así que bastaría un import olvidado de su driver para que algún
// camino volviera a conectarse a la base remota con una app que ya no habla
// su esquema.
//
// Esto recorre el grafo de imports REAL de lo que se empaqueta —el proceso
// principal y el preload, desde sus entradas— y falla si alguno llega a un
// driver de la base 1.x: `@tursodatabase/sync` (la réplica con Turso) o
// `@libsql/client` (la conexión directa). El importador, sus scripts y los
// tests de paridad sí los usan, pero viven fuera de este grafo.
//
// Se miran imports estáticos (`import … from`, `export … from`) y dinámicos
// (`import('…')`), que es como el main carga lo pesado bajo demanda.
//
// ÚNICA EXCEPCIÓN (PUENTE 1.x → L3, §19.3.1): el módulo del corte de la 1.x
// puede cargar `@libsql/client/web` (HTTP, sin nativos) con un import
// DINÁMICO. Ni un import estático desde él, ni ese import desde otro fichero,
// ni `@libsql/client` a secas valen. Se va con el módulo en la tanda L3.

const BRIDGE_FILE = 'src/main/migration/legacyCutover.ts';
const BRIDGE_SPECIFIER = '@libsql/client/web';
const ROOT = process.cwd();
const ENTRIES = ['src/main/index.ts', 'src/preload/index.ts'];
const FORBIDDEN = ['@tursodatabase/sync', '@libsql/client', 'drizzle-orm/libsql'];

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

// Quita comentarios para que un `import` citado en uno no cuente. Burdo pero
// suficiente: el código de la app no mete `//` ni `/*` dentro de literales
// de import.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

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

// Las importaciones de solo tipos se borran al compilar: no llegan al bundle.
const isTypeOnly = (statement: string): boolean => /^(?:import|export)\s+type\s/.test(statement);

const walk = (
  root: string = ROOT,
  entries: readonly string[] = ENTRIES,
): { reached: Map<string, string[]>; unresolved: string[] } => {
  // paquete prohibido -> cadena de ficheros que lo arrastra
  const reached = new Map<string, string[]>();
  const unresolved: string[] = [];
  const parent = new Map<string, string | null>();
  const queue = entries.map((entry) => resolve(root, entry));
  for (const entry of queue) parent.set(entry, null);

  const chainOf = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null = file; at; at = parent.get(at) ?? null) {
      chain.unshift(relative(root, at).split(sep).join('/'));
    }
    return chain;
  };

  while (queue.length > 0) {
    const file = queue.shift() as string;
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(IMPORT_RE)) {
      if (isTypeOnly(match[0])) continue;
      const specifier = match[1] ?? match[2];
      const isDynamic = match[2] !== undefined;
      const fromBridge = relative(root, file).split(sep).join('/') === BRIDGE_FILE;
      if (specifier === BRIDGE_SPECIFIER && isDynamic && fromBridge) continue;
      if (FORBIDDEN.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
        if (!reached.has(specifier)) reached.set(specifier, chainOf(file));
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const target = resolveLocal(file, specifier);
      // Un import relativo que no resuelve a .ts/.tsx es un recurso
      // (?asset, .css, .json): no trae código que pueda abrir una base.
      if (!target) {
        if (!/\?|\.(css|json|png|svg|html)$/.test(specifier)) {
          unresolved.push(`${relative(root, file)} -> ${specifier}`);
        }
        continue;
      }
      if (parent.has(target)) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  return { reached, unresolved };
};

describe('el proceso principal 2.0 no arrastra los drivers de Turso (R-14)', () => {
  const { reached, unresolved } = walk();

  it('ningún fichero del main ni del preload importa un driver de la base 1.x', () => {
    const report = [...reached].map(
      ([specifier, chain]) => `${specifier}, desde:\n    ${chain.join('\n    -> ')}`,
    );
    assert.deepEqual(report, []);
  });

  it('el recorrido entiende todos los imports relativos (si no, el test no vería nada)', () => {
    assert.deepEqual(unresolved, []);
  });
});

describe('la excepción del puente 1.x solo vale para su módulo y su import dinámico', () => {
  // Monta un mini-proyecto en un directorio temporal y devuelve los paquetes
  // prohibidos que alcanza el recorrido desde `src/main/index.ts`.
  const fixture = (files: Record<string, string>): string[] => {
    const root = mkdtempSync(join(tmpdir(), 'afterplay-barrier-'));
    try {
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, name)), { recursive: true });
        writeFileSync(join(root, name), text);
      }
      return [...walk(root, ['src/main/index.ts']).reached.keys()];
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const INDEX = "import './migration/legacyCutover';";
  const dynamic = (specifier: string): string =>
    `export const open = () => import('${specifier}');`;

  it('el módulo puente con import dinámico pasa', () => {
    assert.deepEqual(
      fixture({ 'src/main/index.ts': INDEX, [BRIDGE_FILE]: dynamic(BRIDGE_SPECIFIER) }),
      [],
    );
  });

  it('otro fichero con el mismo import dinámico sigue fallando', () => {
    assert.deepEqual(
      fixture({
        'src/main/index.ts': "import './other';",
        'src/main/other.ts': dynamic(BRIDGE_SPECIFIER),
      }),
      [BRIDGE_SPECIFIER],
    );
  });

  it('el módulo puente con import estático o con @libsql/client a secas falla', () => {
    for (const text of [
      `import { createClient } from '${BRIDGE_SPECIFIER}';`,
      dynamic('@libsql/client'),
    ]) {
      assert.equal(fixture({ 'src/main/index.ts': INDEX, [BRIDGE_FILE]: text }).length, 1);
    }
  });

  it('@tursodatabase/sync y drizzle-orm/libsql siguen prohibidos también en el puente', () => {
    for (const name of ['@tursodatabase/sync', 'drizzle-orm/libsql']) {
      assert.deepEqual(fixture({ 'src/main/index.ts': INDEX, [BRIDGE_FILE]: dynamic(name) }), [
        name,
      ]);
    }
  });
});
