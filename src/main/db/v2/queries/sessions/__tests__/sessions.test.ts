import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { StoreError } from '../../../store';
import {
  OTHER,
  asOtherDevice,
  at,
  hours,
  insertSynced,
  openQueryDb,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  seedUnlock,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { closeSession, closeSessionIfOpen } from '../close';
import { assignSession, deletePendingSession, deleteSession, updateSessionNote } from '../edit';
import { captureStoreError } from '../errors';
import { createEmulatorSession, startGameSession } from '../start';
import {
  activePlaythroughs,
  eventsOfGame,
  playthroughsOf,
  sessionRow,
  sessionsOfGame,
  typesOf,
} from './helpers';

// El ciclo de vida de una sesión sobre el esquema 2.0: abrirla, cerrarla,
// asignarla si vino de un emulador, anotarla y borrarla. Porta
// `src/main/db/__tests__/sessions.test.ts` (la parte de `computeDurationSec`
// ya la cubre `common/__tests__/sessionsClose.test.ts`) y añade lo nuevo del
// modelo: dueño, `startedBy`, `closedBy` y el filtro por dispositivo.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const open = (playthroughId: string, startedAt = at(0)): string =>
  seedSession(fx.ctx, { playthroughId, startedAt, endedAt: null });

describe('cerrar una sesión: idempotencia y quién tiene derecho a cantarlo', () => {
  it('closeSessionIfOpen cierra la que estaba abierta, con closedBy, y devuelve la fila cerrada', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const sessionId = open(playthroughId);

    const closed = closeSessionIfOpen(fx.ctx, sessionId, {
      endedAt: at(hours(2.5)),
      closedBy: 'owner',
    });

    assert.equal(closed?.id, sessionId);
    assert.equal(closed?.durationSec, 9000);
    assert.equal(closed?.endedAt?.getTime(), at(hours(2.5)).getTime());
    assert.equal(closed?.closedBy, 'owner');
    assert.equal(sessionRow(fx.ctx, sessionId)?.durationSec, 9000);
  });

  it('una sesión ya cerrada no se vuelve a cerrar: null y su duración intacta', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const sessionId = open(playthroughId);
    closeSessionIfOpen(fx.ctx, sessionId, { endedAt: at(hours(2.5)), closedBy: 'user' });

    const second = closeSessionIfOpen(fx.ctx, sessionId, {
      endedAt: at(hours(6.5)),
      closedBy: 'owner',
    });

    assert.equal(second, null);
    const stored = sessionRow(fx.ctx, sessionId);
    assert.equal(stored?.durationSec, 9000);
    // Quien la cerró primero se queda: el Stop del usuario.
    assert.equal(stored?.closedBy, 'user');
  });

  it('closeSession sobre una ya cerrada la devuelve TAL CUAL, sin recalcular nada', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const sessionId = open(playthroughId);

    const first = closeSession(fx.ctx, sessionId, { endedAt: at(hours(2.5)), closedBy: 'user' });
    const again = closeSession(fx.ctx, sessionId, { endedAt: at(hours(40)), closedBy: 'user' });

    assert.equal(first?.durationSec, 9000);
    assert.equal(again?.durationSec, 9000);
    assert.equal(again?.endedAt?.getTime(), at(hours(2.5)).getTime());
  });

  it('una sesión que no existe o tiene lápida devuelve null por las dos puertas', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const gone = seedSession(fx.ctx, { playthroughId });
    fx.ctx.store.remove('sessions', gone);
    const input = { endedAt: at(hours(1)), closedBy: 'owner' as const };

    for (const id of ['no-existe', gone]) {
      assert.equal(closeSessionIfOpen(fx.ctx, id, input), null);
      assert.equal(closeSession(fx.ctx, id, input), null);
    }
  });

  it('cerrar con una fecha anterior a su inicio no cierra nada: se queda abierta', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const sessionId = open(playthroughId, at(hours(10)));

    assert.equal(
      closeSessionIfOpen(fx.ctx, sessionId, { endedAt: at(hours(1)), closedBy: 'owner' }),
      null,
    );
    const row = sessionRow(fx.ctx, sessionId);
    assert.equal(row?.endedAt, null);
    assert.equal(row?.durationSec, null);
  });

  it('una sesión abierta de OTRO PC no se cierra desde aquí, y ninguna de las dos lanza', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });
    const input = { endedAt: at(hours(1)), closedBy: 'user' as const };

    assert.equal(closeSessionIfOpen(fx.ctx, foreign, input), null);
    const returned = closeSession(fx.ctx, foreign, input);
    assert.equal(returned?.endedAt, null);
    assert.equal(returned?.deviceId, OTHER);
    assert.equal(sessionRow(fx.ctx, foreign)?.endedAt, null);
  });
});

