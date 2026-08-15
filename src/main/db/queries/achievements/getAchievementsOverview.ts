import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { AchievementsOverview } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../../schema';

// La vista GLOBAL de los logros (LOGROS-IDEAS.md §3-4): la materia del
// bloque de trofeos de Stats — salón de la fama, totales por año, muro de
// 100%, perfil de rareza y "almost there".
//
// Las reglas transversales del documento, aplicadas aquí:
//   1. dateReliable=false NUNCA cuenta en lo temporal (totales por año); sí
//      en totales absolutos, completados y rareza.
//   2. Un juego sin desbloqueos sincronizados NO es un 0%: solo entran en
//      completados/almost-there los juegos con unlocks preguntados o con al
//      menos un desbloqueo constatado.
//   3. Los ocultos siguen siendo spoiler: "almost there" enseña nombre e
//      icono de lo que falta, jamás la descripción.
//
// ── POR QUÉ ESTO AGREGA EN SQL (la cicatriz de rendimiento) ────────────────
//
// Era la consulta MÁS LENTA de toda la app: 242 ms en la biblioteca real y
// 487 ms con cinco años de uso simulados. El 100% del coste era el VIAJE: se
// traía la tabla `achievements` ENTERA a JavaScript —39.808 filas— para
// contarlas y agruparlas aquí. Pedir menos COLUMNAS no arregla nada; lo que
// cuesta son las FILAS.
//
// Medido con el andamio de tests (994 juegos, 39.808 logros, 3.915
// desbloqueos), mediana de 5:
//
//                    ANTES                  DESPUÉS
//   All Time      447 ms, 44.717 filas    29 ms, 4.034 filas
//   con año       492 ms, 44.717 filas    29 ms, 3.988 filas
//
// El reparto de ahora, y el criterio para no deshacerlo:
//   · lo que solo necesita CONTAR el catálogo (el total, y cuántos logros
//     tiene cada juego) se agrega en SQL — ahí están las 39.808 filas, y
//     ninguna llega a JS;
//   · lo que necesita mirar desbloqueo a desbloqueo (años, meses, rareza,
//     fama) viaja entero, pero son los DESBLOQUEOS: ~3.900 filas, un orden de
//     magnitud menos, y encima ya fundidos por logro en la base;
//   · lo que falta de los juegos "casi" se pide SOLO de esos ≤6 juegos, en
//     vez de arrastrar el catálogo entero por si acaso.
// Si alguien vuelve a poner un `.select()` sin agregar sobre `achievements`,
// esto vuelve a los 450 ms sin que se note en una base de desarrollo.
//
// El plan de las tres consultas está comprobado con EXPLAIN QUERY PLAN y no
// escanea `achievements` en ninguna: el conteo por juego entra por el índice
// achievements_game_api_unique (COVERING), los desbloqueos por
// achievement_unlocks_source_unique, y lo que falta por búsquedas de game_id.

const RARE = 10;
const ULTRA_RARE = 5;

// Los tres cubos de rareza, DISJUNTOS: común ≥10%, raro 5-10%, ultra <5%.
// Viven aquí arriba y no repartidos por la función porque "raro" llegó a
// significar dos cosas dentro de la MISMA respuesta: yearTotals.rare (y los
// años, y los juegos del año) contaban todo lo que baja del 10% —ultras
// dentro— mientras rarityProfile.rare y los meses contaban solo el tramo
// 5-10%. Las dos lecturas se pintan del MISMO ámbar en el mismo bloque de
// Stats, así que la fila del año decía "· 2" y la barra apilada de al lado
// enseñaba un ámbar y un violeta. Con una sola definición el color significa
// lo mismo en todo el bloque, y "por debajo del 10%" se DERIVA sumando
// rare + ultra allí donde alguien lo quiera.
const isRare = (percent: number | null): boolean =>
  percent !== null && percent < RARE && percent >= ULTRA_RARE;
