import { createClaimQueue } from '../lib/claimQueue';
import { syncGameAchievements } from './syncAchievements';
import { hasSteamKey } from './api';
import { notifyAchievementsActivity } from './notify';

// La ÚNICA puerta por la que se sincronizan logros — la misma cola serial con
// reserva que curiosidades y recaps (lib/claimQueue, clavada por el test de
// src/main/__tests__/queues.test.ts) y por los mismos motivos:
//
//   · Evita pagar dos veces el mismo juego. Una sync tarda un par de
//     segundos, y en ese rato el juego sigue apareciendo como "pendiente"
//     para cualquier otra pasada que arranque a la vez.
//   · Evita las ráfagas. La Steam Web API tiene su propio límite (100k
//     peticiones al día, pero con techo por minuto), y sincronizar 300 juegos
//     de golpe es justo cómo se cobra un 429. En serie no hace falta limitar
//     nada.
//
// A diferencia de las curiosidades, esto NO es "una vez en la vida": tus
// desbloqueos cambian cada vez que juegas, así que un juego puede volver a
// pasar por aquí muchas veces. Por eso la cola guarda solo ids y títulos, y
// quien encola decide a quién le toca.

export type PendingAchievementsGame = {
  id: number;
  title: string;
  steamAppId: number;
  // true solo en los refrescos EN VIVO (cerraste el juego, cambiaste su
  // ruta): son los únicos que avisan en pantalla. La pasada masiva no.
  notify?: boolean;
  // Para la fuente de emuladores (LOGROS.md §7): dos de sus formatos viven
  // JUNTO AL EXE, y el catálogo de Goldberg se escribe en la carpeta de
  // instalación. Nullables: sin ellos esa fuente simplemente mira menos sitios.
  executablePath: string | null;
  installDirectory: string | null;
  // Para el fondo del aviso flotante — el mismo hero que usa el aviso de
  // sesión cerrada.
  heroUrl: string | null;
};

// Los que fallaron en la última pasada, con todo lo que hace falta para
// reintentarlos sin volver a consultar la lista. Sobrevive a que la cola se
// vacíe: es justo entonces cuando el botón de "reintentar" tiene sentido.
const failedGames = new Map<number, PendingAchievementsGame>();

// La intención VIVA de cada juego: con qué elemento hay que sincronizarlo
// cuando le llegue el turno. Hace falta porque la reserva de createClaimQueue
// es por clave y tira el elemento ENTERO cuando el juego ya estaba encolado.
// Su "encolar dos veces lo mismo es inofensivo" vale para curiosidades y
// recaps, donde el elemento es solo un id; aquí no: el segundo encolado puede
// traer notify=true (acabas de cerrar el juego) y el primero venir de la
// pasada masiva de "Sync now", que no avisa. Ganaba siempre el primero, así
// que los logros que acababas de sacar se guardaban BIEN pero sin tarjeta
// flotante y sin el broche dorado del 100%. Fusionando, el aviso no se pierde.
const intents = new Map<number, PendingAchievementsGame>();

// El juego que se está sincronizando AHORA MISMO. Su intención ya se leyó, así
// que fusionar sobre él ya no llega a tiempo: se guarda para no mentir en el
// valor de retorno de enqueueAchievements.
let inFlightId: number | null = null;

const queue = createClaimQueue<PendingAchievementsGame>({
  keyOf: (game) => game.id,
  canRun: () => hasSteamKey(),
  process: async (game) => {
    // La intención fusionada manda sobre el elemento con el que se encoló:
    // trae el notify de todos los que pidieron este juego y los datos de la
    // lectura más reciente.
    const intent = intents.get(game.id) ?? game;
    inFlightId = game.id;
    let completed = false;
    try {
      const result = await syncGameAchievements(intent, intent.notify === true);
      failedGames.delete(game.id);
      notifyAchievementsActivity({
        kind: 'synced',
        gameId: game.id,
        catalogCount: result.catalogCount,
        unlockedCount: result.unlockedCount,
      });
      completed = true;
    } finally {
      const latest = intents.get(game.id);
      if (latest && latest.steamAppId !== intent.steamAppId) {
        intents.delete(game.id);
        // La reserva del juego se libera al salir de process(). Después se
        // pide otra pasada con el ID corregido.
        setTimeout(() => enqueueAchievements([latest]), 0);
      } else if (completed) {
        intents.delete(game.id);
      }
      inFlightId = null;
    }
  },
  onProgress: (progress) => {
    notifyAchievementsActivity({
      kind: 'progress',
      running: progress.running,
      done: progress.done,
      total: progress.total,
      failed: progress.failed,
      currentTitle: progress.current?.title ?? null,
    });
  },
  // Un juego que falla se recuerda para poder reintentar SOLO los fallidos,
  // sin repetir la pasada entera. Se guarda el título además del id: cuando
  // se reintenten, la lista ya no se vuelve a consultar.
  onItemError: (game, error) => {
    // Se recuerda la intención FUSIONADA, no el elemento con el que se encoló:
    // si no, el reintento perdería el notify por segunda vez.
    failedGames.set(game.id, intents.get(game.id) ?? game);
    intents.delete(game.id);
    console.error(`[steam] fallo sincronizando logros de "${game.title}":`, error);
  },
  onWorkerError: (error) => {
    console.error('[steam] la cola de logros se detuvo por un error inesperado:', error);
  },
  // Respiro entre juegos. La pasada completa son 300 y pico juegos, cada uno
  // con varias transacciones de escritura, y el ciclo de sync con Turso corre
  // cada minuto sobre ESE MISMO fichero: sin este hueco, la cola encadena
  // escrituras durante minutos sin soltar nunca la DB y el sync se queda sin
  // turno (o peor, compite con ella dentro del motor, que está en preview).
  // 120 ms por juego son ~40 segundos de más en una pasada entera — barato a
  // cambio de que la app siga respondiendo y el sync pueda entrar.
  breatheMs: 120,
});

