import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import type { IgdbSearchResult } from '../../igdb/types';
import type { ScannedFolder } from '../contracts';
import type { CacheEntry } from '../cache';

// LA CACHÉ DE ESCANEO DE CARPETAS (scan/cache.ts).
//
// Lo que se blinda aquí son las DECISIONES que separan "hay que volver a
// mirar esto" de "ya lo sabemos", no que el fichero se lea o se escriba:
//
//   · needsDescribe: la ventana de "instalación a medias" cuenta desde
//     firstSeenAt, NUNCA desde scannedAt — el bug documentado que hacía que
//     una carpeta sin .exe (ROMs, assets) se recorriera en disco PARA SIEMPRE.
//   · needsMatch: sin respuesta de IGDB se reintenta pronto (10 min); con
//     respuesta vacía se reintenta tarde (24h); con matches, nunca.
//   · pathKey: unifica mayúsculas y separadores de Windows.
//   · prune (privada, solo alcanzable vía putCachedEntries): al superar el
//     tope, sobreviven las MÁS RECIENTES por scannedAt, no las primeras.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: el módulo es el de verdad, leyendo y
// escribiendo scan-cache.json en una carpeta temporal por proceso. Solo se
// dobla electron (app.getPath) — nada más lo necesita.
//
// UN MATIZ DEL MÓDULO QUE OBLIGA A ORDENAR LOS TESTS CON CUIDADO: `read()`
// cachea el fichero en una variable de módulo la PRIMERA vez que se llama y
// ya no vuelve a tocar disco — cambiar `app.getPath('userData')` a mitad de
// la suite NO hace que se relea nada. Por eso aquí no hay una carpeta nueva
// por test: hay UNA sola sesión acumulada, y cada test que toca el fichero
// usa una raíz de Windows distinta y exclusiva para no pisar las entradas de
// los demás (getCachedEntries/getLastScanAt filtran por raíz).

let userDataDir = '';

mock.module('electron', {
  namedExports: {
    app: { getPath: (): string => userDataDir },
  },
});

let cache: typeof import('../cache');

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-scancache-'));
  userDataDir = dir;
  cache = await import('../cache');
});

