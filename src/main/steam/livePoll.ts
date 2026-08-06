import { inArray } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getPlayerUnlocks, getSteamUserId, hasSteamKey } from './api';
import { maybeCelebrateCompletion } from './notifications/complete';
import { enqueueAchievementToasts } from './notifications/overlay';
import { notifyAchievementsActivity } from './notify';
import { storeUnlocks } from './syncAchievements';

// El sondeo en vivo de logros de Steam — el gemelo de ra/livePoll.ts, y por
// el mismo motivo: hasta ahora los logros de Steam LEGÍTIMO solo se recogían
// al CERRAR el juego (setSessionClosedNotifier en main/index.ts), así que
// desbloqueabas algo, Steam te avisaba al instante y Afterplay se enteraba
// media partida después. Las otras dos fuentes ya iban en vivo —RA con este
// mismo sondeo, y los cracks con fs.watch sub-segundo (steam/emu/watcher)—
// o sea que la fuente principal era justo la única que llegaba tarde.
//
// Por qué sondeo y no push: el aviso instantáneo de Steam lo da SU cliente,
// que es quien concede el logro. Nosotros leemos GetPlayerAchievements de la
// Web API, que es de tipo pull — no hay webhook ni evento al que
// suscribirse. Preguntar cada medio minuto es lo más cerca que se puede
// estar sin inyectarse en el cliente de Steam (que es exactamente la clase
// de cosa que esta app no hace, ver OVERLAY.md §2).
//
// Latencia honesta: no vas a batir al popup de Steam. La Web API además
// puede ir unos segundos por detrás del cliente. Se pasa de "al cerrar el
// juego" a "medio minuto", que es toda la diferencia que hace falta para
// que el logro caiga DENTRO de la sesión que lo ganó.

const INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

const tick = async (getActiveGameIds: () => number[]): Promise<void> => {
  // Sin clave no hay API, y sin SteamID64 no se sabe DE QUIÉN leer los
  // desbloqueos — getPlayerUnlocks devolvería null en cada tick. Se
  // comprueba aquí para no montar ni la consulta a la DB.
  if (polling || !hasSteamKey() || !getSteamUserId()) return;

  // La guarda que hace que esto no sea ruido de red perpetuo: sin ningún
  // juego corriendo no puede estar cayendo ningún logro.
  const activeIds = getActiveGameIds();
  if (activeIds.length === 0) return;

  polling = true;
  try {
    // Solo los que están corriendo Y tienen appid — un juego de consola
    // emulado no tiene nada que preguntarle a Steam (sus logros son de RA, y
    // los cubre el otro sondeo).
    const games = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          steamAppId: gamesTable.steamAppId,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(inArray(gamesTable.id, activeIds)),
    );

    for (const game of games) {
      if (game.steamAppId === null) continue;

      // null = Steam se niega a contestar (perfil privado, juego que no
      // tienes, sin stats). NO es "cero desbloqueos": no se sabe nada, y
      // tratarlo como una lista vacía sería inventarse una respuesta.
      const unlocks = await getPlayerUnlocks(game.steamAppId);
      if (!unlocks || unlocks.length === 0) continue;

      // Se manda la lista ENTERA, no solo lo reciente: la API no tiene
      // ventana temporal y storeUnlocks ya deduplica contra lo guardado, así
      // que devuelve únicamente lo genuinamente nuevo. De paso, esto hace el
      // sondeo idempotente — un tick repetido no produce avisos repetidos.
      //
      // Si el juego todavía no tiene su CATÁLOGO sincronizado, aquí no sale
      // nada (storeUnlocks casa por apiName contra la tabla de logros): ese
      // caso lo cubre la sync completa del cierre de sesión, que es la que
      // trae el catálogo. El sondeo en vivo es solo para desbloqueos.
      const fresh = await storeUnlocks(game.id, 'steam', unlocks, new Date());
      if (fresh.length === 0) continue;

      // Solo ASCII en los console.log, convencion de la casa.
      console.log(`[steam] ${fresh.length} logro(s) nuevo(s) en vivo: ${game.title}`);
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
    // Un tick fallido no tumba el sondeo: el siguiente reintenta, y como se
    // pide la lista completa de desbloqueos no hay ventana que se pierda.
    console.warn('[steam] fallo en el sondeo en vivo:', error);
  } finally {
    polling = false;
  }
};

export const startSteamLivePoll = (getActiveGameIds: () => number[]): void => {
  stopSteamLivePoll();
  timer = setInterval(() => void tick(getActiveGameIds), INTERVAL_MS);
};

export const stopSteamLivePoll = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
