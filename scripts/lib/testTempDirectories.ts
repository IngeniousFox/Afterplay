import { lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Only families created with mkdtemp in the test harnesses. A new test
// family must be added here explicitly; unknown afterplay-* directories may
// contain backups or work snapshots and must never be inferred disposable.
const TEST_TEMP_PREFIXES = [
  'afterplay-test-', // db/__tests__/harness.ts
  'afterplay-e2e-', // e2e/sandbox.ts
  'afterplay-e2e-keys-', // e2e/plan-ajustes.spec.ts
  'afterplay-worker-test-', // workerQueries.test.ts
  'afterplay-worker-paridad-', // workerParidad.test.ts
  'afterplay-ficha-test-', // gameDetailParity.test.ts
  'afterplay-legacyenv-', // legacyEnv.test.ts
  'afterplay-keys-', // credentials.test.ts
  'afterplay-migrations-', // migrationSync.test.ts
  'afterplay-remoto-', // migrationSync.test.ts
  'afterplay-backups-', // dailyBackup.test.ts
  'afterplay-parsers-', // steam/__tests__/parsers.test.ts
  'afterplay-scancache-', // scan/__tests__/cache.test.ts
] as const;

// Node's mkdtemp appends exactly six random alphanumeric characters. Full
// matching excludes similarly named archives, files, paths and nested names.
export const isTestTempDirectoryName = (name: string): boolean =>
  TEST_TEMP_PREFIXES.some(
    (prefix) =>
      name.length === prefix.length + 6 &&
      name.startsWith(prefix) &&
      /^[A-Za-z0-9]{6}$/.test(name.slice(prefix.length)),
  );

// Selection only: importing this helper never deletes anything. Resolve
// both paths before a caller may remove a directory, and reject junctions /
// symlinks instead of following them outside the supplied temporary root.
export const resolveTestTempDirectory = (tempRoot: string, name: string): string | null => {
  if (!isTestTempDirectoryName(name)) return null;
  const root = realpathSync(tempRoot);
  const candidate = resolve(root, name);
  if (dirname(candidate) !== root) return null;
  const entry = lstatSync(candidate);
  if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
  const resolvedCandidate = realpathSync(candidate);
  return dirname(resolvedCandidate) === root ? resolvedCandidate : null;
};
