import { getDb } from '../..';
import type { AchievementsOverview } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../../schema';

// La vista GLOBAL de los logros (LOGROS-IDEAS.md §3-4): la materia del
// bloque de trofeos de Stats — salón de la fama, totales por año, muro de
// 100%, perfil de rareza y "almost there". Una sola pasada por las tablas y
// el resto en JS: la biblioteca son ~300 juegos y unos miles de desbloqueos,
// no hace falta SQL heroico.
//
// Las reglas transversales del documento, aplicadas aquí:
//   1. dateReliable=false NUNCA cuenta en lo temporal (totales por año); sí
//      en totales absolutos, completados y rareza.
//   2. Un juego sin desbloqueos sincronizados NO es un 0%: solo entran en
//      completados/almost-there los juegos con unlocks preguntados o con al
//      menos un desbloqueo constatado.
//   3. Los ocultos siguen siendo spoiler: "almost there" enseña nombre e
//      icono de lo que falta, jamás la descripción.

const RARE = 10;
const ULTRA_RARE = 5;
// Umbral de "casi": por debajo hay demasiada lista para ser un plan, por
// encima de 100 ya no falta nada. Decisión de LOGROS-IDEAS §7 (abierta entre
// 75/80 — se estrena en 75 para que la lista no salga vacía en bibliotecas
// jóvenes; subirlo es cambiar UNA constante).
const ALMOST_THERE_MIN = 0.75;
const HALL_OF_FAME_SIZE = 10;
const ALMOST_THERE_GAMES = 6;
const ALMOST_THERE_MISSING = 5;

