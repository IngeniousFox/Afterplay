import { runDailyBackup } from '../db/dailyBackup';
import { runEnrichPending } from '../external/enrichPendingApp';
import { isE2E } from '../lib/e2e';
import { runMemoriesDailyTick } from '../memories/detect';
import { runRadarTick } from '../radar/pass';
import { runPendingSaveReindex } from '../saves/postImportReindex';
import { runRaStartupPass } from '../ra/backfill';
import { startRaLivePoll } from '../ra/livePoll';
import { runSteamAppIdBackfill } from '../steam/appIdBackfill';
import { runAchievementsStartupPass, runEmuUnlocksSweep } from '../steam/backfill';
import { startEmuWatcher } from '../steam/emu/watcher';
import { startSteamLivePoll } from '../steam/livePoll';
import { appState } from './appState';
import { mark } from './startupClock';

const MEMORIES_TICK_MS = 60 * 60 * 1000;

// Primer ciclo de sync (con tope), pasadas de fondo del arranque y el tic
// horario. Nada de esto bloquea el resto del arranque.
export const startBackgroundJobs = (): void => {
  // Las pasadas de fondo del arranque. El escritorio 2.0 ya no sincroniza
  // con Turso (el sync nuevo es la fase 3), así que no esperan a ningún pull:
  // arrancan ya, sin bloquear el resto del arranque.
  //
  // Detección automática de recaps pendientes (AFTERPLAY-LOOP.md §3.3): una
  // pasada al arrancar y un tic horario que solo trabaja una vez por día de
  // calendario — la app vive semanas en la bandeja sin reiniciarse y el
  // cambio de mes tiene que notarse solo.
  void (async () => {
    // EN UN TEST E2E, HASTA AQUI Y NO MAS.
    //
    // Todo lo de abajo son pasadas de fondo que SALEN A LA RED en cuanto hay
    // credenciales — y un sandbox de test las tiene de verdad (.env.test).
    // Costo medido el 29-ago-2026: el radar hacia su primera pasada de la
    // vida contra IGDB y metia sus descubrimientos en el Plan, asi que una
    // pantalla sembrada con tres juegos aparecia con un cuarto que nadie
    // habia puesto ("Ascenxion") y el test de Up next fallaba sin que nada
    // estuviera roto. Y lo peor no es el fallo: es que el resultado dependia
    // de lo que IGDB tuviera ese dia.
    //
    // Un E2E dispara el trabajo que quiere probar EXPLICITAMENTE (los tests
    // de integracion llaman a external.refreshGame, achievements.refreshGame
    // o hltb.refreshGame por su nombre), que ademas es lo que hace que el
    // rojo senale a la API que cambio. Las pasadas automaticas solo anaden
    // ruido no determinista.
    if (isE2E()) {
      mark('pasadas de arranque OMITIDAS (modo E2E)');
      return;
    }
    // El PRIMER ciclo de sync va por delante de todas las pasadas de fondo, con
    // un tope de 10 s: así lo que cambió en otros PCs ya está cuando las pasadas
    // miran la biblioteca, y una red lenta no las retrasa más que eso. Nunca
    // lanza (el motor devuelve sus fallos), pero el try blinda el arranque.
    try {
      await appState.syncRuntime?.start();
    } catch (error) {
      console.warn('[sync] el arranque del sync falló (sigo sin él):', error);
    }
    mark('sync inicial hecho o con tope');
    // Reindexado de las partidas tras importar la 1.x: solo hace algo si la
    // importación dejó el marcador y hay credenciales (si no, espera al tic
    // horario o al siguiente arranque). No se espera: va en paralelo.
    void runPendingSaveReindex();
    // De aquí para abajo el orden ya no es una fila: cada pasada corre en
    // paralelo con las que no comparten NI api NI filas, y en fila con las
    // que sí. Las promesas se recogen en const (antes eran void) solo para
    // poder estampar la marca de "terminadas" del final — la medida de cuándo
    // la app se queda quieta, que con los void no existía.
    const memoriesTick = runMemoriesDailyTick();
    // El catálogo de logros necesita el appid, así que va DESPUÉS del
    // backfill de appids y no en paralelo: un juego cuyo appid acaba de
    // llegar entra en la misma pasada en vez de esperar al próximo arranque.
    await runSteamAppIdBackfill();
    // Los juegos de otro dispositivo que quedaron sin completar de una sesión
    // anterior, o que bajaron con un hub lento (§13.3). Tras el backfill de
    // appids por la misma razón que el radar (IGDB no tiene cola propia); sin
    // hub emparejado no hace nada.
    const enrichTick = runEnrichPending();
    // El radar mira si toca (una vez por semana) y no hace nada el resto de
    // los arranques — la comprobacion es leer una fecha de config.json. TRAS
    // el backfill de appids y no antes (donde estaba): los dos preguntan a
    // IGDB, que NO tiene cola propia (igdb/client.ts es un axios.post a
    // pelo), así que la semana en que el radar sí trabaja los dos disparaban
    // a la vez contra la misma API gratuita. Esperarse cuesta lo que el
    // backfill en régimen: una consulta sin filas (~ms).
    const radarTick = runRadarTick();
    // La pasada de logros de Steam es DB + encolar y nada más (la red la pone
    // su cola, steam/queue.ts): se recoge su promesa porque la de RA se ata a
    // ella dos bloques más abajo.
    const steamPass = runAchievementsStartupPass();
    // Y el barrido de emuladores (LOGROS.md §7): disco local puro, recoge lo
    // que los cracks apuntaron con la app cerrada. Después queda la
    // vigilancia en vivo, que es la que los pilla mientras juegas — el
    // watcher arranca cuando el barrido termina, como siempre.
    //
    // En paralelo con la pasada de RA porque no comparten nada: el barrido es
    // disco y base sin una sola petición.
    const emuSweep = runEmuUnlocksSweep().then(() => startEmuWatcher());
    // RetroAchievements (RETROACHIEVEMENTS.md): emparejado + catálogos de lo
    // emulado retro.
    //
    // Detrás de la pasada de Steam: ya no hace falta para las marcas (cada
    // fuente tiene su propia comprobación en la 2.0), pero así RA y Steam no
    // compiten por la red en el mismo instante del arranque.
    const raPass = steamPass.then(() => runRaStartupPass());
    // Su sondeo en vivo — solo pregunta mientras el watcher vea un emulador
    // corriendo, así que no choca con la pasada de arriba.
    startRaLivePoll(() => appState.watcher?.hasActiveEmulator() ?? false);
    // Y el gemelo para Steam: los logros del juego que estés jugando AHORA,
    // sin esperar a cerrarlo. Solo pregunta mientras el watcher vea juegos
    // corriendo, igual que el de RA con los emuladores.
    startSteamLivePoll(() => appState.watcher?.getActiveGameIds() ?? []);
    mark('pasadas de arranque lanzadas');
    // allSettled por blindaje (ninguna pasada lanza: todas atrapan dentro), y
    // la marca es LA medida de este bloque: cuándo terminó la última pasada y
    // la app se queda de verdad quieta. Con los void de antes no había forma
    // de saberlo sin recompilar.
    await Promise.allSettled([memoriesTick, radarTick, enrichTick, emuSweep, raPass]);
    mark('pasadas de arranque terminadas');
  })();
  appState.memoriesTimer = setInterval(() => {
    void runMemoriesDailyTick();
    // Mismo tic para el radar: la app puede pasar semanas sin reiniciarse
    // (vive en la bandeja), asi que mirarlo solo al arrancar no basta.
    void runRadarTick();
    // Y el reindexado pendiente de las partidas: unas credenciales puestas con
    // la app abierta lo desbloquean sin esperar a otro arranque.
    if (!isE2E()) void runPendingSaveReindex();
    // Y la copia local, por exactamente el mismo motivo. Estaba SOLO en el
    // arranque, con lo que "una copia cada 6 horas" era en realidad "una copia
    // por cada vez que abres la app": con la app en la bandeja tres semanas,
    // te llevabas una copia en tres semanas. La función ya decide sola si toca
    // (mira la fecha de la última que existe), así que llamarla cada hora es
    // barato y hace que el ajuste signifique lo que dice.
    void runDailyBackup().catch((error: unknown) => {
      console.warn('[backup] fallo inesperado en la copia periodica (sigo igualmente):', error);
    });
  }, MEMORIES_TICK_MS);
};
