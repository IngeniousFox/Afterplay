import { and, eq, inArray } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../db/schema';
import {
  getAchievementSchema,
  getGlobalPercentages,
  getPlayerUnlocks,
  getSteamUserId,
} from './api';
import type { SteamAchievementDef } from './api';
import { getLocalAchievementTexts } from './localSchema';
import { ensureGoldbergCatalog } from './emu/goldbergCatalog';
import { readEmuUnlocksForGame } from './emu/readUnlocks';
import { getSessionWindows, placeUnlock } from './matchSessions';
import { maybeCelebrateCompletion } from './notifications/complete';
import { enqueueAchievementToasts } from './notifications/overlay';
import type { AchievementToast } from './notifications/overlay';
import type { PendingAchievementsGame } from './queue';

// El juego (nombre y hero) solo se conoce aquí, no dentro de storeUnlocks
// (que trabaja por gameId) — se rellena al encolar. Y tras la tanda, la
// comprobación del 100%: si estos desbloqueos acaban de cerrar el juego, cae
// el broche dorado (notifications/complete.ts).
const toastFresh = (
  game: Pick<PendingAchievementsGame, 'id' | 'title' | 'heroUrl'>,
  fresh: AchievementToast[],
): void => {
  if (fresh.length === 0) return;
  enqueueAchievementToasts(
    fresh.map((toast) => ({ ...toast, gameTitle: game.title, gameHeroUrl: game.heroUrl })),
  );
  maybeCelebrateCompletion(game.id, game.title, game.heroUrl);
};

// Sincronizar los logros de UN juego (LOGROS.md §3-4): el catálogo (qué
// logros existen), tus desbloqueos por la API de Steam si hay SteamID, y los
// desbloqueos que hayan dejado los emuladores de Steam en este PC (§7).
//
// Las mitades son independientes a propósito: el catálogo se pide una vez y
// no cambia casi nunca; los desbloqueos cambian cada vez que juegas. Un juego
// pirata sin cuenta detrás se queda sin la parte de la API de jugador, pero
// el catálogo y la fuente de emuladores funcionan exactamente igual.

export type GameAchievementSyncResult = {
  catalogCount: number;
  unlockedCount: number;
  // true si Steam contestó sobre TUS logros. false = no se preguntó (sin
  // SteamID) o se negó (juego que no tienes, perfil privado).
  unlocksKnown: boolean;
};

type UnlockInput = { apiName: string; unlockedAt: Date | null };

// Una fila de desbloqueo que YA estaba guardada, para el censo de instantes.
type StoredInstant = { achievementId: number; unlockedAt: Date };

// A partir de cuántos desbloqueos con el MISMO segundo exacto se considera
// que la fecha es del rescate y no de la hazaña. Cinco es holgado: sacar dos
// o tres logros a la vez es normal (los encadenados de final de misión), pero
// cinco en el mismo segundo no le pasa a nadie jugando.
const BULK_SAME_SECOND = 5;

