import { test, mock, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChapterScope } from '../../shared/memory/chapters';
import { scopeKeyOf } from '../../shared/memory/chapters';

// Test de CARACTERIZACIÓN de las tres colas seriales (curiosities, memories,
// steam). Existe para blindar la unificación en lib/claimQueue: primero se
// escribió contra el código original de las tres colas y se puso en verde;
// después se hizo la deduplicación y el MISMO test, sin tocar una línea,
// tiene que seguir en verde. Si algún matiz de comportamiento cambia con el
// refactor (orden de eventos, contadores, reservas, stop, reintentos), esto
// lo canta.
//
// Ataca los módulos REALES de las colas. Lo único mockeado son los cuatro
// módulos de dominio que arrastran Electron/DB (los generate/status/sync) —
// las funciones que la cola llama por cada elemento. Los notify NO se mockean:
// son puros (lib/makeNotifier) y el test captura los eventos de progreso por
// la misma puerta que usa main/index.ts (setXNotifier).
//
// Necesita --experimental-test-module-mocks (ya en el script `test`).

// ── Mocks de dominio (registrados ANTES de importar las colas) ────────────
// Estado mutable por test: cada test reasigna la implementación que necesita.

type AnyGame = { id: number; title: string };

let generateCuriositiesImpl: (game: AnyGame) => Promise<void> = async () => {};

let generateMemoryImpl: (chapter: unknown) => Promise<void> = async () => {};
let loadFactsSnapshotImpl: () => Promise<unknown> = async () => ({ facts: true });
let chapterForImpl: (snapshot: unknown, scope: ChapterScope) => unknown = () => ({
  soFar: false,
});

let syncGameAchievementsImpl: (
  game: AnyGame,
) => Promise<{ catalogCount: number; unlockedCount: number }> = async () => ({
  catalogCount: 0,
  unlockedCount: 0,
});

mock.module('../curiosities/generate', {
  namedExports: {
    generateCuriositiesForGame: (game: AnyGame) => generateCuriositiesImpl(game),
  },
});

mock.module('../memories/generate', {
  namedExports: {
    generateMemoryForChapter: (chapter: unknown) => generateMemoryImpl(chapter),
    // La cola lo usa para currentLabel y para el mensaje de error.
    scopeLabel: (scope: ChapterScope) => `label:${scope.type}`,
  },
});

mock.module('../memories/status', {
  namedExports: {
    loadFactsSnapshot: () => loadFactsSnapshotImpl(),
    chapterFor: (snapshot: unknown, scope: ChapterScope) => chapterForImpl(snapshot, scope),
  },
});

mock.module('../steam/syncAchievements', {
  namedExports: {
    syncGameAchievements: (game: AnyGame) => syncGameAchievementsImpl(game),
  },
});

// ── Los módulos reales, importados DESPUÉS de registrar los mocks ─────────
// En un before() y no con top-level await: los tests compilan como CJS (el
// paquete no es "type": "module") y esbuild no admite await de nivel superior.

let curiositiesQueue: typeof import('../curiosities/queue');
let memoriesQueue: typeof import('../memories/queue');
let steamQueue: typeof import('../steam/queue');

before(async () => {
  curiositiesQueue = await import('../curiosities/queue');
  memoriesQueue = await import('../memories/queue');
  steamQueue = await import('../steam/queue');
  const curiositiesNotify = await import('../curiosities/notify');
  const memoriesNotify = await import('../memories/notify');
  const steamNotify = await import('../steam/notify');
  curiositiesNotify.setCuriositiesNotifier((event) => curiosityEvents.push(event as AnyEvent));
  memoriesNotify.setMemoriesNotifier((event) => memoryEvents.push(event as AnyEvent));
  steamNotify.setAchievementsNotifier((event) => achievementEvents.push(event as AnyEvent));
});

// ── Utilidades ────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Espera activa hasta que se cumpla la condición — las colas no exponen su
// promesa de worker (a propósito, igual que en la app), así que se observa
// desde fuera, como haría el renderer.
const waitUntil = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await sleep(5);
  }
};

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Captura de eventos por la puerta real de cada notify.
type ProgressEvent = {
  kind: 'progress';
  running: boolean;
  done: number;
  total: number;
  failed: number;
  currentTitle?: string | null;
  currentLabel?: string | null;
};
type AnyEvent = { kind: string } & Record<string, unknown>;

const curiosityEvents: AnyEvent[] = [];
const memoryEvents: AnyEvent[] = [];
const achievementEvents: AnyEvent[] = [];