describe('startGameSession: como mucho una sesión abierta por juego en este PC', () => {
  it('un juego sin playthroughs estrena uno, lo deja activo y le cuelga una sesión medida abierta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hollow Knight' });

    const session = startGameSession(fx.ctx, gameId, 'watcher');

    const iterations = playthroughsOf(fx.ctx, gameId);
    assert.equal(iterations.length, 1);
    assert.equal(session?.iterationId, iterations[0].id);
    assert.equal(session?.isManual, false);
    assert.equal(session?.endedAt, null);
    assert.equal(session?.durationSec, null);
    assert.equal(session?.emulatorId, null);
    assert.equal(session?.startedBy, 'watcher');
    assert.equal(session?.datePrecision, 'datetime');
    assert.equal(session?.closedBy, null);
    // Dueño este PC y primera señal de vida en el arranque (§3.2).
    assert.equal(session?.deviceId, fx.ctx.deviceId);
    assert.equal(session?.lastHeartbeatAt?.getTime(), session?.startedAt.getTime());
    assert.equal(sessionRow(fx.ctx, session!.id)?.source, 'measured');

    const events = eventsOfGame(fx.ctx, gameId);
    assert.deepEqual(
      events.map((e) => e.type),
      ['started'],
    );
    // Un solo instante para el evento y la sesión.
    assert.equal(events[0].occurredAt.getTime(), session?.startedAt.getTime());
  });

  it('el botón Play la abre igual, con startedBy "play"', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const session = startGameSession(fx.ctx, gameId, 'play');
    assert.equal(session?.startedBy, 'play');
    assert.equal(sessionRow(fx.ctx, session!.id)?.startedBy, 'play');
  });

  it('con una sesión propia ya abierta devuelve null y no deja rastro', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    assert.ok(startGameSession(fx.ctx, gameId, 'play'));

    assert.equal(startGameSession(fx.ctx, gameId, 'watcher'), null);

    assert.equal(sessionsOfGame(fx.ctx, gameId).length, 1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.equal(eventsOfGame(fx.ctx, gameId).length, 1);
  });

  it('la guarda es por JUEGO: una abierta en un playthrough terminado bloquea igual', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId, type: 'completed', occurredAt: at(0) });
    open(playthroughId, at(hours(1)));

    assert.equal(startGameSession(fx.ctx, gameId, 'watcher'), null);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
  });

  it('una sesión abierta de OTRO juego no bloquea nada', () => {
    const busy = seedGame(fx.ctx, { title: 'Elden Ring' });
    open(seedPlaythrough(fx.ctx, { gameId: busy }));
    const other = seedGame(fx.ctx, { title: 'Celeste' });

    assert.ok(startGameSession(fx.ctx, other, 'watcher'));
    assert.equal(sessionsOfGame(fx.ctx, other).length, 1);
  });

  it('una sesión abierta del mismo juego en OTRO PC no bloquea: se abre la mía (§10.4)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId, type: 'started', occurredAt: at(-hours(1)) });
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });

    const mine = startGameSession(fx.ctx, gameId, 'watcher');

    assert.ok(mine);
    assert.equal(mine.iterationId, playthroughId);
    assert.equal(mine.deviceId, fx.ctx.deviceId);
    // Dos abiertas, una por PC, y la del otro intacta.
    assert.equal(sessionRow(fx.ctx, foreign)?.endedAt, null);
    assert.equal(sessionsOfGame(fx.ctx, gameId).filter((s) => s.endedAt === null).length, 2);
  });

  it('una sesión CERRADA no bloquea: se reanuda el mismo playthrough en pausa', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId, type: 'started', occurredAt: at(-hours(72)) });
    seedSession(fx.ctx, { playthroughId, startedAt: at(-hours(72)) });
    seedStateEvent(fx.ctx, { playthroughId, type: 'on_hold', occurredAt: at(-hours(24)) });

    const session = startGameSession(fx.ctx, gameId, 'watcher');

    assert.equal(session?.iterationId, playthroughId);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [playthroughId]);
  });

  it('si el último playthrough terminó, la sesión cuelga del NUEVO y el viejo no se reabre', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId: first, type: 'started', occurredAt: at(-hours(90)) });
    seedStateEvent(fx.ctx, { playthroughId: first, type: 'completed', occurredAt: at(-hours(9)) });

    const session = startGameSession(fx.ctx, gameId, 'watcher');

    const iterations = playthroughsOf(fx.ctx, gameId);
    assert.equal(iterations.length, 2);
    assert.equal(session?.iterationId, iterations[1].id);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [iterations[1].id]);
  });

  it('una sesión pendiente de emulador abierta no bloquea a ningún juego', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'DuckStation' });
    seedSession(fx.ctx, { emulatorId, endedAt: null });
    const gameId = seedGame(fx.ctx, { title: 'Chrono Trigger', isEmulated: true });

    const session = startGameSession(fx.ctx, gameId, 'watcher');
    assert.ok(session);
    assert.equal(session.endedAt, null);
  });

  it('un juego borrado o inexistente devuelve null sin escribir', () => {
    const gameId = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', gameId);

    assert.equal(startGameSession(fx.ctx, gameId, 'watcher'), null);
    assert.equal(startGameSession(fx.ctx, 'no-existe', 'play'), null);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 0);
  });

  it('un cronómetro vivo del juego lleva su tiempo: no se abre otra', () => {
    const gameId = seedGame(fx.ctx, { title: 'Zelda' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    // Llega por sync desde el móvil: su dueño es otro dispositivo.
    asOtherDevice(fx.ctx).seedSession({
      playthroughId,
      startedBy: 'timer',
      startedAt: at(-hours(2)),
      lastSeenAt: at(-hours(1)),
      endedAt: null,
    });

    assert.equal(startGameSession(fx.ctx, gameId, 'watcher'), null);
  });

  it('un cronómetro RANCIO (24 h sin señal) no bloquea: este PC no puede cerrarlo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Zelda' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    asOtherDevice(fx.ctx).seedSession({
      playthroughId,
      startedBy: 'timer',
      startedAt: at(-hours(30)),
      lastSeenAt: at(-hours(25)),
      endedAt: null,
    });

    assert.ok(startGameSession(fx.ctx, gameId, 'watcher'));
  });

  it('NO cuenta una propia abierta bajo un playthrough borrado, y la puerta tampoco', () => {
    // La sesión huérfana (su playthrough se borró o se fusionó en otro PC
    // mientras se jugaba aquí) ya no existe para nadie: getOpenSessions no la
    // devuelve y el watcher nunca la cerraría. Si contara, el juego no
    // volvería a medirse en este PC (fase 4). La comprobación previa y la red
    // de seguridad de la puerta tienen que coincidir: si la puerta siguiera
    // contándola, lanzaría `open_session` aquí.
    const gameId = seedGame(fx.ctx, { title: 'Carrera' });
    const dead = seedPlaythrough(fx.ctx, { gameId });
    insertSynced(fx.ctx, 'sessions', {
      playthroughId: dead,
      deviceId: fx.ctx.deviceId,
      startedBy: 'watcher',
      source: 'measured',
      startedAt: at(0),
      datePrecision: 'datetime',
    });
    tombstoneOnly(fx.ctx, 'playthroughs', dead);

    const fresh = startGameSession(fx.ctx, gameId, 'watcher');
    assert.ok(fresh);
    assert.notEqual(fresh.iterationId, dead);
  });
});

