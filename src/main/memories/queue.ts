import type { ChapterScope } from '../../shared/memory/chapters';
import { scopeKeyOf } from '../../shared/memory/chapters';
import { createClaimQueue } from '../lib/claimQueue';
import { generateMemoryForChapter, scopeLabel } from './generate';
import { notifyMemoriesActivity } from './notify';
import type { FactsSnapshot } from './status';
import { chapterFor, loadFactsSnapshot } from './status';

// La ÚNICA puerta por la que se generan recaps — la misma cola serial con
// reserva que curiosidades y logros (lib/claimQueue, clavada por el test de
// src/main/__tests__/queues.test.ts), y por los mismos motivos: no pagar dos
// veces el mismo periodo, no disparar ráfagas contra la API.
//
// Esta cola usa el stop ("para después de este", AFTERPLAY-LOOP.md §3.6): un
// backfill histórico puede ser largo y pararlo a mitad no debe tirar lo ya
// pagado — se termina el periodo en vuelo y se suelta el resto, que queda
// pendiente para otra pasada.

type QueuedScope = {
  scope: ChapterScope;
  // Solo los automáticos levantan el toast de aterrizaje (§3.3): una pasada
  // manual de 40 meses no puede disparar 40 avisos.
  origin: 'auto' | 'manual';
};

// La foto de hechos se carga UNA vez por racha, no por periodo: derivar
// momentos recorre la historia completa y los periodos que se narran están
// CERRADOS — sus hechos no cambian mientras la racha corre (lo nuevo cae en
// el mes en curso, que jamás se narra). Se resetea al arrancar racha nueva
// (onRunStart) para que una racha de mañana vea los hechos de mañana.
let snapshot: FactsSnapshot | null = null;

const queue = createClaimQueue<QueuedScope>({
  keyOf: (item) => `${item.scope.type}:${scopeKeyOf(item.scope)}`,
  canRun: () => Boolean(process.env.ANTHROPIC_API_KEY),
  onRunStart: () => {
    snapshot = null;
  },
  process: async (item) => {
    snapshot = snapshot ?? (await loadFactsSnapshot());
    const chapter = chapterFor(snapshot, item.scope, new Date());
    // Sin capítulo ya no hay nada que narrar (la actividad se borró entre
    // encolar y generar): no es un fallo, simplemente no toca.
    if (chapter && !chapter.soFar) {
      // Solo se anuncia lo que se guardó de verdad. Un rechazo del modelo sale
      // limpio y sin fila (generate.ts devuelve false), y avisar igual
      // levantaba el toast de aterrizaje "Your June story is ready" hacia un
      // Journey donde no había ningún panel que leer.
      //
      // El aviso es un booleano y TypeScript no obliga a nadie a mirarlo:
      // volver a escribir aquí `await generateMemoryForChapter(chapter)` como
      // sentencia suelta reintroduce el toast mentiroso sin que compile en
      // rojo. Lo único que lo canta es el test "memories: un rechazo del
      // modelo no anuncia 'generated'" de src/main/__tests__/queues.test.ts.
      const written = await generateMemoryForChapter(chapter);
      if (written) {
        notifyMemoriesActivity({
          kind: 'generated',
          scopeType: item.scope.type,
          scopeKey: scopeKeyOf(item.scope),
          origin: item.origin,
        });
      }
    }
  },
  onProgress: (progress) => {
    notifyMemoriesActivity({
      kind: 'progress',
      running: progress.running,
      done: progress.done,
      total: progress.total,
      failed: progress.failed,
      currentLabel: progress.current ? scopeLabel(progress.current.scope) : null,
    });
  },
  // Un periodo que falla (red, 429, respuesta rota) queda sin marcar y por
  // tanto pendiente: la siguiente pasada lo recoge. No tumba al resto.
  onItemError: (item, error) => {
    console.error(`[memories] fallo generando "${scopeLabel(item.scope)}":`, error);
  },
  onWorkerError: (error) => {
    console.error('[memories] la cola se detuvo por un error inesperado:', error);
  },
});

export const isMemoriesQueueRunning = (): boolean => queue.isRunning();

export const requestMemoriesStop = (): void => {
  queue.requestStop();
};

// Encola los periodos que no estén ya reservados y arranca el worker si
// estaba parado. Devuelve enseguida: la generación va por su cuenta.
export const enqueueMemories = (scopes: ChapterScope[], origin: 'auto' | 'manual'): void => {
  queue.enqueue(scopes.map((scope) => ({ scope, origin })));
};
