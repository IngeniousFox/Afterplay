import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { basename } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { closeAppDbFixture, freshAppDb } from '../../db/v2/__tests__/appDbHarness';
import { currentChangeOrigin } from '../../lib/changeOrigin';
import {
  asOtherDevice,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  tombstoneOnly,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import { closeSession } from '../../db/v2/queries/sessions';
import { assignSession } from '../../db/v2/queries/sessions/edit';
import {
  localSessionBeats,
  playthroughs,
  sessions as sessionsTable,
  stateEvents,
} from '../../db/v2/schema';
import type { StateEventType } from '../../db/v2/schema';
import type { SessionClosedEvent } from '../../../shared/types';

// EL CICLO DEL WATCHER, contra una lista de procesos de mentira y la BASE DE
// DATOS DE VERDAD (una base 2.0 en memoria, db/v2/__tests__/appDbHarness.ts).
//
// Por qué la base real y no dobles de las consultas: lo que hay que blindar
// aquí no son las llamadas, son las CONSECUENCIAS — que al arrancar un juego
// quede exactamente UNA sesión abierta y su playthrough en Playing, que al
// cerrarlo la duración salga medida y no inflada, que un cronómetro del móvil
// no acabe con dos sesiones vivas del mismo juego sumando las mismas horas dos
// veces. Todo eso es el estado que queda en las tablas, y un mock de las
// queries lo daría por bueno pase lo que pase.
//
// Lo único falso, aparte del reloj de la pantalla bloqueada, es EL SISTEMA:
// ps-list y find-process (los procesos), electron/powerMonitor (¿está la
// pantalla bloqueada?), el overlay y el disparador de backups.
//
// El sondeo se llama A MANO, ciclo a ciclo (`cycle()`), en vez de arrancar el
// intervalo de 5s: así ningún test depende de cuánto tarde la máquina, y el
// orden "arranques -> cierres -> latido" se puede observar paso a paso.

// ── El sistema de mentira ─────────────────────────────────────────────────

type FakeProcess = {
  pid: number;
  // Tal cual lo escupe ps-list en Windows, con sus mayúsculas: el watcher las
  // baja a minúsculas para cruzarlas, y esa normalización es parte de lo que
  // se prueba aquí.
  name: string;
  // La línea de comandos que find-process sabe leer (Fase 2). null = no se
  // pudo: juegos con anti-cheat que bloquean la introspección, o un pid que
  // murió entre la Fase 1 y la 2.
  cmd: string | null;
};

let systemProcesses: FakeProcess[] = [];
let screenLocked = false;

mock.module('ps-list', {
  defaultExport: async (): Promise<{ pid: number; name: string; ppid: number }[]> =>
    systemProcesses.map((proc) => ({ pid: proc.pid, name: proc.name, ppid: 0 })),
});

mock.module('find-process', {
  defaultExport: async (
    _by: string,
    pid: number,
  ): Promise<{ pid: number; name: string; cmd: string }[]> => {
    const proc = systemProcesses.find((candidate) => candidate.pid === pid);
    return proc && proc.cmd !== null ? [{ pid: proc.pid, name: proc.name, cmd: proc.cmd }] : [];
  },
});

// getSystemIdleState es la ÚNICA fuente de "¿sigue bloqueada la pantalla?"
// (ver isScreenLocked en watcher.ts: se le pregunta al sistema en cada vuelta
// en vez de llevar la cuenta de los eventos de powerMonitor).
mock.module('electron', {
  namedExports: {
    powerMonitor: {
      getSystemIdleState: (): string => (screenLocked ? 'locked' : 'active'),
    },
  },
});

// El backup de partidas guardadas se dispara al cerrar sesión
// (PARTIDAS-GUARDADAS.md §10.2). Aquí solo se apunta A QUÉ JUEGO: con quién se
// dispara y con quién no es una regla del watcher, subirlo a R2 no.
const backupsScheduled: string[] = [];
mock.module('../../saves/sessionHook', {
  namedExports: {
    scheduleSaveBackup: (gameId: string): void => {
      backupsScheduled.push(gameId);
    },
  },
});

// El watcher canta cada arranque y cada cierre por consola. Correcto en la
// app, ruido de tres líneas por test aquí.
const realConsoleLog = console.log;
const realConsoleError = console.error;
console.log = (): void => {};
console.error = (): void => {};

// ── Los módulos reales, DESPUÉS de registrar los mocks ────────────────────

let ProcessWatcher: typeof import('../watcher').ProcessWatcher;

const closedEvents: SessionClosedEvent[] = [];

before(async () => {
  ({ ProcessWatcher } = await import('../watcher'));
  const { setSessionClosedNotifier } = await import('../notifySession');
  // Por la misma puerta que usa main/index.ts: notifySession es puro
  // (lib/makeNotifier), así que no hace falta doblarlo.
  setSessionClosedNotifier((event) => closedEvents.push(event));
});

after(() => {
  closeAppDbFixture();
  console.log = realConsoleLog;
  console.error = realConsoleError;
});

// ── Fábricas del mundo ────────────────────────────────────────────────────

const EXE_CELESTE = 'C:\\Games\\Celeste\\Celeste.exe';
const EXE_HOLLOW = 'C:\\Games\\Hollow\\hollow_knight.exe';
const EXE_RETROARCH = 'C:\\Emu\\RetroArch\\retroarch.exe';

// "Arranca el juego": mete su proceso en la lista del sistema, con la línea de
// comandos que la Fase 2 sabrá reconocer.
const launch = (pid: number, exePath: string, options: { readableCmd?: boolean } = {}): void => {
  systemProcesses.push({
    pid,
    name: basename(exePath),
    cmd: options.readableCmd === false ? null : `"${exePath}" --fullscreen`,
  });
};

// "Cierra el juego".
const quit = (pid: number): void => {
  systemProcesses = systemProcesses.filter((proc) => proc.pid !== pid);
};

// La regla de frescura del §7.4 se mide contra el reloj del sistema (y la base
// del test usa ese mismo reloj, ver beforeEach), así que los cronómetros son
// los únicos casos que no pueden llevar fecha fija. El
// ancla se toma una vez, y las horas elegidas (1h / 26h) quedan lejísimos del
// borde de las 24h: ningún retraso de la máquina puede cambiar el veredicto, y
// las duraciones siguen saliendo exactas porque las dos fechas salen de aquí.
const ANCHOR_MS = Date.now();
const hoursAgo = (hours: number): Date => new Date(ANCHOR_MS - hours * 3_600_000);

// ── Estado por test ───────────────────────────────────────────────────────

let fx: QueryFixture;
let watcher: InstanceType<typeof ProcessWatcher>;
// Los avisos de cambio que la puerta de escritura confirmó, con el origen con
// el que se escribieron (lo que el main convierte en 'data:changed', §15.4).
const committed: { tables: readonly string[]; origin: string }[] = [];
let stopListening: (() => void) | null = null;
const trayUpdates: string[][] = [];

beforeEach(async () => {
  // Con el reloj del sistema: el watcher mide la gracia de arranque y el
  // abandono de los cronómetros contra Date.now(), y la base tiene que fechar
  // las sesiones que abre con ese mismo reloj.
  fx = freshAppDb({ realClock: true });
  systemProcesses = [];
  screenLocked = false;
  committed.length = 0;
  stopListening?.();
  stopListening = fx.local.store.onChange((change) => {
    committed.push({ tables: change.tables, origin: currentChangeOrigin() });
  });
  trayUpdates.length = 0;
  closedEvents.length = 0;
  backupsScheduled.length = 0;
  watcher = new ProcessWatcher((titles) => trayUpdates.push(titles));
});

// ── Utilidades ────────────────────────────────────────────────────────────

// El sondeo es privado y su intervalo real es de 5s. Los tests lo llaman tick
// a tick: cero temporizadores, cero esperas al azar.
type WatcherInternals = { poll: () => Promise<void>; polling: boolean };
const internals = (): WatcherInternals => watcher as unknown as WatcherInternals;
const cycle = (): Promise<void> => internals().poll();

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

const waitUntil = async (
  condition: () => boolean | Promise<boolean>,
  what: string,
): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await nextTick();
  }
};

