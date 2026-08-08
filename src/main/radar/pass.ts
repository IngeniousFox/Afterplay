import { eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { getConfigValue, setConfigValue } from '../config/store';
import { getDb, withDbAccess } from '../db';
import { gamesTable, radarGamesTable } from '../db/schema';
import { getGameExternalBatch, getUpcomingCollectionGames } from '../igdb/api';
import { adoptIgdbForCandidates, findAdoptionCandidates } from '../external/adoptIgdb';
import { fillMissingSgdbIds } from '../external/sgdbBackfill';
import { notifyRadarActivity } from './notify';

// EL RADAR DE SECUELAS (PLAN-TO-PLAY.md §4) — la única cosa de todo este
// documento que corre SOLA, sin que pulses nada.
//
// La corrección de diseño que lo justifica: enterarte de que a un juego tuyo
// le viene una secuela no puede depender de que abras su ficha cada semana.
// Todo lo demás (notas, sinopsis, etiquetas) se refresca a mano porque son
// datos que solo miras cuando los miras; una secuela anunciada es una NOTICIA,
// y una noticia que hay que ir a buscar no es una noticia.
//
// Es la excepción acordada al "todo refresco es manual", y está acotada: dos
// o tres peticiones a la semana.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Ids por sentencia DELETE — con margen de sobra bajo el tope de variables
// de SQLite (999).
const DELETE_CHUNK = 400;

// ── Las DOS fases, y por qué la primera es la que de verdad importa ─────────
//
// El caso que rompe el diseño ingenuo: un juego ÚNICO tiene `collections`
// vacío en IGDB… HASTA QUE SE ANUNCIA SU SECUELA. Es entonces cuando los
// editores crean la colección y meten a los dos. Un radar que solo consultara
// "las colecciones que ya conozco" jamás vería NACER la saga de un juego
// único: su lista vacía seguiría vacía para siempre, que es justo el caso que
// este radar existe para cubrir.
//
// Por eso la fase 1 no es un preámbulo, es el radar: refresca la PERTENENCIA
// de toda la biblioteca en una petición, y ahí es donde un juego único estrena
// colección la misma semana en que IGDB se la crea. La fase 2 solo recoge lo
// que la primera ha dejado a la vista.
//
// Límite honesto y documentado: si los editores de IGDB nunca agrupan los dos
// juegos en una colección, no hay señal — IGDB no tiene enlaces de secuela
// directos y emparejar por título sería la lotería de siempre. En la práctica
// la comunidad crea la colección rápido (es exactamente cómo IGDB modela las
// series), pero la cobertura depende de esa curación y no se puede prometer
// más.

export type RadarPassResult = {
  // Colecciones distintas que se miraron.
  collections: number;
  // Descubrimientos nuevos de ESTA pasada (los que no estaban ya en la tabla).
  discovered: number;
  // Y si esta fue la primera de la vida — la que siembra en silencio.
  seeding: boolean;
};

let running = false;

export const isRadarRunning = (): boolean => running;

// ── Fase 1: refrescar la pertenencia de TODOS los juegos ───────────────────
const refreshMembership = async (): Promise<number[]> => {
  // Antes de nada: los juegos dados de alta SOLO con Steam (porque IGDB no
  // los tenía) pueden estar ya en su catálogo. Se comprueba aquí porque esta
  // es la única pasada que corre sola, sin que nadie pulse nada — y por tanto
  // la que de verdad hace que un juego "aparezca" en IGDB sin que tengas que
  // acordarte de refrescar. Si alguno entra, cambia de fuente y a partir de
  // esta misma pasada ya tiene sagas como cualquier otro.
  const adopted = await adoptIgdbForCandidates(await findAdoptionCandidates());
  if (adopted > 0) {
    // Solo ASCII, misma convención que el resto de logs del main.
    console.log(`[radar] ${adopted} juego(s) que solo estaban en Steam ya estan en IGDB`);
  }

  // Y lo mismo con el id de SteamGridDB: tampoco existe el día que se anuncia
  // un juego. Aquí cuesta poco — solo entran los que no lo tienen, así que
  // esto se agota solo y en régimen normal son cero peticiones.
  await fillMissingSgdbIds();

  // isNotNull(igdbId): el radar va de sagas de IGDB, así que un juego sin
  // ficha allí (existe en Steam y ellos aún no lo tienen) no puede aportar
  // ninguna colección ni cruzarse con nada. Se queda fuera de la pasada.
  const games = await withDbAccess(async () =>
    getDb()
      .select({ id: gamesTable.id, igdbId: gamesTable.igdbId })
      .from(gamesTable)
      .where(isNotNull(gamesTable.igdbId)),
  );
  if (games.length === 0) return [];
  const inIgdb = games.filter(
    (game): game is { id: number; igdbId: number } => game.igdbId !== null,
  );

  // Red fuera del candado, como siempre. Es el MISMO lote que el refresco
  // manual (§5.1): una biblioteca entera cabe en 1-2 peticiones, y de paso
  // trae notas, sinopsis y fechas — o sea que la pasada semanal también pone
  // al día los "por salir" ya fichados sin pedir nada extra. Un planeado que
  // por fin tiene fecha se reordena solo en el horizonte.
  const byIgdbId = await getGameExternalBatch(inIgdb.map((game) => game.igdbId));

  const now = new Date();
  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      for (const game of inIgdb) {
        const data = byIgdbId.get(game.igdbId);
        if (!data) continue;
        await tx
          .update(gamesTable)
          .set({
            igdbCollections: data.igdbCollections,
            ratingCritics: data.ratingCritics,
            ratingCriticsCount: data.ratingCriticsCount,
            ratingUsers: data.ratingUsers,
            ratingUsersCount: data.ratingUsersCount,
            summary: data.summary,
            releaseDate: data.releaseDate,
            releaseDatePrecision: data.releaseDatePrecision,
            ...(data.releaseYear !== null ? { releaseYear: data.releaseYear } : {}),
            ratingsCheckedAt: now,
          })
          .where(eq(gamesTable.id, game.id));
      }
    }),
  );

  // El conjunto de colecciones distintas de TODA la biblioteca — planeados
  // incluidos, y biblioteca sobre todo: la secuela de un juego que TERMINASTE
  // es justo la noticia buena, no solo la de algo que tenías apuntado.
  const collections = new Set<number>();
  for (const data of byIgdbId.values()) {
    for (const collection of data.igdbCollections ?? []) collections.add(collection.id);
  }
  return [...collections];
};