// year=null → All Time. Con año, cada pieza sigue su propia honestidad:
//   · fama, perfil de rareza y totales del año → solo desbloqueos con fecha
//     FIABLE dentro del año (regla 1: los rescates no fabrican años);
//   · el muro de 100% pasa a ser "perfeccionados ESE año" — la fecha de
//     completado es la del ÚLTIMO logro, y solo existe si todas las fechas
//     del juego son fiables (si alguna es de rescate, no se sabe cuándo se
//     cerró y el juego solo aparece en All Time);
//   · "almost there" y el catálogo total son fotos de AHORA, sin lectura
//     anual — con año vienen vacíos y el bloque no los pinta.
export const getAchievementsOverview = async (
  year: number | null,
): Promise<AchievementsOverview> => {
  const db = getDb();

  const games = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      unlocksSyncedAt: gamesTable.achievementsUnlocksSyncedAt,
    })
    .from(gamesTable);
  const gameById = new Map(games.map((game) => [game.id, game]));

  const definitions = await db
    .select({
      id: achievementsTable.id,
      gameId: achievementsTable.gameId,
      displayName: achievementsTable.displayName,
      iconUrl: achievementsTable.iconUrl,
      iconGrayUrl: achievementsTable.iconGrayUrl,
      hidden: achievementsTable.hidden,
      globalPercent: achievementsTable.globalPercent,
    })
    .from(achievementsTable);

  const unlockRows = await db
    .select({
      achievementId: achievementUnlocksTable.achievementId,
      unlockedAt: achievementUnlocksTable.unlockedAt,
      dateReliable: achievementUnlocksTable.dateReliable,
    })
    .from(achievementUnlocksTable);

  // Fundido multi-fuente por logro — la MISMA regla que getGameAchievements:
  // una fecha fiable gana a una que no lo es; empatadas, la más temprana.
  const merged = new Map<number, { unlockedAt: Date; dateReliable: boolean }>();
  for (const unlock of unlockRows) {
    const existing = merged.get(unlock.achievementId);
    if (!existing) {
      merged.set(unlock.achievementId, {
        unlockedAt: unlock.unlockedAt,
        dateReliable: unlock.dateReliable,
      });
      continue;
    }
    if (unlock.dateReliable && !existing.dateReliable) {
      existing.unlockedAt = unlock.unlockedAt;
      existing.dateReliable = true;
      continue;
    }
    if (!unlock.dateReliable && existing.dateReliable) continue;
    if (unlock.unlockedAt.getTime() < existing.unlockedAt.getTime()) {
      existing.unlockedAt = unlock.unlockedAt;
    }
  }

  // ── Agregados por juego (completados / almost there) ────────────────────
  type PerGame = {
    total: number;
    unlocked: number;
    missing: typeof definitions;
    // Las fechas de sus desbloqueos, para datar el 100% (la del último).
    unlockDates: { time: number; reliable: boolean }[];
  };
  const perGame = new Map<number, PerGame>();
  for (const definition of definitions) {
    const entry = perGame.get(definition.gameId) ?? {
      total: 0,
      unlocked: 0,
      missing: [],
      unlockDates: [],
    };
    entry.total++;
    const unlock = merged.get(definition.id);
    if (unlock) {
      entry.unlocked++;
      entry.unlockDates.push({ time: unlock.unlockedAt.getTime(), reliable: unlock.dateReliable });
    } else {
      entry.missing.push(definition);
    }
    perGame.set(definition.gameId, entry);
  }

  // Regla 2: elegible = desbloqueos preguntados de verdad, o al menos uno
  // constatado por cualquier fuente.
  const eligible = [...perGame.entries()].filter(([gameId, stats]) => {
    const game = gameById.get(gameId);
    return game !== undefined && (game.unlocksSyncedAt !== null || stats.unlocked > 0);
  });

  const perfectGames = eligible
    .filter(([, stats]) => stats.total > 0 && stats.unlocked === stats.total)
    .map(([gameId, stats]) => {
      // La fecha del 100% es la del ÚLTIMO logro — y solo es un dato si
      // TODAS las fechas del juego son fiables: con una sola de rescate por
      // medio, el momento del cierre es inventado y mejor null.
      const allReliable = stats.unlockDates.every((date) => date.reliable);
      const completedAt =
        allReliable && stats.unlockDates.length > 0
          ? new Date(Math.max(...stats.unlockDates.map((date) => date.time)))
          : null;
      return {
        gameId,
        title: gameById.get(gameId)?.title ?? '',
        coverUrl: gameById.get(gameId)?.coverUrl ?? null,
        total: stats.total,
        completedAt,
      };
    })
    .filter(
      (game) =>
        year === null || (game.completedAt !== null && game.completedAt.getFullYear() === year),
    )
    .sort((a, b) => b.total - a.total);

  const almostThereSource = year === null ? eligible : [];
  const almostThere = almostThereSource
    .map(([gameId, stats]) => ({ gameId, stats, ratio: stats.unlocked / Math.max(1, stats.total) }))
    .filter(({ stats, ratio }) => stats.total > 0 && ratio >= ALMOST_THERE_MIN && ratio < 1)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, ALMOST_THERE_GAMES)
    .map(({ gameId, stats }) => ({
      gameId,
      title: gameById.get(gameId)?.title ?? '',
      coverUrl: gameById.get(gameId)?.coverUrl ?? null,
      unlocked: stats.unlocked,
      total: stats.total,
      // Lo que falta, lo MÁS común primero (lo que tiene más gente es lo más
      // alcanzable — el plan para esta noche, no el muro del 0.5%).
      missing: stats.missing
        .slice()
        .sort((a, b) => (b.globalPercent ?? -1) - (a.globalPercent ?? -1))
        .slice(0, ALMOST_THERE_MISSING)
        .map((definition) => ({
          displayName: definition.displayName,
          // El icono APAGADO a propósito: aún no es tuyo.
          iconUrl: definition.iconGrayUrl ?? definition.iconUrl,
          globalPercent: definition.globalPercent,
          hidden: definition.hidden,
        })),
    }));

  // ── Los desbloqueados, con su definición (fama / años / rareza) ─────────
  const unlockedDefs = definitions.flatMap((definition) => {
    const unlock = merged.get(definition.id);
    return unlock ? [{ definition, unlock }] : [];
  });

  // Con año filtrado, la fama y el perfil de rareza hablan SOLO de ese año —
  // y solo con fechas fiables (regla 1).
  const scopedUnlocked =
    year === null
      ? unlockedDefs
      : unlockedDefs.filter(
          (entry) => entry.unlock.dateReliable && entry.unlock.unlockedAt.getFullYear() === year,
        );

  const hallOfFame = scopedUnlocked
    .filter((entry) => entry.definition.globalPercent !== null)
    .sort((a, b) => (a.definition.globalPercent ?? 0) - (b.definition.globalPercent ?? 0))
    .slice(0, HALL_OF_FAME_SIZE)
    .map(({ definition, unlock }) => ({
      gameId: definition.gameId,
      gameTitle: gameById.get(definition.gameId)?.title ?? '',
      displayName: definition.displayName,
      iconUrl: definition.iconUrl,
      globalPercent: definition.globalPercent as number,
      unlockedAt: unlock.dateReliable ? unlock.unlockedAt : null,
    }));

  // Regla 1: los años solo cuentan fechas fiables.
  const byYear = new Map<number, { total: number; rare: number }>();
  for (const { definition, unlock } of unlockedDefs) {
    if (!unlock.dateReliable) continue;
    const year = unlock.unlockedAt.getFullYear();
    const entry = byYear.get(year) ?? { total: 0, rare: 0 };
    entry.total++;
    if (definition.globalPercent !== null && definition.globalPercent < RARE) entry.rare++;
    byYear.set(year, entry);
  }
  const unlockedByYear = [...byYear.entries()]
    .map(([year, entry]) => ({ year, ...entry }))
    .sort((a, b) => a.year - b.year);

  const withPercent = scopedUnlocked.filter((entry) => entry.definition.globalPercent !== null);
  const rarityProfile = {
    common: withPercent.filter((entry) => (entry.definition.globalPercent as number) >= RARE)
      .length,
    rare: withPercent.filter((entry) => {
      const percent = entry.definition.globalPercent as number;
      return percent < RARE && percent >= ULTRA_RARE;
    }).length,
    ultra: withPercent.filter((entry) => (entry.definition.globalPercent as number) < ULTRA_RARE)
      .length,
  };

  return {
    totalUnlocked: unlockedDefs.length,
    totalCatalog: definitions.length,
    yearTotals:
      year === null
        ? null
        : {
            total: scopedUnlocked.length,
            rare: scopedUnlocked.filter(
              (entry) =>
                entry.definition.globalPercent !== null && entry.definition.globalPercent < RARE,
            ).length,
          },
    // Los juegos del año por desbloqueos — el relleno con sustancia de la
    // columna derecha en modo año: dónde cazaste de verdad. Todos los que
    // tengan alguno (la card se desplaza); orden por cantidad.
    topGames:
      year === null
        ? null
        : (() => {
            const byGame = new Map<number, { total: number; rare: number }>();
            for (const { definition } of scopedUnlocked) {
              const entry = byGame.get(definition.gameId) ?? { total: 0, rare: 0 };
              entry.total++;
              if (definition.globalPercent !== null && definition.globalPercent < RARE) {
                entry.rare++;
              }
              byGame.set(definition.gameId, entry);
            }
            return [...byGame.entries()]
              .map(([gameId, counts]) => ({
                gameId,
                title: gameById.get(gameId)?.title ?? '',
                coverUrl: gameById.get(gameId)?.coverUrl ?? null,
                ...counts,
              }))
              .sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
          })(),
    // El año por meses — el gemelo anual de unlockedByYear, para que la
    // columna derecha del bloque no se quede coja con un año filtrado. Los
    // 12 meses SIEMPRE, con ceros: la forma del año (tus rachas y tus
    // sequías) se lee en los huecos tanto como en las barras. Desglosado en
    // los TRES cubos de rareza (los mismos del perfil) para la barra apilada.
    unlockedByMonth:
      year === null
        ? null
        : Array.from({ length: 12 }, (_, month) => {
            const inMonth = scopedUnlocked.filter(
              (entry) => entry.unlock.unlockedAt.getMonth() === month,
            );
            const rare = inMonth.filter((entry) => {
              const percent = entry.definition.globalPercent;
              return percent !== null && percent < RARE && percent >= ULTRA_RARE;
            }).length;
            const ultra = inMonth.filter((entry) => {
              const percent = entry.definition.globalPercent;
              return percent !== null && percent < ULTRA_RARE;
            }).length;
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
};