export const isAchievementsQueueRunning = (): boolean => queue.isRunning();

export const getFailedAchievementsCount = (): number => failedGames.size;

// "Para después de este" — no corta a medias el juego en curso, pero suelta
// todo lo que quede detrás.
export const requestAchievementsStop = (): void => {
  queue.requestStop();
};

// Reintentar SOLO los que fallaron. Devuelve cuántos se encolaron de verdad —
// 0 si no hay ninguno pendiente de reintento. Es el número del encolado y no
// el tamaño del registro porque un fallido puede haber vuelto a la cola por su
// cuenta (cerraste ese juego) y estar EN VUELO ahora mismo: ese no se reintenta
// con este clic, y decir que sí sería mentir en el botón. Ese sí sale del
// registro con los demás — está ejecutándose, así que si vuelve a fallar
// onItemError lo devuelve.
//
// Se encola PRIMERO y se vacía el registro DESPUÉS, y solo si la cola se quedó
// con algo. Al revés se perdían en silencio: enqueueAchievements sale con 0 sin
// tocar la cola cuando no hay clave de Steam, borrar la clave en Ajustes hace
// efecto en caliente (sin reiniciar) y el botón de reintento del renderer sigue
// pintado mientras haya fallidos y credenciales de RA. Un clic ahí con la clave
// ya quitada borraba los doce del registro, el badge se ponía a 0 y esos juegos
// no volvían a asomar por ningún camino automático — el del arranque solo mira
// los que nunca trajeron catálogo.
export const retryFailedAchievements = (): number => {
  const games = [...failedGames.values()];
  if (games.length === 0) return 0;
  const enqueued = enqueueAchievements(games);
  if (enqueued === 0) return 0;
  failedGames.clear();
  return enqueued;
};

// Encola los que aún no estén reservados y arranca el worker si estaba
// parado. Devuelve enseguida: la sincronización va por su cuenta.
//
// Lo que devuelve es cuántos juegos DISTINTOS de los que acabas de pedir van a
// sincronizarse con lo que traes — los ya reservados cuentan igual, porque su
// intención se fusiona (ver `intents`) y el notify llega a tiempo. Quedan
// fuera el juego que ya está en vuelo (su intención se leyó antes de que
// llegaras) y todos si no hay clave de Steam. Quien encola necesita eso para
// no prometer un refresco que se tiró: hoy lo usa
// queueAchievementsRefreshForGame (backfill.ts), que es quien contesta al
// botón de la ficha.
//
// Es una promesa sobre la intención de AHORA, no una garantía. Si a mitad de
// racha se pide parar o desaparece la clave en Ajustes, la cola suelta TODO lo
// pendiente de golpe (releasePending en lib/claimQueue.ts), incluido lo que
// este número acaba de dar por aceptado. Desde aquí no hay forma de verlo
// —claimQueue no expone su stop—, y para lo que se usa el error cae del lado
// bueno: se promete de más solo cuando el usuario ya ha pedido parar.
export const enqueueAchievements = (games: PendingAchievementsGame[]): number => {
  // Misma puerta que la cola, comprobada aquí antes de anotar nada: si no hay
  // clave, queue.enqueue es un no-op y las intenciones se quedarían colgadas.
  if (!hasSteamKey()) return 0;

  // Con la cola parada no queda nada encolado ni en vuelo, así que cualquier
  // intención que sobreviva es de una racha que se soltó a medias (la clave
  // desapareció en Ajustes a mitad) y no debe contaminar a la siguiente.
  if (!queue.isRunning()) intents.clear();

  // Por CLAVE y no por elemento: la cola reserva por id, así que el mismo
  // juego repetido dentro de la misma llamada es UNA sincronización. Contando
  // por elemento, un array con duplicados devolvía más juegos de los que iban
  // a pasar.
  const accepted = new Set<number>();
  for (const game of games) {
    const previous = intents.get(game.id);
    // Gana el dato más reciente (rutas, hero, título: quien encola acaba de
    // leer la fila), pero el aviso NUNCA se pierde — si alguien pidió notify,
    // se avisa.
    intents.set(game.id, { ...game, notify: previous?.notify === true || game.notify === true });
    if (game.id !== inFlightId) accepted.add(game.id);
  }

  queue.enqueue(games);
  return accepted.size;
};
