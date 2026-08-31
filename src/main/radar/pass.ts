import { eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { getConfigValue, setConfigValue } from '../config/store';
import { getDb, withDbAccess } from '../db';
import { gamesTable, radarGamesTable } from '../db/schema';
import { getGameExternalBatch, getUpcomingCollectionGames } from '../igdb/api';
import { adoptIgdbForCandidates, findAdoptionCandidates } from '../external/adoptIgdb';
import { buildIgdbBatchPatch } from '../external/igdbPatch';
import { fillMissingSgdbIds } from '../external/sgdbBackfill';
import { isExternalRefreshRunning, startExternalRefresh } from '../external/refresh';
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
// Es la excepción acordada al "todo refresco es manual".
//
// Y desde el 9-ago-2026 la excepción es MÁS ANCHA a propósito: al terminar,
// esta pasada lanza también el refresco externo completo de la biblioteca
// (ver el final de runRadarPass). Antes eran dos o tres peticiones sueltas;
// ahora arrastra las etiquetas y las reseñas de Steam, que van de una en una
// y tardan minutos. Se aceptó ese coste porque es semanal: el motivo de que
// un dato envejeciera meses era justo que solo se refrescaba a mano.
//
// Por eso mismo la semana NO se da por corrida si esa segunda mitad no llega
// a arrancar: son las dos mitades de la misma pasada. Pero solo unas cuantas
// veces seguidas, porque quien decide si esa mitad arranca es un candado de
// otro módulo y repetir la pasada entera cada hora sale caro (ver el final de
// runRadarPass, que es donde está toda la historia).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Pasadas seguidas que se aguantan SIN sellar esperando a que el refresco
// externo esté libre, antes de sellar igualmente. Es la válvula del bucle
// degenerado que se explica entero al final de runRadarPass.
const MAX_UNSEALED_PASSES = 3;

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
  // Y si esta fue la primera de la vida — la que siembra en silencio. Ojo:
  // "la primera" ya no es solo la marca a cero, ver alreadySown.
  seeding: boolean;
};

let running = false;

// Pasadas seguidas que se han dejado sin sellar porque el refresco externo
// estaba ocupado. En memoria a propósito: el candado que vigila (el `running`
// de external/refresh.ts) también vive en memoria, así que los dos se limpian
// en el mismo reinicio y no queda una marca persistente contando saltos de un
// candado que ya no existe.
let unsealedPasses = 0;

// ¿Ha sembrado ya este proceso? "La primera pasada de la vida" (§4.4) tenía
// UNA sola señal —radarLastRunAt === 0— y valía mientras esa marca se sellara
// siempre al terminar. Desde que el sellado espera al refresco externo puede
// haber pasadas ya corridas con la marca todavía a cero, y sin esto TODAS se
// creerían la primera y se irían mudas: el radar descubriendo secuelas cada
// hora sin avisar de ninguna. El sellado hacía dos trabajos a la vez (el
// límite semanal y "he corrido alguna vez") y aquí se separan.
//
// En memoria y no en config, otra vez porque lo único que puede retrasar el
// sellado es un candado en memoria: los dos duran lo mismo. Y así sigue
// siendo verdad lo que documenta ipc/radar.ts — poner radarLastRunAt a cero
// en config.json (que se lee al arrancar) deja la siguiente pasada muda.
let alreadySown = false;

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
        // Las mismas columnas que escribe el refresco de biblioteca, por el
        // MISMO helper: las dos pasadas piden este lote y lo guardaban con la
        // lista copiada a mano, y el radar lanza a la otra justo después (ver
        // external/igdbPatch.ts).
        await tx
          .update(gamesTable)
          .set(buildIgdbBatchPatch(data, now))
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

