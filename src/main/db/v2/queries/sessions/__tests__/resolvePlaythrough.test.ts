import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { effectivePlaythroughLabel, playthroughPositions } from '../../common';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedStateEvent,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { resolvePlaythroughForSession } from '../resolvePlaythrough';
import { activePlaythroughs, eventsOf, playthroughsOf, typesOf, withNow } from './helpers';

// "¿En qué playthrough cae jugar a este juego?" sobre el esquema 2.0. Porta
// `src/main/db/__tests__/resolveIterationForPlay.test.ts`: lo que se comprueba
// es qué quedó ESCRITO en el log de estados, no qué consulta se hizo.
//
// Hay dos fechas: `at` (a la que se pregunta) y "hoy" (`ctx.now()`, cuándo se
// decide). `jugarEn` las mueve por separado sin tocar el reloj de la puerta,
// así los ids siguen saliendo en orden de creación.
//
// Casos de la 1.x que no se portan: "un plan_to_play posterior no borra el
// desenlace" (el tipo `plan_to_play` ya no existe en `state_events`, F-12).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const jugarEn = (gameId: string, at: string, now: string = at): string =>
  resolvePlaythroughForSession(withNow(fx.ctx, new Date(now)), gameId, new Date(at)).playthroughId;

const evento = (
  playthroughId: string,
  type: 'started' | 'completed' | 'dropped' | 'on_hold' | 'resting',
  occurredAt: string,
): void => {
  seedStateEvent(fx.ctx, { playthroughId, type, occurredAt: new Date(occurredAt) });
};

/** Las etiquetas que enseñaría la app para los playthroughs vivos del juego. */
const etiquetas = (gameId: string): string[] => {
  const positions = playthroughPositions(fx.ctx, [gameId]);
  return playthroughsOf(fx.ctx, gameId).map((row) =>
    effectivePlaythroughLabel(row.customLabel, positions.get(row.id) ?? 0),
  );
};

describe('resolvePlaythroughForSession: cuando ya hay algo en marcha', () => {
  it('el playthrough activo en esa fecha se reanuda sin escribir un segundo started', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');

    const result = resolvePlaythroughForSession(
      withNow(fx.ctx, new Date('2026-01-12T21:00:00Z')),
      gameId,
      new Date('2026-01-12T21:00:00Z'),
    );

    assert.deepEqual(result, { playthroughId: p1, kind: 'use' });
    assert.deepEqual(typesOf(fx.ctx, p1), ['started']);
  });

  it('pulsar Play dos veces no apila dos started: el segundo ya lo encuentra activo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedPlaythrough(fx.ctx, { gameId });

    const primera = jugarEn(gameId, '2026-02-01T18:00:00Z');
    const segunda = jugarEn(gameId, '2026-02-01T18:00:30Z');

    assert.equal(segunda, primera);
    assert.deepEqual(typesOf(fx.ctx, primera), ['started']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [primera]);
  });

  it('una pausa no es un final: el on_hold se reanuda en el mismo playthrough', () => {
    const gameId = seedGame(fx.ctx, { title: 'Disco Elysium' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    evento(p1, 'on_hold', '2026-01-20T23:00:00Z');

    const destino = jugarEn(gameId, '2026-02-01T19:00:00Z');

    assert.equal(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'on_hold', 'started']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [p1]);
  });

  it('el playthrough recién creado por el alta, sin un solo evento, es el destino', () => {
    const gameId = seedGame(fx.ctx, { title: 'Outer Wilds' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });

    const destino = jugarEn(gameId, '2026-03-05T20:00:00Z');

    assert.equal(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started']);
  });

  it('el evento que escribe lleva precisión de instante y el dispositivo de este PC', () => {
    const gameId = seedGame(fx.ctx, { title: 'Tunic' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });

    jugarEn(gameId, '2026-03-05T20:00:00Z');

    const [started] = eventsOf(fx.ctx, p1);
    assert.equal(started.datePrecision, 'datetime');
    assert.equal(started.deviceId, fx.ctx.deviceId);
    assert.equal(started.note, null);
    assert.equal(started.occurredAt.toISOString(), '2026-03-05T20:00:00.000Z');
  });
});

