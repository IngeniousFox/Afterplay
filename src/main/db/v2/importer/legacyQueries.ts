import { asc, isNull } from 'drizzle-orm';
import { getDb } from '../../index';
import { getAchievementsOverview } from '../../queries/achievements/getAchievementsOverview';
import { getAchievementsStatus } from '../../queries/achievements/getAchievementsStatus';
import { getGameAchievements } from '../../queries/achievements/getGameAchievements';
import { getSessionUnlocks } from '../../queries/achievements/getSessionUnlocks';
import { getAllCuriosities } from '../../queries/curiosities/getAllCuriosities';
import { getCuriositiesCounts } from '../../queries/curiosities/getPendingCuriositiesGames';
import { getGameById } from '../../queries/games/getGameById';
import { getGames } from '../../queries/games/getGames';
import { getPlannedGameExtras, getPlannedGames } from '../../queries/games/getPlannedGames';
import { getLatestMemories } from '../../queries/memories/getLatestMemories';
import { getMemoryFacts } from '../../queries/memories/getMemoryFacts';
import { getAllSessions } from '../../queries/sessions/getAllSessions';
import { getAllSpendEvents } from '../../queries/spend/getAllSpendEvents';
import { getAllStateEvents } from '../../queries/stateEvents/getAllStateEvents';
import { gamesTable, radarGamesTable } from '../../schema';

// "LO QUE EL USUARIO VE HOY": las lecturas de la 1.x, con su propio código,
// sobre la base 1.x que devuelva `getDb()`.
//
// Es la mitad 1.x de la validación con consultas (`queryValidation.ts`). Va
// en un módulo aparte, que solo se carga con `import()`, por una razón
// práctica: las consultas 1.x importan `getDb` de `src/main/db/index.ts`, y
// ese módulo arrastra Electron y `@tursodatabase/sync`, que no cargan fuera de
// la app. Quien llama decide de dónde sale `getDb()`:
// - en la app (el corte, fase 10), es la conexión 1.x de siempre;
// - en el script y en los tests, `legacyQueryHost.ts` sustituye ese módulo
//   (como hace `db/__tests__/harness.ts`) por una conexión `@libsql/client`
//   a la copia de la base, el mismo driver con el que se prueban hoy estas
//   consultas.
//
// Las consultas son asíncronas y la importación es una transacción síncrona,
// así que esto se ejecuta ANTES, y la validación recibe la foto ya hecha.
// Ninguna de estas lecturas escribe.

/** Una foto de todo lo que enseñan las lecturas 1.x que la validación compara. */
export interface LegacyQueryViews {
  readonly games: Awaited<ReturnType<typeof getGames>>;
  /** La ficha de CADA juego (planeados incluidos), por id 1.x. */
  readonly details: ReadonlyMap<number, NonNullable<Awaited<ReturnType<typeof getGameById>>>>;
  readonly planned: Awaited<ReturnType<typeof getPlannedGames>>;
  readonly plannedExtras: Awaited<ReturnType<typeof getPlannedGameExtras>>;
  readonly sessions: Awaited<ReturnType<typeof getAllSessions>>;
  readonly stateEvents: Awaited<ReturnType<typeof getAllStateEvents>>;
  readonly spendEvents: Awaited<ReturnType<typeof getAllSpendEvents>>;
  /** La ficha de logros de cada juego, por id 1.x. */
  readonly achievements: ReadonlyMap<number, Awaited<ReturnType<typeof getGameAchievements>>>;
  /** El resumen global: `null` (All Time) y cada año con desbloqueos fiables. */
  readonly overview: ReadonlyMap<
    number | null,
    Awaited<ReturnType<typeof getAchievementsOverview>>
  >;
  readonly status: Awaited<ReturnType<typeof getAchievementsStatus>>;
  readonly sessionUnlocks: Awaited<ReturnType<typeof getSessionUnlocks>>;
  readonly memories: Awaited<ReturnType<typeof getLatestMemories>>;
  readonly memoryFacts: Awaited<ReturnType<typeof getMemoryFacts>>;
  readonly curiosities: Awaited<ReturnType<typeof getAllCuriosities>>;
  readonly curiositiesCounts: Awaited<ReturnType<typeof getCuriositiesCounts>>;
  readonly radar: Awaited<ReturnType<typeof listLegacyRadar>>;
  /** Cuánto tardó la foto (informe). */
  readonly elapsedMs: number;
}