// Marca como "fecha no fiable" los instantes que llegan en bloque. Ver el
// porqué largo en el comentario de dateReliable (db/schema.ts): es la firma de
// un juego re-reportando su historial entero.
//
// Se cuenta por LOGRO distinto y sumando lo que YA hay guardado de la MISMA
// fuente con ese mismo instante. Antes solo miraba la lista que entraba, y eso
// apagaba la regla en cuanto la tanda venía troceada: el sondeo de RA manda
// ventanas parciales por diseño (ra/livePoll.ts), así que un rescate repartido
// en varios ticks entraba como veinticinco momentos buenos. Es una protección
// que se caía sola sin que nadie la tocara.
//
// Contar LOGROS y no filas es lo que hace que sumar lo guardado siga siendo
// idempotente: el sondeo de Steam manda la lista ENTERA cada 30 s, y un logro
// que ya constaba con ese instante es el mismo logro, no uno más — cuatro en
// el mismo segundo siguen siendo cuatro por muchas veces que se repita la
// tanda. Por lo mismo, un apiName repetido DENTRO de la tanda cuenta una vez.
//
// Lo guardado cuenta con independencia de su dateReliable, y eso tiene un
// precio conocido: los desbloqueos sin fecha propia se guardan todos con la
// fecha de respaldo de su llamada, así que si media docena de ellos quedó en
// el instante F, un desbloqueo legítimo que caiga exactamente en F en una
// llamada POSTERIOR se marcará como bloque. Se acepta a sabiendas, porque la
// alternativa (contar solo las filas fiables) apaga la regla justo en la
// llamada siguiente a detectar el bloque: para entonces ya están degradadas y
// el sexto de la tanda troceada volvería a pasar por fiable. Dentro de una
// misma tanda los nulos siguen sin contar (no tienen instante propio).
const unreliableTimestamps = (
  batch: { key: number | string; unlockedAt: Date | null }[],
  stored: StoredInstant[],
): Set<number> => {
  const keysByTime = new Map<number, Set<number | string>>();
  for (const unlock of batch) {
    if (!unlock.unlockedAt) continue;
    const time = unlock.unlockedAt.getTime();
    const keys = keysByTime.get(time) ?? new Set<number | string>();
    keys.add(unlock.key);
    keysByTime.set(time, keys);
  }
  // Solo los instantes que nombra ESTA tanda: censar el historial entero del
  // juego en cada llamada sería reabrir filas que nadie ha tocado.
  for (const row of stored) keysByTime.get(row.unlockedAt.getTime())?.add(row.achievementId);

  return new Set(
    [...keysByTime.entries()]
      .filter(([, keys]) => keys.size >= BULK_SAME_SECOND)
      .map(([time]) => time),
  );
};