// pause() y resume() lanzan su trabajo con `void` (los llaman los oyentes de
// powerMonitor, que son síncronos). Se espera al resultado observable en vez
// de dormir un rato a ojo.
const pauseAndSettle = async (): Promise<void> => {
  watcher.pause();
  await waitUntil(async () => (await openSessions()).length === 0, 'la pausa cerró lo activo');
  await nextTick();
};

const resumeAndSettle = async (): Promise<void> => {
  watcher.resume();
  // poll() marca su cerrojo antes del primer await, así que si el ciclo llegó
  // a arrancar esto espera a que termine; y si el resume no despausó (pantalla
  // todavía bloqueada), no hay nada que esperar y sale en el acto.
  const deadline = Date.now() + 5000;
  while (internals().polling) {
    if (Date.now() > deadline) throw new Error('el ciclo lanzado por resume() no terminó');
    await nextTick();
  }
  await nextTick();
};

// Lo que se lee de una sesión. `iterationId` es el playthrough (el nombre de
// la 1.x se conserva para que los casos se lean igual que antes) y
// `lastHeartbeatAt` el latido local de este PC, o el último visto si no lo hay.
type SessionRow = {
  id: string;
  iterationId: string | null;
  emulatorId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  lastHeartbeatAt: Date | null;
  startedBy: 'watcher' | 'timer' | 'play';
};

// Orden de creación: los ids son UUIDv7.
const sessions = async (): Promise<SessionRow[]> =>
  fx.ctx.db
    .select({
      id: sessionsTable.id,
      iterationId: sessionsTable.playthroughId,
      emulatorId: sessionsTable.emulatorId,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      durationSec: sessionsTable.durationSec,
      beatAt: localSessionBeats.beatAt,
      lastSeenAt: sessionsTable.lastSeenAt,
      startedBy: sessionsTable.startedBy,
    })
    .from(sessionsTable)
    .leftJoin(localSessionBeats, eq(localSessionBeats.sessionId, sessionsTable.id))
    .orderBy(asc(sessionsTable.id))
    .all()
    .map(({ beatAt, lastSeenAt, ...row }) => ({ ...row, lastHeartbeatAt: beatAt ?? lastSeenAt }));

const openSessions = async (): Promise<SessionRow[]> =>
  (await sessions()).filter((session) => session.endedAt === null);

// El log de estado de un playthrough, en orden. Es donde se ve si el watcher
// dejó el juego en Playing — y si lo dejó DOS veces.
const stateLog = async (iterationId: string): Promise<string[]> =>
  fx.ctx.db
    .select({ type: stateEvents.type })
    .from(stateEvents)
    .where(eq(stateEvents.playthroughId, iterationId))
    .orderBy(asc(stateEvents.occurredAt), asc(stateEvents.id))
    .all()
    .map((row) => row.type);

const iterationIds = async (gameId: string): Promise<string[]> =>
  fx.ctx.db
    .select({ id: playthroughs.id })
    .from(playthroughs)
    .where(eq(playthroughs.gameId, gameId))
    .orderBy(asc(playthroughs.id))
    .all()
    .map((row) => row.id);

// Las fábricas del mundo, con la forma de las de la 1.x: un juego con su .exe
// instalado en ESTE PC, un playthrough, un evento, una sesión abierta.
const makeGame = async (options: {
  title: string;
  executablePath?: string;
  isEmulated?: boolean;
  planned?: boolean;
}): Promise<string> =>
  seedGame(fx.ctx, {
    title: options.title,
    isEmulated: options.isEmulated ?? false,
    planned: options.planned ?? false,
    ...(options.executablePath ? { install: { executablePath: options.executablePath } } : {}),
  });

const makeIteration = async (
  gameId: string,
  options: { label?: string; playedPlatform?: string } = {},
): Promise<string> =>
  seedPlaythrough(fx.ctx, {
    gameId,
    ...(options.label ? { customLabel: options.label } : {}),
    ...(options.playedPlatform ? { playedPlatform: options.playedPlatform } : {}),
  });

const makeStateEvent = async (
  playthroughId: string,
  type: StateEventType,
  occurredAt: string,
): Promise<string> =>
  seedStateEvent(fx.ctx, { playthroughId, type, occurredAt: new Date(occurredAt) });

const makeEmulator = async (options: { executablePath: string }): Promise<string> =>
  seedEmulator(fx.ctx, { name: 'RetroArch', executablePath: options.executablePath });

// Una sesión abierta de ESTE PC. `lastHeartbeatAt` es su último visto: el
// latido local (local_session_beats) solo lo escribe el watcher en marcha.
const makeOpenSession = async (
  playthroughId: string | null,
  startedAt: string,
  options: {
    lastHeartbeatAt?: Date;
    startedBy?: 'watcher' | 'play' | 'timer';
    emulatorId?: string;
  } = {},
): Promise<string> =>
  seedSession(fx.ctx, {
    playthroughId,
    emulatorId: options.emulatorId ?? null,
    startedAt: new Date(startedAt),
    endedAt: null,
    startedBy: options.startedBy ?? 'play',
    ...(options.lastHeartbeatAt ? { lastSeenAt: options.lastHeartbeatAt } : {}),
  });

// Un cronómetro del MÓVIL: otra máquina, que lo abrió y es su dueña (R-12).
const makePhoneTimer = async (
  playthroughId: string,
  startedAt: Date,
  lastSeenAt: Date,
): Promise<string> =>
  asOtherDevice(fx.ctx, { name: 'Móvil' }).seedSession({
    playthroughId,
    startedAt,
    endedAt: null,
    startedBy: 'timer',
    lastSeenAt,
  });

// Lo que hace un hito terminal (Beaten, Stop) con la sesión abierta: la cierra
// una persona, en ese instante.
const closeByMilestone = (sessionId: string, endedAt: Date): void => {
  assert.ok(closeSession(fx.ctx, sessionId, { endedAt, closedBy: 'user' }));
};

// ══ El ciclo: arranque, cierre y latido ═══════════════════════════════════