describe('captureStoreError: un fallo de una sesión no tumba el ciclo', () => {
  it('dentro de la transacción del ciclo deshace solo esa operación', () => {
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });
    const other = seedGame(fx.ctx, { title: 'Y' });
    assert.ok(startGameSession(fx.ctx, gameId, 'play'));
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const pendingId = seedSession(fx.ctx, { emulatorId, endedAt: null });

    const results = fx.ctx.store.transaction(() => [
      captureStoreError(() => assignSession(fx.ctx, pendingId, gameId)),
      captureStoreError(() => startGameSession(fx.ctx, other, 'watcher')),
    ]);

    assert.equal(results[0].ok, false);
    assert.equal(results[1].ok, true);
    assert.equal(sessionRow(fx.ctx, pendingId)?.playthroughId, null);
    assert.equal(sessionsOfGame(fx.ctx, other).length, 1);
  });

  it('un error que no es de la puerta se relanza', () => {
    assert.throws(
      () =>
        captureStoreError(() => {
          throw new Error('fallo de programa');
        }),
      /fallo de programa/,
    );
  });
});

describe('createEmulatorSession: una sesión sin juego por emulador', () => {
  it('abre una pendiente medida, del watcher y de este PC', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });

    const session = createEmulatorSession(fx.ctx, emulatorId);

    assert.equal(session?.iterationId, null);
    assert.equal(session?.emulatorId, emulatorId);
    assert.equal(session?.startedBy, 'watcher');
    assert.equal(session?.deviceId, fx.ctx.deviceId);
    assert.equal(session?.endedAt, null);
    assert.equal(session?.lastHeartbeatAt?.getTime(), session?.startedAt.getTime());
  });

  it('con una propia abierta del mismo emulador (asignada o no) devuelve null', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    assert.ok(createEmulatorSession(fx.ctx, emulatorId));
    assert.equal(createEmulatorSession(fx.ctx, emulatorId), null);

    // Asignada en caliente sigue siendo la del proceso vigilado.
    const other = seedEmulator(fx.ctx, { name: 'Dolphin' });
    const gameId = seedGame(fx.ctx, { title: 'Metroid Prime', isEmulated: true });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedSession(fx.ctx, { playthroughId, emulatorId: other, endedAt: null });
    assert.equal(createEmulatorSession(fx.ctx, other), null);
  });

  it('una abierta del mismo emulador en OTRO PC no bloquea', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    asOtherDevice(fx.ctx).seedSession({ emulatorId, endedAt: null });
    assert.ok(createEmulatorSession(fx.ctx, emulatorId));
  });

  it('un emulador borrado o inexistente devuelve null', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    fx.ctx.store.remove('emulators', emulatorId);
    assert.equal(createEmulatorSession(fx.ctx, emulatorId), null);
    assert.equal(createEmulatorSession(fx.ctx, 'no-existe'), null);
  });
});

