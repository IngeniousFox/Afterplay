import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { gamesTable } from '../../db/schema';
import type { GameRow } from '../../../shared/types';

// games:update SOLO ESCRIBE LAS CLAVES DE SU LISTA CERRADA (F-42).
//
// El tipo UpdateGamePatch no viaja por el IPC: al handler le llega un objeto
// cualquiera, y antes de esto `db.update(games).set(patch)` escribía TODO lo
// que trajera dentro — las columnas de caché externa (notas de IGDB, sinopsis,
// etiquetas de Steam, sellos de "ya preguntado"), `planned`, hasta `addedAt`.
// Lo que se blinda aquí es el handler de verdad: sus claves permitidas llegan
// a la fila, las demás se descartan sin tocar nada, y lo que ya hacía (el
// aviso del editor de appid, encolar logros al tocar exe/carpeta) sigue igual.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: el handler (ipc/games.ts), el filtro
// (ipc/gamePatch.ts), updateGame y la base (andamio con las migraciones reales)
// son de verdad. Doblados: electron, el registro del IPC (handleDb, para poder
// llamar al handler a mano) y los módulos de red/colas que games.ts arrastra al
// importarse, que este test no ejercita.

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const achievementsQueued: number[] = [];

mock.module('electron', {
  namedExports: {
    ipcMain: { handle: (): void => {} },
    shell: { openPath: async (): Promise<string> => '' },
  },
});

mock.module('../dbHandle', {
  namedExports: {
    handleDb: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
  },
});

mock.module('../../steam/backfill', {
  namedExports: {
    queueAchievementsRefreshForGame: async (gameId: number): Promise<boolean> => {
      achievementsQueued.push(gameId);
      return true;
    },
  },
});

mock.module('../../external/warmNewGame', {
  namedExports: { warmImageCache: (): void => {}, warmSteamData: (): void => {} },
});
mock.module('../../curiosities/backfill', {
  namedExports: { generateCuriositiesInBackground: (): void => {} },
});
mock.module('../../saves/orchestrator', {
  namedExports: { purgeGameSaves: async (): Promise<void> => {} },
});
mock.module('../../steam/notify', {
  namedExports: { notifyAchievementsActivity: (): void => {} },
});
mock.module('../../lib/openPath', {
  namedExports: { openPathResult: async (): Promise<{ ok: true }> => ({ ok: true }) },
});
mock.module('../../db/queries/games/createGameWithDetails', {
  namedExports: { createGameWithDetails: async (): Promise<never> => assert.fail('no se usa') },
});
mock.module('../../db/queries/games/createPlannedGame', {
  namedExports: { createPlannedGame: async (): Promise<never> => assert.fail('no se usa') },
});

let update: (id: number, patch: Record<string, unknown>) => Promise<GameRow | null>;
let db: TestDb;

before(async () => {
  const { registerGamesHandlers } = await import('../games');
  registerGamesHandlers();
  const handler = handlers.get('games:update');
  assert.ok(handler, 'games:update debería estar registrado');
  update = (id, patch) => handler({}, id, patch) as Promise<GameRow | null>;
});

beforeEach(async () => {
  db = await freshDb();
  achievementsQueued.length = 0;
});

after(cleanupDbs);

const readRow = async (id: number): Promise<typeof gamesTable.$inferSelect> => {
  const [row] = await db.select().from(gamesTable).where(eq(gamesTable.id, id));
  return row;
};

const ADDED_AT = new Date('2026-01-01T00:00:00Z');

describe('games:update', () => {
  it('escribe las claves permitidas y descarta en silencio las que no lo están', async () => {
    const id = await makeGame(db, {
      title: 'Antes',
      notes: null,
      summary: 'Sinopsis de IGDB',
      ratingCritics: 80,
      planned: false,
      raGameId: null,
    });

    const returned = await update(id, {
      // Permitidas.
      title: 'Después',
      notes: 'Mis notas',
      endless: true,
      // Fuera de la lista: caché externa, el flag del Plan, la fecha de alta…
      summary: 'Pisada desde el renderer',
      ratingCritics: 1,
      planned: true,
      raGameId: 999,
      addedAt: new Date('2000-01-01T00:00:00Z'),
      steamTags: [{ name: 'Inyectada', votes: 1 }],
    });

    const row = await readRow(id);
    assert.equal(row.title, 'Después');
    assert.equal(row.notes, 'Mis notas');
    assert.equal(row.endless, true);
    assert.equal(row.summary, 'Sinopsis de IGDB');
    assert.equal(row.ratingCritics, 80);
    assert.equal(row.planned, false);
    assert.equal(row.raGameId, null);
    assert.equal(row.steamTags, null);
    assert.deepEqual(row.addedAt, ADDED_AT);
    // Lo que devuelve el handler es la fila tal como quedó, no el patch.
    assert.equal(returned?.title, 'Después');
    assert.equal(returned?.summary, 'Sinopsis de IGDB');
  });

  it('un patch con SOLO claves prohibidas no escribe nada y devuelve el juego', async () => {
    const id = await makeGame(db, { title: 'Intacto', summary: null });

    const returned = await update(id, { summary: 'No', planned: true });

    const row = await readRow(id);
    assert.equal(row.summary, null);
    assert.equal(row.planned, false);
    assert.equal(returned?.title, 'Intacto');
  });

  it('sigue rechazando el appid con el aviso de su editor, sin escribir', async () => {
    const id = await makeGame(db, { title: 'Con appid', steamAppId: 10 });

    await assert.rejects(update(id, { steamAppId: 20, title: 'No' }), /Steam App ID editor/);
    await assert.rejects(update(id, { steamAppIdManual: true }), /Steam App ID editor/);

    const row = await readRow(id);
    assert.equal(row.steamAppId, 10);
    assert.equal(row.title, 'Con appid');
  });

  it('encola los logros solo cuando el patch toca exe o carpeta', async () => {
    const id = await makeGame(db);

    await update(id, { notes: 'Nada que ver con la instalación' });
    assert.deepEqual(achievementsQueued, []);

    await update(id, { installDirectory: 'D:/Juegos/X', installSizeBytes: 1024 });
    await update(id, { executablePath: 'D:/Juegos/X/x.exe' });
    assert.deepEqual(achievementsQueued, [id, id]);
  });
});