// Guarda una tanda de desbloqueos de UNA fuente, casando cada uno con la
// sesión en la que cayó. Compartido por la vía Steam y la vía emuladores —
// misma tabla, mismo upsert por (logro, fuente), mismo emparejado.
//
// Devuelve los que son NUEVOS de verdad (no constaban por ninguna fuente
// antes de esta llamada). Es lo que decide qué merece un aviso en pantalla:
// sin esa distinción, la primera pasada por 300 juegos dispararía miles.
export const storeUnlocks = async (
  gameId: number,
  source: 'steam' | 'emu' | 'ra',
  unlocks: UnlockInput[],
  // Para los desbloqueos sin fecha propia (Steam la perdió, o el crack no la
  // guardó): sí lo tienes, y perderlo sería peor que fecharlo hoy.
  fallbackDate: Date,
): Promise<AchievementToast[]> => {
  if (unlocks.length === 0) return [];

  const stored = await withDbAccess(async () =>
    getDb()
      .select({
        id: achievementsTable.id,
        apiName: achievementsTable.apiName,
        displayName: achievementsTable.displayName,
        iconUrl: achievementsTable.iconUrl,
        globalPercent: achievementsTable.globalPercent,
      })
      .from(achievementsTable)
      .where(eq(achievementsTable.gameId, gameId)),
  );
  const byApiName = new Map(stored.map((row) => [row.apiName, row]));

  const windows = await withDbAccess(async () => getSessionWindows(gameId));
  const fresh: AchievementToast[] = [];

  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      // Qué desbloqueos YA constaban de este juego (de cualquier fuente) — la
      // foto de "antes" contra la que se decide qué es nuevo, si el instante
      // huele a rescate y si la fecha guardada vale más que la que entra. Se
      // lee DENTRO de la transacción que inserta, con el mismo tx: "decidir
      // qué es nuevo" y "escribirlo" quedan atómicos. Fuera (como antes) dos
      // storeUnlocks solapados del mismo juego —cierre de sesión vs. vigilante
      // de emulador, o livePoll de RA vs. refresco— leían la misma foto sin el
      // insert del otro y daban el mismo logro por nuevo: toast y tarjeta del
      // 100% duplicados. SQLite serializa las transacciones de una misma
      // conexión, así que la segunda ya ve el insert de la primera.
      // (withDbAccess es un contador, no un mutex — por eso no bastaba con
      // envolver por fuera.)
      const storedUnlocks = await tx
        .select({
          id: achievementUnlocksTable.id,
          achievementId: achievementUnlocksTable.achievementId,
          source: achievementUnlocksTable.source,
          unlockedAt: achievementUnlocksTable.unlockedAt,
          dateReliable: achievementUnlocksTable.dateReliable,
        })
        .from(achievementUnlocksTable)
        .innerJoin(
          achievementsTable,
          eq(achievementUnlocksTable.achievementId, achievementsTable.id),
        )
        .where(eq(achievementsTable.gameId, gameId));

      // "Nuevo" es del LOGRO, no de la fuente: enterarte otra vez del mismo
      // Grimm porque ahora lo ha visto también Steam sería un fallo visible.
      const already = new Set(storedUnlocks.map((row) => row.achievementId));
      // Lo demás (el censo del bloque y la fecha que ya había) se mira solo
      // contra ESTA fuente: cada fuente tiene su reloj y su fila propia, y una
      // no puede degradar el momento que la otra tenga bien guardado.
      const sameSource = storedUnlocks.filter((row) => row.source === source);

      const bulkTimes = unreliableTimestamps(
        unlocks.map((unlock) => ({
          // La identidad es el LOGRO. Los que no están en el catálogo se
          // ignoran más abajo, pero cuentan para el censo por su apiName: si
          // un fichero de crack re-reporta en bloque, lo hace entero.
          key: byApiName.get(unlock.apiName)?.id ?? unlock.apiName,
          unlockedAt: unlock.unlockedAt,
        })),
        sameSource,
      );

      // Rescate descubierto A POSTERIORI. Si el instante ya se sabe de bloque,
      // las filas que se guardaron antes con ese mismo instante dejan de ser
      // un momento: se colaron por fiables solo porque su tanda venía troceada
      // (el sondeo de RA manda ventanas parciales). Sin esto, el arreglo del
      // censo dejaría media tanda colgada de la sesión y la otra media no.
      const degradadas = sameSource.filter(
        (row) => row.dateReliable && bulkTimes.has(row.unlockedAt.getTime()),
      );
      if (degradadas.length > 0) {
        await tx
          .update(achievementUnlocksTable)
          .set({ dateReliable: false, sessionId: null, iterationId: null })
          .where(
            inArray(
              achievementUnlocksTable.id,
              degradadas.map((row) => row.id),
            ),
          );
      }

      // Con qué fiabilidad quedó guardada la fecha de cada logro de esta
      // fuente, ya contando el degradado de arriba. Es lo que impide que un
      // rescate en bloque pise un momento bueno (ver el upsert). Su PRESENCIA
      // dice además si esta fuente ya tiene fila para el logro, que es la otra
      // guarda del upsert: por eso las dos se leen de aquí y no de dos mapas
      // que habría que mantener a la vez.
      const storedReliable = new Map(
        sameSource.map((row) => [
          row.achievementId,
          row.dateReliable && !bulkTimes.has(row.unlockedAt.getTime()),
        ]),
      );

      for (const unlock of unlocks) {
        const definition = byApiName.get(unlock.apiName);
        // Un desbloqueo de un logro que no está en el catálogo: logros
        // retirados del juego, o un fichero de crack con claves inventadas.
        // Sin fila del catálogo no hay dónde colgarlo — se ignora.
        if (!definition) continue;

        // Sin fecha propia, o llegada en bloque con el mismo segundo: la
        // fecha existe (hay que guardar algo) pero no vale como momento.
        const dateReliable =
          unlock.unlockedAt !== null && !bulkTimes.has(unlock.unlockedAt.getTime());

        // UN "NO SÉ CUÁNDO" NO BORRA UN "SÉ CUÁNDO". El upsert de abajo pisa
        // las cuatro columnas del momento, y eso es lo que arregla un
        // emparejado obsoleto (la sesión que aparece después de la
        // sincronización) — pero era también lo que destruía el momento bueno
        // en la secuencia real del 007: el crack tenía las fechas buenas, se
        // le escribe el achievements.json que le faltaba, el juego re-reporta
        // los 25 con el mismo segundo y el fichero pasa a tener SOLO la fecha
        // del rescate. Al leerlo se perdía lo ya guardado: fecha del rescate,
        // dateReliable a false y el logro descolgado de su sesión, para
        // siempre. Si lo que entra no vale como momento y lo guardado sí
        // valía, esta fila no se toca: las cuatro columnas del set son justo
        // las que no deben cambiar, así que no escribir es el UPDATE correcto
        // (y de paso no ensucia el ciclo de sincronización con Turso).
        //
        // Solo protege lo FIABLE: una fecha no fiable sí se deja pisar, que es
        // como un rescate se corrige el día que llega la fecha de verdad.
        if (!dateReliable && storedReliable.get(definition.id) === true) continue;

        // Y UN "NO SÉ CUÁNDO" TAMPOCO PISA A OTRO "NO SÉ CUÁNDO". Si lo que
        // entra no trae fecha propia y esta fuente ya tiene fila para el logro,
        // no hay nada nuevo que escribir: la fecha que se guardaría es el
        // `fallbackDate` del llamante, o sea el `new Date()` de ESA pasada, así
        // que el upsert cambiaba el dato en cada llamada sin decir nada nuevo
        // (dateReliable sigue false y el emparejado sigue null, la ficha sigue
        // pintando "date unknown"). Con el sondeo en vivo, que manda la lista
        // ENTERA cada 30 s mientras el juego esté abierto, eso eran doce UPDATE
        // por tick indefinidamente —los logros antiguos con unlocktime 0 son
        // reales y vienen en manada, ver el comentario de unlocktime en
        // steam/api.ts— sobre el mismo fichero que el ciclo de Turso sincroniza
        // cada minuto. Es el mismo churn que fillHiddenDescriptions (más abajo)
        // se toma la molestia de evitar leyendo lo guardado antes de escribir.
        //
        // La fecha vieja se conserva a propósito aunque tampoco fuera fiable:
        // un instante que alguna vez se supo vale más que el de hoy, y un "no"
        // de la fuente no borra lo que había.
        if (unlock.unlockedAt === null && storedReliable.has(definition.id)) continue;

        // Un desbloqueo sin fecha fiable no se cuelga de ninguna sesión:
        // colgarlo sería inventarse que lo sacaste en ese rato concreto.
        const placement = dateReliable
          ? placeUnlock(unlock.unlockedAt, windows)
          : { sessionId: null, iterationId: null };

        await tx
          .insert(achievementUnlocksTable)
          .values({
            achievementId: definition.id,
            unlockedAt: unlock.unlockedAt ?? fallbackDate,
            dateReliable,
            source,
            iterationId: placement.iterationId,
            sessionId: placement.sessionId,
          })
          .onConflictDoUpdate({
            target: [achievementUnlocksTable.achievementId, achievementUnlocksTable.source],
            set: {
              unlockedAt: unlock.unlockedAt ?? fallbackDate,
              dateReliable,
              iterationId: placement.iterationId,
              sessionId: placement.sessionId,
            },
          });

        if (!already.has(definition.id)) {
          // gameTitle/gameHeroUrl los rellena quien encola (toastFresh): aquí
          // solo se trabaja por gameId.
          fresh.push({
            displayName: definition.displayName,
            iconUrl: definition.iconUrl,
            globalPercent: definition.globalPercent,
            gameTitle: '',
            gameHeroUrl: null,
          });
        }

        // La foto se actualiza AL INSERTAR, no solo al abrir la transacción:
        // dentro de una misma tanda un apiName repetido es el MISMO logro. Con
        // la foto congelada salía dos veces en `fresh` —dos tarjetas flotantes
        // para un solo logro y el unlockedCount del evento 'synced' inflado—
        // aunque guardada quedara una sola fila, porque el UNIQUE (logro,
        // fuente) sí hacía su trabajo. Hoy ninguna fuente entrega duplicados,
        // pero el día que alguien junte las tandas de dos ficheros esto es lo
        // que evita el aviso doble.
        already.add(definition.id);
        storedReliable.set(definition.id, dateReliable);
      }
    }),
  );

  return fresh;
};

