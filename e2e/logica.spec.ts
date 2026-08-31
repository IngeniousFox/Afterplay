import type { Page } from '@playwright/test';
import type { GameDetail } from '../src/shared/types';
import { expect, test } from './fixtures';

// LA LOGICA DE NEGOCIO, DE PUNTA A PUNTA, CON EL DRIVER DE PRODUCCION.
//
// Nada de esto lo puede cubrir un test de unidad: el andamio de unidad
// (src/main/db/__tests__/harness.ts) abre la base con @libsql/client, pero la
// app instalada abre la MISMA base con drizzle-orm/tursodatabase-sync (el
// paquete @tursodatabase/sync — ver src/main/db/index.ts), y los dos drivers
// no tienen por que comportarse igual en lo fino: si aplican de verdad el
// ON DELETE CASCADE del esquema, si el PRAGMA foreign_keys sobrevive a la
// transaccion, si una columna `real` redondea al volver por el IPC. Aqui se
// pregunta TODO eso por el camino real: renderer (page.evaluate) -> preload
// (globalThis.api, tipado con la firma real) -> IPC -> main -> el driver de
// produccion -> Afterplay.db en disco, y de vuelta.
//
// QUE ES REAL: la base entera (migraciones del repo, igual que el sembrado),
// el driver, la transaccion de addStateEvent.ts/resolveIterationForPlay.ts,
// las derivaciones de getGameById.ts. Ni un mock.module en todo el fichero.
//
// QUE ES DOBLE: solo la biblioteca de partida (sembrada desde fuera, ver
// e2e/sandbox.ts) y la red — IGDB/HLTB/Steam/RetroAchievements —, que ninguno
// de estos ocho tests toca. No hay UI de por medio: se llama a `api`
// directamente, igual que hace integraciones.spec.ts, para que un cambio de
// firma en el preload tumbe este fichero en vez de manifestarse como un botón
// que ya no hace nada.
//
// LOS IDS son los que deja el sembrado por defecto (e2e/seed.ts), por orden
// de insercion: Assassin's Creed II = 1, Strange Horticulture = 2,
// 007 First Light = 3, ... , The Legend of Zelda: Link's Awakening = 7,
// Alan Wake = 8. Documentado tambien en sandbox.ts/seed.ts.
const AC_II = 1;
const FIRST_LIGHT = 3;
const ZELDA_LA = 7;
const ALAN_WAKE = 8;

// Un `.find()` que no encuentra nada (o un games.getById que devuelve null
// porque el id ya no existe) es casi siempre el sembrado moviendose por
// debajo del test, no un caso legitimo que haya que seguir arrastrando — y
// un `!` a secas deja el fallo como "Cannot read properties of null/
// undefined" tres lineas mas abajo, sin decir DE QUE se esperaba y no
// estaba. Esto lo dice, y de paso estrecha el tipo para el resto del test.
const mustFind = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) throw new Error(message);
  return value;
};

// La ficha completa de un juego, por el mismo canal que usa GameDetail.tsx.
const fetchGame = (page: Page, gameId: number): Promise<GameDetail | null> =>
  page.evaluate((id) => globalThis.api.games.getById(id), gameId);