describe('un proceso vigilado que arranca', () => {
  it('abre una sesion, deja el playthrough en Playing y avisa a la ventana Y al HUD', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4100, EXE_CELESTE);

    await cycle();

    const rows = await sessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].endedAt, null);
    assert.equal(rows[0].startedBy, 'watcher');
    assert.equal(watcher.isGameRunning(gameId), true);
    assert.deepEqual(watcher.getActiveGameIds(), [gameId]);

    // Sin el 'started' el juego se quedaría pintado como "sin empezar"
    // mientras lo estás jugando: la sesión sola no cambia el estado.
    const [iterationId] = await iterationIds(gameId);
    assert.equal(rows[0].iterationId, iterationId);
    assert.deepEqual(await stateLog(iterationId), ['started']);

    // El aviso a la interfaz ya no lo manda el watcher: sale de la puerta de
    // escritura al confirmar, marcado con su origen (§15.4).
    assert.ok(
      committed.some((change) => change.origin === 'watcher' && change.tables.includes('sessions')),
      'la sesion se escribe con origen watcher',
    );
    assert.deepEqual(trayUpdates.at(-1), ['Celeste']);
  });

  it('no abre una segunda sesion en los ciclos siguientes mientras el proceso viva', async () => {
    // SPEC 4.5: como mucho UNA sesión abierta por juego. Dos sesiones vivas
    // del mismo juego son las mismas horas contadas dos veces.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4101, EXE_CELESTE);

    await cycle();
    await cycle();
    await cycle();

    assert.equal((await sessions()).length, 1);
    const [iterationId] = await iterationIds(gameId);
    // Ni un 'started' de más: cada uno pinta un "Started" en el Journey y
    // mueve el ancla de las horas manuales.
    assert.deepEqual(await stateLog(iterationId), ['started']);
    assert.equal((await iterationIds(gameId)).length, 1);
  });

  it('retomar un juego ya terminado abre un playthrough NUEVO, y solo uno activo', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const finished = await makeIteration(gameId, { label: 'Playthrough 1' });
    await makeStateEvent(finished, 'started', '2026-01-01T10:00:00Z');
    await makeStateEvent(finished, 'completed', '2026-02-01T10:00:00Z');
    launch(4102, EXE_CELESTE);

    await cycle();

    const all = await iterationIds(gameId);
    assert.equal(all.length, 2);
    const [session] = await sessions();
    assert.equal(session.iterationId, all[1]);
    // El que estaba terminado sigue terminado: reactivarlo sería reescribir el
    // pasado, y dos playthroughs con 'started' de último evento romperían
    // "como mucho uno activo" (SPEC 4.5).
    assert.deepEqual(await stateLog(finished), ['started', 'completed']);
    assert.deepEqual(await stateLog(all[1]), ['started']);
  });
});

describe('un proceso vigilado que se cierra', () => {
  it('cierra su sesion con duracion medida, canta el aviso y dispara el backup', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4200, EXE_CELESTE);
    await cycle();
    quit(4200);

    await cycle();

    const [session] = await sessions();
    assert.notEqual(session.endedAt, null);
    // Nunca negativa, pase lo que pase con el reloj (computeDurationSec).
    assert.ok((session.durationSec ?? -1) >= 0);
    assert.equal(watcher.isGameRunning(gameId), false);
    assert.deepEqual(trayUpdates.at(-1), []);

    // El toast de "dónde lo dejé" y el backup salen del cierre, no de un
    // sondeo aparte: si el watcher deja de detectarlo, los dos desaparecen.
    assert.equal(closedEvents.length, 1);
    assert.equal(closedEvents[0].gameId, gameId);
    assert.equal(closedEvents[0].gameTitle, 'Celeste');
    assert.deepEqual(backupsScheduled, [gameId]);
  });

  it('no vuelve a cantar el aviso si la sesion ya la habia cerrado un hito terminal', async () => {
    // El caso real de closeSessionIfOpen: pulsas Beaten/Stop con el juego
    // TODAVÍA abierto (la sesión se cierra ahí). Horas después cierras el
    // juego de verdad y el watcher pasa por aquí: sin la guarda volvería a
    // cantar "sesión cerrada" con una sesión que terminó hace horas, y el
    // diario se pediría por segunda vez.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4201, EXE_CELESTE);
    await cycle();

    const [live] = await sessions();
    const hito = new Date(live.startedAt.getTime() + 1000);
    closeByMilestone(live.id, hito);

    quit(4201);
    await cycle();

    const [session] = await sessions();
    // La hora de fin que puso el hito se respeta: no se pisa con "ahora".
    assert.equal(session.endedAt?.getTime(), hito.getTime());
    assert.equal(session.durationSec, 1);
    assert.deepEqual(closedEvents, []);
    assert.equal(watcher.isGameRunning(gameId), false);
    // El backup SÍ se dispara: la sesión estaba cerrada, pero la partida
    // guardada acaba de cambiar en disco al salir del juego.
    assert.deepEqual(backupsScheduled, [gameId]);
  });

  it('dos juegos a la vez se siguen por separado: cerrar uno no toca al otro', async () => {
    const celeste = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const hollow = await makeGame({ title: 'Hollow Knight', executablePath: EXE_HOLLOW });
    launch(4210, EXE_CELESTE);
    launch(4211, EXE_HOLLOW);

    await cycle();
    assert.deepEqual([...watcher.getActiveGameIds()].sort(), [celeste, hollow].sort());
    assert.deepEqual([...(trayUpdates.at(-1) ?? [])].sort(), ['Celeste', 'Hollow Knight']);

    quit(4210);
    await cycle();

    assert.deepEqual(watcher.getActiveGameIds(), [hollow]);
    assert.equal((await sessions()).length, 2);
    assert.equal((await openSessions()).length, 1);
    assert.deepEqual(backupsScheduled, [celeste]);
  });

  it('late en cada ciclo mientras vive, y deja de latir en cuanto se cierra', async () => {
    // El latido es lo único que salva las horas si la app muere de golpe: sin
    // él, la reconciliación del próximo arranque cerraría la sesión en su
    // startedAt y la partida entera valdría cero.
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4220, EXE_CELESTE);

    await cycle();
    const first = (await sessions())[0].lastHeartbeatAt;
    assert.notEqual(first, null);

    await cycle();
    const second = (await sessions())[0].lastHeartbeatAt;
    assert.ok((second?.getTime() ?? 0) >= (first?.getTime() ?? 0));

    quit(4220);
    await cycle();
    const third = (await sessions())[0].lastHeartbeatAt;
    assert.equal(third?.getTime(), second?.getTime());
  });
});

// ══ Adopción: sesiones abiertas que el watcher no abrió ═══════════════════