const progressOf = (events: AnyEvent[]): ProgressEvent[] =>
  events.filter((event) => event.kind === 'progress') as unknown as ProgressEvent[];

// Silencia los console.error esperados de los tests de fallo (las colas
// logan cada elemento fallido — correcto en la app, ruido aquí).
const realConsoleError = console.error;
console.error = () => {};
after(() => {
  console.error = realConsoleError;
});

const game = (id: number, title = `Juego ${id}`): AnyGame => ({ id, title });
const steamGame = (
  id: number,
  title = `Juego ${id}`,
): import('../steam/queue').PendingAchievementsGame => ({
  id,
  title,
  steamAppId: 100000 + id,
  executablePath: null,
  installDirectory: null,
  heroUrl: null,
});
// La forma REAL de un scope de mes (month 0-11, como Date): scopeKeyOf — que
// la cola usa sin mock para las claves de reserva — deriva '2026-04' de aquí.
const monthScope = (year: number, month0: number): ChapterScope => ({
  type: 'month',
  year,
  month: month0,
});

beforeEach(() => {
  // Claves puestas por defecto; cada test las quita si su escenario lo pide.
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.STEAM_API_KEY = 'test-steam-key';
  curiosityEvents.length = 0;
  memoryEvents.length = 0;
  achievementEvents.length = 0;
  // Implementaciones por defecto, inofensivas.
  generateCuriositiesImpl = async () => {};
  generateMemoryImpl = async () => {};
  loadFactsSnapshotImpl = async () => ({ facts: true });
  chapterForImpl = () => ({ soFar: false });
  syncGameAchievementsImpl = async () => ({ catalogCount: 0, unlockedCount: 0 });
});

// ══ CURIOSITIES ═══════════════════════════════════════════════════════════

test('curiosities: sin ANTHROPIC_API_KEY encolar es un no-op (y no reserva nada)', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const calls: number[] = [];
  generateCuriositiesImpl = async (g) => {
    calls.push(g.id);
  };

  curiositiesQueue.enqueueCuriosities([game(101)] as never[]);
  assert.equal(curiositiesQueue.isCuriositiesQueueRunning(), false);
  await sleep(30);
  assert.deepEqual(calls, []);
  assert.equal(curiosityEvents.length, 0);

  // Y no dejó el id reservado: con clave, el mismo juego sí se procesa.
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  curiositiesQueue.enqueueCuriosities([game(101)] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');
  assert.deepEqual(calls, [101]);
});

test('curiosities: procesa en serie, en orden FIFO, uno en vuelo como mucho', async () => {
  const calls: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  generateCuriositiesImpl = async (g) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push(g.id);
    await sleep(15);
    inFlight--;
  };

  curiositiesQueue.enqueueCuriosities([game(111), game(112), game(113)] as never[]);
  assert.equal(curiositiesQueue.isCuriositiesQueueRunning(), true);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');

  assert.deepEqual(calls, [111, 112, 113]);
  assert.equal(maxInFlight, 1);
});

