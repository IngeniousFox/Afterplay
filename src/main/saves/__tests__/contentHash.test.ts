import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { canonicalSavePath, computeContentHash, hashLocalSave, sha1OfFile } from '../contentHash';

// Huella del contenido de una partida (§12.2, F-25). Datos inventados.

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const H3 = 'c'.repeat(40);

const hashOf = (
  files: { path: string; hash: string | null | undefined }[],
  home: string,
  registryHash: string | null = null,
): string | null => computeContentHash({ files, registryHash, home });

describe('computeContentHash', () => {
  it('la misma partida en dos PCs con carpetas de usuario distintas da la misma huella', () => {
    const ana = hashOf(
      [
        { path: 'C:/Users/ana/AppData/Local/Juego/slot1.sav', hash: H1 },
        { path: 'C:/Users/ana/Documents/Juego/slot2.sav', hash: H2 },
      ],
      'C:/Users/ana',
    );
    const bea = hashOf(
      [
        { path: 'C:/Users/bea/AppData/Local/Juego/slot1.sav', hash: H1 },
        { path: 'C:/Users/bea/Documents/Juego/slot2.sav', hash: H2 },
      ],
      'C:/Users/bea',
    );
    assert.ok(ana);
    assert.equal(ana, bea);
  });

  it('no depende del orden de los archivos', () => {
    const files = [
      { path: 'C:/Users/ana/a.sav', hash: H1 },
      { path: 'C:/Users/ana/b.sav', hash: H2 },
      { path: 'C:/Users/ana/c.sav', hash: H3 },
    ];
    assert.equal(hashOf(files, 'C:/Users/ana'), hashOf([...files].reverse(), 'C:/Users/ana'));
  });

  it('cambia si cambia el contenido de un archivo o su ruta', () => {
    const base = hashOf([{ path: 'C:/Users/ana/a.sav', hash: H1 }], 'C:/Users/ana');
    assert.notEqual(base, hashOf([{ path: 'C:/Users/ana/a.sav', hash: H2 }], 'C:/Users/ana'));
    assert.notEqual(base, hashOf([{ path: 'C:/Users/ana/b.sav', hash: H1 }], 'C:/Users/ana'));
  });

  it('dos archivos intercambiando su contenido no dan la misma huella', () => {
    const a = hashOf(
      [
        { path: 'C:/Users/ana/a.sav', hash: H1 },
        { path: 'C:/Users/ana/b.sav', hash: H2 },
      ],
      'C:/Users/ana',
    );
    const b = hashOf(
      [
        { path: 'C:/Users/ana/a.sav', hash: H2 },
        { path: 'C:/Users/ana/b.sav', hash: H1 },
      ],
      'C:/Users/ana',
    );
    assert.notEqual(a, b);
  });

  it('normaliza mayúsculas, barras invertidas y el prefijo de rutas largas', () => {
    const plain = hashOf(
      [{ path: 'C:/Users/ana/AppData/Juego/Slot1.sav', hash: H1 }],
      'C:/Users/ana',
    );
    const backslash = hashOf(
      [{ path: 'C:\\Users\\ana\\AppData\\Juego\\Slot1.sav', hash: H1 }],
      'C:\\Users\\ana',
    );
    const upper = hashOf(
      [{ path: 'C:/USERS/ANA/APPDATA/JUEGO/SLOT1.SAV', hash: H1 }],
      'c:/users/ana',
    );
    const longPath = hashOf(
      [{ path: '\\\\?\\C:\\Users\\ana\\AppData\\Juego\\Slot1.sav', hash: H1 }],
      '\\\\?\\C:\\Users\\ana',
    );
    // El prefijo solo en la ruta, no en el home (y al revés).
    const longPathOnly = hashOf(
      [{ path: '\\\\?\\C:\\Users\\ana\\AppData\\Juego\\Slot1.sav', hash: H1 }],
      'C:/Users/ana',
    );
    assert.equal(plain, backslash);
    assert.equal(plain, upper);
    assert.equal(plain, longPath);
    assert.equal(plain, longPathOnly);
  });

  it('el hash del archivo se normaliza (mayúsculas y espacios)', () => {
    assert.equal(
      hashOf([{ path: 'C:/x/a.sav', hash: H1 }], ''),
      hashOf([{ path: 'C:/x/a.sav', hash: `  ${H1.toUpperCase()} ` }], ''),
    );
  });

  it('si falta el hash de UN archivo no hay huella', () => {
    assert.equal(
      hashOf(
        [
          { path: 'C:/Users/ana/a.sav', hash: H1 },
          { path: 'C:/Users/ana/b.sav', hash: null },
        ],
        'C:/Users/ana',
      ),
      null,
    );
    assert.equal(hashOf([{ path: 'C:/x/a.sav', hash: undefined }], ''), null);
    assert.equal(hashOf([{ path: 'C:/x/a.sav', hash: '   ' }], ''), null);
  });

  it('el registro participa en la huella', () => {
    const files = [{ path: 'C:/x/a.sav', hash: H1 }];
    const without = hashOf(files, '');
    const withRegistry = hashOf(files, '', H2);
    const otherRegistry = hashOf(files, '', H3);
    assert.ok(without && withRegistry && otherRegistry);
    assert.notEqual(without, withRegistry);
    assert.notEqual(withRegistry, otherRegistry);
    // Un registro con hash vacío es un registro ilegible: sin huella.
    assert.equal(hashOf(files, '', '  '), null);
  });

  it('una partida solo de registro tiene huella; sin archivos ni registro, no', () => {
    assert.ok(hashOf([], '', H1));
    assert.equal(hashOf([], '', null), null);
  });

  it('las rutas fuera de la carpeta de usuario no se tokenizan', () => {
    const inD = hashOf([{ path: 'D:/Juegos/Juego/a.sav', hash: H1 }], 'C:/Users/ana');
    // Con otro home da lo mismo: la ruta no depende de él...
    assert.equal(inD, hashOf([{ path: 'D:/Juegos/Juego/a.sav', hash: H1 }], 'C:/Users/bea'));
    // ...y no coincide con la misma partida bajo el home.
    assert.notEqual(inD, hashOf([{ path: 'C:/Users/ana/Juego/a.sav', hash: H1 }], 'C:/Users/ana'));
  });

  it('una carpeta cuyo nombre empieza igual que el home no se confunde con él', () => {
    // C:/Users/ana2 NO está bajo C:/Users/ana.
    assert.equal(canonicalSavePath('C:/Users/ana2/a.sav', 'C:/Users/ana'), 'c:/users/ana2/a.sav');
    assert.equal(canonicalSavePath('C:/Users/ana/a.sav', 'C:/Users/ana'), '<home>/a.sav');
    assert.equal(canonicalSavePath('C:/Users/ana', 'C:/Users/ana'), '<home>');
  });

  it('con home vacío no tokeniza nada', () => {
    assert.equal(canonicalSavePath('C:/Users/ana/a.sav', ''), 'c:/users/ana/a.sav');
  });

  it('la huella es un SHA-256 en hex', () => {
    const hash = hashOf([{ path: 'C:/x/a.sav', hash: H1 }], '');
    assert.match(hash ?? '', /^[0-9a-f]{64}$/);
  });
});