describe('resolvePlaythroughForSession: cuando el último playthrough terminó', () => {
  it('tras un Beaten, volver a jugar abre el siguiente playthrough con su propio started', () => {
    const gameId = seedGame(fx.ctx, { title: 'Dark Souls' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    evento(p1, 'completed', '2026-02-01T23:30:00Z');

    const result = resolvePlaythroughForSession(
      withNow(fx.ctx, new Date('2026-02-10T19:00:00Z')),
      gameId,
      new Date('2026-02-10T19:00:00Z'),
    );

    assert.equal(result.kind, 'create');
    assert.notEqual(result.playthroughId, p1);
    assert.deepEqual(etiquetas(gameId), ['Playthrough 1', 'Playthrough 2']);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'completed']);
    const eventos = eventsOf(fx.ctx, result.playthroughId);
    assert.deepEqual(
      eventos.map((e) => e.type),
      ['started'],
    );
    assert.equal(eventos[0].occurredAt.toISOString(), '2026-02-10T19:00:00.000Z');
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [result.playthroughId]);
  });

  it('el playthrough nuevo se crea sin etiqueta propia ni horas manuales', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hades II' });

    const destino = jugarEn(gameId, '2026-02-10T19:00:00Z');

    const [created] = playthroughsOf(fx.ctx, gameId);
    assert.equal(created.id, destino);
    assert.equal(created.customLabel, null);
    assert.equal(created.manualHours, null);
    assert.equal(created.origin, 'Purchased');
    assert.equal(created.format, 'digital');
  });

  it('un Dropped cierra igual que un Beaten: también abre uno nuevo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Kenshi' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    evento(p1, 'dropped', '2026-01-25T22:00:00Z');

    const destino = jugarEn(gameId, '2026-04-01T18:00:00Z');

    assert.notEqual(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 2);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [destino]);
  });

  it('un juego sin ninguna iteración estrena Playthrough 1', () => {
    const gameId = seedGame(fx.ctx, { title: 'Factorio' });

    const destino = jugarEn(gameId, '2026-05-01T17:00:00Z');

    const iteraciones = playthroughsOf(fx.ctx, gameId);
    assert.equal(iteraciones.length, 1);
    assert.equal(iteraciones[0].id, destino);
    assert.deepEqual(etiquetas(gameId), ['Playthrough 1']);
    assert.deepEqual(typesOf(fx.ctx, destino), ['started']);
  });

  it('el playthrough nuevo nace en la plataforma del juego: Emulated manda sobre la oficial', () => {
    // Las plataformas oficiales vienen ahora de la caché (`game_metadata`).
    const emulado = seedGame(fx.ctx, {
      title: 'Chrono Trigger',
      isEmulated: true,
      metadata: { officialPlatforms: ['Super Nintendo'] },
    });
    const consola = seedGame(fx.ctx, {
      title: 'Bloodborne',
      metadata: { officialPlatforms: ['PlayStation 4'] },
    });
    const sinPlataformas = seedGame(fx.ctx, { title: 'Juego sin ficha' });

    jugarEn(emulado, '2026-06-01T18:00:00Z');
    jugarEn(consola, '2026-06-01T18:00:00Z');
    jugarEn(sinPlataformas, '2026-06-01T18:00:00Z');

    assert.equal(playthroughsOf(fx.ctx, emulado)[0].playedPlatform, 'Emulated');
    assert.equal(playthroughsOf(fx.ctx, consola)[0].playedPlatform, 'PlayStation 4');
    assert.equal(playthroughsOf(fx.ctx, sinPlataformas)[0].playedPlatform, 'PC');
  });

  it('el número del nuevo es su posición, contando el playthrough borrado del medio (R-03)', () => {
    // En la 1.x la etiqueta se guardaba y salía del número más alto ya usado.
    // En la 2.0 es la posición contando también los borrados: tras borrar el
    // 2, el siguiente sigue siendo el 4 y no repite "Playthrough 3".
    const gameId = seedGame(fx.ctx, { title: 'Baldurs Gate 3' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'completed', '2026-01-20T22:00:00Z');
    const p2 = seedPlaythrough(fx.ctx, { gameId });
    const p3 = seedPlaythrough(fx.ctx, { gameId });
    evento(p3, 'completed', '2026-02-20T22:00:00Z');
    fx.ctx.store.remove('playthroughs', p2);

    const destino = jugarEn(gameId, '2026-03-01T18:00:00Z');

    const iteraciones = playthroughsOf(fx.ctx, gameId);
    assert.equal(iteraciones.length, 3);
    assert.equal(iteraciones[2].id, destino);
    assert.deepEqual(etiquetas(gameId), ['Playthrough 1', 'Playthrough 3', 'Playthrough 4']);
  });

  it('con los playthroughs rebautizados a mano, el nuevo es "Playthrough 3"', () => {
    const gameId = seedGame(fx.ctx, { title: 'Dragon Quest XI' });
    const primera = seedPlaythrough(fx.ctx, { gameId, customLabel: 'Primera vuelta' });
    evento(primera, 'completed', '2026-01-20T22:00:00Z');
    const ngPlus = seedPlaythrough(fx.ctx, { gameId, customLabel: 'NG+' });
    evento(ngPlus, 'completed', '2026-02-20T22:00:00Z');

    jugarEn(gameId, '2026-03-01T18:00:00Z');

    assert.deepEqual(etiquetas(gameId), ['Primera vuelta', 'NG+', 'Playthrough 3']);
  });

  it('un endless no tiene playthroughs discretos: ni un Dropped le abre un Playthrough 2', () => {
    const gameId = seedGame(fx.ctx, { title: 'Slay the Spire', endless: true });
    const unico = seedPlaythrough(fx.ctx, { gameId, customLabel: 'Endless' });
    evento(unico, 'started', '2026-01-05T18:00:00Z');
    evento(unico, 'dropped', '2026-03-01T21:00:00Z');

    const destino = jugarEn(gameId, '2026-07-01T18:00:00Z');

    assert.equal(destino, unico);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.deepEqual(typesOf(fx.ctx, unico), ['started', 'dropped', 'started']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [unico]);
  });
});

