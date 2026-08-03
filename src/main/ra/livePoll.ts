import { isNotNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { maybeCelebrateCompletion } from '../steam/notifications/complete';
import { enqueueAchievementToasts } from '../steam/notifications/overlay';
import { notifyAchievementsActivity } from '../steam/notify';
import { storeUnlocks } from '../steam/syncAchievements';
import { getRaRecentUnlocks, hasRaCredentials } from './api';

// El sondeo en vivo de RetroAchievements (RETROACHIEVEMENTS.md §7).
//
// Aquí no hay ficheros que vigilar (la fuente de verdad es SU servidor, no
// el disco): se pregunta "¿logros nuevos?" cada medio minuto, y SOLO
// mientras el watcher vea un emulador corriendo — sin emulador no puede
// estar cayendo nada, y sondear en vacío sería ruido de red perpetuo.
//
// Latencia honesta: el emulador sube el logro al instante y este sondeo lo
// ve como tarde INTERVAL_MS después. No es el caso RUNE (sub-segundo por
// fs.watch) y no pretende serlo — además el emulador ya enseñó su propio
// aviso en el momento exacto; el nuestro añade la cola, el sonido de la
// casa y que quede guardado con su sesión.

const INTERVAL_MS = 30_000;
// Ventana holgada respecto al intervalo: si un tick se pierde (red, PC
// dormido), el siguiente recoge lo de antes. storeUnlocks dedup a — repetir
// un desbloqueo ya guardado no hace nada.
const LOOKBACK_MINUTES = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

const tick = async (isEmulatorRunning: () => boolean): Promise<void> => {
  if (polling || !hasRaCredentials() || !isEmulatorRunning()) return;
  polling = true;

  try {
    const recent = await getRaRecentUnlocks(LOOKBACK_MINUTES);
    if (recent.length === 0) return;

    const games = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          raGameId: gamesTable.raGameId,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(isNotNull(gamesTable.raGameId)),
    );

    // Agrupar por juego: una tanda de desbloqueos del mismo juego entra
    // junta en storeUnlocks (mismo emparejado de sesiones, un solo aviso
    // combinado si son muchos).
    const byRaGame = new Map<number, typeof recent>();
    for (const unlock of recent) {
      const list = byRaGame.get(unlock.raGameId) ?? [];
      list.push(unlock);
      byRaGame.set(unlock.raGameId, list);
    }

    for (const [raGameId, unlocks] of byRaGame) {
      const game = games.find((candidate) => candidate.raGameId === raGameId);
      // Un appid de RA que no está en la biblioteca (o sin emparejar): no
      // hay dónde colgarlo. Mismo silencio que el vigilante de emuladores.
      if (!game) continue;

      const fresh = await storeUnlocks(
        game.id,
        'ra',
        unlocks.map((unlock) => ({
          apiName: String(unlock.raAchievementId),
          unlockedAt: unlock.unlockedAt,
        })),
        new Date(),
      );
      if (fresh.length === 0) continue;

      // Solo ASCII en los console.log, convencion de la casa.
      console.log(`[ra] ${fresh.length} logro(s) nuevo(s) en vivo: ${game.title}`);
      enqueueAchievementToasts(
        fresh.map((toast) => ({ ...toast, gameTitle: game.title, gameHeroUrl: game.heroUrl })),
      );
      // ¿Acaba de caer el último? El broche dorado del 100%.
      maybeCelebrateCompletion(game.id, game.title, game.heroUrl);
      notifyAchievementsActivity({
        kind: 'synced',
        gameId: game.id,
        catalogCount: 0,
        unlockedCount: fresh.length,
      });
    }
  } catch (error) {
    // Un tick fallido no tumba el sondeo: el siguiente reintenta, y la
    // ventana de LOOKBACK recoge lo que este se perdió.
    console.warn('[ra] fallo en el sondeo en vivo:', error);
  } finally {
    polling = false;
  }
};

export const startRaLivePoll = (isEmulatorRunning: () => boolean): void => {
  stopRaLivePoll();
  timer = setInterval(() => void tick(isEmulatorRunning), INTERVAL_MS);
};

export const stopRaLivePoll = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