describe('assignSession: la sesión de emulador encuentra su juego (EMULADORES.md §6)', () => {
  const pending = (startedAt: string, durationHours: number | null): string => {
    const emulatorId = seedEmulator(fx.ctx, { name: `Emu ${startedAt}` });
    const start = new Date(startedAt);
    return seedSession(fx.ctx, {
      emulatorId,
      startedAt: start,
      endedAt: durationHours === null ? null : new Date(start.getTime() + hours(durationHours)),
    });
  };

  it('asigna el playthrough, conserva el emulador y fecha el arranque en cuando SE JUGÓ', () => {
    const sessionId = pending('2026-07-20T21:00:00Z', 2);
    const emulatorId = sessionRow(fx.ctx, sessionId)?.emulatorId;
    const gameId = seedGame(fx.ctx, { title: 'Silent Hill', isEmulated: true });

    const assigned = assignSession(fx.ctx, sessionId, gameId);

    const iterations = playthroughsOf(fx.ctx, gameId);
    assert.equal(iterations.length, 1);
    assert.equal(assigned?.iterationId, iterations[0].id);
    assert.equal(iterations[0].playedPlatform, 'Emulated');
    assert.equal(assigned?.emulatorId, emulatorId);
    assert.equal(assigned?.durationSec, 7200);
    assert.deepEqual(
      eventsOfGame(fx.ctx, gameId).map((e) => [e.type, e.occurredAt.toISOString()]),
      [['started', '2026-07-20T21:00:00.000Z']],
    );
  });

  it('un juego no emulado la rechaza y no deja rastro', () => {
    const sessionId = pending('2026-07-20T21:00:00Z', 2);
    const gameId = seedGame(fx.ctx, { title: 'Celeste', isEmulated: false });

    assert.throws(() => assignSession(fx.ctx, sessionId, gameId), /no está marcado como emulado/);

    assert.equal(sessionRow(fx.ctx, sessionId)?.playthroughId, null);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 0);
  });

  it('una sesión que ya tiene playthrough no se reasigna a otro juego', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'DuckStation' });
    const first = seedGame(fx.ctx, { title: 'Silent Hill', isEmulated: true });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: first });
    const sessionId = seedSession(fx.ctx, { playthroughId, emulatorId });
    const other = seedGame(fx.ctx, { title: 'Resident Evil', isEmulated: true });

    assert.throws(() => assignSession(fx.ctx, sessionId, other), /ya está asignada/);
    assert.equal(sessionRow(fx.ctx, sessionId)?.playthroughId, playthroughId);
    assert.equal(playthroughsOf(fx.ctx, other).length, 0);
  });

  it('una sesión inexistente o borrada devuelve null; un juego inexistente o borrado revienta', () => {
    const sessionId = pending('2026-07-20T21:00:00Z', 2);
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });
    const deadGame = seedGame(fx.ctx, { title: 'Y', isEmulated: true });
    fx.ctx.store.remove('games', deadGame);
    const deadSession = pending('2026-07-21T21:00:00Z', 1);
    fx.ctx.store.remove('sessions', deadSession);

    assert.equal(assignSession(fx.ctx, 'no-existe', gameId), null);
    assert.equal(assignSession(fx.ctx, deadSession, gameId), null);
    assert.throws(() => assignSession(fx.ctx, sessionId, 'no-existe'), /No existe el juego/);
    assert.throws(() => assignSession(fx.ctx, sessionId, deadGame), /No existe el juego/);
  });

  it('SPEC 4.5: una sesión retroactiva se cuelga del playthrough activo HOY', () => {
    const gameId = seedGame(fx.ctx, { title: 'Chrono Trigger', isEmulated: true });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    const ev = (type: 'started' | 'completed', iso: string): void => {
      seedStateEvent(fx.ctx, { playthroughId, type, occurredAt: new Date(iso) });
    };
    ev('started', '2026-07-01T10:00:00Z');
    ev('completed', '2026-07-10T23:00:00Z');
    ev('started', '2026-08-01T18:00:00Z');
    const sessionId = pending('2026-07-20T21:00:00Z', 2);

    const assigned = assignSession(fx.ctx, sessionId, gameId);

    assert.equal(assigned?.iterationId, playthroughId);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.equal(eventsOfGame(fx.ctx, gameId).length, 3);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [playthroughId]);
  });

  it('si el destino ya arrancó DESPUÉS de la sesión, no se le añade un segundo "Started"', () => {
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, {
      playthroughId,
      type: 'started',
      occurredAt: new Date('2026-07-25T10:00:00Z'),
    });
    seedStateEvent(fx.ctx, {
      playthroughId,
      type: 'on_hold',
      occurredAt: new Date('2026-08-01T10:00:00Z'),
    });
    const sessionId = pending('2026-07-20T21:00:00Z', 2);

    const assigned = assignSession(fx.ctx, sessionId, gameId);

    assert.equal(assigned?.iterationId, playthroughId);
    assert.deepEqual(typesOf(fx.ctx, playthroughId), ['started', 'on_hold']);
  });

  it('una sesión de emulador todavía en marcha se puede asignar: sigue abierta y ya con dueño', () => {
    const sessionId = pending('2026-07-20T21:00:00Z', null);
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });

    const assigned = assignSession(fx.ctx, sessionId, gameId);

    assert.equal(assigned?.endedAt, null);
    assert.ok(assigned?.iterationId);
    assert.equal(startGameSession(fx.ctx, gameId, 'watcher'), null);
  });

  it('se puede asignar la sesión de OTRO PC (§7.4)', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const foreign = asOtherDevice(fx.ctx).seedSession({ emulatorId });
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });

    const assigned = assignSession(fx.ctx, foreign, gameId);

    assert.ok(assigned?.iterationId);
    assert.equal(assigned?.deviceId, OTHER);
  });

  it('asignar en caliente a un juego que ya tiene otra propia abierta lo para la puerta', () => {
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });
    assert.ok(startGameSession(fx.ctx, gameId, 'play'));
    const sessionId = pending('2026-07-20T21:00:00Z', null);

    const result = captureStoreError(() => assignSession(fx.ctx, sessionId, gameId));

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error instanceof StoreError);
    assert.equal(!result.ok && result.error.code, 'open_session');
    // Nada a medias: la sesión sigue sin asignar.
    assert.equal(sessionRow(fx.ctx, sessionId)?.playthroughId, null);
  });
});