describe('adopcion de sesiones ajenas, ciclo a ciclo', () => {
  it('adopta la sesion que abrio el boton Play, para que su cierre se detecte alguna vez', async () => {
    // La cicatriz: startGameSession ve la sesión del botón Play y devuelve
    // null (no duplica), pero sin adoptarla nunca entra en `active` — y la
    // sección de cierres solo mira `active`. Resultado: había que esperar
    // SIEMPRE al botón Stop manual, aunque el juego llevara horas cerrado.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);

    // Un ciclo en vacío primero: a partir de aquí la reconciliación del
    // arranque ya está hecha, así que lo que pase después es adopción por
    // ciclo y no el barrido del primer arranque.
    await cycle();

    const playSessionId = await makeOpenSession(iterationId, '2026-03-01T18:00:00Z');
    launch(4300, EXE_CELESTE);
    await cycle();

    assert.equal((await sessions()).length, 1, 'no se abre una segunda sesion');
    assert.equal((await sessions())[0].id, playSessionId);
    assert.equal(watcher.isGameRunning(gameId), true);

    quit(4300);
    await cycle();
    assert.notEqual((await sessions())[0].endedAt, null);
  });

  it('una sesion de emulador YA asignada se sigue por el emulador, pero su juego SI figura como en marcha', async () => {
    // EMULADORES.md §5 + openSessionKey: la bandeja Pending deja asignar una
    // sesión todavía viva (badge LIVE), y assignSession conserva el
    // emulatorId — así que la fila acaba con gameId Y emulatorId. Con gameId
    // primero, su clave pasaba a ser "game:X" mientras el objetivo vigilado
    // seguía siendo "emu:N": un juego emulado no tiene executablePath, así que
    // "game:X" NO EXISTE como objetivo, nadie la adoptaba, y el mismo ciclo
    // que la dejaba huérfana abría otra por el emulador.
    //
    // ARREGLADO (esto antes fijaba getActiveGameIds() === [] con el juego
    // vivo): que se SIGA por el emulador no puede significar que el juego no
    // esté en marcha. isGameRunning() leía el prefijo de la clave, así que para
    // un juego emulado devolvía false durante toda la partida — y es justo la
    // guarda que impide RESTAURAR una partida guardada encima de un juego
    // abierto (PARTIDAS-GUARDADAS.md §10bis.3). O sea: con Chrono Trigger
    // corriendo bajo RetroArch, la app te dejaba escribirle el backup por
    // debajo. Ahora quien contesta es el dueño de la sesión, no la clave.
    const gameId = await makeGame({ title: 'Chrono Trigger', isEmulated: true });
    const iterationId = await makeIteration(gameId, { playedPlatform: 'Emulated' });
    const emulatorId = await makeEmulator({ executablePath: EXE_RETROARCH });

    await cycle();

    const sessionId = await makeOpenSession(iterationId, '2026-03-02T20:00:00Z', {
      emulatorId,
    });
    launch(4310, EXE_RETROARCH);
    await cycle();

    assert.equal((await sessions()).length, 1, 'ni se duplica ni se queda huerfana');
    assert.equal((await sessions())[0].id, sessionId);
    assert.equal(watcher.hasActiveEmulator(), true);
    // El proceso vigilado sigue siendo el emulador (la clave es "emu:N"), pero
    // las dos preguntas que importan van por el juego.
    assert.equal(watcher.isGameRunning(gameId), true);
    assert.deepEqual(watcher.getActiveGameIds(), [gameId]);

    quit(4310);
    await cycle();

    assert.notEqual((await sessions())[0].endedAt, null);
    // La otra mitad de la cicatriz: la clave nunca empieza por "game:", así
    // que sin la rama que resuelve el juego desde la iteración este juego se
    // quedaba SIEMPRE sin backup automático.
    assert.deepEqual(backupsScheduled, [gameId]);
    assert.equal(closedEvents.length, 1);
    assert.equal(closedEvents[0].gameId, gameId);
    // Y al morir el emulador deja de estar en marcha, claro.
    assert.equal(watcher.isGameRunning(gameId), false);
    assert.deepEqual(watcher.getActiveGameIds(), []);
  });

  it('el backup de un juego emulado se dispara aunque un hito terminal ya hubiera cerrado la sesion', async () => {
    // El mismo caso que el test del juego nativo ("no vuelve a cantar el aviso
    // si la sesion ya la habia cerrado un hito terminal") por el otro objetivo
    // vigilado, y la regla tiene que ser LA MISMA: la partida guardada acaba de
    // cambiar en disco al salir del emulador, la haya cerrado quien la haya
    // cerrado. La rama del emulador exigia ademas que closeSessionIfOpen
    // devolviera fila, asi que pulsar Beaten/Dropped con RetroArch todavia
    // abierto —que cierra la sesion en ese instante— dejaba a ese juego SIN
    // backup automatico para siempre.
    const gameId = await makeGame({ title: 'Chrono Trigger', isEmulated: true });
    const iterationId = await makeIteration(gameId, { playedPlatform: 'Emulated' });
    const emulatorId = await makeEmulator({ executablePath: EXE_RETROARCH });

    await cycle();

    const sessionId = await makeOpenSession(iterationId, '2026-03-02T20:00:00Z', {
      emulatorId,
    });
    launch(4340, EXE_RETROARCH);
    await cycle();
    assert.equal(watcher.isGameRunning(gameId), true, 'la sesion asignada se adopta con su juego');

    // Beaten con el emulador vivo: el hito cierra la sesion abierta del
    // playthrough en ese mismo instante.
    closeByMilestone(sessionId, new Date('2026-03-02T22:00:00Z'));

    quit(4340);
    await cycle();

    assert.deepEqual(backupsScheduled, [gameId]);
    // El aviso de sesion cerrada SI se calla: ese ya lo dio el hito, y repetirlo
    // pediria el diario por segunda vez.
    assert.deepEqual(closedEvents, []);
    // Y la hora de fin que puso el hito se respeta.
    assert.equal((await sessions())[0].endedAt?.toISOString(), '2026-03-02T22:00:00.000Z');
  });

  it('asignar la sesion del emulador EN CALIENTE pone al juego en marcha en el ciclo siguiente', async () => {
    // El otro borde del mismo arreglo. La asignación llega por FUERA del
    // watcher (bandeja Pending, sesión con badge LIVE) y su mapa de sesiones
    // activas sobrevive entre ciclos sin recalcularse: la entrada nació sin
    // juego, cuando el emulador se detectó a secas. Sin volver a mirar quién es
    // su dueño en cada vuelta, ese juego se quedaba fuera de isGameRunning()
    // el resto de la partida aunque la fila de la DB ya dijera a quién
    // pertenece.
    const gameId = await makeGame({ title: 'Chrono Trigger', isEmulated: true });
    await makeEmulator({ executablePath: EXE_RETROARCH });
    launch(4330, EXE_RETROARCH);

    await cycle();
    const [pending] = await sessions();
    assert.equal(pending.iterationId, null, 'nace en la bandeja Pending, sin juego');
    assert.equal(watcher.isGameRunning(gameId), false);

    // assignSession de verdad: cuelga la sesión de un playthrough del juego y
    // CONSERVA el emulatorId (EMULADORES.md §5).
    assert.ok(assignSession(fx.ctx, pending.id, gameId));
    await cycle();

    assert.equal((await sessions()).length, 1, 'no se abre otra: se sigue la misma');
    assert.equal(watcher.isGameRunning(gameId), true);
    assert.deepEqual(watcher.getActiveGameIds(), [gameId]);
  });

  it('un emulador suelto abre una sesion sin juego (bandeja Pending) y no canta nada al cerrarse', async () => {
    const emulatorId = await makeEmulator({ executablePath: EXE_RETROARCH });
    launch(4320, EXE_RETROARCH);

    await cycle();

    const [session] = await sessions();
    assert.equal(session.iterationId, null);
    assert.equal(session.emulatorId, emulatorId);
    assert.equal(watcher.hasActiveEmulator(), true);
    assert.deepEqual(watcher.getActiveGameIds(), []);

    quit(4320);
    await cycle();

    assert.notEqual((await sessions())[0].endedAt, null);
    assert.equal(watcher.hasActiveEmulator(), false);
    // Sin juego no hay de qué hablar: el aviso saldría sin título y no hay
    // partida guardada que respaldar.
    assert.deepEqual(closedEvents, []);
    assert.deepEqual(backupsScheduled, []);
  });
});

// ══ Reconciliación del primer ciclo ═══════════════════════════════════════

