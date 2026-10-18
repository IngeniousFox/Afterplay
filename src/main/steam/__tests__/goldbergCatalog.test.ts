import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  type TestDb,
} from '../../db/__tests__/harness';

// DÓNDE BUSCA AFTERPLAY LAS steam_settings DE GSE (emu/goldbergCatalog.ts).
//
// QUÉ ES REAL Y QUÉ ES DOBLE: las carpetas de juego son de verdad, en un
// temporal, con la forma exacta de cada caso — vacías salvo lo que el
// emulador mira. La base es la del andamio, enchufada a getDb() al importarlo
// (por eso el módulo se carga con import() DESPUÉS, ver harness.ts).

let findSteamSettingsDirs: typeof import('../emu/goldbergCatalog').findSteamSettingsDirs;
let ensureGoldbergCatalog: typeof import('../emu/goldbergCatalog').ensureGoldbergCatalog;
let db: TestDb;

const carpetas: string[] = [];

before(async () => {
  ({ findSteamSettingsDirs, ensureGoldbergCatalog } = await import('../emu/goldbergCatalog'));
});

beforeEach(async () => {
  db = await freshDb();
});

after(() => {
  cleanupDbs();
  for (const dir of carpetas) rmSync(dir, { recursive: true, force: true });
});

// Una carpeta de juego con estas subcarpetas creadas.
const juego = (...subcarpetas: string[]): string => {
  const root = mkdtempSync(join(tmpdir(), 'afterplay-test-goldberg-'));
  carpetas.push(root);
  for (const sub of subcarpetas) mkdirSync(join(root, sub), { recursive: true });
  return root;
};

// La ruta de Unreal tal como la trae The Adventures of Elliot.
const UNREAL = join('Engine', 'Binaries', 'ThirdParty', 'Steamworks', 'Steamv157', 'Win64');

describe('findSteamSettingsDirs', () => {
  it('Unreal: encuentra la steam_settings junto a la DLL del motor, seis niveles abajo', () => {
    const root = juego(join(UNREAL, 'steam_settings'), join('Elliot', 'Binaries', 'Win64'));
    assert.deepEqual(findSteamSettingsDirs(root), [join(root, UNREAL, 'steam_settings')]);
  });

  it('Unreal de 32 bits y cualquier versión de Steamworks', () => {
    const win32 = join('Engine', 'Binaries', 'ThirdParty', 'Steamworks', 'Steamv139', 'Win32');
    const root = juego(join(win32, 'steam_settings'));
    assert.deepEqual(findSteamSettingsDirs(root), [join(root, win32, 'steam_settings')]);
  });

  it('Unreal sin GSE (Steamworks sin steam_settings): nada que escribir', () => {
    const root = juego(UNREAL);
    assert.deepEqual(findSteamSettingsDirs(root), []);
  });

  it('sigue encontrando los casos de siempre: junto al exe y en Unity', () => {
    const unity = join('Juego_Data', 'Plugins', 'x86_64', 'steam_settings');
    const root = juego('steam_settings', unity);
    assert.deepEqual(
      findSteamSettingsDirs(root).sort(),
      [join(root, 'steam_settings'), join(root, unity)].sort(),
    );
  });

  it('el límite general no se mueve: una steam_settings enterrada fuera de Unreal no se busca', () => {
    const root = juego(join('mods', 'a', 'b', 'c', 'd', 'e', 'steam_settings'));
    assert.deepEqual(findSteamSettingsDirs(root), []);
  });

  it('un FICHERO llamado steam_settings en la ruta de Unreal no cuenta', () => {
    const root = juego(UNREAL);
    writeFileSync(join(root, UNREAL, 'steam_settings'), '');
    assert.deepEqual(findSteamSettingsDirs(root), []);
  });
});

describe('ensureGoldbergCatalog en un juego de Unreal', () => {
  it('escribe el achievements.json que le falta a GSE, con los logros del catálogo', async () => {
    const root = juego(join(UNREAL, 'steam_settings'));
    const gameId = await makeGame(db, { installDirectory: root });
    await makeAchievement(db, gameId, 'ACH_FIRST_STEP', { displayName: 'First step' });
    await makeAchievement(db, gameId, 'ACH_SECRET', { hidden: true });

    const escritos = await ensureGoldbergCatalog(gameId, root);

    const fichero = join(root, UNREAL, 'steam_settings', 'achievements.json');
    assert.equal(escritos, 1);
    const catalogo = JSON.parse(readFileSync(fichero, 'utf8')) as {
      name: string;
      hidden: string;
    }[];
    assert.deepEqual(catalogo.map((a) => a.name).sort(), ['ACH_FIRST_STEP', 'ACH_SECRET']);
    assert.equal(catalogo.find((a) => a.name === 'ACH_SECRET')?.hidden, '1');
  });

  it('nunca pisa un achievements.json que ya esté', async () => {
    const root = juego(join(UNREAL, 'steam_settings'));
    const fichero = join(root, UNREAL, 'steam_settings', 'achievements.json');
    writeFileSync(fichero, '[]');
    const gameId = await makeGame(db, { installDirectory: root });
    await makeAchievement(db, gameId, 'ACH_FIRST_STEP');

    assert.equal(await ensureGoldbergCatalog(gameId, root), 0);
    assert.equal(readFileSync(fichero, 'utf8'), '[]');
    assert.ok(existsSync(fichero));
  });
});
