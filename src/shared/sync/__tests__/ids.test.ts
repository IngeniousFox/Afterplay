import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  achievementCatalogId,
  achievementUnlockId,
  AFTERPLAY_NAMESPACE,
  compositeId,
  createUuidV7Generator,
  emulatorInstallId,
  emulatorOrigin,
  externalCheckId,
  gameIdForIgdb,
  gameInstallId,
  generatedMemoryId,
  isUuid,
  radarGameId,
  saveBackupId,
  uuidv5,
  uuidv7,
} from '../ids';
import { sha1 } from '../sha1';

// Identificadores de §7.2. node:crypto solo se usa AQUÍ, como referencia contra
// la que comparar la implementación propia, que no puede depender de él.

/** Generador pseudoaleatorio con semilla (mulberry32): casos reproducibles. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('SHA-1 propio', () => {
  it('da los vectores conocidos (FIPS 180-2)', () => {
    assert.equal(hex(sha1(utf8(''))), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
    assert.equal(hex(sha1(utf8('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d');
    assert.equal(
      hex(sha1(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
    assert.equal(
      hex(sha1(new Uint8Array(1_000_000).fill(0x61))),
      '34aa973cd4c4daa4f61eeb2bdbad27316534016f',
    );
  });

  it('coincide con node:crypto en todas las longitudes alrededor de los bloques', () => {
    const r = rng(7);
    for (let len = 0; len <= 200; len++) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = Math.floor(r() * 256);
      assert.equal(hex(sha1(data)), createHash('sha1').update(data).digest('hex'), `len ${len}`);
    }
  });
});

describe('UUIDv5', () => {
  it('da el vector del RFC 9562 (apéndice A.4)', () => {
    const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    assert.equal(uuidv5('www.example.com', DNS), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('coincide con una implementación de referencia, también con texto no ASCII', () => {
    const reference = (name: string, ns: string): string => {
      const h = createHash('sha1')
        .update(Buffer.from(ns.replace(/-/g, ''), 'hex'))
        .update(name, 'utf8')
        .digest();
      h[6] = (h[6] & 0x0f) | 0x50;
      h[8] = (h[8] & 0x3f) | 0x80;
      const x = h.toString('hex').slice(0, 32);
      return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
    };
    for (const name of ['', 'igdb:1942', 'Pokémon™ — ポケモン', '🎮'.repeat(40)]) {
      assert.equal(uuidv5(name), reference(name, AFTERPLAY_NAMESPACE), name);
    }
  });

  it('el espacio de nombres de Afterplay no ha cambiado', () => {
    // Si este test falla, alguien cambió la constante: todos los ids
    // deterministas guardados dejarían de coincidir (F-08, F-21).
    assert.equal(AFTERPLAY_NAMESPACE, '238ac618-84bc-446b-94b8-fb0f02d79a8e');
    assert.equal(gameIdForIgdb(1942), uuidv5('igdb:1942'));
  });

  it('rechaza un espacio de nombres mal formado', () => {
    assert.throws(() => uuidv5('x', 'no-es-un-uuid'), RangeError);
  });
});

describe('UUIDv7', () => {
  it('da el vector del RFC 9562 (apéndice A.6) con el azar fijado', () => {
    // rand_a = 0xCC3, rand_b = 0x18C4DC0C0C07398F → 74 bits; se rellenan 10 bytes.
    let rand = (BigInt(0xcc3) << BigInt(62)) | BigInt('0x18C4DC0C0C07398F');
    const bytes: number[] = [];
    for (let i = 0; i < 10; i++) {
      bytes.unshift(Number(rand & BigInt(0xff)));
      rand >>= BigInt(8);
    }
    const gen = createUuidV7Generator((out) => out.set(bytes));
    assert.equal(gen(0x017f22e279b0), '017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  });

  it('lleva versión 7, variante RFC y el instante en los 48 bits altos', () => {
    const at = new Date('2026-11-13T10:00:00.123Z');
    for (let i = 0; i < 200; i++) {
      const id = uuidv7(at);
      assert.ok(isUuid(id));
      assert.equal(id[14], '7');
      assert.match(id[19], /[89ab]/);
      assert.equal(parseInt(id.replace(/-/g, '').slice(0, 12), 16), at.getTime());
    }
    assert.ok(isUuid(uuidv7()), 'sin instante usa la hora actual y globalThis.crypto');
  });

  it('es único y sale ordenado en una ráfaga dentro del mismo milisegundo', () => {
    const gen = createUuidV7Generator();
    const ids = Array.from({ length: 20_000 }, () => gen(1_763_020_800_000));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), ids);
  });

  it('único aunque el azar se repita siempre (el incremento lo garantiza)', () => {
    const gen = createUuidV7Generator((out) => out.fill(0));
    const ids = Array.from({ length: 1000 }, () => gen(5));
    assert.equal(new Set(ids).size, 1000);
  });

  it('se ordena por instante de creación', () => {
    const r = rng(9);
    const times = Array.from({ length: 2000 }, () => 1_600_000_000_000 + Math.floor(r() * 1e10));
    const ids = times.map((t) => uuidv7(t));
    const byId = [...ids].sort();
    const byTime = times
      .map((t, i) => [t, ids[i]] as const)
      .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
      .map(([, id]) => id);
    assert.deepEqual(byId, byTime);
  });

  it('rechaza instantes que no caben', () => {
    assert.throws(() => uuidv7(-1), RangeError);
    assert.throws(() => uuidv7(2 ** 48), RangeError);
    assert.throws(() => uuidv7(1.5), RangeError);
    assert.throws(() => uuidv7(new Date(NaN)), RangeError);
  });
});

describe('ids compuestos', () => {
  it('une las partes con ":"', () => {
    assert.equal(compositeId('a', 'b', 'c'), 'a:b:c');
  });

  it('falla con una parte vacía, con ":" dentro o con una sola parte', () => {
    assert.throws(() => compositeId('a', ''), RangeError);
    assert.throws(() => compositeId('a:b', 'c'), RangeError);
    assert.throws(() => compositeId('a', 'b:c'), RangeError);
    assert.throws(() => compositeId('a'), RangeError);
  });
});

describe('ids de la tabla de §7.2', () => {
  const game = gameIdForIgdb(1942);
  const device = '5f0c7e2a-3b1d-4c8e-9a6f-0d2e4b6c8a1f';

  it('juego con igdbId: UUIDv5 determinista; sin entero positivo, error', () => {
    assert.equal(gameIdForIgdb(1942), game);
    assert.notEqual(gameIdForIgdb(1943), game);
    assert.equal(game[14], '5');
    assert.throws(() => gameIdForIgdb(0), RangeError);
    assert.throws(() => gameIdForIgdb(19.42), RangeError);
  });

  it('radar: igdb:<igdbId> literal, distinto del id del juego', () => {
    assert.equal(radarGameId(1942), 'igdb:1942');
    assert.notEqual(radarGameId(1942), game);
  });

  it('instalaciones, catálogos y comprobaciones: <a>:<b>', () => {
    assert.equal(gameInstallId(game, device), `${game}:${device}`);
    assert.equal(emulatorInstallId('emu-1', device), `emu-1:${device}`);
    assert.equal(achievementCatalogId(game, 'steam'), `${game}:steam`);
    assert.equal(externalCheckId(game, 'steam_appid'), `${game}:steam_appid`);
  });

  it('desbloqueos: <gameId>:<source>:<apiName>:<origin>, con origen emu@<deviceId>', () => {
    assert.equal(emulatorOrigin(device), `emu@${device}`);
    assert.equal(
      achievementUnlockId(game, 'steam', 'ACH_WIN', emulatorOrigin(device)),
      `${game}:steam:ACH_WIN:emu@${device}`,
    );
    // apiName viene de fuera: puede llevar ":" porque es la única parte que puede.
    assert.equal(achievementUnlockId(game, 'ra', 'a:b', 'ra'), `${game}:ra:a:b:ra`);
    assert.throws(() => achievementUnlockId(game, 'ra', 'x', 'r:a'), RangeError);
    assert.throws(() => achievementUnlockId(game, 'steam', '', 'steam'), RangeError);
    assert.throws(() => emulatorOrigin('a@b'), RangeError);
    assert.throws(() => emulatorOrigin(''), RangeError);
  });

  it('recuerdos: <scopeType>:<scopeKey>', () => {
    assert.equal(generatedMemoryId('month', '2026-06'), 'month:2026-06');
    assert.equal(generatedMemoryId('game', `${game}:2`), `game:${game}:2`);
    assert.throws(() => generatedMemoryId('mo:nth', '2026-06'), RangeError);
    assert.throws(() => generatedMemoryId('month', ''), RangeError);
  });

  it('copias de partida: UUIDv5 de la clave del objeto', () => {
    const key = 'saves/1942/2026-11-13T10-00-00.zip';
    assert.equal(saveBackupId(key), saveBackupId(key));
    assert.equal(saveBackupId(key), uuidv5(key));
    assert.notEqual(saveBackupId(key), saveBackupId(`${key}x`));
    assert.throws(() => saveBackupId(''), RangeError);
  });
});
