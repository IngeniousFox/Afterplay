// La cola serial con reserva que estaba escrita tres veces casi idénticas
// (curiosities/queue.ts, memories/queue.ts, steam/queue.ts) — y que ya había
// empezado a divergir en detalles (dónde se reseteaba el stop, quién tenía
// stop y quién no). Un arreglo del ciclo de vida eran tres ediciones a mano,
// re-verificadas tres veces; ahora es una.
//
// La semántica NO es negociable a la ligera: está clavada por el test de
// caracterización src/main/__tests__/queues.test.ts, que se escribió contra
// las tres colas originales ANTES de esta unificación y pasa idéntico contra
// ella. Si tocas algo aquí y ese test se queja, el test tiene razón.
//
// Qué garantiza, en corto:
//   · SERIE: un elemento en vuelo como mucho, orden FIFO.
//   · RESERVA (claimed): encolar dos veces lo mismo es inofensivo mientras
//     esté encolado o en vuelo; al terminar (bien o mal) se libera.
//   · RACHAS: si el worker está parado, encolar arranca racha nueva con los
//     contadores a cero; si está en marcha, lo nuevo se suma a la racha y el
//     total del progreso crece.
//   · PUERTA (canRun): se comprueba al encolar y antes de CADA elemento; si
//     se pierde a mitad (clave borrada en Ajustes), lo pendiente se suelta
//     con sus reservas liberadas — otra pasada lo recogerá limpio.
//   · STOP: "para después de este" — no corta el elemento en vuelo, suelta
//     el resto. Sin worker es un no-op, y nunca contamina la racha siguiente.
//   · FALLOS: un elemento que falla cuenta en `failed`, avisa por
//     onItemError y NO tumba a los demás.
//   · PROGRESO: onProgress(running=true) al empezar cada elemento y
//     onProgress(running=false) al acabar la racha, con done/total/failed
//     calculados igual que siempre (total = hechos + en cola + en vuelo).

export type ClaimQueueProgress<T> = {
  running: boolean;
  done: number;
  total: number;
  failed: number;
  // El elemento en vuelo, para que cada dominio derive su currentTitle /
  // currentLabel sin que esta cola sepa de títulos.
  current: T | null;
};

type ClaimQueueOptions<T> = {
  // La identidad del elemento para la reserva (id numérico, clave de scope…).
  keyOf: (item: T) => number | string;
  // La puerta: credenciales presentes. Se relee en vivo — puede cambiar a
  // mitad de racha desde Ajustes.
  canRun: () => boolean;
  // El trabajo de UN elemento. Los avisos de éxito de dominio ('generated',
  // 'synced'…) van dentro, donde se sabe qué se hizo.
  process: (item: T) => Promise<void>;
  onProgress: (progress: ClaimQueueProgress<T>) => void;
  // El fallo de UN elemento: log con el texto del dominio y contabilidad
  // propia (p. ej. el registro de fallidos de steam).
  onItemError: (item: T, error: unknown) => void;
  // Un fallo del worker fuera del try por elemento — no debería pasar, pero
  // si pasa la cola no puede morir en silencio.
  onWorkerError: (error: unknown) => void;
  // Comienzo de racha nueva (contadores ya a cero): para estado por-racha del
  // dominio, como la foto de hechos de memories que se carga una vez por racha.
  onRunStart?: () => void;
  // Respiro entre elementos (steam: soltar la DB para que el sync de Turso
  // tenga turno). Solo si queda cola por delante.
  breatheMs?: number;
};

export type ClaimQueue<T> = {
  enqueue: (items: T[]) => void;
  isRunning: () => boolean;
  requestStop: () => void;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createClaimQueue = <T>(options: ClaimQueueOptions<T>): ClaimQueue<T> => {
  const queue: T[] = [];
  const claimed = new Set<number | string>();

  let worker: Promise<void> | null = null;
  let current: T | null = null;
  let stopRequested = false;
  let processed = 0;
  let failed = 0;

  const emitProgress = (running: boolean): void => {
    options.onProgress({
      running,
      done: processed,
      total: processed + queue.length + (current ? 1 : 0),
      failed,
      current,
    });
  };

  const releasePending = (): void => {
    for (const item of queue) claimed.delete(options.keyOf(item));
    queue.length = 0;
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      // La puerta puede cerrarse a mitad de racha (clave borrada en Ajustes)
      // y el stop suelta lo pendiente: en ambos casos, otra pasada lo
      // recogerá limpio.
      if (!options.canRun() || stopRequested) {
        releasePending();
        break;
      }

      const next = queue.shift();
      if (!next) break;
      current = next;
      emitProgress(true);

      try {
        await options.process(next);
      } catch (error) {
        // Un elemento que falla no tumba al resto.
        failed++;
        options.onItemError(next, error);
      }

      claimed.delete(options.keyOf(next));
      current = null;
      processed++;

      if (options.breatheMs && queue.length > 0) await sleep(options.breatheMs);
    }
  };

  return {
    isRunning: () => worker !== null,

    // "Para después de este": no corta el elemento en vuelo. Solo con worker
    // vivo — pedir parar una cola parada no deja el flag armado para la
    // racha siguiente.
    requestStop: () => {
      if (worker) stopRequested = true;
    },

    // Encola los que no estén ya reservados y arranca el worker si estaba
    // parado. Devuelve enseguida: el trabajo va por su cuenta.
    enqueue: (items) => {
      if (!options.canRun()) return;

      let added = false;
      for (const item of items) {
        const key = options.keyOf(item);
        if (claimed.has(key)) continue;
        claimed.add(key);
        queue.push(item);
        added = true;
      }

      if (!added || worker) return;

      // Racha nueva: contadores desde cero. Si el worker ya estaba en marcha
      // no se toca nada — lo encolado se suma a la racha y el total crece solo.
      processed = 0;
      failed = 0;
      stopRequested = false;
      options.onRunStart?.();
      worker = drain()
        .catch((error) => {
          options.onWorkerError(error);
        })
        .finally(() => {
          worker = null;
          stopRequested = false;
          emitProgress(false);
        });
    },
  };
};
