import { RARE, ULTRA_RARE } from '../../../../../shared/achievements';
import type { AchievementsOverview } from '../../../../../shared/types';
import type { QueryContext } from '../common/context';
import { readGameRows } from '../common/gameView';
import { achievementKey, type AchievementKey } from './ids';
import {
  completedAtOf,
  loadCatalogProgress,
  progressIsComplete,
  progressIsKnown,
  type CatalogProgress,
  type UnlockedItem,
} from './progress';

// La vista GLOBAL de los logros para el bloque de trofeos de Stats
// (LOGROS-IDEAS.md §3-4). Port de getAchievementsOverview.ts con sus reglas:
//   1. `dateReliable = false` nunca cuenta en lo temporal (años, meses, fama
//      con año); sí en totales, completados y rareza.
//   2. Un catálogo sin desbloqueos preguntados y sin ninguno constatado no es
//      un 0 %: no entra en completados ni en "almost there".
//   3. Los ocultos siguen siendo spoiler: lo que falta viaja sin descripción.
//
// Lo que cambia con el 2.0:
// - Completado POR FUENTE (R-11): el muro del 100 % y "almost there" tienen
//   una entrada por catálogo (juego × fuente), con `source` añadido. Un juego
//   con Steam y RA al 100 % sale dos veces; uno con RA al 100 % y Steam a
//   medias sale en el muro por RA. `total` es el de esa fuente. Antes era la
//   suma de las dos.
// - `totalCatalog` cuenta solo catálogos de juegos vivos. La 1.x contaba
//   también filas huérfanas de un borrado a medias; en el 2.0 los catálogos
//   de un juego borrado se quedan como caché (`keep`) y no se enseñan.
// - Población: todos los juegos vivos con catálogo, PLANEADOS INCLUIDOS (la
//   decisión de hoy, getAchievementsOverview.ts:137-156).
// - Los ids son texto: `achievementId` = `<gameId>:<source>:<apiName>`.

const isRare = (percent: number | null): boolean =>
  percent !== null && percent < RARE && percent >= ULTRA_RARE;
const isUltra = (percent: number | null): boolean => percent !== null && percent < ULTRA_RARE;
const ALMOST_THERE_MIN = 0.75;
const HALL_OF_FAME_SIZE = 10;
const ALMOST_THERE_GAMES = 6;
const ALMOST_THERE_MISSING = 5;

// Con ids de texto, `AchievementsOverview<string>` ya lleva `source` en las
// entradas del muro y de "almost there" (shared/types.ts).
type Overview = AchievementsOverview<string>;
type PerfectGame = Overview['perfectGames'][number];
type AlmostThere = Overview['almostThere'][number];

interface Unlocked {
  readonly achievementId: AchievementKey;
  readonly gameId: string;
  readonly displayName: string;
  readonly iconUrl: string | null;
  readonly globalPercent: number | null;
  readonly unlockedAt: Date;
  readonly dateReliable: boolean;
}

const toUnlocked = (progress: CatalogProgress, unlock: UnlockedItem): Unlocked => ({
  achievementId: achievementKey(progress.gameId, progress.source, unlock.item.apiName),
  gameId: progress.gameId,
  displayName: unlock.item.displayName,
  iconUrl: unlock.item.iconUrl,
  globalPercent: unlock.item.globalPercent,
  unlockedAt: unlock.unlockedAt,
  dateReliable: unlock.dateReliable,
});

/**
 * `year = null` → All Time. Con año: fama, perfil de rareza y totales del año
 * solo con fechas fiables de ese año; el muro son los completados ese año;
 * "almost there" viene vacío (es una foto de ahora).
 */
