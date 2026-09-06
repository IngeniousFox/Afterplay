import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, it } from 'node:test';
import {
  isTestTempDirectoryName,
  resolveTestTempDirectory,
} from '../../../scripts/lib/testTempDirectories';

// The global pretest script is never imported or executed. All filesystem
// cases live under one dedicated parent with a name outside the allowlist.
let parent: string;
before(() => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), 'codex-temp-classifier-')));
});
after(() => {
  assert.equal(dirname(parent), realpathSync(tmpdir()));
  assert.match(parent, /codex-temp-classifier-[A-Za-z0-9]{6}$/);
  rmSync(parent, { recursive: true, force: true });
});

it('accepts all verified mkdtemp test families and only their exact six-character suffixes', () => {
  for (const family of [
    'test',
    'e2e',
    'e2e-keys',
    'worker-test',
    'worker-paridad',
    'ficha-test',
    'legacyenv',
    'keys',
    'migrations',
    'remoto',
    'backups',
    'parsers',
    'scancache',
  ]) {
    assert.equal(isTestTempDirectoryName(`afterplay-${family}-aB19zX`), true, family);
    assert.equal(isTestTempDirectoryName(`afterplay-${family}-aB19z`), false, family);
    assert.equal(isTestTempDirectoryName(`afterplay-${family}-aB19zX7`), false, family);
  }
});

it('preserves snapshots, archives, unknown families and path-like names', () => {
  for (const name of [
    'afterplay-refactor-20260906-095653',
    'afterplay-test-backup-20260906',
    'afterplay-test-aB19zX.zip',
    'afterplay-test-aB19zX-old',
    'afterplay-new-test-aB19zX',
    'afterplay-ludusavi-smoke-123456',
    'afterplay-keys.json',
    '../afterplay-test-aB19zX',
    '..\\afterplay-test-aB19zX',
    'afterplay-test-aB19zX/child',
    'afterplay-test-aB19zX\\child',
    'afterplay-test-..\\abc',
    'afterplay-test-aB19zX\n',
  ]) {
    assert.equal(isTestTempDirectoryName(name), false, name);
    assert.equal(resolveTestTempDirectory(parent, name), null, name);
  }
});

it('selects a real direct child and leaves regular files and unknown directories alone', () => {
  const directoryName = 'afterplay-test-Ab123x';
  const fileName = 'afterplay-test-File12';
  const snapshotName = 'afterplay-refactor-20260906-095653';
  mkdirSync(join(parent, directoryName));
  writeFileSync(join(parent, fileName), 'a file is not a test sandbox');
  mkdirSync(join(parent, snapshotName));
  assert.equal(
    resolveTestTempDirectory(parent, directoryName),
    realpathSync(join(parent, directoryName)),
  );
  assert.equal(resolveTestTempDirectory(parent, fileName), null);
  assert.equal(resolveTestTempDirectory(parent, snapshotName), null);
  assert.equal(existsSync(join(parent, fileName)), true);
  assert.equal(existsSync(join(parent, snapshotName)), true);
});

it('rejects directory symlinks and Windows junctions even when their names match', () => {
  const scope = join(parent, 'temp-root');
  const outside = join(parent, 'preserve-me');
  mkdirSync(scope);
  mkdirSync(outside);
  writeFileSync(join(outside, 'important.txt'), 'preserve');
  const link = join(scope, 'afterplay-e2e-Link12');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(resolveTestTempDirectory(scope, 'afterplay-e2e-Link12'), null);
  assert.equal(existsSync(join(outside, 'important.txt')), true);
  // Rejection also applies to links back inside the same root.
  mkdirSync(join(scope, 'real-directory'));
  symlinkSync(
    join(scope, 'real-directory'),
    join(scope, 'afterplay-test-Link34'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal(resolveTestTempDirectory(scope, 'afterplay-test-Link34'), null);
});