/**
 * La lectura del radar de la 1.x vive en su manejador de IPC (`radar:list`,
 * `src/main/ipc/radar.ts`), que no se puede importar fuera de Electron. Es
 * esta misma consulta, copiada tal cual (selección, filtro y orden).
 */
async function listLegacyRadar(): Promise<
  {
    id: number;
    igdbId: number;
    title: string;
    coverUrl: string | null;
    collectionName: string | null;
    releaseDate: Date | null;
    releaseDatePrecision: 'year' | 'month' | 'day' | null;
    releaseYear: number | null;
    discoveredAt: Date;
    dismissedAt: Date | null;
  }[]
> {
  return getDb()
    .select({
      id: radarGamesTable.id,
      igdbId: radarGamesTable.igdbId,
      title: radarGamesTable.title,
      coverUrl: radarGamesTable.coverUrl,
      collectionName: radarGamesTable.collectionName,
      releaseDate: radarGamesTable.releaseDate,
      releaseDatePrecision: radarGamesTable.releaseDatePrecision,
      releaseYear: radarGamesTable.releaseYear,
      discoveredAt: radarGamesTable.discoveredAt,
      dismissedAt: radarGamesTable.dismissedAt,
    })
    .from(radarGamesTable)
    .where(isNull(radarGamesTable.dismissedAt))
    .orderBy(asc(radarGamesTable.releaseDate));
}

/** Las credenciales que la 1.x lee de `process.env` (la 2.0 las recibe igual). */
export const legacyStatusCredentials = (): {
  hasApiKey: boolean;
  hasUserId: boolean;
  hasRaCredentials: boolean;
} => ({
  hasApiKey: Boolean(process.env.STEAM_API_KEY),
  hasUserId: Boolean(process.env.STEAM_USER_ID64),
  hasRaCredentials: Boolean(process.env.RA_USERNAME && process.env.RA_API_KEY),
});

/** Ejecuta todas las lecturas 1.x sobre la base de `getDb()`. */
export async function collectLegacyQueryViews(): Promise<LegacyQueryViews> {
  const started = performance.now();
  const ids = (await getDb().select({ id: gamesTable.id }).from(gamesTable)).map((g) => g.id);

  const details = new Map<number, NonNullable<Awaited<ReturnType<typeof getGameById>>>>();
  const achievements = new Map<number, Awaited<ReturnType<typeof getGameAchievements>>>();
  for (const id of ids) {
    const detail = await getGameById(id);
    if (detail) details.set(id, detail);
    achievements.set(id, await getGameAchievements(id));
  }

  // All Time y, además, cada año que el propio resumen dice que tiene
  // desbloqueos: así se comparan todas las vistas por año que puede pedir Stats.
  const overview = new Map<number | null, Awaited<ReturnType<typeof getAchievementsOverview>>>();
  const allTime = await getAchievementsOverview(null);
  overview.set(null, allTime);
  for (const { year } of allTime.unlockedByYear) {
    overview.set(year, await getAchievementsOverview(year));
  }

  return {
    games: await getGames(),
    details,
    planned: await getPlannedGames(),
    plannedExtras: await getPlannedGameExtras(),
    sessions: await getAllSessions(),
    stateEvents: await getAllStateEvents(),
    spendEvents: await getAllSpendEvents(),
    achievements,
    overview,
    status: await getAchievementsStatus(false, 0),
    sessionUnlocks: await getSessionUnlocks(),
    memories: await getLatestMemories(),
    memoryFacts: await getMemoryFacts(),
    curiosities: await getAllCuriosities(),
    curiositiesCounts: await getCuriositiesCounts(),
    radar: await listLegacyRadar(),
    elapsedMs: Math.round(performance.now() - started),
  };
}