// ── Fase 2: buscar lo anunciado en esas colecciones ────────────────────────
const findAnnounced = async (collectionIds: number[]): Promise<number> => {
  if (collectionIds.length === 0) return 0;

  const upcoming = await getUpcomingCollectionGames(collectionIds, Date.now() / 1000);
  if (upcoming.length === 0) return 0;

  // Lo que YA tienes no es un descubrimiento. El cruce es por igdbId exacto,
  // el mismo emparejado que usa todo lo demás de la app.
  const ownedIgdbIds = new Set(
    (await withDbAccess(async () => getDb().select({ igdbId: gamesTable.igdbId }).from(gamesTable)))
      .map((game) => game.igdbId)
      // Los que no estan en IGDB no pueden cruzarse con un descubrimiento
      // suyo: fuera del conjunto en vez de meter un null que no casa con nada.
      .filter((igdbId): igdbId is number => igdbId !== null),
  );

  const candidates = upcoming.filter((game) => !ownedIgdbIds.has(game.igdbId));
  if (candidates.length === 0) return 0;

  // Nombres de colección, para poder decir "de la saga Fable" en la fila. Se
  // sacan de lo que la fase 1 acaba de guardar en TUS propios juegos: son tus
  // sagas, así que el nombre ya está en casa y no hace falta pedirlo.
  const collectionNames = new Map<number, string>();
  for (const row of await withDbAccess(async () =>
    getDb().select({ igdbCollections: gamesTable.igdbCollections }).from(gamesTable),
  )) {
    for (const collection of row.igdbCollections ?? []) {
      collectionNames.set(collection.id, collection.name);
    }
  }

  // De todas las sagas de un anuncio, la que es TUYA — y si son varias, la
  // primera que aparezca. Es lo que hace que la fila diga algo que reconoces
  // ("de la saga Fable") en vez del nombre a secas de un juego que no te
  // suena de nada.
  const yourCollectionOf = (game: (typeof candidates)[number]): number | null =>
    game.collectionIds.find((id) => collectionNames.has(id)) ?? null;

  const existing = new Set(
    (
      await withDbAccess(async () =>
        getDb().select({ igdbId: radarGamesTable.igdbId }).from(radarGamesTable),
      )
    ).map((row) => row.igdbId),
  );

  const fresh = candidates.filter((game) => !existing.has(game.igdbId));

  const now = new Date();
  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      for (const game of candidates) {
        const collectionId = yourCollectionOf(game);
        // Se re-inserta TODO lo encontrado, no solo lo nuevo: así una fecha
        // que se mueve (los anuncios se retrasan constantemente) se corrige
        // sola. El onConflictDoUpdate deja intacto `dismissedAt` — un
        // descarte tuyo no se deshace porque el juego cambie de fecha.
        await tx
          .insert(radarGamesTable)
          .values({
            igdbId: game.igdbId,
            collectionId,
            collectionName:
              collectionId === null ? null : (collectionNames.get(collectionId) ?? null),
            title: game.title,
            coverUrl: game.coverUrl,
            releaseDate: game.releaseDate,
            releaseDatePrecision: game.releaseDatePrecision,
            releaseYear: game.releaseYear,
            discoveredAt: now,
          })
          .onConflictDoUpdate({
            target: radarGamesTable.igdbId,
            set: {
              collectionId,
              collectionName:
                collectionId === null ? null : (collectionNames.get(collectionId) ?? null),
              title: game.title,
              coverUrl: game.coverUrl,
              releaseDate: game.releaseDate,
              releaseDatePrecision: game.releaseDatePrecision,
              releaseYear: game.releaseYear,
            },
          });
      }

      // Limpieza: lo que ya has añadido a la app deja de ser un
      // descubrimiento pendiente. Sin esto, la fila del radar y el juego de
      // verdad convivirían en el horizonte, duplicados.
      //
      // Troceado porque SQLite tiene un tope de variables por sentencia
      // (999 por defecto): una biblioteca grande metería mil ids de golpe en
      // el IN y la pasada entera reventaría justo al final, después de haber
      // pagado todas las peticiones.
      const owned = [...ownedIgdbIds];
      for (let start = 0; start < owned.length; start += DELETE_CHUNK) {
        await tx
          .delete(radarGamesTable)
          .where(inArray(radarGamesTable.igdbId, owned.slice(start, start + DELETE_CHUNK)));
      }
    }),
  );

  return fresh.length;
};