describe('resolvePlaythroughForSession: la foto se toma en `at`, no hoy', () => {
  it('la sesión de julio cae en el playthrough que seguía abierto en julio, aunque hoy esté Beaten', () => {
    const gameId = seedGame(fx.ctx, { title: 'Elden Ring', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-07-10T18:00:00Z');
    evento(p1, 'completed', '2026-08-01T23:00:00Z');

    const destino = jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-10T12:00:00Z');

    assert.equal(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'completed']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), []);
  });

  it('si a esa fecha ya había terminado, el playthrough nuevo nace fechado en la sesión Y ya cerrado', () => {
    const gameId = seedGame(fx.ctx, { title: 'Super Metroid', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-06-01T18:00:00Z');
    evento(p1, 'completed', '2026-07-01T22:00:00Z');

    const destino = jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.notEqual(destino, p1);
    const eventos = eventsOf(fx.ctx, destino);
    // El empate de instante lo deshace el orden de creación: `completed` último.
    assert.deepEqual(
      eventos.map((e) => e.type),
      ['started', 'completed'],
    );
    assert.deepEqual(
      eventos.map((e) => e.occurredAt.toISOString()),
      ['2026-07-20T21:00:00.000Z', '2026-07-20T21:00:00.000Z'],
    );
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), []);
  });

  it('la misma jugada, pero de hoy, sí deja el juego Playing', () => {
    // Fechas sin Z a propósito: hora LOCAL, la que usa el corte por día.
    const gameId = seedGame(fx.ctx, { title: 'Hollow Knight: Silksong', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-06-01T18:00:00Z');
    evento(p1, 'completed', '2026-07-01T22:00:00Z');

    const destino = jugarEn(gameId, '2026-08-13T17:00:00', '2026-08-13T22:30:00');

    assert.notEqual(destino, p1);
    assert.deepEqual(typesOf(fx.ctx, destino), ['started']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [destino]);
  });

  it('varias sesiones viejas del mismo tirón caen en el mismo playthrough, no una por sesión', () => {
    const gameId = seedGame(fx.ctx, { title: 'Chrono Trigger', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-06-01T18:00:00Z');
    evento(p1, 'completed', '2026-07-01T22:00:00Z');

    const hoy = '2026-08-13T12:00:00Z';
    const primeraTarde = jugarEn(gameId, '2026-07-20T21:00:00Z', hoy);
    const segundaTarde = jugarEn(gameId, '2026-07-21T20:00:00Z', hoy);
    const terceraTarde = jugarEn(gameId, '2026-07-23T19:00:00Z', hoy);

    assert.equal(segundaTarde, primeraTarde);
    assert.equal(terceraTarde, primeraTarde);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 2);
    assert.deepEqual(typesOf(fx.ctx, primeraTarde), ['started', 'completed']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), []);
  });

  it('un playthrough terminado A MANO no se reabre con una sesión vieja: esa sí estrena otro', () => {
    const gameId = seedGame(fx.ctx, { title: 'Silent Hill 2', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-07-01T18:00:00Z');
    evento(p1, 'completed', '2026-07-01T22:00:00Z');

    const destino = jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.notEqual(destino, p1);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'completed']);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 2);
    assert.deepEqual(
      eventsOf(fx.ctx, p1).map((e) => e.occurredAt.toISOString()),
      ['2026-07-01T18:00:00.000Z', '2026-07-01T22:00:00.000Z'],
    );
  });

  it('el PRIMER playthrough de un juego sí nace abierto, aunque la sesión sea vieja', () => {
    const gameId = seedGame(fx.ctx, { title: 'Suikoden II', isEmulated: true });

    const destino = jugarEn(gameId, '2026-08-05T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.deepEqual(typesOf(fx.ctx, destino), ['started']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [destino]);
  });

  it('reanudar un playthrough pausado con una sesión vieja no lo cierra: sigue en marcha', () => {
    const gameId = seedGame(fx.ctx, { title: 'Vagrant Story', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-05-01T18:00:00Z');
    evento(p1, 'on_hold', '2026-06-10T21:00:00Z');

    const destino = jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.equal(destino, p1);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'on_hold', 'started']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [p1]);
  });

  it('si la iteración ya tiene un started en `at` o después, no se le escribe otro', () => {
    const gameId = seedGame(fx.ctx, { title: 'Metroid Prime', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-08-01T18:00:00Z');
    evento(p1, 'completed', '2026-08-15T22:00:00Z');

    const destino = jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-20T12:00:00Z');

    assert.equal(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'completed']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), []);
  });
});

describe('resolvePlaythroughForSession: como mucho un playthrough activo por juego', () => {
  it('con uno vivo hoy, la sesión retroactiva cae en él aunque a su fecha todo estuviera terminado', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hades', isEmulated: true });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    evento(p1, 'completed', '2026-03-01T22:00:00Z');
    evento(p1, 'started', '2026-08-01T18:00:00Z');
    const p2 = seedPlaythrough(fx.ctx, { gameId });
    evento(p2, 'started', '2026-05-01T18:00:00Z');
    evento(p2, 'dropped', '2026-06-15T20:00:00Z');

    const destino = jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.equal(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 2);
    assert.deepEqual(typesOf(fx.ctx, p1), ['started', 'completed', 'started']);
    assert.deepEqual(typesOf(fx.ctx, p2), ['started', 'dropped']);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [p1]);
  });

  it('una jugada nueva sobre un juego con un hermano activo no abre un segundo activo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Persona 5' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    evento(p1, 'completed', '2026-02-20T22:00:00Z');
    const p2 = seedPlaythrough(fx.ctx, { gameId });
    evento(p2, 'started', '2026-03-01T18:00:00Z');

    const destino = jugarEn(gameId, '2026-03-15T19:00:00Z');

    assert.equal(destino, p2);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 2);
    assert.deepEqual(activePlaythroughs(fx.ctx, gameId), [p2]);
  });
});