// ── La otra mitad: los datos externos de TODA la biblioteca ────────────────
//
// Decisión 9-ago-2026. El radar ya pone al día lo de IGDB por su cuenta, pero
// lo de Steam —el appid, las etiquetas y las reseñas— solo llegaba pulsando un
// botón. Un juego podía pasarse meses con el % de reseñas de su semana de
// lanzamiento, o con el appid de un playtest, sin que nada lo corrigiera.
//
// Se llama a la MISMA pasada del botón de Ajustes en vez de copiar su trabajo
// aquí: es literalmente el mismo, y tenerlo dos veces garantiza que un día se
// separen. Ella lleva su propio progreso, así que la tarjeta de Ajustes lo
// enseña igual que si lo hubieras pulsado tú — trabajo de red de varios
// minutos que no se hace a escondidas.
//
// Y lleva su propio CANDADO, que es lo que hay que preguntar ANTES de llamar.
// Si hay otra pasada en marcha —incluida una de scope 'plan', que solo cubre
// los planeados y deja fuera a los cientos que no lo están—, esa llamada
// devuelve 0 y se va sin evento, sin log y sin dejar rastro; y ese 0 tampoco
// se distingue del de "no había nada que refrescar". Por eso se pregunta por
// el candado en vez de mirar el número que devuelve.
//
// LO QUE DEVUELVE ESTO ES "EL CANDADO ESTABA LIBRE", ni un pelo más. NO es
// "hay trabajo en marcha": con la biblioteca vacía, startExternalRefresh
// devuelve 0 y suelta el candado a mano sin lanzar ninguna pasada, y aquí
// sale true igual. Para lo que se usa —saber si nuestra mitad tuvo su
// oportunidad— es exactamente la pregunta correcta: una biblioteca sin juegos
// no tiene datos externos que refrescar, así que esa mitad está hecha.
//
// La lectura del candado va PEGADA a la llamada y sin await en medio, y eso
// basta SOLO porque startExternalRefresh lo toma antes de su primer await
// (`if (running) return 0; running = true;`, sin nada asíncrono en medio).
// DEPENDENCIA REAL Y FRÁGIL, escrita aquí porque en refresh.ts no hay nada
// que avise: si alguien vuelve a bajar ese `running = true` por debajo del
// SELECT de juegos —que es justo donde vivía—, esta pareja deja de ser
// atómica y dos pasadas se cuelan a la vez.
//
// Sin await a propósito: el radar ya ha terminado lo suyo y no tiene por qué
// quedarse retenido mientras las reseñas van de una en una. Con .catch, como
// todo fire-and-forget de la casa (el runDailyBackup del tic horario en
// index.ts es el mismo patrón): startExternalRefresh SÍ
// puede rechazar —su SELECT de juegos corre antes de soltar el trabajo de
// fondo— y esa promesa cae fuera del try de runRadarPass, que promete no
// lanzar nunca. Ese rechazo YA NO deja el candado ajeno tomado: refresh.ts lo
// suelta en su propio catch antes de relanzar (ver la válvula del final de
// runRadarPass, donde está la historia entera).
const claimExternalRefresh = (): boolean => {
  if (isExternalRefreshRunning()) return false;
  void startExternalRefresh('all').catch((error: unknown) => {
    console.warn('[radar] el refresco externo de la pasada semanal fallo:', error);
  });
  return true;
};