export type EmuUnlocksApplied = {
  // Cuántos desbloqueos hay en disco para este juego — no cuántos son nuevos.
  unlockedCount: number;
  // Los que no constaban por ninguna fuente antes de esta llamada: lo único
  // que puede merecer un aviso en pantalla.
  fresh: AchievementToast[];
};

// Los desbloqueos que algún emulador de Steam haya dejado en este PC para UNA
// fila de juego (LOGROS.md §7). Lo comparten los tres sitios que los leen: la
// sincronización de un juego (aquí abajo), el barrido del arranque
// (backfill.ts) y el vigilante en vivo (emu/watcher.ts).
//
// Está junto porque la regla ya se desincronizó una vez y el síntoma no se ve
// hasta que alguien compara dos pantallas: la lectura va por FILA y no por
// appid, porque dos de los formatos viven junto al EXE (emu/locations.ts) y
// executablePath es de la fila — y el schema permite a propósito varias fichas
// con el mismo appid (juego y edición). Con un find() por appid los logros
// acababan colgados de la edición que NO estabas jugando, y el estado "en
// vivo" ni siquiera coincidía con el de después de reiniciar.
//
// Lo que NO hace es escribir el catálogo de Goldberg: eso toca la carpeta del
// juego y solo lo hacen los dos caminos lentos, no el vigilante, que salta con
// cada fichero que escribe un crack.
export const applyEmuUnlocksForGame = async (
  game: { id: number; steamAppId: number; executablePath: string | null },
  // Para los desbloqueos sin fecha propia. Cada llamante trae la suya: la
  // sincronización usa el mismo instante que estampa en el juego; el barrido y
  // el vigilante, el de ahora.
  fallbackDate: Date,
): Promise<EmuUnlocksApplied> => {
  const emu = readEmuUnlocksForGame(game.steamAppId, game.executablePath);
  if (emu.unlocks.length === 0) return { unlockedCount: 0, fresh: [] };

  const fresh = await storeUnlocks(game.id, 'emu', emu.unlocks, fallbackDate);
  return { unlockedCount: emu.unlocks.length, fresh };
};