describe('sesiones que quedaron abiertas de la ejecucion anterior', () => {
  it('se cierran en su ULTIMO LATIDO, sin sumar el hueco con la app apagada', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    await makeOpenSession(iterationId, '2026-01-10T18:00:00Z', {
      lastHeartbeatAt: new Date('2026-01-10T20:30:00Z'),
    });
    // Nada corriendo: la app se cerró de golpe (corte de luz) con el juego vivo.

    await cycle();

    const [session] = await sessions();
    assert.equal(session.endedAt?.toISOString(), '2026-01-10T20:30:00.000Z');
    // 2h30 de partida, no los meses que van hasta hoy.
    assert.equal(session.durationSec, 9000);
  });

  it('si nunca llegaron a latir se cierran en su arranque: cero, sin inventar horas', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    await makeOpenSession(iterationId, '2026-01-10T18:00:00Z');

    await cycle();

    const [session] = await sessions();
    assert.equal(session.endedAt?.toISOString(), '2026-01-10T18:00:00.000Z');
    assert.equal(session.durationSec, 0);
  });

  it('se ADOPTAN si su juego sigue corriendo, en vez de cerrarse a lo tonto', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    const sessionId = await makeOpenSession(iterationId, '2026-01-10T18:00:00Z', {
      lastHeartbeatAt: new Date('2026-01-10T20:30:00Z'),
    });
    launch(4400, EXE_CELESTE);

    await cycle();

    assert.equal((await openSessions()).length, 1, 'sigue viva');
    assert.equal((await sessions()).length, 1, 'y no se le abre otra al lado');
    assert.equal(watcher.isGameRunning(gameId), true);

    // Y ahora sí se cierra bien, cuando el proceso muere de verdad.
    quit(4400);
    await cycle();
    const [session] = await sessions();
    assert.equal(session.id, sessionId);
    assert.notEqual(session.endedAt, null);
  });

  // La "sesión sin dueño reconocible" de la 1.x (emulatorId a null tras borrar
  // el emulador) no existe en la 2.0: borrar deja lápida y la sesión de un
  // emulador o un playthrough borrado ya no es una sesión viva (liveSession),
  // así que el watcher ni la ve.

  it('un juego SIN .exe configurado conserva su sesion manual para siempre: no hay proceso que echar de menos', async () => {
    // La mitad BUENA del guardián `reconciled`, y sigue intacta: pulsar Play en
    // un juego sin .exe (una consola, un juego que no detectas) abre una sesión
    // que ningún proceso va a respaldar nunca. No es un objetivo vigilado, así
    // que el barrido por ciclo ni la mira — si la cerrara, la mataría a los
    // cinco segundos de empezar a jugar. Solo el Stop manual la cierra.
    const gameId = await makeGame({ title: 'Celeste' });
    const iterationId = await makeIteration(gameId);

    await cycle();
    await makeOpenSession(iterationId, '2026-03-01T18:00:00Z');
    await cycle();
    await cycle();

    assert.equal((await openSessions()).length, 1);
  });

  it('un juego CON .exe cuyo proceso no aparece nunca se cierra solo, sin esperar a reiniciar la app', async () => {
    // ARREGLADO (esto antes fijaba "pasado el primer ciclo ya NO se cierra
    // sola", sin distinguir de quién era la sesión). El guardián `reconciled`
    // cubría dos casos con una sola regla, y el segundo era un fallo: pulsas
    // Play en un juego CON executablePath, el .exe arranca y revienta antes del
    // siguiente tick (o lo cierras en dos segundos). Nadie la cerraba — la
    // reconciliación solo corre en el primer ciclo y la adopción solo mira lo
    // que está en `running` — así que quedaba con endedAt y durationSec null:
    // el juego pintado LIVE en la biblioteca y sus horas sin contar hasta
    // reiniciar Afterplay o pulsar Stop.
    //
    // Se cierra en su último latido, que no lo hay: `startedAt`. Duración cero,
    // que es la verdad de lo que se jugó.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);

    await cycle();
    // Muy anterior a la gracia de dos minutos: el .exe tuvo tiempo de sobra.
    await makeOpenSession(iterationId, '2026-03-01T18:00:00Z');
    await cycle();

    const [session] = await sessions();
    assert.equal(session.endedAt?.toISOString(), '2026-03-01T18:00:00.000Z');
    assert.equal(session.durationSec, 0);
    assert.equal(watcher.isGameRunning(gameId), false);
    assert.ok(
      committed.some((change) => change.origin === 'watcher'),
      'la biblioteca tiene que repintarse',
    );
  });

  it('pero espera la gracia: un lanzador lento no pierde la sesion que acaba de abrir', async () => {
    // El borde contrario, y el que hace que el arreglo no sea peor que el
    // fallo. Con Steam/EA/Ubisoft de por medio el .exe de verdad tarda 20-40s
    // en nacer (y más si compila shaders): cerrar en el primer ciclo que no lo
    // ve mataría la sesión del juego que todavía está arrancando. La gracia son
    // dos minutos, atada a los 90s del armado del overlay.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);

    await cycle();
    // Recién pulsado Play: la hora de ahora mismo, no una fija — lo que se
    // mide es el rato que lleva abierta contra el reloj real.
    await makeOpenSession(iterationId, new Date().toISOString());
    await cycle();
    await cycle();

    assert.equal((await openSessions()).length, 1, 'sigue viva mientras el lanzador trabaja');

    // Y cuando el .exe por fin sale, se adopta: la sesión es la misma.
    launch(4450, EXE_CELESTE);
    await cycle();
    assert.equal((await sessions()).length, 1);
    assert.equal(watcher.isGameRunning(gameId), true);
  });

  it('la sesion de un EMULADOR que no llego a verse tambien se cierra sola', async () => {
    // Mismo agujero por el otro objetivo vigilado: una sesión de emulador
    // (bandeja Pending) cuyo proceso ya no está. Aquí no hay Play manual que
    // proteger — un emulador SIEMPRE tiene .exe configurado, así que si no
    // aparece es que no está.
    const emulatorId = await makeEmulator({ executablePath: EXE_RETROARCH });
    await cycle();

    await makeOpenSession(null, '2026-03-01T18:00:00Z', {
      emulatorId,
      startedBy: 'watcher',
      lastHeartbeatAt: new Date('2026-03-01T19:00:00Z'),
    });
    await cycle();

    const [session] = await sessions();
    // En su último latido, no en "ahora": el tiempo que se sabe que se jugó.
    assert.equal(session.endedAt?.toISOString(), '2026-03-01T19:00:00.000Z');
    assert.equal(session.durationSec, 3600);
    // Nada que cantar: la sesión nunca llegó a seguirse, no hay diario que
    // pedir ni partida guardada que haya cambiado en disco.
    assert.deepEqual(closedEvents, []);
    assert.deepEqual(backupsScheduled, []);
  });
});

// ══ Cronómetros del móvil (REMOTO.md §7) ══════════════════════════════════