test('curiosities: secuencia exacta de eventos de progreso y "generated" por juego', async () => {
  curiositiesQueue.enqueueCuriosities([game(121, 'Alpha'), game(122, 'Beta')] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');

  const progress = progressOf(curiosityEvents);
  assert.deepEqual(
    progress.map((p) => [p.running, p.done, p.total, p.failed, p.currentTitle]),
    [
      [true, 0, 2, 0, 'Alpha'],
      [true, 1, 2, 0, 'Beta'],
      [false, 2, 2, 0, null],
    ],
  );
  const generated = curiosityEvents.filter((e) => e.kind === 'generated');
  assert.deepEqual(
    generated.map((e) => e.gameId),
    [121, 122],
  );
});

test('curiosities: la reserva impide encolar dos veces; al terminar se libera', async () => {
  const gate = deferred();
  const calls: number[] = [];
  generateCuriositiesImpl = async (g) => {
    calls.push(g.id);
    await gate.promise;
  };

  curiositiesQueue.enqueueCuriosities([game(131)] as never[]);
  await waitUntil(() => calls.length === 1, 'primer generate en vuelo');
  // Mismo juego mientras se genera: reservado -> ignorado.
  curiositiesQueue.enqueueCuriosities([game(131)] as never[]);
  gate.resolve();
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');
  assert.deepEqual(calls, [131]);

  // Terminado, la reserva se soltó: volver a encolarlo procesa de nuevo.
  generateCuriositiesImpl = async (g) => {
    calls.push(g.id);
  };
  curiositiesQueue.enqueueCuriosities([game(131)] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');
  assert.deepEqual(calls, [131, 131]);
});

test('curiosities: encolar a mitad de racha se suma a la racha (sin resetear contadores ni segundo worker)', async () => {
  const gate = deferred();
  generateCuriositiesImpl = async (g) => {
    if (g.id === 141) await gate.promise;
  };

  curiositiesQueue.enqueueCuriosities([game(141, 'Uno')] as never[]);
  await waitUntil(() => progressOf(curiosityEvents).length === 1, 'primer progreso');
  // Con el 141 en vuelo entra el 142: mismo worker, el total crece.
  curiositiesQueue.enqueueCuriosities([game(142, 'Dos')] as never[]);
  gate.resolve();
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');

  const progress = progressOf(curiosityEvents);
  assert.deepEqual(
    progress.map((p) => [p.running, p.done, p.total, p.currentTitle]),
    [
      [true, 0, 1, 'Uno'],
      [true, 1, 2, 'Dos'],
      [false, 2, 2, null],
    ],
  );
});

test('curiosities: un fallo no tumba la racha, cuenta en failed y libera la reserva', async () => {
  const calls: number[] = [];
  generateCuriositiesImpl = async (g) => {
    calls.push(g.id);
    if (g.id === 151) throw new Error('boom');
  };

  curiositiesQueue.enqueueCuriosities([game(151), game(152)] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');

  assert.deepEqual(calls, [151, 152]);
  const final = progressOf(curiosityEvents).at(-1);
  assert.deepEqual([final?.running, final?.done, final?.total, final?.failed], [false, 2, 2, 1]);
  // Solo el que salió bien emite 'generated'.
  assert.deepEqual(
    curiosityEvents.filter((e) => e.kind === 'generated').map((e) => e.gameId),
    [152],
  );

  // El fallido quedó libre para reintentarse.
  generateCuriositiesImpl = async (g) => {
    calls.push(g.id);
  };
  curiositiesQueue.enqueueCuriosities([game(151)] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');
  assert.deepEqual(calls, [151, 152, 151]);
});

test('curiosities: una racha nueva arranca con los contadores a cero', async () => {
  generateCuriositiesImpl = async (g) => {
    if (g.id === 161) throw new Error('boom');
  };
  curiositiesQueue.enqueueCuriosities([game(161)] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'primera racha');

  curiosityEvents.length = 0;
  generateCuriositiesImpl = async () => {};
  curiositiesQueue.enqueueCuriosities([game(162, 'Limpio')] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'segunda racha');

  const progress = progressOf(curiosityEvents);
  assert.deepEqual(
    progress.map((p) => [p.running, p.done, p.total, p.failed]),
    [
      [true, 0, 1, 0],
      [false, 1, 1, 0],
    ],
  );
});

test('curiosities: si la clave desaparece a mitad, lo pendiente se suelta (y queda reencolable)', async () => {
  const gate = deferred();
  const calls: number[] = [];
  generateCuriositiesImpl = async (g) => {
    calls.push(g.id);
    if (g.id === 171) await gate.promise;
  };

  curiositiesQueue.enqueueCuriosities([game(171), game(172), game(173)] as never[]);
  await waitUntil(() => calls.length === 1, 'primero en vuelo');
  delete process.env.ANTHROPIC_API_KEY;
  gate.resolve();
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'cola curiosities vacía');

  // Solo el primero llegó a generarse; el resto se soltó.
  assert.deepEqual(calls, [171]);
  const final = progressOf(curiosityEvents).at(-1);
  assert.deepEqual([final?.running, final?.done, final?.total], [false, 1, 1]);

  // Y sus reservas quedaron libres: con clave otra vez, se procesan.
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  curiositiesQueue.enqueueCuriosities([game(172), game(173)] as never[]);
  await waitUntil(() => !curiositiesQueue.isCuriositiesQueueRunning(), 'reencolados');
  assert.deepEqual(calls, [171, 172, 173]);
});

// ══ MEMORIES ══════════════════════════════════════════════════════════════

test('memories: la foto de hechos se carga UNA vez por racha, y se recarga en la siguiente', async () => {
  let snapshotLoads = 0;
  loadFactsSnapshotImpl = async () => {
    snapshotLoads++;
    return { facts: true };
  };

  memoriesQueue.enqueueMemories([monthScope(2026, 0), monthScope(2026, 1)], 'manual');
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'primera racha memories');
  assert.equal(snapshotLoads, 1);

  memoriesQueue.enqueueMemories([monthScope(2026, 2)], 'manual');
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'segunda racha memories');
  assert.equal(snapshotLoads, 2);
});

test('memories: stop a mitad — termina el periodo en vuelo, suelta el resto y no contamina la racha siguiente', async () => {
  const gate = deferred();
  generateMemoryImpl = async () => {
    await gate.promise;
  };
  chapterForImpl = () => ({ soFar: false });

  memoriesQueue.enqueueMemories(
    [monthScope(2026, 3), monthScope(2026, 4), monthScope(2026, 5)],
    'manual',
  );
  await waitUntil(() => progressOf(memoryEvents).length === 1, 'primer periodo en vuelo');
  memoriesQueue.requestMemoriesStop();
  gate.resolve();
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'cola memories parada');

  // Solo el primero se generó; el resto NI se intentó.
  const events = memoryEvents.filter((e) => e.kind === 'generated');
  assert.equal(events.length, 1);
  assert.equal(events[0].scopeKey, '2026-04');
  const final = progressOf(memoryEvents).at(-1);
  assert.deepEqual([final?.running, final?.done, final?.total], [false, 1, 1]);

  // Los soltados quedaron libres y el stop no arrastra: se reencolan y corren.
  generateMemoryImpl = async () => {};
  memoryEvents.length = 0;
  memoriesQueue.enqueueMemories([monthScope(2026, 4)], 'manual');
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'racha post-stop');
  assert.equal(memoryEvents.filter((e) => e.kind === 'generated').length, 1);
});

