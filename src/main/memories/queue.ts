import type { ChapterScope } from '../../shared/memory/chapters';
import { scopeKeyOf } from '../../shared/memory/chapters';
import { generateMemoryForChapter, scopeLabel } from './generate';
import { notifyMemoriesActivity } from './notify';
import type { FactsSnapshot } from './status';
import { chapterFor, loadFactsSnapshot } from './status';

// La ÚNICA puerta por la que se generan recaps — calcada de la cola de
// curiosidades y por los mismos motivos (no pagar dos veces el mismo periodo,
// no disparar ráfagas contra la API): serial, una llamada en vuelo como
// mucho, `claimed` por scope para que encolar dos veces sea inofensivo.
//
// Lo único que esta cola tiene y la de curiosidades no es la cancelación
// "stop after this one" (AFTERPLAY-LOOP.md §3.6): un backfill histórico puede
// ser largo y pararlo a mitad no debe tirar lo ya pagado — se termina el
// periodo en vuelo y se suelta el resto, que queda pendiente para otra pasada.

type QueuedScope = {
  scope: ChapterScope;
  // Solo los automáticos levantan el toast de aterrizaje (§3.3): una pasada
  // manual de 40 meses no puede disparar 40 avisos.
  origin: 'auto' | 'manual';
};

const queue: QueuedScope[] = [];
const claimed = new Set<string>();

let worker: Promise<void> | null = null;
let current: QueuedScope | null = null;
let stopRequested = false;
let processed = 0;
let failed = 0;

const claimKey = (scope: ChapterScope): string => `${scope.type}:${scopeKeyOf(scope)}`;

export const isMemoriesQueueRunning = (): boolean => worker !== null;

export const requestMemoriesStop = (): void => {
  if (worker) stopRequested = true;
};

const emitProgress = (running: boolean): void => {
  notifyMemoriesActivity({
    kind: 'progress',
    running,
    done: processed,
    total: processed + queue.length + (current ? 1 : 0),
    failed,
    currentLabel: current ? scopeLabel(current.scope) : null,
  });
};

const releasePending = (): void => {
  for (const item of queue) claimed.delete(claimKey(item.scope));
  queue.length = 0;
};

const drain = async (): Promise<void> => {
  // La foto de hechos se carga UNA vez por racha, no por periodo: derivar
  // momentos recorre la historia completa y los periodos que se narran están
  // CERRADOS — sus hechos no cambian mientras la racha corre (lo nuevo cae en
  // el mes en curso, que jamás se narra).
  let snapshot: FactsSnapshot | null = null;

  while (queue.length > 0) {
    // La clave puede borrarse desde Ajustes a mitad de racha, y el stop
    // suelta lo pendiente: en ambos casos, otra pasada lo recogerá limpio.
    if (!process.env.ANTHROPIC_API_KEY || stopRequested) {
      releasePending();
      break;
    }

    const next = queue.shift();
    if (!next) break;
    current = next;
    emitProgress(true);

    try {
      snapshot = snapshot ?? (await loadFactsSnapshot());
      const chapter = chapterFor(snapshot, next.scope, new Date());
      // Sin capítulo ya no hay nada que narrar (la actividad se borró entre
      // encolar y generar): no es un fallo, simplemente no toca.
      if (chapter && !chapter.soFar) {
        await generateMemoryForChapter(chapter);
        notifyMemoriesActivity({
          kind: 'generated',
          scopeType: next.scope.type,
          scopeKey: scopeKeyOf(next.scope),
          origin: next.origin,
        });
      }
    } catch (error) {
      // Un periodo que falla (red, 429, respuesta rota) queda sin marcar y
      // por tanto pendiente: la siguiente pasada lo recoge. No tumba al resto.
      failed++;
      console.error(`[memories] fallo generando "${scopeLabel(next.scope)}":`, error);
    }

    claimed.delete(claimKey(next.scope));
    current = null;
    processed++;
  }

  stopRequested = false;
};

// Encola los periodos que no estén ya reservados y arranca el worker si
// estaba parado. Devuelve enseguida: la generación va por su cuenta.
export const enqueueMemories = (scopes: ChapterScope[], origin: 'auto' | 'manual'): void => {
  if (!process.env.ANTHROPIC_API_KEY) return;

  let added = false;
  for (const scope of scopes) {
    const key = claimKey(scope);
    if (claimed.has(key)) continue;
    claimed.add(key);
    queue.push({ scope, origin });
    added = true;
  }

  if (!added || worker) return;

  processed = 0;
  failed = 0;
  worker = drain()
    .catch((error) => {
      console.error('[memories] la cola se detuvo por un error inesperado:', error);
    })
    .finally(() => {
      worker = null;
      emitProgress(false);
    });
};