describe('updateSessionNote', () => {
  it('guarda la nota recortada; vacía es null', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const sessionId = seedSession(fx.ctx, { playthroughId });

    assert.equal(updateSessionNote(fx.ctx, sessionId, '  jefe final  ')?.note, 'jefe final');
    assert.equal(updateSessionNote(fx.ctx, sessionId, '   ')?.note, null);
  });

  it('se puede anotar la sesión de otro PC; una inexistente o borrada es null', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });
    const gone = seedSession(fx.ctx, { playthroughId });
    fx.ctx.store.remove('sessions', gone);

    assert.equal(updateSessionNote(fx.ctx, foreign, 'desde aquí')?.note, 'desde aquí');
    assert.equal(updateSessionNote(fx.ctx, 'no-existe', 'x'), null);
    assert.equal(updateSessionNote(fx.ctx, gone, 'x'), null);
  });
});

describe('deleteSession y deletePendingSession: una sesión abierta no se borra', () => {
  it('borra (lápida) una sesión cerrada y anula los desbloqueos que colgaban de ella', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    const sessionId = seedSession(fx.ctx, { playthroughId });
    const unlockId = seedUnlock(fx.ctx, { gameId, apiName: 'ACH_1', sessionId });

    assert.equal(deleteSession(fx.ctx, sessionId), true);

    assert.notEqual(sessionRow(fx.ctx, sessionId)?.syncDeleted, null);
    const unlock = fx.local.db.$client
      .prepare('SELECT sessionId, syncDeleted FROM achievement_unlocks WHERE id = ?')
      .get(unlockId);
    assert.equal(unlock?.sessionId, null);
    assert.equal(unlock?.syncDeleted, null);
  });

  it('una sesión abierta (propia o de otro PC) se niega a borrarse y sigue ahí', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const mine = open(playthroughId);
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });

    assert.throws(() => deleteSession(fx.ctx, mine), /sigue abierta/);
    assert.throws(() => deleteSession(fx.ctx, foreign), /sigue abierta/);
    assert.equal(sessionRow(fx.ctx, mine)?.syncDeleted, null);
    assert.equal(sessionRow(fx.ctx, foreign)?.syncDeleted, null);
  });

  it('una cerrada de otro PC sí se borra', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId });
    assert.equal(deleteSession(fx.ctx, foreign), true);
  });

  it('borrar una que no existe o ya borrada es false, no una excepción', () => {
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const sessionId = seedSession(fx.ctx, { playthroughId });
    assert.equal(deleteSession(fx.ctx, sessionId), true);
    assert.equal(deleteSession(fx.ctx, sessionId), false);
    assert.equal(deleteSession(fx.ctx, 'no-existe'), false);
  });

  it('borrar la sesión no toca el historial', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId, type: 'started' });
    const sessionId = seedSession(fx.ctx, { playthroughId });

    assert.equal(deleteSession(fx.ctx, sessionId), true);
    assert.deepEqual(typesOf(fx.ctx, playthroughId), ['started']);
  });

  it('una pendiente EN MARCHA no se descarta; una cerrada sí; una asignada nunca', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'DuckStation' });
    const running = seedSession(fx.ctx, { emulatorId, endedAt: null });
    const closed = seedSession(fx.ctx, { emulatorId, startedAt: at(-hours(5)) });
    const playthroughId = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'A' }) });
    const assigned = seedSession(fx.ctx, { playthroughId, emulatorId });

    assert.equal(deletePendingSession(fx.ctx, running), false);
    assert.equal(deletePendingSession(fx.ctx, assigned), false);
    assert.equal(deletePendingSession(fx.ctx, closed), true);
    assert.equal(deletePendingSession(fx.ctx, closed), false);
    assert.equal(sessionRow(fx.ctx, running)?.syncDeleted, null);
    assert.equal(sessionRow(fx.ctx, assigned)?.syncDeleted, null);
  });
});