test('memories: stop sin worker es un no-op (no deja el flag armado)', async () => {
  memoriesQueue.requestMemoriesStop();
  memoriesQueue.enqueueMemories([monthScope(2026, 6)], 'auto');
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'racha tras stop en vacío');
  assert.equal(memoryEvents.filter((e) => e.kind === 'generated').length, 1);
});

test('memories: sin capítulo no se genera (pero el periodo cuenta como procesado)', async () => {
  const generatedChapters: unknown[] = [];
  generateMemoryImpl = async (chapter) => {
    generatedChapters.push(chapter);
  };
  chapterForImpl = (_snapshot, scope) =>
    scopeKeyOf(scope) === '2026-08' ? null : { soFar: false };

  memoriesQueue.enqueueMemories([monthScope(2026, 7), monthScope(2026, 8)], 'auto');
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'racha con capítulo nulo');

  assert.equal(generatedChapters.length, 1);
  const generated = memoryEvents.filter((e) => e.kind === 'generated');
  assert.deepEqual(
    generated.map((e) => [e.scopeKey, e.origin]),
    [['2026-09', 'auto']],
  );
  // El nulo también avanza el contador: done final = 2.
  const final = progressOf(memoryEvents).at(-1);
  assert.deepEqual([final?.done, final?.total], [2, 2]);
});

test('memories: reserva por scope, currentLabel en el progreso, y fallo que no tumba', async () => {
  const gate = deferred();
  let calls = 0;
  generateMemoryImpl = async () => {
    calls++;
    if (calls === 1) {
      await gate.promise;
      throw new Error('boom recap');
    }
  };

  memoriesQueue.enqueueMemories([monthScope(2026, 9)], 'manual');
  await waitUntil(() => progressOf(memoryEvents).length === 1, 'primer periodo en vuelo');
  // Mismo scope mientras corre: reservado -> ignorado.
  memoriesQueue.enqueueMemories([monthScope(2026, 9), monthScope(2026, 10)], 'manual');
  gate.resolve();
  await waitUntil(() => !memoriesQueue.isMemoriesQueueRunning(), 'racha memories con fallo');

  // El 2026-10 falló (1 llamada), el 2026-11 entró por la segunda enqueue y salió bien.
  assert.equal(calls, 2);
  const progress = progressOf(memoryEvents);
  assert.equal(progress[0].currentLabel, 'label:month');
  const final = progress.at(-1);
  assert.deepEqual([final?.running, final?.done, final?.total, final?.failed], [false, 2, 2, 1]);
});

// ══ STEAM ═════════════════════════════════════════════════════════════════

test('steam: sin STEAM_API_KEY encolar es un no-op', async () => {
  delete process.env.STEAM_API_KEY;
  const calls: number[] = [];
  syncGameAchievementsImpl = async (g) => {
    calls.push(g.id);
    return { catalogCount: 0, unlockedCount: 0 };
  };

  steamQueue.enqueueAchievements([steamGame(201)]);
  assert.equal(steamQueue.isAchievementsQueueRunning(), false);
  await sleep(30);
  assert.deepEqual(calls, []);
});