const isUltra = (percent: number | null): boolean => percent !== null && percent < ULTRA_RARE;
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

  // ── EL FUNDIDO DE FUENTES, ESCRITO EN SQL ────────────────────────────────
  //
  // La regla de la zona (mergeUnlocks.ts) dice: "una fuente CON fecha fiable
  // gana a una que no, por temprana que sea esta; empatadas en fiabilidad,
  // manda la más temprana". Aquí NO se puede llamar a
  // mergeUnlocksByAchievement sin traerse antes las filas —que es justo lo que
  // costaba los 400 ms—, así que la regla va expresada como agregado, y es
  // exactamente la misma término a término:
  //
  //   winner.unlockedAt   = min(fechas FIABLES) si hay alguna fiable,
  //                         si no min(todas)          → el COALESCE de abajo
  //   winner.dateReliable = ¿hay alguna fiable?       → el MAX de abajo
  //
  // Esto es una SEGUNDA ESCRITURA de una regla de negocio que vive en
  // mergeUnlocks.ts, y eso ya salió caro una vez (estuvo copiada a mano en
  // tres consultas, divergieron, y el mismo logro acabó saliendo en dos
  // sesiones). Se acepta aquí porque es el único sitio donde la regla se paga
  // en la tabla ENTERA, y con una condición: el día que se toque el desempate
  // —la decisión pendiente de RETROACHIEVEMENTS.md §8, hardcore vs softcore—
  // hay que tocar LOS DOS. Los tests de achievements.test.ts cruzan la ficha
  // con esta vista a propósito para que una divergencia salga en rojo.
  //
  // Ojo: solo se traducen los dos campos que esta vista necesita (la fecha y
  // su fiabilidad). La fila ganadora ENTERA —su sesión, su playthrough, su
  // fuente— sigue saliendo de mergeUnlocks.ts en quien la necesita.
  const merged = db.$with('merged_unlocks').as(
    db
      .select({
        achievementId: achievementUnlocksTable.achievementId,
        unlockedAt:
          sql<number>`coalesce(min(case when ${achievementUnlocksTable.dateReliable} then ${achievementUnlocksTable.unlockedAt} end), min(${achievementUnlocksTable.unlockedAt}))`.as(
            'unlocked_at',
          ),
        dateReliable:
          sql<number>`max(case when ${achievementUnlocksTable.dateReliable} then 1 else 0 end)`.as(
            'date_reliable',
          ),
      })
      .from(achievementUnlocksTable)
      .groupBy(achievementUnlocksTable.achievementId),
  );

  // El tamaño del catálogo: 39.808 filas contadas EN LA BASE, cero en el
  // viaje. Va suelto y no derivado de los grupos de abajo porque cuenta
  // también el logro cuyo juego ya no está en `games` (una fila huérfana de
  // un borrado a medias sigue siendo catálogo), que es lo que contaba el
  // `definitions.length` de antes.
  const [catalog] = await db.select({ total: sql<number>`count(*)` }).from(achievementsTable);

  // Cuántos logros tiene cada juego, con lo que hace falta para pintarlo.
  // El ORDER BY por el PRIMER logro del juego no es cosmético: reproduce el
  // orden en que la versión anterior iba llenando su Map al recorrer la tabla
  // entera, y de ese orden dependen los desempates de "almost there" (dos
  // juegos al mismo ratio) y del muro (dos juegos con el mismo catálogo).
  const catalogByGame = await db
    .select({
      gameId: achievementsTable.gameId,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      unlocksSyncedAt: gamesTable.achievementsUnlocksSyncedAt,
      total: sql<number>`count(*)`,
    })
    .from(achievementsTable)
    .innerJoin(gamesTable, eq(gamesTable.id, achievementsTable.gameId))
    .groupBy(achievementsTable.gameId)
    .orderBy(sql`min(${achievementsTable.id})`);

  // Los DESBLOQUEOS, ya fundidos por logro en la base: una fila por logro que
  // tienes, con la fecha y la fiabilidad de la fuente ganadora. Estas sí
  // viajan enteras —años, meses, rareza y fama necesitan mirarlas una a una—
  // pero son ~3.900, no 39.808.
  //
  // El ORDER BY por id del logro reproduce el orden del escaneo de tabla que
  // hacía la versión anterior, del que dependen los desempates del salón de
  // la fama (dos logros con la MISMA rareza global, que es lo normal en los
  // que los tiene todo el mundo).
  const unlockedRows = await db
    .with(merged)
    .select({
      gameId: achievementsTable.gameId,
      displayName: achievementsTable.displayName,
      iconUrl: achievementsTable.iconUrl,
      globalPercent: achievementsTable.globalPercent,
      unlockedAt: merged.unlockedAt,
      dateReliable: merged.dateReliable,
    })
    .from(merged)
    .innerJoin(achievementsTable, eq(achievementsTable.id, merged.achievementId))
    .orderBy(asc(achievementsTable.id));

  // Los enteros del CTE llegan como number con este driver, pero el de
  // producción es otro (@tursodatabase/sync): Number() los normaliza sin
  // depender de eso.
  const unlockedDefs = unlockedRows.map((row) => ({
    gameId: row.gameId,
    displayName: row.displayName,
    iconUrl: row.iconUrl,
    globalPercent: row.globalPercent,
    unlockedAt: new Date(Number(row.unlockedAt)),
    dateReliable: Number(row.dateReliable) === 1,
  }));

  // ── Agregados por juego (completados / almost there) ────────────────────
  type PerGame = {
    title: string;
    coverUrl: string | null;
    unlocksSyncedAt: Date | null;
    total: number;
    unlocked: number;
    // El ÚLTIMO desbloqueo del juego y si TODOS son de fecha fiable: es lo
    // único que hace falta para datar el 100%.
    lastUnlockedAt: number;
    allReliable: boolean;
  };
  const perGame = new Map<number, PerGame>();
  for (const row of catalogByGame) {
    perGame.set(row.gameId, {
      title: row.title,
      coverUrl: row.coverUrl,
      unlocksSyncedAt: row.unlocksSyncedAt,
      total: Number(row.total),
      unlocked: 0,
      lastUnlockedAt: 0,
      allReliable: true,
    });
  }
  for (const unlock of unlockedDefs) {
    const entry = perGame.get(unlock.gameId);
    // Sin entrada = el juego del logro ya no está en `games`. No es elegible
    // para nada de aquí abajo, igual que antes.
    if (!entry) continue;
    entry.unlocked++;
    entry.lastUnlockedAt = Math.max(entry.lastUnlockedAt, unlock.unlockedAt.getTime());
    if (!unlock.dateReliable) entry.allReliable = false;
  }

  // Regla 2: elegible = desbloqueos preguntados de verdad, o al menos uno
  // constatado por cualquier fuente.
  const eligible = [...perGame.entries()].filter(
    ([, stats]) => stats.unlocksSyncedAt !== null || stats.unlocked > 0,
  );

  const perfectGames = eligible
    .filter(([, stats]) => stats.total > 0 && stats.unlocked === stats.total)
    .map(([gameId, stats]) => ({
      gameId,
      title: stats.title,
      coverUrl: stats.coverUrl,
      total: stats.total,
      // La fecha del 100% es la del ÚLTIMO logro — y solo es un dato si
      // TODAS las fechas del juego son fiables: con una sola de rescate por
      // medio, el momento del cierre es inventado y mejor null.
      completedAt: stats.allReliable && stats.unlocked > 0 ? new Date(stats.lastUnlockedAt) : null,
    }))
    .filter(
      (game) =>
        year === null || (game.completedAt !== null && game.completedAt.getFullYear() === year),
    )
    .sort((a, b) => b.total - a.total);

  const almostThereSource = year === null ? eligible : [];
  const almostThereGames = almostThereSource
    .map(([gameId, stats]) => ({ gameId, stats, ratio: stats.unlocked / Math.max(1, stats.total) }))
    .filter(({ stats, ratio }) => stats.total > 0 && ratio >= ALMOST_THERE_MIN && ratio < 1)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, ALMOST_THERE_GAMES);

  // Lo que FALTA, pedido solo de esos ≤6 juegos. Antes salía de tener el
  // catálogo entero en memoria; ahora es una consulta más y aun así es el
  // cambio que más filas ahorra, porque el catálogo entero eran 39.808 y
  // esto son los pendientes de seis juegos. Un logro "falta" si no consta
  // por NINGUNA fuente, que es lo mismo que decir que el fundido no le da
  // ganador.
  const missingRows =
    almostThereGames.length === 0
      ? []
      : await db
          .select({
            gameId: achievementsTable.gameId,
            displayName: achievementsTable.displayName,
            iconUrl: achievementsTable.iconUrl,
            iconGrayUrl: achievementsTable.iconGrayUrl,
            hidden: achievementsTable.hidden,
            globalPercent: achievementsTable.globalPercent,
          })
          .from(achievementsTable)
          .where(
            and(
              inArray(
                achievementsTable.gameId,
                almostThereGames.map(({ gameId }) => gameId),
              ),
              notExists(
                db
                  .select({ one: sql<number>`1` })
                  .from(achievementUnlocksTable)
                  .where(eq(achievementUnlocksTable.achievementId, achievementsTable.id)),
              ),
            ),
          )
          .orderBy(asc(achievementsTable.id));

  const missingByGame = new Map<number, (typeof missingRows)[number][]>();
  for (const row of missingRows) {
    const list = missingByGame.get(row.gameId);
    if (list) list.push(row);
    else missingByGame.set(row.gameId, [row]);
  }

  const almostThere = almostThereGames.map(({ gameId, stats }) => ({
    gameId,
    title: stats.title,
    coverUrl: stats.coverUrl,
    unlocked: stats.unlocked,
    total: stats.total,
    // Lo que falta, lo MÁS común primero (lo que tiene más gente es lo más
    // alcanzable — el plan para esta noche, no el muro del 0.5%). El sort va
    // en JS y no en el ORDER BY porque es un sort ESTABLE sobre filas que
    // llegan en orden de id: los logros sin rareza conocida quedan al final
    // y los empatados en el orden de Steam, igual que siempre.
    missing: (missingByGame.get(gameId) ?? [])
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

  // ── Los desbloqueados (fama / años / rareza) ────────────────────────────

  // Con año filtrado, la fama y el perfil de rareza hablan SOLO de ese año —
  // y solo con fechas fiables (regla 1).
  const scopedUnlocked =
    year === null
      ? unlockedDefs
      : unlockedDefs.filter(
          (entry) => entry.dateReliable && entry.unlockedAt.getFullYear() === year,
        );

  const hallOfFame = scopedUnlocked
    .filter((entry) => entry.globalPercent !== null)
    .sort((a, b) => (a.globalPercent ?? 0) - (b.globalPercent ?? 0))
    .slice(0, HALL_OF_FAME_SIZE)
    .map((entry) => ({
      gameId: entry.gameId,
      gameTitle: perGame.get(entry.gameId)?.title ?? '',
      displayName: entry.displayName,
      iconUrl: entry.iconUrl,
      globalPercent: entry.globalPercent as number,
      unlockedAt: entry.dateReliable ? entry.unlockedAt : null,
    }));

  // Regla 1: los años solo cuentan fechas fiables.
  //
  // Los años y los meses se agrupan AQUÍ y no con un strftime en SQL a
  // propósito: getFullYear()/getMonth() leen en la zona horaria del que mira,
  // y el 'localtime' de SQLite depende del reloj del proceso nativo (en
  // Windows ni siquiera entiende los nombres IANA). Un logro sacado el 1 de
  // enero a las 00:30 en Madrid cambiaría de año según quién hiciera la
  // cuenta. Son ~3.900 filas ya en memoria: agrupar aquí no cuesta nada.
  const byYear = new Map<number, { total: number; rare: number; ultra: number }>();
  for (const unlock of unlockedDefs) {
    if (!unlock.dateReliable) continue;
    const year = unlock.unlockedAt.getFullYear();
    const entry = byYear.get(year) ?? { total: 0, rare: 0, ultra: 0 };
    entry.total++;
    if (isRare(unlock.globalPercent)) entry.rare++;
    if (isUltra(unlock.globalPercent)) entry.ultra++;
    byYear.set(year, entry);
  }
  const unlockedByYear = [...byYear.entries()]
    .map(([year, entry]) => ({ year, ...entry }))
    .sort((a, b) => a.year - b.year);

  const withPercent = scopedUnlocked.filter((entry) => entry.globalPercent !== null);
  const rarityProfile = {
    common: withPercent.filter((entry) => (entry.globalPercent as number) >= RARE).length,
    rare: withPercent.filter((entry) => isRare(entry.globalPercent)).length,
    ultra: withPercent.filter((entry) => isUltra(entry.globalPercent)).length,
  };

  return {
    totalUnlocked: unlockedDefs.length,
    totalCatalog: Number(catalog?.total ?? 0),
    yearTotals:
      year === null
        ? null
        : {
            total: scopedUnlocked.length,
            rare: scopedUnlocked.filter((entry) => isRare(entry.globalPercent)).length,
            ultra: scopedUnlocked.filter((entry) => isUltra(entry.globalPercent)).length,
          },
    // Los juegos del año por desbloqueos — el relleno con sustancia de la
    // columna derecha en modo año: dónde cazaste de verdad. Todos los que
    // tengan alguno (la card se desplaza); orden por cantidad.
    topGames:
      year === null
        ? null
        : (() => {
            const byGame = new Map<number, { total: number; rare: number; ultra: number }>();
            for (const unlock of scopedUnlocked) {
              const entry = byGame.get(unlock.gameId) ?? { total: 0, rare: 0, ultra: 0 };
              entry.total++;
              if (isRare(unlock.globalPercent)) entry.rare++;
              if (isUltra(unlock.globalPercent)) entry.ultra++;
              byGame.set(unlock.gameId, entry);
            }
            return [...byGame.entries()]
              .map(([gameId, counts]) => ({
                gameId,
                title: perGame.get(gameId)?.title ?? '',
                coverUrl: perGame.get(gameId)?.coverUrl ?? null,
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
            const inMonth = scopedUnlocked.filter((entry) => entry.unlockedAt.getMonth() === month);
            const rare = inMonth.filter((entry) => isRare(entry.globalPercent)).length;
            const ultra = inMonth.filter((entry) => isUltra(entry.globalPercent)).length;
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
