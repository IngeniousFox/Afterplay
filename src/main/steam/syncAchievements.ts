import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { achievementsTable, achievementUnlocksTable, gamesTable } from '../db/schema';
import {
  getAchievementSchema,
  getGlobalPercentages,
  getPlayerUnlocks,
  getSteamUserId,
} from './api';
import { ensureGoldbergCatalog } from './emu/goldbergCatalog';
import { readEmuUnlocksForGame } from './emu/readUnlocks';
import { getSessionWindows, placeUnlock } from './matchSessions';
import { enqueueAchievementToasts } from './notifications/overlay';
import type { AchievementToast } from './notifications/overlay';
import type { PendingAchievementsGame } from './queue';

// El nombre del juego solo se conoce aquí, no dentro de storeUnlocks (que
// trabaja por gameId) — se rellena al encolar.
const toastFresh = (gameTitle: string, fresh: AchievementToast[]): void => {
  if (fresh.length === 0) return;
  enqueueAchievementToasts(fresh.map((toast) => ({ ...toast, gameTitle })));
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
  source: 'steam' | 'emu',
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

  // Qué logros YA constaban desbloqueados (de cualquier fuente) antes de
  // tocar nada: la foto de "antes" contra la que se decide qué es nuevo.
  const already = new Set(
    (
      await withDbAccess(async () =>
        getDb()
          .select({ achievementId: achievementUnlocksTable.achievementId })
          .from(achievementUnlocksTable)
          .innerJoin(
            achievementsTable,
            eq(achievementUnlocksTable.achievementId, achievementsTable.id),
          )
          .where(eq(achievementsTable.gameId, gameId)),
      )
    ).map((row) => row.achievementId),
  );

  const windows = await withDbAccess(async () => getSessionWindows(gameId));
  const bulkTimes = unreliableTimestamps(unlocks);
  const fresh: AchievementToast[] = [];

  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
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
          fresh.push({
            displayName: definition.displayName,
            iconUrl: definition.iconUrl,
            globalPercent: definition.globalPercent,
            gameTitle: '',
          });
        }
      }
    }),
  );

  return fresh;
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
          globalPercent: percentages.get(definition.apiName) ?? null,
          sortIndex: definition.sortIndex,
        };
        // UPSERT por (juego, nombre interno) — resincronizar refresca textos,
        // iconos y rareza sin duplicar el catálogo ni perder los desbloqueos
        // que cuelgan de estas filas.
        await tx
          .insert(achievementsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [achievementsTable.gameId, achievementsTable.apiName],
            set: {
              displayName: values.displayName,
              description: values.description,
              iconUrl: values.iconUrl,
              iconGrayUrl: values.iconGrayUrl,
              hidden: values.hidden,
              globalPercent: values.globalPercent,
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

  const emu = readEmuUnlocksForGame(appId, game.executablePath);
  const fresh = await storeUnlocks(gameId, 'emu', emu.unlocks, syncedAt);

  // ── Tus desbloqueos por la API ──────────────────────────────────────────
  if (!getSteamUserId()) {
    if (notify) toastFresh(game.title, fresh);
    return {
      catalogCount: definitions.length,
      unlockedCount: emu.unlocks.length,
      unlocksKnown: false,
    };
  }

  const unlocks = await getPlayerUnlocks(appId);
  if (unlocks === null) {
    // Steam no contestó sobre este juego (no lo tienes, perfil privado…). NO
    // se marca la fecha: no saber nada no es lo mismo que saber que no tienes
    // ninguno, y marcarlo daría por bueno un vacío que no hemos comprobado.
    if (notify) toastFresh(game.title, fresh);
    return {
      catalogCount: definitions.length,
      unlockedCount: emu.unlocks.length,
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

  if (notify) toastFresh(game.title, fresh);

  return {
    catalogCount: definitions.length,
    unlockedCount: unlocks.length + emu.unlocks.length,
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