// La pasada entera. Nunca lanza: es trabajo de fondo, y un fallo de red no
// puede tumbar nada — un fallo no sella nada, así que lo reintenta el próximo
// tic horario (o el del siguiente arranque, si llega antes).
export const runRadarPass = async (force = false): Promise<RadarPassResult | null> => {
  if (running) return null;

  const lastRun = getConfigValue('radarLastRunAt');
  if (!force && lastRun > 0 && Date.now() - lastRun < WEEK_MS) return null;

  // Sin claves de IGDB no hay radar, y tampoco hay nada que explicar: la app
  // entera funciona sin ellas (modo local).
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return null;

  running = true;
  const seeding = lastRun === 0 && !alreadySown;
  try {
    const collections = await refreshMembership();
    const discovered = await findAnnounced(collections);

    // Sembrado. Lo que venga después ya no es la primera pasada de la vida,
    // se selle la semana ahí abajo o no — que es de lo que va alreadySown.
    alreadySown = true;

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

    // Y DE PASO, LOS DATOS EXTERNOS DE TODA LA BIBLIOTECA — la otra mitad de
    // la pasada, ver claimExternalRefresh aquí arriba.
    const externalStarted = claimExternalRefresh();

    // Y LA SEMANA SOLO SE SELLA SI ARRANCARON LAS DOS MITADES… CON VÁLVULA.
    //
    // Sellarla con el refresco externo sin arrancar era perder la mitad entera
    // durante siete días: pulsas el refresco del Plan (scope 'plan', ~20 s de
    // reseñas de los planeados), en ese hueco salta el tic horario, el radar
    // hace lo suyo y sella… y su startExternalRefresh('all') choca con ese
    // candado y se va mudo. Resultado: los cientos de juegos NO planeados se
    // quedan otra semana con las etiquetas, el % de reseñas y el appid de
    // playtest sin tocar — justo el dato que envejecía meses y que la decisión
    // del 9-ago vino a arreglar.
    //
    // PERO "NO SELLAR NUNCA" TAMPOCO VALE, y esta es la cicatriz de la primera
    // versión de este arreglo. Nació de un candado que se quedaba TOMADO PARA
    // SIEMPRE: startExternalRefresh ponía su `running = true` antes de leer los
    // juegos y no lo soltaba si ese SELECT rechazaba, así que se quedaba en
    // true hasta reiniciar el proceso — y esta app vive semanas en la bandeja.
    // ESO YA ESTÁ ARREGLADO EN SU SITIO (external/refresh.ts envuelve el
    // SELECT en un try que suelta el candado, avisa con su evento 'done' y
    // relanza), así que hoy lo único que deja esta mitad sin arrancar es una
    // COLISIÓN legítima: otra pasada en marcha, normalmente la del Plan.
    //
    // La válvula se queda igualmente, y no por inercia: el candado es de otro
    // módulo y esto no puede volver a depender de que allí no se cuele nunca
    // una salida sin soltarlo. Atado a él sin más, si eso pasara esto no
    // sellaría jamás y el tic horario (index.ts) dispararía la pasada COMPLETA
    // cada hora para siempre. Y sale cara: repetirla es idempotente —los
    // descubrimientos ya están en la tabla, `fresh` sale 0 y no se vuelve a
    // avisar de nada— pero
    // no es gratis, y aquí llegó a decir que sí lo era: son otra vez la
    // adopción de IGDB + el relleno de ids de SteamGridDB + el lote de IGDB de
    // toda la biblioteca (esas sí, 1-2 peticiones) + una petición de anuncios
    // por cada 200 colecciones, MÁS la reescritura entera de la tabla games en
    // una transacción, que la cola CDC captura y sube a Turso. A la semana no
    // se nota; cada hora y para siempre, sí.
    //
    // De ahí la válvula: se aguanta sin sellar MAX_UNSEALED_PASSES veces
    // seguidas y a la siguiente se sella igual. Tres reintentos cubren de
    // sobra la colisión de verdad (una pasada del Plan dura segundos y la de
    // biblioteca entera minutos, así que el tic de dentro de una hora la
    // encuentra libre); si a la cuarta sigue ocupado ya no es una colisión —es
    // un candado que alguien no ha soltado— y esperar más no lo va a soltar.
    // El contador se pone a cero al sellar: si dentro de una semana sigue
    // ocupado se vuelven a gastar los tres intentos, que es el precio de no
    // dar por perdida una colisión legítima.
    //
    // ALCANCE HONESTO: todo esto cubre "no llegó a ARRANCAR". Un refresco que
    // arranca y se muere a mitad (fallo de red dentro de su propia pasada)
    // sella la semana igual. Se acepta porque ese caso no muere en silencio:
    // publica el error en su evento de actividad y la tarjeta de Ajustes lo
    // enseña, mientras que el choque con el candado no dejaba ni una línea en
    // ningún sitio.
    if (externalStarted) {
      unsealedPasses = 0;
      setConfigValue('radarLastRunAt', Date.now());
    } else if (unsealedPasses < MAX_UNSEALED_PASSES) {
      unsealedPasses += 1;
      console.log(
        `[radar] el refresco externo estaba ocupado (${unsealedPasses}/${MAX_UNSEALED_PASSES}): la semanal no se sella, se reintenta en el proximo tic`,
      );
    } else {
      unsealedPasses = 0;
      setConfigValue('radarLastRunAt', Date.now());
      console.warn(
        `[radar] el refresco externo lleva ${MAX_UNSEALED_PASSES + 1} pasadas seguidas ocupado (candado encallado?): sello la semana igualmente para no repetir la pasada entera cada hora`,
      );
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