after(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

const carpeta = (overrides: Partial<ScannedFolder> = {}): ScannedFolder => ({
  folderName: 'Palworld',
  path: 'D:\\Videojuegos\\Palworld',
  root: 'D:\\Videojuegos',
  sizeBytes: 1000,
  executablePath: null,
  executableCandidates: [],
  ...overrides,
});

const entrada = (overrides: Partial<CacheEntry> = {}): CacheEntry => ({
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  scannedAt: '2026-01-01T00:00:00.000Z',
  folder: carpeta(),
  matches: [] as IgdbSearchResult[],
  matchedAt: null,
  ...overrides,
});

// ── prune, PRIMERO de todo: la única forma de tener la certeza de que la
// caché en memoria está vacía cuando arranca (ver la nota de arriba). ────────
describe('prune (vía putCachedEntries, al superar el tope de 2000)', () => {
  it('se queda con las 2000 entradas MÁS RECIENTES por scannedAt, no las primeras', () => {
    const raiz = 'D:\\Prune';
    const entradas: CacheEntry[] = [];
    for (let i = 0; i < 2001; i++) {
      // scannedAt CRECIENTE con i: la entrada 0 es la más vieja, la 2000 la
      // más nueva. Si prune() se quedara con "las primeras 2000" en vez de
      // "las últimas 2000 por fecha", este test lo vería al revés.
      const scannedAt = new Date(2026, 0, 1, 0, 0, i).toISOString();
      entradas.push(
        entrada({
          folder: carpeta({ path: `${raiz}\\juego-${i}`, root: raiz }),
          scannedAt,
        }),
      );
    }

    cache.putCachedEntries(entradas);

    const restantes = cache.getCachedEntries([raiz]);
    assert.equal(restantes.length, 2000, 'el tope es 2000, ni una más');
    assert.equal(
      cache.getCachedEntry(`${raiz}\\juego-0`),
      null,
      'la más VIEJA (índice 0) es la que se descarta',
    );
    assert.notEqual(
      cache.getCachedEntry(`${raiz}\\juego-2000`),
      null,
      'la más NUEVA sobrevive siempre',
    );
  });
});

describe('pathKey: unifica mayúsculas y los dos separadores de Windows', () => {
  it('"D:/Juegos\\X" y "d:\\juegos/x" son la MISMA clave', () => {
    assert.equal(cache.pathKey('D:/Juegos\\X'), cache.pathKey('d:\\juegos/x'));
    assert.equal(cache.pathKey('D:/Juegos\\X'), 'd:\\juegos\\x');
  });
});

describe('getCachedEntries / dropCachedEntries / getLastScanAt', () => {
  const raizA = 'D:\\RaizA';
  const raizB = 'E:\\RaizB';

  it('getCachedEntries filtra por raíz: lo de otra raíz no se cuela', () => {
    cache.putCachedEntries([
      entrada({
        folder: carpeta({ path: `${raizA}\\uno`, root: raizA }),
        scannedAt: '2026-02-01T00:00:00.000Z',
      }),
      entrada({
        folder: carpeta({ path: `${raizB}\\dos`, root: raizB }),
        scannedAt: '2026-02-02T00:00:00.000Z',
      }),
    ]);

    const soloA = cache.getCachedEntries([raizA]);
    assert.deepEqual(
      soloA.map((e) => e.folder.path),
      [`${raizA}\\uno`],
    );
  });

  it('dropCachedEntries retira solo lo pedido, el resto de la raíz se queda', () => {
    cache.dropCachedEntries([`${raizA}\\uno`]);
    assert.equal(cache.getCachedEntry(`${raizA}\\uno`), null);
    // La de raízB, que nadie pidió borrar, sigue ahí.
    assert.notEqual(cache.getCachedEntry(`${raizB}\\dos`), null);
  });

  it('getLastScanAt: la fecha MÁS RECIENTE entre las raíces pedidas, o null sin nada', () => {
    assert.equal(cache.getLastScanAt(['Z:\\RaizQueNoExiste']), null);
    assert.equal(cache.getLastScanAt([raizB]), '2026-02-02T00:00:00.000Z');
  });
});

describe('needsDescribe: cuándo hay que volver a mirar DENTRO de una carpeta', () => {
  const AHORA = Date.parse('2026-03-01T12:00:00.000Z');

  it('sin entrada previa, siempre hay que mirar', () => {
    assert.equal(cache.needsDescribe(null, AHORA), true);
  });

  it('con un ejecutable ya encontrado, no hace falta volver a mirar', () => {
    const e = entrada({
      folder: carpeta({ executableCandidates: ['C:\\Palworld\\Palworld.exe'] }),
    });
    assert.equal(cache.needsDescribe(e, AHORA), false);
  });

  it('sin ejecutable pero vista hace poco (dentro de las 2h), se vuelve a mirar', () => {
    const e = entrada({ firstSeenAt: new Date(AHORA - 30 * 60 * 1000).toISOString() });
    assert.equal(cache.needsDescribe(e, AHORA), true);
  });

  it('sin ejecutable y pasadas las 2h desde que se vio, se deja de mirar', () => {
    const e = entrada({ firstSeenAt: new Date(AHORA - 3 * 60 * 60 * 1000).toISOString() });
    assert.equal(cache.needsDescribe(e, AHORA), false);
  });

  it('la ventana cuenta desde firstSeenAt, NO desde scannedAt — el bug que esto arregló', () => {
    // Carpeta vista por primera vez hace 5h (ventana YA cerrada) pero
    // reescaneada hace un minuto (scannedAt reciente). Contando desde
    // scannedAt como hacía la versión vieja, esto daría `true` para SIEMPRE
    // en cada barrido — la carpeta sin .exe nunca dejaría de recorrerse.
    const e = entrada({
      firstSeenAt: new Date(AHORA - 5 * 60 * 60 * 1000).toISOString(),
      scannedAt: new Date(AHORA - 60 * 1000).toISOString(),
    });
    assert.equal(cache.needsDescribe(e, AHORA), false);
  });
});

describe('needsMatch: cuándo hay que volver a preguntarle a IGDB', () => {
  const AHORA = Date.parse('2026-03-01T12:00:00.000Z');
  const unMatch: IgdbSearchResult = {
    igdbId: 1,
    title: 'Palworld',
    coverUrl: null,
    releaseYear: 2024,
    platforms: [],
    genres: [],
    summary: null,
  };

  it('sin entrada previa, siempre se pregunta', () => {
    assert.equal(cache.needsMatch(null, AHORA), true);
  });

  it('nunca se pudo preguntar (matchedAt null): NO se reintenta antes de los 10 min', () => {
    const e = entrada({
      matchedAt: null,
      scannedAt: new Date(AHORA - 5 * 60 * 1000).toISOString(),
    });
    assert.equal(cache.needsMatch(e, AHORA), false);
  });

  it('nunca se pudo preguntar: SÍ se reintenta pasados los 10 min', () => {
    const e = entrada({
      matchedAt: null,
      scannedAt: new Date(AHORA - 15 * 60 * 1000).toISOString(),
    });
    assert.equal(cache.needsMatch(e, AHORA), true);
  });

  it('con matches encontrados, no se repite nunca (aunque matchedAt sea viejo)', () => {
    const e = entrada({
      matches: [unMatch],
      matchedAt: new Date(AHORA - 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(cache.needsMatch(e, AHORA), false);
  });

  it('"nada encontrado" (matches vacío) NO se repite antes de las 24h', () => {
    const e = entrada({
      matches: [],
      matchedAt: new Date(AHORA - 23 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(cache.needsMatch(e, AHORA), false);
  });

  it('"nada encontrado" SÍ se repite pasadas las 24h', () => {
    const e = entrada({
      matches: [],
      matchedAt: new Date(AHORA - 25 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(cache.needsMatch(e, AHORA), true);
  });

  it('una entrada de un fichero viejo sin el campo matchedAt usa scannedAt, no NaN', () => {
    // El `??` de needsMatch existe para esto: sin él, Date.parse(undefined)
    // da NaN y la resta con `now` también es NaN — `NaN > MATCH_RETRY_MS` es
    // `false` siempre, así que la carpeta no se preguntaría JAMÁS.
    const sinCampo = { ...entrada(), scannedAt: new Date(AHORA - 15 * 60 * 1000).toISOString() };
    delete (sinCampo as { matchedAt?: unknown }).matchedAt;

    assert.equal(cache.needsMatch(sinCampo, AHORA), true);
  });
});