// Rellena con el schema local de Steam las descripciones de los logros
// OCULTOS que la Web API dejó mudos (nunca las da, ni siquiera de los que ya
// tienes desbloqueados). Es el escalón 2 de los tres que documenta
// hiddenDescriptions.ts, y hasta ahora no lo llamaba nadie: se saltaba una
// fuente local y gratis para irse al tercero por cada juego con ocultos,
// incluidos aquellos cuyo .bin está en este disco.
//
// Esto SÍ se guarda en la base de datos, al revés que Steam Hunters: es tu
// propio Steam hablando de tu propio juego, no un tercero.
//
// Solo AÑADE, y solo lo que cambia. Si el .bin no existe (juego que tu cliente
// no ha cacheado) o no trae texto para ese logro, la fila se queda como estaba
// — un "no" de una fuente no borra lo que ya había.
const fillHiddenDescriptions = async (
  gameId: number,
  appId: number,
  definitions: SteamAchievementDef[],
): Promise<void> => {
  const mute = definitions.filter(
    (definition) => definition.hidden && definition.description === null,
  );
  if (mute.length === 0) return;

  // La lectura (registro de Windows + fichero) va FUERA del candado de la DB,
  // igual que la red: es I/O que puede tardar y nadie más debería esperarla.
  const texts = await getLocalAchievementTexts(appId);
  if (texts.size === 0) return;

  // Contra lo GUARDADO, no contra lo que trae la API. Mirar la API no sirve de
  // filtro: de un oculto siempre devuelve null, así que cada "Sync now"
  // completo repetía los 253 UPDATE con el mismo texto que ya estaba, más su
  // línea de consola por juego. Escrituras que no cambian nada, sobre el mismo
  // fichero que el ciclo de Turso sincroniza cada minuto — justo el churn que
  // el breatheMs de la cola (queue.ts) existe para no provocar.
  const stored = await withDbAccess(async () =>
    getDb()
      .select({ apiName: achievementsTable.apiName, description: achievementsTable.description })
      .from(achievementsTable)
      .where(eq(achievementsTable.gameId, gameId)),
  );
  const current = new Map(stored.map((row) => [row.apiName, row.description]));

  const filled = mute.flatMap((definition) => {
    const description = texts.get(definition.apiName)?.description;
    if (!description || current.get(definition.apiName) === description) return [];
    return [{ apiName: definition.apiName, description }];
  });
  if (filled.length === 0) return;

  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      for (const row of filled) {
        await tx
          .update(achievementsTable)
          .set({ description: row.description })
          .where(
            and(eq(achievementsTable.gameId, gameId), eq(achievementsTable.apiName, row.apiName)),
          );
      }
    }),
  );

  // Solo ASCII en los console.log: la consola de Windows no siempre usa UTF-8.
  console.log(
    `[steam] ${filled.length} descripcion(es) oculta(s) nueva(s) del schema local para el appid ${appId}`,
  );
};

