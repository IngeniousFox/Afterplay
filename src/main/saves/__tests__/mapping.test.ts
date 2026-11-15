import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findVersion, listVersions } from '../mapping';
import type { BackupMapping } from '../types';

// entries / registryHash de las versiones del mapping.yaml (§12.2). Datos
// inventados.

const H = (letter: string): string => letter.repeat(40);

const mapping: BackupMapping = {
  name: 'Juego Inventado',
  backups: [
    {
      name: 'backup-20260101T000000Z.zip',
      when: '2026-01-01T00:00:00Z',
      files: {
        'C:\\Users\\ana\\Saves\\slot1.sav': { hash: H('a'), size: 10 },
        'C:\\Users\\ana\\Saves\\slot2.sav': { hash: H('b'), size: 20 },
        'C:\\Users\\ana\\Saves\\sin-hash.sav': { size: 5 },
      },
      registry: { hash: H('r') },
      children: [
        {
          name: 'backup-20260102T000000Z-diff.zip',
          when: '2026-01-02T00:00:00Z',
          files: {
            // Cambia uno, borra otro y añade otro.
            'C:\\Users\\ana\\Saves\\slot1.sav': { hash: H('c'), size: 11 },
            'C:\\Users\\ana\\Saves\\slot2.sav': null,
            'C:\\Users\\ana\\Saves\\slot3.sav': { hash: H('d'), size: 30 },
          },
        },
        {
          name: 'backup-20260103T000000Z-diff.zip',
          when: '2026-01-03T00:00:00Z',
          files: {},
          registry: { hash: H('s') },
        },
      ],
    },
    {
      name: 'backup-20260110T000000Z.zip',
      when: '2026-01-10T00:00:00Z',
      files: { 'D:/Juegos/x/save.dat': { hash: H('e'), size: 1 } },
    },
  ],
};

const sorted = (
  entries: { path: string; hash: string | null }[],
): { path: string; hash: string | null }[] =>
  [...entries].sort((a, b) => a.path.localeCompare(b.path));

describe('BackupVersion.entries / registryHash', () => {
  it('una copia completa lista sus archivos con el hash de ludusavi y rutas con /', () => {
    const full = findVersion(mapping, 'backup-20260101T000000Z.zip');
    assert.ok(full);
    assert.equal(full.differential, false);
    assert.deepEqual(sorted(full.entries), [
      { path: 'C:/Users/ana/Saves/sin-hash.sav', hash: null },
      { path: 'C:/Users/ana/Saves/slot1.sav', hash: H('a') },
      { path: 'C:/Users/ana/Saves/slot2.sav', hash: H('b') },
    ]);
    assert.deepEqual(
      [...full.files].sort(),
      sorted(full.entries).map((entry) => entry.path),
    );
    assert.equal(full.registryHash, H('r'));
    assert.equal(full.hasRegistry, true);
  });

  it('un diferencial: el hijo pisa al padre y el archivo borrado (null) no consta', () => {
    const child = findVersion(mapping, 'backup-20260102T000000Z-diff.zip');
    assert.ok(child);
    assert.equal(child.differential, true);
    assert.deepEqual(child.chain, [
      'backup-20260101T000000Z.zip',
      'backup-20260102T000000Z-diff.zip',
    ]);
    assert.deepEqual(sorted(child.entries), [
      { path: 'C:/Users/ana/Saves/sin-hash.sav', hash: null },
      { path: 'C:/Users/ana/Saves/slot1.sav', hash: H('c') },
      { path: 'C:/Users/ana/Saves/slot3.sav', hash: H('d') },
    ]);
    // El archivo borrado tampoco cuenta en el tamaño.
    assert.equal(child.sizeBytes, 11 + 30 + 5);
    assert.ok(!child.files.some((file) => file.endsWith('slot2.sav')));
  });

  it('el registro del diferencial sale del padre si el hijo no lo trae', () => {
    const child = findVersion(mapping, 'backup-20260102T000000Z-diff.zip');
    assert.equal(child?.registryHash, H('r'));
    assert.equal(child?.hasRegistry, true);
  });

  it('el registro propio del diferencial manda sobre el del padre', () => {
    const child = findVersion(mapping, 'backup-20260103T000000Z-diff.zip');
    assert.equal(child?.registryHash, H('s'));
  });

  it('sin registro en ninguno: registryHash null y hasRegistry false', () => {
    const other = findVersion(mapping, 'backup-20260110T000000Z.zip');
    assert.equal(other?.registryHash, null);
    assert.equal(other?.hasRegistry, false);
    assert.deepEqual(other?.entries, [{ path: 'D:/Juegos/x/save.dat', hash: H('e') }]);
  });

  it('un registro sin hash cuenta como sin registro', () => {
    const version = listVersions({
      backups: [
        { name: 'b.zip', when: '2026-01-01T00:00:00Z', registry: { hash: null }, files: {} },
      ],
    })[0];
    assert.equal(version.registryHash, null);
    assert.equal(version.hasRegistry, false);
  });

  it('un padre que a su vez traía nulos no los cuela en el hijo', () => {
    const version = findVersion(
      {
        backups: [
          {
            name: 'full.zip',
            when: '2026-01-01T00:00:00Z',
            files: { 'C:/a.sav': null, 'C:/b.sav': { hash: H('b'), size: 1 } },
            children: [{ name: 'child.zip', when: '2026-01-02T00:00:00Z', files: {} }],
          },
        ],
      },
      'child.zip',
    );
    assert.deepEqual(version?.entries, [{ path: 'C:/b.sav', hash: H('b') }]);
  });

  it('listVersions devuelve de la más reciente a la más antigua', () => {
    assert.deepEqual(
      listVersions(mapping).map((version) => version.name),
      [
        'backup-20260110T000000Z.zip',
        'backup-20260103T000000Z-diff.zip',
        'backup-20260102T000000Z-diff.zip',
        'backup-20260101T000000Z.zip',
      ],
    );
  });

  it('sin mapping no hay versiones', () => {
    assert.deepEqual(listVersions(null), []);
    assert.deepEqual(listVersions({}), []);
  });
});