describe('cronometros del movil, que no tienen proceso que vigilar', () => {
  it('§7.3: uno fresco sobrevive a la reconciliacion del arranque aunque no haya proceso', async () => {
    // Sin la marca startedBy, reconcileOpenSessions no encontraba su proceso
    // (nunca lo habrá: es una Switch, o GeForce Now) y la cerraba en el acto
    // con endedAt = startedAt. Duración 0, cada vez que arrancabas la app.
    const gameId = await makeGame({ title: 'Tears of the Kingdom' });
    const iterationId = await makeIteration(gameId, { playedPlatform: 'Switch' });
    await makePhoneTimer(iterationId, hoursAgo(3), hoursAgo(1));

    await cycle();

    assert.equal((await openSessions()).length, 1);
  });

  it('§7.4 y R-12: uno sin latir 24h lo cierra su dueño, no este PC', async () => {
    // En la 1.x el PC barría los cronómetros abandonados del móvil, y como su
    // copia de Turso podía ir atrasada (PC suspendido mientras el móvil seguía
    // midiendo) hacía falta esperar a un pull reciente para no pisar horas
    // buenas. En la 2.0 eso lo resuelve la regla del dueño: una sesión solo la
    // cierra el dispositivo que la abrió, así que el PC ni lo intenta.
    const gameId = await makeGame({ title: 'Tears of the Kingdom' });
    const iterationId = await makeIteration(gameId, { playedPlatform: 'Switch' });
    await cycle();

    await makePhoneTimer(iterationId, hoursAgo(28), hoursAgo(26));
    await cycle();
    await cycle();

    const [session] = await sessions();
    assert.equal(session.endedAt, null, 'el cronometro del movil sigue abierto');
    assert.equal(session.durationSec, null);
  });

  it('§7.4: un cronometro PROPIO sin latir 24h se cierra en su ultimo latido, y no solo al arrancar', async () => {
    // El barrido corre en CADA ciclo a propósito: la app vive días en la
    // bandeja, así que con la regla solo en el arranque un cronómetro
    // olvidado por la noche se quedaba LIVE y sin horas hasta el siguiente
    // reinicio. Este cronómetro nace DESPUÉS del primer ciclo justamente para
    // demostrarlo.
    const gameId = await makeGame({ title: 'Tears of the Kingdom' });
    const iterationId = await makeIteration(gameId, { playedPlatform: 'Switch' });
    await cycle();

    await makeOpenSession(iterationId, hoursAgo(28).toISOString(), {
      startedBy: 'timer',
      lastHeartbeatAt: hoursAgo(26),
    });
    await cycle();

    const [session] = await sessions();
    assert.equal(session.endedAt?.getTime(), hoursAgo(26).getTime());
    // 28h - 26h: lo que se sabe que jugó, no las 28h hasta ahora.
    assert.equal(session.durationSec, 7200);
  });

  it('mientras el cronometro este fresco, su juego en marcha NO abre sesion propia', async () => {
    // REMOTO.md §7 + el bucle de arranques: el .exe está vivo pero su tiempo
    // lo lleva el móvil. Abrirle sesión propia serían dos sesiones vivas del
    // mismo juego, o sea las mismas horas contadas dos veces.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    await cycle();

    const timerSessionId = await makePhoneTimer(iterationId, hoursAgo(2), hoursAgo(0.5));
    launch(4500, EXE_CELESTE);
    await cycle();
    await cycle();

    assert.equal((await sessions()).length, 1);
    assert.equal((await sessions())[0].id, timerSessionId);
    assert.equal((await sessions())[0].endedAt, null);
    // El precio, documentado y asumido: mientras mande el cronómetro el juego
    // NO figura como en marcha, así que la guarda de restaurar partidas y el
    // sondeo en vivo de logros de Steam no lo ven.
    assert.equal(watcher.isGameRunning(gameId), false);
    assert.deepEqual(watcher.getActiveGameIds(), []);

    // Y tampoco se adopta: si se adoptara, al morir el .exe se cerraría el
    // cronómetro con el startedAt del móvil — que puede ser de ayer.
    quit(4500);
    await cycle();
    assert.equal((await sessions())[0].endedAt, null, 'el cronometro sobrevive al .exe');
  });

  it('en cuanto se pone rancio, el MISMO ciclo le devuelve al juego su sesion propia', async () => {
    // La foto `openSessions` se toma ANTES del barrido de rancios, así que el
    // bucle de arranques vuelve a mirar la frescura por su cuenta: un
    // cronómetro rancio ya no retiene al juego, lo cierre quien lo cierre.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    await cycle();

    const timerSessionId = await makeOpenSession(iterationId, hoursAgo(28).toISOString(), {
      startedBy: 'timer',
      lastHeartbeatAt: hoursAgo(26),
    });
    launch(4510, EXE_CELESTE);
    await cycle();

    const rows = await sessions();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, timerSessionId);
    assert.equal(rows[0].endedAt?.getTime(), hoursAgo(26).getTime());
    assert.equal(rows[1].startedBy, 'watcher');
    assert.equal(rows[1].endedAt, null);
    // Mismo playthrough: el relevo no abre uno nuevo.
    assert.equal(rows[1].iterationId, iterationId);
    assert.equal(watcher.isGameRunning(gameId), true);
  });
});

// ══ Pausa por bloqueo de pantalla (SPEC-2 §7.2) ═══════════════════════════

describe('el tiempo con la pantalla bloqueada no es tiempo jugado', () => {
  it('bloquear cierra YA las sesiones activas, aunque el juego siga corriendo detras', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4600, EXE_CELESTE);
    await cycle();
    assert.equal(watcher.isGameRunning(gameId), true);

    // El proceso NO muere: te vas a comer y bloqueas con Win+L.
    screenLocked = true;
    await pauseAndSettle();

    assert.equal((await openSessions()).length, 0);
    assert.equal(watcher.isGameRunning(gameId), false);
    assert.deepEqual(trayUpdates.at(-1), []);
  });

  it('con el PC bloqueado el sondeo ni escanea: no se reabre nada a los 5 segundos', async () => {
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4610, EXE_CELESTE);
    await cycle();
    screenLocked = true;
    await pauseAndSettle();

    await cycle();
    await cycle();

    assert.equal((await sessions()).length, 1, 'ninguna sesion nueva durante el bloqueo');
    assert.equal((await openSessions()).length, 0);
  });

  it('un resume con la pantalla TODAVIA bloqueada no despausa (Windows lo manda antes)', async () => {
    // La cicatriz gorda del §7.2: al despertar con contraseña, Windows manda
    // 'resume' ANTES que 'unlock-screen'. Con un solo booleano, ese primer
    // aviso despausaba con la pantalla aún bloqueada y el juego seguía sumando
    // todos los minutos que tardaras en teclear. Quien decide es poll(),
    // preguntándole al sistema si la pantalla sigue bloqueada.
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4620, EXE_CELESTE);
    await cycle();
    const closedId = (await sessions())[0].id;

    screenLocked = true;
    await pauseAndSettle();

    // Llega el 'resume' mientras la contraseña sigue sin teclear.
    await resumeAndSettle();
    assert.equal((await sessions()).length, 1, 'nada nuevo mientras la pantalla sigue bloqueada');

    // Se teclea. El tick normal de 5s recoge el desbloqueo él solo, aunque el
    // 'unlock-screen' se pierda o llegue tarde: la petición sobrevive.
    screenLocked = false;
    await cycle();

    const rows = await sessions();
    assert.equal(rows.length, 2);
    assert.notEqual(rows[1].id, closedId);
    assert.equal(rows[1].endedAt, null);
    // El rato bloqueado quedó FUERA: es un hueco entre dos sesiones, no
    // tiempo dentro de una.
    assert.ok(rows[1].startedAt.getTime() >= (rows[0].endedAt?.getTime() ?? 0));
  });

  it('una pausa invalida el ciclo EN VUELO, aunque un resume rapido lo despause por debajo', async () => {
    // La carrera: withDbAccess es un contador y no un mutex, asi que pause()
    // puede colarse en cualquiera de los awaits de poll(). El ciclo en vuelo
    // reanudaba con la foto de ANTES —`active` ya vaciado, la sesion ya
    // cerrada— y volvia a abrir una sesion nueva por el mismo juego, que se
    // quedaba viva durante todo el bloqueo: el rato con la pantalla bloqueada
    // contado como jugado, que es justo lo que la pausa existe para impedir
    // (SPEC-2 §7.2).
    //
    // Releer el booleano `paused` no bastaba, y por eso el ciclo lleva su
    // GENERACION: al despertar con contrasena Windows manda 'resume' antes que
    // 'unlock-screen', y ese resume despausa el booleano mientras el ciclo
    // viejo sigue en vuelo — se creia vigente otra vez.
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4640, EXE_CELESTE);
    await cycle();
    assert.equal((await openSessions()).length, 1);

    // El ciclo arranca y se queda en su primer await (la DB): a partir de aqui
    // todo lo que pase, pasa "a mitad de ciclo".
    const inflight = internals().poll();
    screenLocked = true;
    watcher.pause();
    // Sin esperar a que la pausa termine de cerrar: el resume llega pisandole
    // los talones, como el de Windows.
    screenLocked = false;
    watcher.resume();

    await inflight;
    await waitUntil(async () => (await openSessions()).length === 0, 'la pausa cerro lo activo');
    await nextTick();

    assert.equal(
      (await sessions()).length,
      1,
      'el ciclo caducado no abre ninguna sesion despues de la pausa',
    );
    assert.equal((await openSessions()).length, 0);
    assert.equal(watcher.isGameRunning(gameId), false);
  });

  it('resume() con la app apagandose no abre sesiones fantasma', async () => {
    // Los oyentes de powerMonitor siguen vivos durante el cierre de la app, y
    // un unlock/resume tardío llamaba a resume() -> poll() con la base
    // desmontándose. El ScanWatcher hermano ya se blindaba con este flag;
    // este no lo tenía.
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4630, EXE_CELESTE);
    await cycle();
    screenLocked = true;
    await pauseAndSettle();

    watcher.stop();
    screenLocked = false;
    await resumeAndSettle();
    await cycle();

    assert.equal((await sessions()).length, 1);
    assert.equal((await openSessions()).length, 0);
  });
});