test('steam: serie FIFO y evento synced con los conteos del resultado', async () => {
  const calls: number[] = [];
  syncGameAchievementsImpl = async (g) => {
    calls.push(g.id);
    return { catalogCount: g.id === 211 ? 7 : 12, unlockedCount: g.id === 211 ? 3 : 5 };
  };

  steamQueue.enqueueAchievements([steamGame(211, 'Alpha'), steamGame(212, 'Beta')]);
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'cola steam vacía');

  assert.deepEqual(calls, [211, 212]);
  const synced = achievementEvents.filter((e) => e.kind === 'synced');
  assert.deepEqual(
    synced.map((e) => [e.gameId, e.catalogCount, e.unlockedCount]),
    [
      [211, 7, 3],
      [212, 12, 5],
    ],
  );
  const progress = progressOf(achievementEvents);
  assert.deepEqual(
    progress.map((p) => [p.running, p.done, p.total, p.currentTitle]),
    [
      [true, 0, 2, 'Alpha'],
      [true, 1, 2, 'Beta'],
      [false, 2, 2, null],
    ],
  );
});

test('steam: los fallidos se recuerdan, retryFailed los reencola una sola vez y el éxito los limpia', async () => {
  syncGameAchievementsImpl = async (g) => {
    if (g.id === 221) throw new Error('boom sync');
    return { catalogCount: 1, unlockedCount: 0 };
  };

  steamQueue.enqueueAchievements([steamGame(221), steamGame(222)]);
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'racha con fallo');
  assert.equal(steamQueue.getFailedAchievementsCount(), 1);

  // Reintento: solo el fallido, y esta vez sale bien -> registro limpio.
  syncGameAchievementsImpl = async () => ({ catalogCount: 1, unlockedCount: 1 });
  assert.equal(steamQueue.retryFailedAchievements(), 1);
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'racha de reintento');
  assert.equal(steamQueue.getFailedAchievementsCount(), 0);

  // Sin fallidos pendientes, el reintento dice 0 y no arranca nada.
  assert.equal(steamQueue.retryFailedAchievements(), 0);
  assert.equal(steamQueue.isAchievementsQueueRunning(), false);
});

test('steam: un éxito posterior borra al juego del registro de fallidos', async () => {
  syncGameAchievementsImpl = async () => {
    throw new Error('boom');
  };
  steamQueue.enqueueAchievements([steamGame(231)]);
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'fallo inicial');
  assert.equal(steamQueue.getFailedAchievementsCount(), 1);

  // El mismo juego vuelve a pasar (p. ej. cierre de sesión) y esta vez va bien.
  syncGameAchievementsImpl = async () => ({ catalogCount: 2, unlockedCount: 2 });
  steamQueue.enqueueAchievements([steamGame(231)]);
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'éxito posterior');
  assert.equal(steamQueue.getFailedAchievementsCount(), 0);
});

test('steam: stop a mitad — termina el juego en vuelo, suelta el resto, y la racha siguiente arranca limpia', async () => {
  const gate = deferred();
  const calls: number[] = [];
  syncGameAchievementsImpl = async (g) => {
    calls.push(g.id);
    if (g.id === 241) await gate.promise;
    return { catalogCount: 0, unlockedCount: 0 };
  };

  steamQueue.enqueueAchievements([steamGame(241), steamGame(242), steamGame(243)]);
  await waitUntil(() => calls.length === 1, 'primero en vuelo');
  steamQueue.requestAchievementsStop();
  gate.resolve();
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'cola steam parada');

  assert.deepEqual(calls, [241]);
  const final = progressOf(achievementEvents).at(-1);
  assert.deepEqual([final?.running, final?.done, final?.total], [false, 1, 1]);

  // Los soltados no quedaron reservados ni el stop armado.
  steamQueue.enqueueAchievements([steamGame(242)]);
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'racha post-stop steam');
  assert.deepEqual(calls, [241, 242]);
});

test('steam: la reserva impide duplicar mientras está encolado o en vuelo', async () => {
  const gate = deferred();
  const calls: number[] = [];
  syncGameAchievementsImpl = async (g) => {
    calls.push(g.id);
    if (g.id === 251) await gate.promise;
    return { catalogCount: 0, unlockedCount: 0 };
  };

  steamQueue.enqueueAchievements([steamGame(251), steamGame(252)]);
  await waitUntil(() => calls.length === 1, 'primero en vuelo');
  // El 251 está en vuelo y el 252 encolado: ninguno se duplica.
  steamQueue.enqueueAchievements([steamGame(251), steamGame(252)]);
  gate.resolve();
  await waitUntil(() => !steamQueue.isAchievementsQueueRunning(), 'cola steam vacía');
  assert.deepEqual(calls, [251, 252]);
});
