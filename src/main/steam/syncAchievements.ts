import { and, eq } from 'drizzle-orm';
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

// A partir de cuántos desbloqueos con el MISMO segundo exacto se considera
// que la fecha es del rescate y no de la hazaña. Cinco es holgado: sacar dos
// o tres logros a la vez es normal (los encadenados de final de misión), pero
// cinco en el mismo segundo no le pasa a nadie jugando.
const BULK_SAME_SECOND = 5;

// Marca como "fecha no fiable" los desbloqueos que llegan en bloque con el
// mismo instante. Ver el porqué largo en el comentario de dateReliable
// (db/schema.ts): es la firma de un juego re-reportando su historial entero.
const unreliableTimestamps = (unlocks: UnlockInput[]): Set<number> => {
  const counts = new Map<number, number>();
  for (const unlock of unlocks) {
    if (!unlock.unlockedAt) continue;
    const time = unlock.unlockedAt.getTime();
    counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count >= BULK_SAME_SECOND).map(([time]) => time),
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
  const bulkTimes = unreliableTimestamps(unlocks);
  const fresh: AchievementToast[] = [];

  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      // Qué logros YA constaban desbloqueados (de cualquier fuente) — la foto
      // de "antes" contra la que se decide qué es nuevo. Se lee DENTRO de la
      // transacción que inserta, con el mismo tx: "decidir qué es nuevo" y
      // "escribirlo" quedan atómicos. Fuera (como antes) dos storeUnlocks
      // solapados del mismo juego —cierre de sesión vs. vigilante de emulador,
      // o livePoll de RA vs. refresco— leían la misma foto sin el insert del
      // otro y daban el mismo logro por nuevo: toast y tarjeta del 100%
      // duplicados. SQLite serializa las transacciones de una misma conexión,
      // así que la segunda ya ve el insert de la primera. (withDbAccess es un
      // contador, no un mutex — por eso no bastaba con envolver por fuera.)
      const already = new Set(
        (
          await tx
            .select({ achievementId: achievementUnlocksTable.achievementId })
            .from(achievementUnlocksTable)
            .innerJoin(
              achievementsTable,
              eq(achievementUnlocksTable.achievementId, achievementsTable.id),
            )
            .where(eq(achievementsTable.gameId, gameId))
        ).map((row) => row.achievementId),
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

  // Un catálogo vacío tiene DOS lecturas y getAchievementSchema las aplasta en
  // el mismo []: "este juego existe y no tiene logros" (legítimo) y el 400/403
  // de un appid sin stats, que casi siempre es un juego que TODAVIA no ha
  // salido — Enter the kOS anuncia logros en su ficha de Steam y aun así da
  // 403. Estampar achievementsSyncedAt en el segundo caso graba como
  // definitivo un "no" que caduca el día del lanzamiento: la pasada del
  // arranque (la única automática) filtra por isNull(achievementsSyncedAt), así
  // que ese juego no se vuelve a preguntar NUNCA y el día que salga sus 34
  // logros no aparecen — salvo que el usuario adivine que tiene que darle a
  // "Sync now". Mismo bug que refresh.ts ya arregló para el appid.
  //
  // La rareza hace de testigo para distinguir los dos casos: es otro endpoint
  // del mismo ISteamUserStats, contesta 200 (mapa vacío) para un juego con
  // stats y cero logros, y se niega igual que el schema para el que aún no ha
  // salido, donde devuelve null. Si el testigo tampoco sabe (o simplemente
  // falló la red) no se marca nada y el arranque lo vuelve a coger: preguntar
  // de más es gratis, perder el juego para siempre no. Lo limpio del todo
  // sería que getAchievementSchema devolviera null en SteamNoStatsError, como
  // ya hacen sus dos hermanas de api.ts.
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
  if (definitions.length === 0 && percentages === null) {
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
export const replaceUnlockPlacements = async (gameId: number): Promise<number> => {
  const windows = await withDbAccess(async () => getSessionWindows(gameId));
  if (windows.length === 0) return 0;

  const rows = await withDbAccess(async () =>
    getDb()
      .select({
        id: achievementUnlocksTable.id,
        unlockedAt: achievementUnlocksTable.unlockedAt,
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
        const placement = placeUnlock(row.unlockedAt, windows);
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