export const syncGameAchievements = async (
  game: PendingAchievementsGame,
  // Solo los refrescos EN VIVO (cerrar el juego, jugar con la app abierta)
  // avisan en pantalla. La pasada de 300 juegos no: son logros de hace años,
  // no algo que acabe de pasar, y anunciarlos sería un castigo.
  notify = false,
): Promise<GameAchievementSyncResult> => {
  const { id: gameId, steamAppId: appId } = game;

  // ── Catálogo ────────────────────────────────────────────────────────────
  const [definitions, percentages] = await Promise.all([
    getAchievementSchema(appId),
    getGlobalPercentages(appId),
  ]);

  const syncedAt = new Date();

  // Un catálogo vacío tiene TRES lecturas y getAchievementSchema las aplasta
  // todas en el mismo []: "este juego existe y no tiene logros" (legítimo); el
  // 400/403 de un appid sin stats, que casi siempre es un juego que TODAVIA no
  // ha salido —Enter the kOS anuncia logros en su ficha de Steam y aun así da
  // 403—; y el 403 de una CLAVE mal pegada o revocada, que solo le llega a este
  // endpoint porque es el único de los tres que la manda.
  //
  // Estampar achievementsSyncedAt en los dos últimos casos graba como
  // definitivo un "no" que no lo es: la pasada del arranque (la única
  // automática) filtra por isNull(achievementsSyncedAt), así que ese juego no
  // se vuelve a preguntar NUNCA. Con el juego sin publicar se pierden sus 34
  // logros el día que salga; con una errata en la clave se pierde la
  // BIBLIOTECA ENTERA de una sentada —541 juegos marcados como sincronizados y
  // con cero logros— y ni corregir la clave y reiniciar lo deshace, porque ya
  // no queda ninguno pendiente que mirar. Mismo bug que refresh.ts ya arregló
  // para el appid.
  //
  // La rareza hace de testigo, y hay que mirar CUÁNTA trae, no solo si
  // contestó: es otro endpoint del mismo ISteamUserStats y NO manda la clave
  // (api.ts), así que sobrevive a que la nuestra sea mala.
  //   · null                 -> ni ella sabe: el juego que aún no ha salido, o
  //                             simplemente falló la red. No se marca nada.
  //   · un mapa VACÍO        -> el juego publica stats y no tiene ni un logro:
  //                             el [] del schema es la verdad, y se marca.
  //   · un mapa CON entradas -> este juego SÍ tiene logros, luego un catálogo
  //                             vacío no es una respuesta, es que no se pudo
  //                             leer. No se marca y el arranque lo vuelve a
  //                             coger cuando la clave esté bien.
  // Preguntar de más es gratis; perder la biblioteca hasta que el usuario
  // adivine que tiene que pulsar "Sync now", no.
  //
  // El precio no son solo las peticiones de más: la tarjeta de Ajustes cuenta
  // "sincronizados" por isNotNull(achievementsSyncedAt) y "elegibles" por
  // tener appid (db/queries/achievements/getAchievementsStatus.ts), así que
  // cada juego sin publicar deja ahí un "540 de 541" que no se cierra hasta
  // que salga. Se acepta a sabiendas —el otro camino es perder sus logros el
  // día del lanzamiento—, pero es del tipo de denominador incompleto contra el
  // que avisa el propio comentario de esa consulta ("541 de 527"), y el
  // arreglo va ahí: descontar del denominador los que sabemos que hoy no
  // tienen stats, no fingir aquí que sí se sincronizaron.
  if (definitions.length === 0 && (percentages === null || percentages.size > 0)) {
    return { catalogCount: 0, unlockedCount: 0, unlocksKnown: false };
  }

  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      for (const definition of definitions) {
        const values = {
          gameId,
          apiName: definition.apiName,
          displayName: definition.displayName,
          description: definition.description,
          iconUrl: definition.iconUrl,
          iconGrayUrl: definition.iconGrayUrl,
          hidden: definition.hidden,
          globalPercent: percentages?.get(definition.apiName) ?? null,
          sortIndex: definition.sortIndex,
        };
        // UPSERT por (juego, nombre interno) — resincronizar refresca textos,
        // iconos y rareza sin duplicar el catálogo ni perder los desbloqueos
        // que cuelgan de estas filas.
        //
        // La rareza es una de las dos columnas que se quedan fuera del set
        // cuando su llamada falló (percentages === null): en las demás, lo que
        // trae el schema es la verdad de ahora mismo, pero un porcentaje que no
        // se ha podido leer no es un porcentaje nuevo — pisarlo con null
        // borraría un dato bueno a cambio de nada. En un alta el null va igual:
        // no hay nada guardado que conservar.
        //
        // La otra es la descripción. El motivo es el logro OCULTO: la API
        // NUNCA da la suya, así que ahí siempre llega null, y lo que hay
        // guardado puede venir del schema local de Steam
        // (fillHiddenDescriptions, más abajo) — escribir ese null volvía a
        // dejar mudos los 253 ocultos en cada "Sync now".
        //
        // Pero la guarda mira el VALOR, no el `hidden`, así que alcanza también
        // a los visibles: a un logro al que su desarrollador le borre la
        // descripción en Steam, la app le conserva la vieja para siempre. Es a
        // propósito (un texto que ya tienes vale más que un hueco), y es la
        // diferencia con la rareza: aquella se acota por si su llamada falló
        // —percentages === null, una decisión por TANDA— y esta por lo que trae
        // cada logro.
        await tx
          .insert(achievementsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [achievementsTable.gameId, achievementsTable.apiName],
            set: {
              displayName: values.displayName,
              ...(values.description === null ? {} : { description: values.description }),
              iconUrl: values.iconUrl,
              iconGrayUrl: values.iconGrayUrl,
              hidden: values.hidden,
              ...(percentages ? { globalPercent: values.globalPercent } : {}),
              sortIndex: values.sortIndex,
            },
          });
      }

      await tx
        .update(gamesTable)
        .set({ achievementsSyncedAt: syncedAt })
        .where(eq(gamesTable.id, gameId));
    }),
  );

  if (definitions.length === 0) {
    return { catalogCount: 0, unlockedCount: 0, unlocksKnown: false };
  }

  // ── Descripciones de los OCULTOS, del Steam de este PC (LOGROS.md §6) ────
  await fillHiddenDescriptions(gameId, appId, definitions);

  // ── Emuladores de Steam (LOGROS.md §7) ──────────────────────────────────
  // ANTES que la API de jugador a propósito: es lectura local (no puede
  // fallar por red) y así un juego pirata queda completo aunque Steam luego
  // no conteste nada sobre él.
  //
  // Y el catálogo para Goldberg: si el crack de este juego tiene una carpeta
  // steam_settings sin achievements.json, el emulador NO está registrando
  // nada de lo que sacas (lo comprobamos con horas de 007 y cero logros
  // grabados) — escribírselo es lo que hace que empiece a apuntar.
  await withDbAccess(async () => ensureGoldbergCatalog(gameId, game.installDirectory));

  const emu = await applyEmuUnlocksForGame(game, syncedAt);
  const fresh = emu.fresh;

  // ── Tus desbloqueos por la API ──────────────────────────────────────────
  if (!getSteamUserId()) {
    if (notify) toastFresh(game, fresh);
    return {
      catalogCount: definitions.length,
      unlockedCount: emu.unlockedCount,
      unlocksKnown: false,
    };
  }

  const unlocks = await getPlayerUnlocks(appId);
  if (unlocks === null) {
    // Steam no contestó sobre este juego (no lo tienes, perfil privado…). NO
    // se marca la fecha: no saber nada no es lo mismo que saber que no tienes
    // ninguno, y marcarlo daría por bueno un vacío que no hemos comprobado.
    if (notify) toastFresh(game, fresh);
    return {
      catalogCount: definitions.length,
      unlockedCount: emu.unlockedCount,
      unlocksKnown: false,
    };
  }

  fresh.push(...(await storeUnlocks(gameId, 'steam', unlocks, syncedAt)));

  await withDbAccess(async () =>
    getDb()
      .update(gamesTable)
      .set({ achievementsUnlocksSyncedAt: syncedAt })
      .where(eq(gamesTable.id, gameId)),
  );

  if (notify) toastFresh(game, fresh);

  return {
    catalogCount: definitions.length,
    unlockedCount: unlocks.length + emu.unlockedCount,
    unlocksKnown: true,
  };
};