describe('resolvePlaythroughForSession: solo filas vivas (F-11)', () => {
  it('un playthrough activo con lápida no es destino: se abre uno nuevo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    fx.ctx.store.remove('playthroughs', p1);

    const destino = jugarEn(gameId, '2026-02-01T18:00:00Z');

    assert.notEqual(destino, p1);
    // Su posición cuenta el borrado: "Playthrough 2".
    assert.deepEqual(etiquetas(gameId), ['Playthrough 2']);
  });

  it('un evento con lápida no cuenta: el Beaten borrado deja el playthrough sin terminar', () => {
    const gameId = seedGame(fx.ctx, { title: 'Ori' });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    evento(p1, 'started', '2026-01-10T18:00:00Z');
    const beaten = seedStateEvent(fx.ctx, {
      playthroughId: p1,
      type: 'completed',
      occurredAt: new Date('2026-01-20T18:00:00Z'),
    });
    tombstoneOnly(fx.ctx, 'state_events', beaten);

    const destino = jugarEn(gameId, '2026-02-01T18:00:00Z');

    assert.equal(destino, p1);
    assert.equal(playthroughsOf(fx.ctx, gameId).length, 1);
  });

  it('un juego borrado es un error de quien llama', () => {
    const gameId = seedGame(fx.ctx, { title: 'Borrado' });
    fx.ctx.store.remove('games', gameId);
    assert.throws(() => jugarEn(gameId, '2026-02-01T18:00:00Z'), /No existe el juego/);
  });
});