// La pasada entera. Nunca lanza: es trabajo de fondo, y un fallo de red no
// puede tumbar nada — se reintenta la semana que viene (o al siguiente
// arranque, que es más pronto).
export const runRadarPass = async (force = false): Promise<RadarPassResult | null> => {
  if (running) return null;

  const lastRun = getConfigValue('radarLastRunAt');
  if (!force && lastRun > 0 && Date.now() - lastRun < WEEK_MS) return null;

  // Sin claves de IGDB no hay radar, y tampoco hay nada que explicar: la app
  // entera funciona sin ellas (modo local).
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return null;

  running = true;
  const seeding = lastRun === 0;
  try {
    const collections = await refreshMembership();
    const discovered = await findAnnounced(collections);
    setConfigValue('radarLastRunAt', Date.now());

    // Solo ASCII en consola, misma convención que watcher/watcher.ts.
    console.log(
      `[radar] ${collections.length} colecciones miradas, ${discovered} entregas nuevas${seeding ? ' (primera pasada, en silencio)' : ''}`,
    );

    // LA PRIMERA PASADA DE LA VIDA SIEMBRA EN SILENCIO (§4.4). Descubrirá
    // docenas de golpe —todo lo anunciado de doscientas colecciones— y
    // docenas de avisos el primer día no son noticias, son spam. El patrón ya
    // establecido con los logros: backfill mudo, vivo con aviso.
    if (!seeding && discovered > 0) {
      notifyRadarActivity({ discovered });
    }
    return { collections: collections.length, discovered, seeding };
  } catch (error) {
    console.warn('[radar] la pasada semanal fallo (se reintentara):', error);
    return null;
  } finally {
    running = false;
  }
};

// El tic de arranque + el de cada hora, igual que los recaps: la app puede
// pasar semanas sin reiniciarse (vive en la bandeja), así que no basta con
// mirarlo al abrir. La comprobación en sí es de coste cero — leer una fecha
// de config.json — y solo dispara la pasada si de verdad toca.
export const runRadarTick = async (): Promise<void> => {
  await runRadarPass(false);
};

// Cuántos descubrimientos hay a la vista ahora mismo (sin los descartados) —
// para la píldora de la cabecera del Plan.
export const countRadarGames = async (): Promise<number> => {
  const [row] = await withDbAccess(async () =>
    getDb()
      .select({ total: sql<number>`count(*)` })
      .from(radarGamesTable)
      .where(isNull(radarGamesTable.dismissedAt)),
  );
  return row?.total ?? 0;
};