// ══ Qué se vigila y qué no (barrido de dos fases, SPEC-2 §7.1) ════════════

describe('el barrido de dos fases descarta lo que no es', () => {
  it('un .exe con el mismo nombre desde otra carpeta no cuenta como el juego', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    // Mismo nombre de exe, otra ruta: otro programa. La Fase 1 lo propone y
    // la Fase 2 tiene que tirarlo.
    systemProcesses.push({ pid: 4700, name: 'celeste.exe', cmd: 'd:\\otros\\celeste.exe /q' });

    await cycle();
    assert.deepEqual(await sessions(), []);
    assert.equal(watcher.isGameRunning(gameId), false);

    // Y el de verdad sí, con el impostor todavía en la lista: el cruce va por
    // nombre en minúsculas contra una ruta en minúsculas, y ps-list devuelve
    // el nombre tal cual lo tenga Windows.
    launch(4701, EXE_CELESTE);
    await cycle();
    assert.equal((await sessions()).length, 1);
    assert.equal(watcher.isGameRunning(gameId), true);
  });

  it('si no se puede leer la ruta del proceso, la Fase 2b no se inventa nada', async () => {
    // Fase 2b solo mira si el .exe CONCRETO configurado está bloqueado contra
    // escritura (EBUSY = proceso vivo). Aquí ese archivo no existe siquiera,
    // así que el error es ENOENT y no cuenta — igual que un EACCES por
    // permisos. Tratar cualquier fallo como señal daría falsos positivos
    // permanentes: un juego marcado "en marcha" para siempre.
    const gameId = await makeGame({
      title: 'Neverness to Everness',
      executablePath: 'C:\\Games\\NoExiste\\nte.exe',
    });
    launch(4710, 'C:\\Games\\NoExiste\\nte.exe', { readableCmd: false });

    await cycle();

    assert.deepEqual(await sessions(), []);
    assert.equal(watcher.isGameRunning(gameId), false);
  });

  it('un juego de Plan to Play no se vigila aunque tenga .exe configurado', async () => {
    // Un juego planeado, por definición, todavía no lo juegas dentro de la
    // app: abrirle una sesión lo sacaría solo del Plan.
    await makeGame({ title: 'Silksong', planned: true, executablePath: EXE_CELESTE });
    launch(4720, EXE_CELESTE);

    await cycle();

    assert.deepEqual(await sessions(), []);
  });
});

// ══ Arranque: limpieza de latidos locales (§10.3) ═════════════════════════

describe('el arranque limpia los latidos locales que ya no sirven', () => {
  const beatRows = async (): Promise<string[]> =>
    fx.ctx.db
      .select({ sessionId: localSessionBeats.sessionId })
      .from(localSessionBeats)
      .orderBy(asc(localSessionBeats.sessionId))
      .all()
      .map((row) => row.sessionId);

  const insertBeat = (sessionId: string, beatAt: Date): void => {
    fx.ctx.db.insert(localSessionBeats).values({ sessionId, beatAt }).run();
  };

  it('la poda va DESPUES de reconciliar: el cierre aun usa el latido, y luego se borra', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    const crashed = await makeOpenSession(iterationId, '2026-01-10T18:00:00Z');
    insertBeat(crashed, new Date('2026-01-10T20:30:00Z'));
    // Un latido huérfano de una sesión que se cerró hace tiempo.
    const old = seedSession(fx.ctx, {
      playthroughId: iterationId,
      startedAt: new Date('2026-01-09T18:00:00Z'),
      endedAt: new Date('2026-01-09T19:00:00Z'),
      startedBy: 'watcher',
    });
    insertBeat(old, new Date('2026-01-09T19:00:00Z'));

    await cycle();

    const closed = (await sessions()).find((session) => session.id === crashed);
    // Si la poda hubiera ido antes, habría cerrado en `startedAt`.
    assert.equal(closed?.endedAt?.toISOString(), '2026-01-10T20:30:00.000Z');
    assert.deepEqual(await beatRows(), []);
  });

  it('no toca el latido de una sesion que sigue viva (adoptada)', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    const live = await makeOpenSession(iterationId, '2026-01-10T18:00:00Z');
    insertBeat(live, new Date('2026-01-10T20:30:00Z'));
    launch(4800, EXE_CELESTE);

    await cycle();

    assert.deepEqual(await beatRows(), [live]);
    assert.equal(watcher.isGameRunning(gameId), true);
  });

  it('solo una vez, en el primer ciclo', async () => {
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    await cycle();
    const gameId = await makeGame({ title: 'Hollow Knight', executablePath: EXE_HOLLOW });
    const iterationId = await makeIteration(gameId);
    const closed = seedSession(fx.ctx, {
      playthroughId: iterationId,
      startedAt: new Date('2026-01-09T18:00:00Z'),
      endedAt: new Date('2026-01-09T19:00:00Z'),
      startedBy: 'watcher',
    });
    insertBeat(closed, new Date('2026-01-09T19:00:00Z'));

    await cycle();

    assert.deepEqual(await beatRows(), [closed]);
  });
});

// ══ Sesiones borradas por fuera mientras se siguen (F-11) ═════════════════

describe('una sesion seguida que se borra en otro PC', () => {
  it('se suelta, y si el proceso sigue vivo el ciclo siguiente abre una nueva', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4810, EXE_CELESTE);
    await cycle();
    const [first] = await sessions();
    // Llega la lápida por sync: la sesión sigue sin `endedAt` pero ya no vive.
    tombstoneOnly(fx.ctx, 'sessions', first.id);

    await cycle();

    const live = (await openSessions()).filter((session) => session.id !== first.id);
    assert.equal(live.length, 1);
    assert.equal(watcher.isGameRunning(gameId), true);
    // Lo ajeno no se toca: la fila borrada no se cierra desde aquí.
    assert.equal((await sessions()).find((s) => s.id === first.id)?.endedAt, null);
  });

  it('con el juego borrado tambien se suelta, sin cerrar nada ni lanzar backup', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4811, EXE_CELESTE);
    await cycle();
    const [first] = await sessions();
    backupsScheduled.length = 0;
    tombstoneOnly(fx.ctx, 'games', gameId);

    await cycle();

    assert.equal(watcher.isGameRunning(gameId), false);
    assert.deepEqual(watcher.getActiveGameIds(), []);
    const rows = await sessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.id);
    assert.equal(rows[0].endedAt, null);
    assert.deepEqual(backupsScheduled, []);
    assert.deepEqual(trayUpdates.at(-1), []);
  });

  it('una sesion CERRADA por otro (Stop manual) no se suelta: no se reabre sola', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4812, EXE_CELESTE);
    await cycle();
    const [first] = await sessions();
    closeByMilestone(first.id, new Date());

    await cycle();
    await cycle();

    assert.equal((await sessions()).length, 1);
    assert.equal(watcher.isGameRunning(gameId), true);
  });
});