describe('sha1OfFile / hashLocalSave', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'afterplay-saves-hash-'));
    mkdirSync(join(dir, 'Saves'), { recursive: true });
    writeFileSync(join(dir, 'Saves', 'slot1.sav'), 'contenido de la ranura 1');
    writeFileSync(join(dir, 'Saves', 'slot2.sav'), Buffer.from([0, 1, 2, 3, 250, 251]));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const sha1 = (content: string | Buffer): string =>
    createHash('sha1').update(content).digest('hex');

  it('sha1OfFile coincide con el SHA-1 de node:crypto', async () => {
    assert.equal(
      await sha1OfFile(join(dir, 'Saves', 'slot1.sav')),
      sha1('contenido de la ranura 1'),
    );
    assert.equal(
      await sha1OfFile(join(dir, 'Saves', 'slot2.sav')),
      sha1(Buffer.from([0, 1, 2, 3, 250, 251])),
    );
  });

  it('sha1OfFile rechaza si el archivo no existe', async () => {
    await assert.rejects(sha1OfFile(join(dir, 'Saves', 'no-existe.sav')));
  });

  it('hashLocalSave equivale a computeContentHash de las mismas entradas', async () => {
    const paths = [join(dir, 'Saves', 'slot1.sav'), join(dir, 'Saves', 'slot2.sav')];
    const expected = computeContentHash({
      files: [
        { path: paths[0], hash: sha1('contenido de la ranura 1') },
        { path: paths[1], hash: sha1(Buffer.from([0, 1, 2, 3, 250, 251])) },
      ],
      registryHash: null,
      home: dir,
    });
    assert.ok(expected);
    assert.equal(await hashLocalSave(paths, dir), expected);
    // El orden de la lista de ludusavi no importa.
    assert.equal(await hashLocalSave([...paths].reverse(), dir), expected);
  });

  it('hashLocalSave devuelve null si algún archivo no se deja leer', async () => {
    assert.equal(
      await hashLocalSave(
        [join(dir, 'Saves', 'slot1.sav'), join(dir, 'Saves', 'fantasma.sav')],
        dir,
      ),
      null,
    );
  });

  it('hashLocalSave sin archivos no tiene huella', async () => {
    assert.equal(await hashLocalSave([], dir), null);
  });
});
