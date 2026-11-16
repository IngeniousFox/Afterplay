import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeAppDbFixture, freshAppDb } from '../../db/v2/__tests__/appDbHarness';
import {
  seedGame,
  type QueryFixture,
  type SeedGameOptions,
} from '../../db/v2/queries/common/__tests__/fixtures';
import { gameInstalls, gameMetadata, games, planEntries } from '../../db/v2/schema';
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
// (ipc/gamePatch.ts), updateGame y la base (2.0 en memoria con las migraciones
// reales, appDbHarness.ts) son de verdad. Doblados: electron, el registro del IPC (handleDb, para poder
// llamar al handler a mano) y los módulos de red/colas que games.ts arrastra al
// importarse, que este test no ejercita.

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const achievementsQueued: string[] = [];

mock.module('electron', {
  namedExports: {
    ipcMain: { handle: (): void => {} },
    shell: { openPath: async (): Promise<string> => '' },
  },
});

mock.module('../contractHandlers', {
  namedExports: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
  },
});

mock.module('../../steam/backfill', {
  namedExports: {
    queueAchievementsRefreshForGame: async (gameId: string): Promise<boolean> => {
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
mock.module('../../steam/notify', {
  namedExports: { notifyAchievementsActivity: (): void => {} },
});
mock.module('../../lib/openPath', {
  namedExports: { openPathResult: async (): Promise<{ ok: true }> => ({ ok: true }) },
});

let update: (id: string, patch: Record<string, unknown>) => Promise<GameRow | null>;
let fx: QueryFixture;

before(async () => {
  const { registerGamesHandlers } = await import('../games');
  registerGamesHandlers();
  const handler = handlers.get('games:update');
  assert.ok(handler, 'games:update debería estar registrado');
  update = (id, patch) => handler({}, id, patch) as Promise<GameRow | null>;
});

beforeEach(async () => {
  fx = freshAppDb();
  achievementsQueued.length = 0;
});

after(closeAppDbFixture);

const ADDED_AT = new Date('2026-01-01T00:00:00Z');

const makeGame = (options: Partial<SeedGameOptions> = {}): string =>
  seedGame(fx.ctx, { title: 'Juego', addedAt: ADDED_AT, ...options });

// Lo que el renderer podría intentar pisar vive repartido en la 2.0: la
// identidad en `games`, la caché externa en `game_metadata`, el Plan en
// `plan_entries` y las rutas en `game_installs`.
type FilaLeida = typeof games.$inferSelect & {
  summary: string | null;
  ratingCritics: number | null;
  steamTags: (typeof gameMetadata.$inferSelect)['steamTags'];
  planned: boolean;
};

const readRow = async (id: string): Promise<FilaLeida> => {
  const game = fx.ctx.db.select().from(games).where(eq(games.id, id)).get();
  assert.ok(game);
  const metadata = fx.ctx.db.select().from(gameMetadata).where(eq(gameMetadata.gameId, id)).get();
  const planned = fx.ctx.db
    .select({ id: planEntries.id })
    .from(planEntries)
    .where(eq(planEntries.gameId, id))
    .all();
  return {
    ...game,
    summary: metadata?.summary ?? null,
    ratingCritics: metadata?.ratingCritics ?? null,
    steamTags: metadata?.steamTags ?? null,
    planned: planned.length > 0,
  };
};

const installOf = (id: string): typeof gameInstalls.$inferSelect | undefined =>
  fx.ctx.db.select().from(gameInstalls).where(eq(gameInstalls.gameId, id)).get();

describe('games:update', () => {
  it('escribe las claves permitidas y descarta en silencio las que no lo están', async () => {
    const id = makeGame({
      title: 'Antes',
      notes: null,
      metadata: { summary: 'Sinopsis de IGDB', ratingCritics: 80 },
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
    const id = makeGame({ title: 'Intacto' });

    const returned = await update(id, { summary: 'No', planned: true });

    const row = await readRow(id);
    assert.equal(row.summary, null);
    assert.equal(row.planned, false);
    assert.equal(returned?.title, 'Intacto');
  });

  it('sigue rechazando el appid con el aviso de su editor, sin escribir', async () => {
    const id = makeGame({ title: 'Con appid', steamAppId: 10 });

    await assert.rejects(update(id, { steamAppId: 20, title: 'No' }), /Steam App ID editor/);
    await assert.rejects(update(id, { steamAppIdManual: true }), /Steam App ID editor/);

    const row = await readRow(id);
    assert.equal(row.steamAppId, 10);
    assert.equal(row.title, 'Con appid');
  });

  it('encola los logros solo cuando el patch toca exe o carpeta', async () => {
    const id = makeGame();

    await update(id, { notes: 'Nada que ver con la instalación' });
    assert.deepEqual(achievementsQueued, []);

    await update(id, { installDirectory: 'D:/Juegos/X', installSizeBytes: 1024 });
    await update(id, { executablePath: 'D:/Juegos/X/x.exe' });
    assert.deepEqual(achievementsQueued, [id, id]);
    // Y las rutas quedan en la instalación de ESTE PC, no en el juego.
    assert.equal(installOf(id)?.executablePath, 'D:/Juegos/X/x.exe');
  });
});