export function getAchievementsOverview(ctx: QueryContext, year: number | null): Overview {
  const catalogs = loadCatalogProgress(ctx);

  // Los desbloqueados, en el orden estable de la 1.x (allí, el id del logro;
  // aquí, catálogo por orden de creación y logro por su posición).
  const unlockedDefs: Unlocked[] = catalogs.flatMap((p) => p.unlocked.map((u) => toUnlocked(p, u)));
  const known = catalogs.filter(progressIsKnown);
  const scopedUnlocked =
    year === null
      ? unlockedDefs
      : unlockedDefs.filter((u) => u.dateReliable && u.unlockedAt.getFullYear() === year);

  // Título y carátula (efectiva) solo de los juegos que salen en alguna lista:
  // la vista común del juego cuesta ~8 ms para la biblioteca entera y aquí
  // salen unas decenas.
  const shown = new Set<string>([...known.filter(progressIsComplete).map((p) => p.gameId)]);
  if (year === null) {
    for (const p of known) {
      const ratio = p.unlocked.length / Math.max(1, p.total);
      if (p.total > 0 && ratio >= ALMOST_THERE_MIN && ratio < 1) shown.add(p.gameId);
    }
  } else {
    for (const u of scopedUnlocked) shown.add(u.gameId);
  }
  for (const u of scopedUnlocked) if (u.globalPercent !== null) shown.add(u.gameId);
  const gamesById = new Map(readGameRows(ctx, [...shown]).map((game) => [game.id, game]));
  const titleOf = (gameId: string): string => gamesById.get(gameId)?.title ?? '';
  const coverOf = (gameId: string): string | null => gamesById.get(gameId)?.coverUrl ?? null;

  const perfectGames: PerfectGame[] = known
    .filter(progressIsComplete)
    .map((p) => ({
      gameId: p.gameId,
      source: p.source,
      title: titleOf(p.gameId),
      coverUrl: coverOf(p.gameId),
      total: p.total,
      completedAt: completedAtOf(p),
    }))
    .filter(
      (game) =>
        year === null || (game.completedAt !== null && game.completedAt.getFullYear() === year),
    )
    .sort((a, b) => b.total - a.total);

  const almostThere: AlmostThere[] = (year === null ? known : [])
    .map((p) => ({ p, ratio: p.unlocked.length / Math.max(1, p.total) }))
    .filter(({ p, ratio }) => p.total > 0 && ratio >= ALMOST_THERE_MIN && ratio < 1)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, ALMOST_THERE_GAMES)
    .map(({ p }) => {
      // Con ratio ≥ 75 % hay desbloqueos, así que el catálogo ya viene desplegado.
      const have = new Set(p.unlocked.map((u) => u.item.apiName));
      const missing = (p.items ?? [])
        .filter((item) => !have.has(item.apiName))
        // Lo MÁS común primero (lo más alcanzable); sort estable sobre el
        // orden del catálogo, sin rareza al final.
        .sort((a, b) => (b.globalPercent ?? -1) - (a.globalPercent ?? -1))
        .slice(0, ALMOST_THERE_MISSING)
        .map((item) => ({
          achievementId: achievementKey(p.gameId, p.source, item.apiName),
          displayName: item.displayName,
          // El icono APAGADO a propósito: aún no es tuyo.
          iconUrl: item.iconGrayUrl ?? item.iconUrl,
          globalPercent: item.globalPercent,
          hidden: item.hidden,
        }));
      return {
        gameId: p.gameId,
        source: p.source,
        title: titleOf(p.gameId),
        coverUrl: coverOf(p.gameId),
        unlocked: p.unlocked.length,
        total: p.total,
        missing,
      };
    });

  const hallOfFame = scopedUnlocked
    .filter((u) => u.globalPercent !== null)
    .sort((a, b) => (a.globalPercent ?? 0) - (b.globalPercent ?? 0))
    .slice(0, HALL_OF_FAME_SIZE)
    .map((u) => ({
      achievementId: u.achievementId,
      gameId: u.gameId,
      gameTitle: titleOf(u.gameId),
      displayName: u.displayName,
      iconUrl: u.iconUrl,
      globalPercent: u.globalPercent as number,
      unlockedAt: u.dateReliable ? u.unlockedAt : null,
    }));

  // Años y meses en JS, en la zona horaria de quien mira (getAchievementsOverview.ts:375-380).
  const byYear = new Map<number, { total: number; rare: number; ultra: number }>();
  for (const u of unlockedDefs) {
    if (!u.dateReliable) continue;
    const y = u.unlockedAt.getFullYear();
    const entry = byYear.get(y) ?? { total: 0, rare: 0, ultra: 0 };
    entry.total++;
    if (isRare(u.globalPercent)) entry.rare++;
    if (isUltra(u.globalPercent)) entry.ultra++;
    byYear.set(y, entry);
  }
  const unlockedByYear = [...byYear.entries()]
    .map(([y, entry]) => ({ year: y, ...entry }))
    .sort((a, b) => a.year - b.year);

  const withPercent = scopedUnlocked.filter((u) => u.globalPercent !== null);
  const rarityProfile = {
    common: withPercent.filter((u) => (u.globalPercent as number) >= RARE).length,
    rare: withPercent.filter((u) => isRare(u.globalPercent)).length,
    ultra: withPercent.filter((u) => isUltra(u.globalPercent)).length,
  };

  let topGames: Overview['topGames'] = null;
  if (year !== null) {
    const byGame = new Map<string, { total: number; rare: number; ultra: number }>();
    for (const u of scopedUnlocked) {
      const entry = byGame.get(u.gameId) ?? { total: 0, rare: 0, ultra: 0 };
      entry.total++;
      if (isRare(u.globalPercent)) entry.rare++;
      if (isUltra(u.globalPercent)) entry.ultra++;
      byGame.set(u.gameId, entry);
    }
    topGames = [...byGame.entries()]
      .map(([gameId, counts]) => ({
        gameId,
        title: titleOf(gameId),
        coverUrl: coverOf(gameId),
        ...counts,
      }))
      .sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  }

  return {
    totalUnlocked: unlockedDefs.length,
    totalCatalog: catalogs.reduce((sum, p) => sum + p.total, 0),
    yearTotals:
      year === null
        ? null
        : {
            total: scopedUnlocked.length,
            rare: scopedUnlocked.filter((u) => isRare(u.globalPercent)).length,
            ultra: scopedUnlocked.filter((u) => isUltra(u.globalPercent)).length,
          },
    topGames,
    unlockedByMonth:
      year === null
        ? null
        : Array.from({ length: 12 }, (_, month) => {
            const inMonth = scopedUnlocked.filter((u) => u.unlockedAt.getMonth() === month);
            const rare = inMonth.filter((u) => isRare(u.globalPercent)).length;
            const ultra = inMonth.filter((u) => isUltra(u.globalPercent)).length;
            return {
              month,
              total: inMonth.length,
              common: inMonth.length - rare - ultra,
              rare,
              ultra,
            };
          }),
    unlockedByYear,
    hallOfFame,
    perfectGames,
    almostThere,
    rarityProfile,
  };
}