// ══ Cierre por bloqueo: también programa el backup de partidas ════════════

describe('cerrar por bloqueo o suspension', () => {
  it('programa el backup de partidas igual que el cierre normal', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4820, EXE_CELESTE);
    await cycle();
    assert.deepEqual(backupsScheduled, []);

    screenLocked = true;
    await pauseAndSettle();

    assert.deepEqual(backupsScheduled, [gameId]);
  });

  it('un emulador sin juego asignado no programa nada', async () => {
    await makeEmulator({ executablePath: EXE_RETROARCH });
    launch(4821, EXE_RETROARCH);
    await cycle();

    screenLocked = true;
    await pauseAndSettle();

    assert.deepEqual(backupsScheduled, []);
  });
});

// ══ Sync rápido antes de crear un playthrough (§10.7) ═════════════════════

describe('el sync rapido antes de abrir la sesion de un juego', () => {
  const withSync = (syncBeforeCreate: (limitMs: number) => Promise<void>): void => {
    watcher = new ProcessWatcher((titles) => trayUpdates.push(titles), { syncBeforeCreate });
  };

  it('se pide con tope de 3 s ANTES de abrir, y la sesion se abre al volver', async () => {
    const events: string[] = [];
    withSync(async (limitMs) => {
      events.push(`sync:${limitMs}:sesiones=${(await sessions()).length}`);
    });
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4830, EXE_CELESTE);

    await cycle();

    assert.deepEqual(events, ['sync:3000:sesiones=0']);
    assert.equal((await sessions()).length, 1);
  });

  it('no se pide si la sesion ya existia (la abrio Play): se adopta sin esperar', async () => {
    let calls = 0;
    withSync(async () => {
      calls += 1;
    });
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    await makeOpenSession(iterationId, new Date().toISOString());
    launch(4831, EXE_CELESTE);

    await cycle();

    assert.equal(calls, 0);
    assert.equal(watcher.isGameRunning(gameId), true);
  });

  it('no se pide para un emulador (no crea playthrough)', async () => {
    let calls = 0;
    withSync(async () => {
      calls += 1;
    });
    await makeEmulator({ executablePath: EXE_RETROARCH });
    launch(4832, EXE_RETROARCH);

    await cycle();

    assert.equal(calls, 0);
    assert.equal((await sessions()).length, 1);
  });

  it('con dos juegos arrancando a la vez se paga una sola vez por ciclo', async () => {
    let calls = 0;
    withSync(async () => {
      calls += 1;
    });
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    await makeGame({ title: 'Hollow Knight', executablePath: EXE_HOLLOW });
    launch(4833, EXE_CELESTE);
    launch(4834, EXE_HOLLOW);

    await cycle();

    assert.equal(calls, 1);
    assert.equal((await sessions()).length, 2);
  });

  it('mientras espera, otro ciclo no abre la misma sesion dos veces', async () => {
    let release: () => void = () => {};
    let calls = 0;
    withSync(
      () =>
        new Promise<void>((resolve) => {
          calls += 1;
          release = resolve;
        }),
    );
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4835, EXE_CELESTE);

    const first = cycle();
    await nextTick();
    // Es el tick de 5 s volviendo a pasar mientras el primero sigue esperando.
    await cycle();
    await cycle();
    assert.equal(calls, 1);
    assert.equal((await sessions()).length, 0);

    release();
    await first;

    assert.equal((await sessions()).length, 1);
    await cycle();
    assert.equal((await sessions()).length, 1);
  });

  it('si el PC se bloquea durante la espera, no se abre nada', async () => {
    let release: () => void = () => {};
    withSync(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4836, EXE_CELESTE);

    const first = cycle();
    await nextTick();
    screenLocked = true;
    watcher.pause();
    release();
    await first;

    assert.deepEqual(await sessions(), []);
  });

  it('si el sync falla, la sesion se abre igualmente', async () => {
    withSync(() => Promise.reject(new Error('sin red')));
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4837, EXE_CELESTE);

    await cycle();

    assert.equal((await sessions()).length, 1);
  });
});

// ══ Cierre ordenado de la app (§10.6, paso 1) ═════════════════════════════

describe('closeAllForQuit', () => {
  const closedByOf = (sessionId: string): string | null =>
    fx.ctx.db
      .select({ closedBy: sessionsTable.closedBy })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .get()?.closedBy ?? null;

  it('cierra las seguidas Y las abiertas por Play que aun no se adoptaron, como owner', async () => {
    const celeste = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const hollow = await makeGame({ title: 'Hollow Knight', executablePath: EXE_HOLLOW });
    launch(4840, EXE_CELESTE);
    await cycle();
    // Play acaba de abrir esta y el watcher no ha tenido ciclo para adoptarla.
    const hollowIteration = await makeIteration(hollow);
    const fromPlay = await makeOpenSession(hollowIteration, '2026-01-10T18:00:00Z');
    // Después del arranque real de la sesión del watcher (que usa el reloj de pared).
    const at = new Date(Date.now() + 60_000);
    backupsScheduled.length = 0;

    const closed = watcher.closeAllForQuit(at);

    assert.equal(closed, 2);
    assert.equal((await openSessions()).length, 0);
    for (const session of await sessions()) {
      assert.equal(closedByOf(session.id), 'owner');
    }
    const play = (await sessions()).find((session) => session.id === fromPlay);
    assert.equal(play?.endedAt?.toISOString(), at.toISOString());
    assert.deepEqual([...backupsScheduled].sort(), [celeste, hollow].sort());
    assert.deepEqual(watcher.getActiveGameIds(), []);
  });

  it('no toca ni los cronometros ni lo de otro dispositivo', async () => {
    const gameId = await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    const iterationId = await makeIteration(gameId);
    const timer = await makePhoneTimer(iterationId, new Date(), new Date());
    const otherPc = asOtherDevice(fx.ctx, { name: 'Otro PC' }).seedSession({
      playthroughId: iterationId,
      startedAt: new Date(),
      endedAt: null,
      startedBy: 'watcher',
    });

    assert.equal(watcher.closeAllForQuit(new Date()), 0);

    const open = (await openSessions()).map((session) => session.id);
    assert.deepEqual(open.sort(), [timer, otherPc].sort());
  });

  it('para el sondeo: con el juego aun corriendo no se reabre nada durante la espera', async () => {
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });
    launch(4841, EXE_CELESTE);
    await cycle();

    watcher.closeAllForQuit(new Date());
    await cycle();
    await cycle();

    assert.equal((await sessions()).length, 1);
    assert.equal((await openSessions()).length, 0);
  });

  it('sin sesiones abiertas devuelve 0 y no programa backups', async () => {
    await makeGame({ title: 'Celeste', executablePath: EXE_CELESTE });

    assert.equal(watcher.closeAllForQuit(new Date()), 0);
    assert.deepEqual(backupsScheduled, []);
  });
});