// Vuelve a colgar de sus sesiones los desbloqueos YA guardados de un juego,
// sin tocar la red. Hace falta porque el orden real de las cosas es al revés
// del ideal: primero juegas (y Afterplay graba la sesión), y la sincronización
// llega después — pero también al contrario, cuando alguien asigna a mano una
// sesión de emulador o corrige fechas. Recolocar es barato y deja los momentos
// bien pegados sin repreguntar nada.
//
// Respeta dateReliable EXACTAMENTE igual que storeUnlocks (arriba, en el
// insert): son los dos únicos escritores de sessionId/iterationId en
// achievement_unlocks y la regla tiene que ser la misma en los dos, o el que
// pase después deshace la honestidad del otro. Antes esta función recolocaba
// TODAS las filas mirando solo la fecha: los 25 logros que Goldberg re-reporta
// sellados con el mismo segundo llevan un segundo que cae DENTRO de la sesión
// que estabas jugando, así que una sola llamada a 'achievements:replacePlacements'
// se los colgaba a esa sesión y la pantalla de Sesiones se inventaba que los
// habías sacado en ese rato — justo lo que prohíbe la regla 1 de
// LOGROS-IDEAS §1 ("ni en sesiones").
export const replaceUnlockPlacements = async (gameId: number): Promise<number> => {
  const windows = await withDbAccess(async () => getSessionWindows(gameId));
  if (windows.length === 0) return 0;

  const rows = await withDbAccess(async () =>
    getDb()
      .select({
        id: achievementUnlocksTable.id,
        unlockedAt: achievementUnlocksTable.unlockedAt,
        dateReliable: achievementUnlocksTable.dateReliable,
        sessionId: achievementUnlocksTable.sessionId,
      })
      .from(achievementUnlocksTable)
      .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
      .where(eq(achievementsTable.gameId, gameId)),
  );

  let placed = 0;
  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      for (const row of rows) {
        // Sin fecha fiable no hay rato al que pegarlo — y el null se ESCRIBE,
        // no se salta la fila: así una pasada de esta misma función también
        // descuelga lo que una versión anterior hubiera colgado mal.
        const placement = row.dateReliable
          ? placeUnlock(row.unlockedAt, windows)
          : { sessionId: null, iterationId: null };
        if (placement.sessionId === row.sessionId) continue;
        await tx
          .update(achievementUnlocksTable)
          .set({ sessionId: placement.sessionId, iterationId: placement.iterationId })
          .where(eq(achievementUnlocksTable.id, row.id));
        if (placement.sessionId !== null) placed++;
      }
    }),
  );

  return placed;
};