test.describe('logica de negocio (e2e, driver de produccion)', () => {
  test('el ciclo de un playthrough: dos partidas del mismo juego, cada una con su fecha y sus horas', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const game = mustFind(
      await fetchGame(page, AC_II),
      "Assassin's Creed II deberia existir (id 1)",
    );
    expect(game.iterations).toHaveLength(2);
    const [first, second] = game.iterations;

    // Playthrough 1: 2021 a secas (precision de ANO), 23h tecleadas y sin una
    // sola sesion medida — resolveIterationHours es manual + 0.
    expect(first.hours).toBe(23);
    expect(first.currentState).toBe('completed');
    const firstStart = mustFind(first.startEvent, 'el playthrough 1 deberia tener un started');
    expect(firstStart.datePrecision).toBe('year');
    expect(firstStart.occurredAt.getTime()).toBe(new Date('2021-01-01T00:00:00.000Z').getTime());
    const firstEnd = mustFind(first.endEvent, 'el playthrough 1 deberia tener un desenlace');
    expect(firstEnd.datePrecision).toBe('year');

    // Playthrough 2: dias exactos de oct-nov 2023, 23.5h — la MISMA columna
    // de precision, con un valor distinto en cada fila, es justo lo que un
    // sembrado de un solo playthrough no puede ejercitar.
    expect(second.hours).toBe(23.5);
    expect(second.currentState).toBe('completed');
    const secondStart = mustFind(second.startEvent, 'el playthrough 2 deberia tener un started');
    expect(secondStart.datePrecision).toBe('day');
    expect(secondStart.occurredAt.getTime()).toBe(new Date('2023-10-13T22:00:00.000Z').getTime());
    const secondEnd = mustFind(second.endEvent, 'el playthrough 2 deberia tener un desenlace');
    expect(secondEnd.datePrecision).toBe('day');
    expect(secondEnd.occurredAt.getTime()).toBe(new Date('2023-11-13T23:00:00.000Z').getTime());

    // El total suma las dos (46.5), y el estado del JUEGO es el del evento
    // MAS RECIENTE entre todos los playthroughs — 2023 gana a 2021, aunque el
    // playthrough 1 aparezca primero en la lista.
    expect(game.totalHours).toBe(46.5);
    expect(game.currentState).toBe('completed');
  });

  test('SPEC 4.5 — retomar Playing tras un desenlace abre un playthrough NUEVO, como mucho uno activo', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const before = mustFind(await fetchGame(page, ALAN_WAKE), 'Alan Wake deberia existir (id 8)');
    expect(before.iterations).toHaveLength(1);
    expect(before.currentState).toBe('dropped');
    const oldIterationId = before.iterations[0].id;

    // El mismo camino que StatusCard.tsx al marcar "Playing" sobre un juego
    // ya terminado: primero el contenedor nuevo (iterations.create), luego el
    // 'started' que lo activa — nunca reescribiendo el playthrough viejo.
    const newIterationId = await page.evaluate(async (gameId) => {
      const iteration = await globalThis.api.iterations.create({
        gameId,
        playedPlatform: 'PC',
        origin: 'Purchased',
        format: 'digital',
      });
      await globalThis.api.stateEvents.add({
        iterationId: iteration.id,
        type: 'started',
        occurredAt: new Date(),
        datePrecision: 'datetime',
      });
      return iteration.id;
    }, ALAN_WAKE);

    const after = mustFind(await fetchGame(page, ALAN_WAKE), 'Alan Wake deberia seguir existiendo');
    expect(after.iterations).toHaveLength(2);

    const oldIteration = mustFind(
      after.iterations.find((iteration) => iteration.id === oldIterationId),
      'el playthrough viejo deberia seguir en la lista',
    );
    const newIteration = mustFind(
      after.iterations.find((iteration) => iteration.id === newIterationId),
      'el playthrough nuevo deberia estar en la lista',
    );

    // El viejo sigue cerrado — nadie lo reabrio — y el juego entero tiene
    // COMO MUCHO un playthrough activo: el nuevo.
    expect(oldIteration.currentState).toBe('dropped');
    expect(newIteration.currentState).toBe('started');
    expect(
      after.iterations.filter((iteration) => iteration.currentState === 'started'),
    ).toHaveLength(1);
    expect(after.currentState).toBe('started');
  });

  test('la auto-pausa de hermanos: empezar un playthrough pausa el que seguia activo', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const before = mustFind(
      await fetchGame(page, ZELDA_LA),
      "Zelda: Link's Awakening deberia existir (id 7)",
    );
    const seededIterationId = before.iterations[0].id;

    const ids = await page.evaluate(async (gameId) => {
      const a = await globalThis.api.iterations.create({
        gameId,
        playedPlatform: 'Emulated',
        origin: 'Pirate',
        format: 'digital',
      });
      await globalThis.api.stateEvents.add({
        iterationId: a.id,
        type: 'started',
        occurredAt: new Date('2026-08-20T10:00:00.000Z'),
        datePrecision: 'datetime',
      });

      const b = await globalThis.api.iterations.create({
        gameId,
        playedPlatform: 'Emulated',
        origin: 'Pirate',
        format: 'digital',
      });
      // Este 'started' es el que dispara la transaccion de addStateEvent.ts:
      // cualquier hermano que siguiera "started" recibe un on_hold
      // automatico, venga la orden de donde venga — aqui, del IPC, no de un
      // clic en la UI, que es justo lo que un test de unidad de esa funcion
      // no puede demostrar por si solo.
      await globalThis.api.stateEvents.add({
        iterationId: b.id,
        type: 'started',
        occurredAt: new Date('2026-08-21T10:00:00.000Z'),
        datePrecision: 'datetime',
      });

      return { aId: a.id, bId: b.id };
    }, ZELDA_LA);

    const after = mustFind(
      await fetchGame(page, ZELDA_LA),
      "Zelda: Link's Awakening deberia seguir existiendo",
    );

    const iterA = mustFind(
      after.iterations.find((iteration) => iteration.id === ids.aId),
      'falta el playthrough A',
    );
    const iterB = mustFind(
      after.iterations.find((iteration) => iteration.id === ids.bId),
      'falta el playthrough B',
    );
    const seeded = mustFind(
      after.iterations.find((iteration) => iteration.id === seededIterationId),
      'falta el playthrough sembrado',
    );

    expect(iterB.currentState).toBe('started');
    // A estaba jugandose cuando B arranco: la pausa automatica lo manda a
    // on_hold — si no fuera asi, el juego se quedaria con DOS playthroughs
    // "started" a la vez, justo lo que SPEC 4.5 prohibe.
    expect(iterA.currentState).toBe('on_hold');
    // Y el sembrado, que ya estaba TERMINADO (dropped) antes de que nada de
    // esto pasara, no se toca: la pausa solo alcanza a quien seguia activo.
    expect(seeded.currentState).toBe('dropped');
  });

  test('borrar un juego no deja huerfanos: ON DELETE CASCADE de verdad', async ({ afterplay }) => {
    const { window: page } = afterplay;

    const sessionsBefore = await page.evaluate(() => globalThis.api.sessions.getAll());
    const ownSessionsBefore = sessionsBefore.filter((session) => session.gameId === FIRST_LIGHT);
    // 007 First Light trae 6 sesiones medidas en el sembrado — si esto diera
    // 0 el test estaria comprobando que "nada" se borra, que no prueba nada.
    expect(ownSessionsBefore.length).toBeGreaterThan(0);

    const eventsBefore = await page.evaluate(() => globalThis.api.stateEvents.getAll());
    expect(eventsBefore.some((event) => event.gameId === FIRST_LIGHT)).toBe(true);

    const deleted = await page.evaluate((id) => globalThis.api.games.delete(id), FIRST_LIGHT);
    expect(deleted).toBe(true);

    // Ni una sesion del juego borrado sigue viva — y las de los DEMAS juegos
    // del sandbox tampoco desaparecieron por el camino (el cascade es por
    // FK, no un DELETE FROM sessions a lo bruto).
    const sessionsAfter = await page.evaluate(() => globalThis.api.sessions.getAll());
    expect(sessionsAfter.some((session) => session.gameId === FIRST_LIGHT)).toBe(false);
    expect(sessionsAfter).toHaveLength(sessionsBefore.length - ownSessionsBefore.length);

    const eventsAfter = await page.evaluate(() => globalThis.api.stateEvents.getAll());
    expect(eventsAfter.some((event) => event.gameId === FIRST_LIGHT)).toBe(false);

    expect(await fetchGame(page, FIRST_LIGHT)).toBeNull();
  });

  test('resetEndlessState: pasar a endless borra el log salvo plan_to_play y conserva horas y sesiones', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const before = mustFind(
      await fetchGame(page, FIRST_LIGHT),
      '007 First Light deberia existir (id 3)',
    );
    expect(before.currentState).toBe('completed');
    const hoursBefore = before.totalHours;
    const sessionsBefore = before.iterations[0].sessions.length;
    expect(sessionsBefore).toBeGreaterThan(0);

    // El mismo par de llamadas que hace EditGameModal al marcar "Endless":
    // el flag primero, el barrido del log despues.
    await page.evaluate((id) => globalThis.api.games.update(id, { endless: true }), FIRST_LIGHT);
    const ok = await page.evaluate((id) => globalThis.api.games.resetEndlessState(id), FIRST_LIGHT);
    expect(ok).toBe(true);

    const after = mustFind(
      await fetchGame(page, FIRST_LIGHT),
      '007 First Light deberia seguir existiendo',
    );
    expect(after.endless).toBe(true);
    // El log de estados se vacio: sin ningun 'completed' que decir, el
    // estado derivado es Unplayed (null), no "sigue completado".
    expect(after.stateHistory).toHaveLength(0);
    expect(after.currentState).toBeNull();
    // Pero lo MEDIDO no se toco — mismas sesiones, mismas horas.
    expect(after.iterations[0].sessions).toHaveLength(sessionsBefore);
    expect(after.totalHours).toBeCloseTo(hoursBefore, 10);
  });

  test('la nota de una sesion: cadena vacia guarda null, no cadena vacia', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const sessions = await page.evaluate(() => globalThis.api.sessions.getAll());
    const target = mustFind(
      sessions.find((session) => session.gameId === FIRST_LIGHT),
      '007 First Light deberia tener sesiones sembradas',
    );

    const withNote = await page.evaluate(
      ({ id, note }) => globalThis.api.sessions.setNote(id, note),
      { id: target.id, note: '  ya llegue al jefe final  ' },
    );
    // Recorta espacios y guarda el texto — esta mitad no es la que protege
    // el test, es la base sobre la que se ve la otra mitad.
    expect(withNote?.note).toBe('ya llegue al jefe final');

    const cleared = await page.evaluate(
      ({ id, note }) => globalThis.api.sessions.setNote(id, note),
      { id: target.id, note: '' },
    );
    // Lo que de verdad protege este test: "sin nota" es NULL, no "". Si
    // updateSessionNote guardara la cadena vacia tal cual, cualquier `if
    // (session.note)` de la UI seguiria colando una nota fantasma vacia en
    // el diario de sesion.
    expect(cleared?.note).toBeNull();
  });

  test('borrar un evento de estado reabre el playthrough: el estado derivado vuelve atras', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const before = mustFind(
      await fetchGame(page, AC_II),
      "Assassin's Creed II deberia existir (id 1)",
    );
    const secondPlaythrough = before.iterations[1];
    expect(secondPlaythrough.currentState).toBe('completed');
    expect(secondPlaythrough.endedAt).not.toBeNull();

    const completedEvent = mustFind(
      before.stateHistory.find(
        (event) => event.iterationId === secondPlaythrough.id && event.type === 'completed',
      ),
      'el playthrough 2 deberia tener un evento completed en su historial',
    );

    const deleted = await page.evaluate(
      (id) => globalThis.api.stateEvents.delete(id),
      completedEvent.id,
    );
    expect(deleted).toBe(true);

    const after = mustFind(
      await fetchGame(page, AC_II),
      "Assassin's Creed II deberia seguir existiendo",
    );
    const reopened = mustFind(
      after.iterations.find((iteration) => iteration.id === secondPlaythrough.id),
      'el playthrough 2 deberia seguir en la lista',
    );

    // Sin el 'completed', el ultimo evento REAL de ese playthrough vuelve a
    // ser su 'started': el estado derivado retrocede solo (modelo v2 — no
    // hay ancla que reparar, ver deleteStateEvent.ts).
    expect(reopened.currentState).toBe('started');
    expect(reopened.endedAt).toBeNull();
    // Y el juego entero lo hereda: el playthrough 2 (2023) sigue siendo mas
    // reciente que el 1 (2021), asi que el estado del JUEGO tambien retrocede.
    expect(after.currentState).toBe('started');
  });

  test('las horas derivadas: horas manuales y medidas se SUMAN, no se reemplazan', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const before = mustFind(
      await fetchGame(page, FIRST_LIGHT),
      '007 First Light deberia existir (id 3)',
    );
    const iteration = before.iterations[0];
    expect(iteration.manualTotalPlayed).toBeNull();
    const trackedHours = iteration.hours;
    // Si esto fuera 0 el test no distinguiria "suma" de "reemplaza". 007
    // esta elegido justo porque sus horas son enteramente medidas (sesiones
    // del watcher), sin una sola manual todavia — ver iterationHours.ts.
    expect(trackedHours).toBeGreaterThan(0);

    await page.evaluate(
      ({ id, hours }) => globalThis.api.iterations.update(id, { manualTotalPlayed: hours }),
      { id: iteration.id, hours: 10 },
    );

    const after = mustFind(
      await fetchGame(page, FIRST_LIGHT),
      '007 First Light deberia seguir existiendo',
    );
    const updated = mustFind(
      after.iterations.find((candidate) => candidate.id === iteration.id),
      'la iteracion deberia seguir en la lista',
    );

    // El bug historico que documenta iterationHours.ts: un manualTotalPlayed
    // nuevo REEMPLAZABA lo medido en vez de sumarse, y un playthrough con
    // horas manuales que seguia activo se quedaba clavado en ese numero para
    // siempre aunque el watcher le colgara sesiones nuevas. Si eso volviera,
    // esto daria 10 en vez de trackedHours + 10.
    expect(updated.manualTotalPlayed).toBe(10);
    expect(updated.hours).toBeCloseTo(trackedHours + 10, 6);
  });
});
