import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { GameListItem } from '../../../shared/types';
import { sessionsTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeOpenSession,
  makeSession,
  makeStateEvent,
  type TestDb,
} from './harness';

// getGames es la consulta que alimenta MEDIA APP: la biblioteca, el rail de
// navegación, Sessions, Stats y el hero del modo TV leen todos de aquí vía
// useGames(). Y casi nada de lo que devuelve está guardado en ninguna columna:
// las horas, el nº de sesiones, si el juego está en marcha, cuándo se jugó por
// última vez y en qué estado está se DERIVAN al leer, de las sesiones y del
// log de estados. Ese cálculo es justo lo que un refactor rompe sin que salte
// ningún tipo — el número sigue saliendo, solo que mal.
//
// Por eso estos tests van contra la base real del andamio (ver harness.ts) y
// comprueban RESULTADOS, no consultas.
//
// Para lanzarlo solo:
//   npx tsx --test --experimental-test-module-mocks src/main/db/__tests__/getGames.test.ts

let db: TestDb;
let getGames: typeof import('../queries/games/getGames').getGames;

// El módulo bajo prueba se importa DENTRO del before(): el mock.module de la
// DB (registrado al cargar el andamio) tiene que estar puesto antes de que
// getGames resuelva su `getDb`. Un import normal arriba lo cargaría antes.
before(async () => {
  ({ getGames } = await import('../queries/games/getGames'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// ── Ayudas locales ─────────────────────────────────────────────────────────
// Casi todos los casos de aquí montan UN juego y miran qué sale: leerlo así
// deja cada test hablando de la regla y no de índices de array.

const onlyGame = async (): Promise<GameListItem> => {
  const games = await getGames();
  assert.equal(games.length, 1, 'este escenario debería devolver un único juego');
  return games[0];
};

const gameNamed = async (title: string): Promise<GameListItem> => {
  const games = await getGames();
  const found = games.find((game) => game.title === title);
  assert.ok(found, `no salió "${title}" en la lista`);
  return found;
};

// Una sesión de emulador SIN ASIGNAR (EMULADORES.md §5): la bandeja "Pending".
// No tiene iterationId todavía, o sea que no pertenece a ningún juego. No está
// en el andamio compartido porque es un dato deliberadamente incompleto y solo
// lo necesita el caso de aquí abajo.
const makeUnassignedEmulatorSession = async (startedAt: string, hours: number): Promise<void> => {
  const start = new Date(startedAt);
  await db.insert(sessionsTable).values({
    iterationId: null,
    isManual: false,
    startedAt: start,
    endedAt: new Date(start.getTime() + hours * 3600 * 1000),
    durationSec: Math.round(hours * 3600),
    datePrecision: 'datetime',
  });
};

// ══ HORAS ═════════════════════════════════════════════════════════════════

describe('getGames · las horas de un juego', () => {
  it('las horas manuales se SUMAN a las trackeadas del mismo playthrough, no las reemplazan', async () => {
    // La cicatriz vive escrita en iterationHours.ts: antes reemplazaba. Un
    // playthrough con horas manuales ("me lo jugué en PS4 antes de tener
    // Afterplay") al que el watcher le sigue colgando sesiones se quedaba
    // CLAVADO en el número manual para siempre — las sesiones se guardaban, se
    // veían en el Session History, y el total las ignoraba. Son tiempos
    // disjuntos: uno es lo que jugaste fuera, otro lo que se midió aquí.
    const gameId = await makeGame(db, { title: 'Elden Ring' });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 90 });
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);
    await makeSession(db, iterationId, '2026-01-11T18:00:00Z', 1.5);

    assert.equal((await onlyGame()).totalHours, 93.5);
  });

  it('el total del juego es la suma de sus playthroughs, cada uno resuelto por su cuenta', async () => {
    // Las horas se agrupan por ITERACIÓN antes de sumarse por juego. Hoy da
    // igual porque sumar es lineal, pero el día que la resolución por
    // playthrough deje de serlo (un tope, un "manda el manual") este test es
    // el que dice qué esperaba el resto de la app.
    const gameId = await makeGame(db, { title: 'Hollow Knight' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const steelSoul = await makeIteration(db, gameId, {
      label: 'Steel Soul',
      manualTotalPlayed: 10,
    });
    await makeSession(db, first, '2026-01-10T18:00:00Z', 1);
    await makeSession(db, steelSoul, '2026-02-10T18:00:00Z', 3);

    assert.equal((await onlyGame()).totalHours, 14);
  });

  it('la sesión que está en marcha todavía no aporta horas: entran al cerrarla', async () => {
    // Una sesión abierta no tiene durationSec, y aquí no se inventa con
    // (ahora - startedAt): si se inventara, el total cambiaría en cada
    // refresco de la lista y al cerrar la sesión el rato se contaría otra vez.
    // El juego SÍ sale en marcha y la sesión SÍ cuenta para el contador — lo
    // único que espera es el tiempo.
    const gameId = await makeGame(db, { title: 'Balatro' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);
    await makeOpenSession(db, iterationId, '2026-01-11T20:00:00Z');

    const game = await onlyGame();
    assert.equal(game.totalHours, 2);
    assert.equal(game.sessionCount, 2);
    assert.equal(game.isLive, true);
  });

  it('un juego sin playthroughs sale entero y a cero, no desaparece ni revienta', async () => {
    // El juego recién dado de alta sin tocar (Unplayed) es el caso más común
    // de una biblioteca grande, y pasa por todos los Map.get()?? de la query.
    await makeGame(db, { title: 'Silksong', addedAt: new Date('2026-01-05T12:00:00Z') });

    const game = await onlyGame();
    assert.equal(game.totalHours, 0);
    assert.equal(game.sessionCount, 0);
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
    assert.equal(game.currentState, null);
    assert.equal(game.lastPlayedAt, null);
    assert.deepEqual(game.manualIterations, []);
  });

  it('una sesión de emulador sin asignar no le suma horas ni sesiones a nadie', async () => {
    // EMULADORES.md §5: mientras vive en la bandeja "Pending" no pertenece a
    // ningún playthrough (iterationId null). El inner join con iterations es
    // lo único que la deja fuera; cambiarlo a un left join metería tiempo de
    // un juego sin identificar en la biblioteca.
    const gameId = await makeGame(db, { title: 'Chrono Trigger', isEmulated: true });
    const iterationId = await makeIteration(db, gameId, { playedPlatform: 'SNES' });
    await makeSession(db, iterationId, '2026-03-01T18:00:00Z', 1);
    await makeUnassignedEmulatorSession('2026-03-02T18:00:00Z', 5);

    const game = await onlyGame();
    assert.equal(game.totalHours, 1);
    assert.equal(game.sessionCount, 1);
  });
});

// ══ SESIONES Y "EN VIVO" ══════════════════════════════════════════════════

describe('getGames · el contador de sesiones y el badge PLAYING', () => {
  it('la sesión abierta cuenta como una sesión más', async () => {
    // Fallo real: el overlay in-game le sumaba +1 "por la sesión de ahora"
    // dando por hecho que esto contaba solo las cerradas, y todo juego en
    // marcha enseñaba una sesión de más. Aquí NO hay filtro por endedAt y no
    // lo tiene que haber.
    const gameId = await makeGame(db, { title: 'Hades' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 1);
    await makeSession(db, iterationId, '2026-01-11T18:00:00Z', 1);
    await makeOpenSession(db, iterationId, '2026-01-12T18:00:00Z');

    assert.equal((await onlyGame()).sessionCount, 3);
  });

  it('cuenta las sesiones de todos los playthroughs, y cada una una sola vez', async () => {
    // El join con iterations es el sitio donde una fila se duplica sin avisar:
    // si el juego tiene dos playthroughs y el join se hace mal, cada sesión
    // aparece dos veces y el contador (y las horas) se doblan.
    const gameId = await makeGame(db, { title: 'Dark Souls' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const second = await makeIteration(db, gameId, { label: 'NG+' });
    await makeSession(db, first, '2026-01-10T18:00:00Z', 1);
    await makeSession(db, first, '2026-01-11T18:00:00Z', 1);
    await makeSession(db, second, '2026-05-01T18:00:00Z', 1);

    const game = await onlyGame();
    assert.equal(game.sessionCount, 3);
    assert.equal(game.totalHours, 3);
  });

  it('está en vivo desde que arrancó la sesión abierta, no desde la última cerrada', async () => {
    // SPEC 10.7 pide el contador en vivo junto al badge PLAYING: saber que
    // está en marcha no basta, hace falta desde cuándo. Con una sesión cerrada
    // detrás para que se note que liveSince no es "la última sesión".
    const gameId = await makeGame(db, { title: 'Vampire Survivors' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-02T10:00:00Z', 2);
    await makeOpenSession(db, iterationId, '2026-01-12T21:15:00Z');

    const game = await onlyGame();
    assert.equal(game.isLive, true);
    assert.equal(game.liveSince?.toISOString(), '2026-01-12T21:15:00.000Z');
  });

  it('sin ninguna sesión abierta el juego no está en vivo', async () => {
    const gameId = await makeGame(db, { title: 'Tunic' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-02T10:00:00Z', 2);

    const game = await onlyGame();
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
  });

  it('con dos sesiones abiertas a la vez manda el arranque más reciente', async () => {
    // ARREGLADO (antes era caracterización de un empate sin criterio): SPEC 4.5
    // dice que como mucho hay un playthrough activo, pero la BD no lo impone —
    // una sesión que el watcher nunca cerró más otra abierta después dejan dos
    // filas abiertas del mismo juego. liveSince es un Map por juego y antes la
    // última FILA LEÍDA pisaba a la anterior, sin ORDER BY que lo fijara: el
    // contador en vivo de la card arrancaba en un sitio u otro según el plan de
    // la consulta. Ahora el criterio está escrito: gana el arranque más
    // reciente, que es la sesión que de verdad está en marcha (la vieja es la
    // huérfana), y así liveSince y lastPlayedAt cuentan lo mismo.
    const gameId = await makeGame(db, { title: 'Deep Rock Galactic' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeOpenSession(db, first, '2026-04-01T18:00:00Z');
    await makeOpenSession(db, second, '2026-04-01T19:00:00Z');

    const game = await onlyGame();
    assert.equal(game.isLive, true);
    assert.equal(game.sessionCount, 2);
    assert.equal(game.liveSince?.toISOString(), '2026-04-01T19:00:00.000Z');
    // Y el máximo se ve también en "Last played": la abierta cuenta por su
    // arranque, así que las dos derivaciones coinciden en el mismo instante.
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-04-01T19:00:00.000Z');
  });

  it('el desempate de liveSince no depende del orden en que se insertaron las sesiones', async () => {
    // El caso contrario del de arriba, que es el que de verdad protege del
    // bug: aquí la sesión ANTIGUA se inserta la última, así que si el criterio
    // volviera a ser "la última fila leída gana" saldrían las 10:00. Sin ORDER
    // BY en la query, el orden de lectura es cosa del plan de SQLite y hoy
    // suele ser el de inserción — por eso hace falta probar los dos sentidos.
    const gameId = await makeGame(db, { title: 'Satisfactory' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeOpenSession(db, first, '2026-05-02T21:00:00Z');
    await makeOpenSession(db, second, '2026-05-02T10:00:00Z');

    assert.equal((await onlyGame()).liveSince?.toISOString(), '2026-05-02T21:00:00.000Z');
  });
});

// ══ LAST PLAYED ═══════════════════════════════════════════════════════════

describe('getGames · cuándo se jugó por última vez', () => {
  it('cuenta cuándo se DEJÓ de jugar, no cuándo se arrancó', async () => {
    // Una maratón de sábado noche: si "last played" fuera el arranque, un
    // juego que empezaste a las 18:00 y dejaste a las 21:00 quedaría por
    // detrás de otro que solo tocaste a las 19:00.
    const gameId = await makeGame(db, { title: 'Outer Wilds' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 3);

    assert.equal((await onlyGame()).lastPlayedAt?.toISOString(), '2026-01-10T21:00:00.000Z');
  });

  it('en una sesión abierta manda su arranque: es lo más reciente que hay', async () => {
    // Mientras el juego está en marcha no hay fin que mirar, y el arranque es
    // un dato mejor que el fin de la sesión anterior.
    const gameId = await makeGame(db, { title: 'Factorio' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 2);
    await makeOpenSession(db, iterationId, '2026-01-12T09:00:00Z');

    assert.equal((await onlyGame()).lastPlayedAt?.toISOString(), '2026-01-12T09:00:00.000Z');
  });

  it('sin sesiones vale el evento de estado, si la fecha la pusiste tú', async () => {
    // Un juego que te pasaste antes de usar Afterplay SÍ se jugó: usar solo
    // sesiones lo mandaría al fondo de la biblioteca junto a los que ni has
    // tocado.
    const gameId = await makeGame(db, {
      title: 'Bloodborne',
      addedAt: new Date('2026-01-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2023-05-04T00:00:00Z');

    const game = await onlyGame();
    assert.equal(game.lastPlayedAt?.toISOString(), '2023-05-04T00:00:00.000Z');
    assert.equal(game.currentState, 'completed');
  });

  it('el evento que escribe el alta no dice cuándo jugaste: no vale como last played', async () => {
    // writeInitialPlaythrough escribe el estado en la MISMA transacción que la
    // fila del juego, así que su occurredAt cae pegado al addedAt (unos
    // milisegundos). Sin este filtro el orden "Last played" de la biblioteca
    // se convertía en "los últimos que añadí" disfrazado: medido en la BD
    // real, 6 juegos de 331, y los seis salían arriba del todo.
    //
    // Ojo al reparto de papeles: el evento NO vale como fecha, pero sí como
    // ESTADO — el juego está completado aunque no sepamos cuándo lo jugaste.
    const addedAt = new Date('2026-02-01T10:00:00.000Z');
    const gameId = await makeGame(db, { title: 'Journey', addedAt });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-02-01T10:00:02.500Z');

    const game = await onlyGame();
    assert.equal(game.lastPlayedAt, null);
    assert.equal(game.currentState, 'completed');
  });

  it('una fecha tecleada el mismo día del alta sí vale: aterriza a medianoche, a horas de distancia', async () => {
    // El margen del artefacto son 5 segundos, no un día. Cuando tecleas una
    // fecha se guarda a medianoche de ese día, así que "lo añadí y le puse que
    // lo acabé hoy" tiene que sobrevivir. Si el margen creciera a "mismo día",
    // este caso se perdería.
    const addedAt = new Date('2026-02-01T18:30:00.000Z');
    const gameId = await makeGame(db, { title: 'Inside', addedAt });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-02-01T00:00:00Z', {
      datePrecision: 'day',
    });

    assert.equal((await onlyGame()).lastPlayedAt?.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('una fecha buena de un evento antiguo sobrevive aunque el último evento sea el del alta', async () => {
    // Se mira TODO el log, no solo el evento más reciente: das de alta un
    // juego como "completado" (evento artefacto, sin fecha propia) pero además
    // le pones a mano cuándo lo empezaste. Esa fecha es un dato real y no hay
    // que tirarla solo porque el evento de encima no tenga ninguna.
    const addedAt = new Date('2026-02-01T10:00:00.000Z');
    const gameId = await makeGame(db, { title: 'Nier Automata', addedAt });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2024-03-15T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeStateEvent(db, iterationId, 'completed', '2026-02-01T10:00:01.000Z');

    const game = await onlyGame();
    assert.equal(game.lastPlayedAt?.toISOString(), '2024-03-15T00:00:00.000Z');
    assert.equal(game.currentState, 'completed');
  });

  it('planear no es jugar: un plan_to_play suelto deja el juego sin fecha y sin estado', async () => {
    // Un juego promocionado del Plan a la biblioteca sin decir que lo jugaste:
    // su único evento es el "Planeado el X" del historial. Ni es una fecha de
    // juego ni es un estado.
    const gameId = await makeGame(db, {
      title: 'Pentiment',
      addedAt: new Date('2026-01-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-01-05T00:00:00Z', {
      datePrecision: 'day',
    });

    const game = await onlyGame();
    assert.equal(game.lastPlayedAt, null);
    assert.equal(game.currentState, null);
  });

  it('habiendo sesiones, un evento tecleado POSTERIOR sí manda: vale la más reciente de las dos', async () => {
    // ARREGLADO (antes: "manda la sesión" a secas, y en cuanto había una sola
    // sesión el log dejaba de mirarse). El caso que lo delataba: trackeas
    // Persona 5 en enero, lo terminas en la consola y lo marcas como completado
    // con fecha tecleada de junio — y la biblioteca seguía ordenándolo por
    // enero, hundido por debajo de juegos que tocaste menos. "Last played" es
    // la última vez que toqué el juego, venga el dato de la medición o del log.
    const gameId = await makeGame(db, {
      title: 'Persona 5',
      addedAt: new Date('2026-01-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-02T20:00:00Z', 2);
    await makeStateEvent(db, iterationId, 'completed', '2026-06-01T00:00:00Z', {
      datePrecision: 'day',
    });

    assert.equal((await onlyGame()).lastPlayedAt?.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('el borde contrario: con la sesión por delante del evento, manda la sesión', async () => {
    // La otra mitad del máximo, y la más corriente: marcas el juego como
    // completado y luego le sigues echando ratos (NG+, rejugadas sueltas). El
    // arreglo no puede haber invertido la regla — el evento viejo no tiene que
    // congelar la fecha.
    const gameId = await makeGame(db, {
      title: 'Hades',
      addedAt: new Date('2026-01-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-02-10T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeSession(db, iterationId, '2026-03-05T20:00:00Z', 1);

    assert.equal((await onlyGame()).lastPlayedAt?.toISOString(), '2026-03-05T21:00:00.000Z');
  });

  it('el evento del alta sigue sin contar aunque el juego tenga sesiones', async () => {
    // La guarda que el máximo podría haberse llevado por delante: ahora el log
    // se mira SIEMPRE, así que el filtro del artefacto (el evento que escribe
    // writeInitialPlaythrough, pegado al addedAt) pasa a importar también en
    // los juegos trackeados. Sin él, dar de alta hoy un juego que jugaste en
    // enero lo subiría al top de "Last played" por el mero hecho de añadirlo —
    // que es el bug medido en la BD real (6 juegos de 331, los seis arriba).
    const addedAt = new Date('2026-08-01T10:00:00.000Z');
    const gameId = await makeGame(db, { title: 'Cocoon', addedAt });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-15T18:00:00Z', 2);
    await makeStateEvent(db, iterationId, 'completed', '2026-08-01T10:00:01.500Z');

    const game = await onlyGame();
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-01-15T20:00:00.000Z');
    assert.equal(game.currentState, 'completed');
  });

  it('un plan_to_play posterior a la última sesión tampoco adelanta la fecha', async () => {
    // Planear no es jugar, y eso no cambia porque ahora se mire el log habiendo
    // sesiones: devolver un juego al Plan después de haberlo jugado no puede
    // reordenarlo como si lo hubieras tocado ese día.
    const gameId = await makeGame(db, {
      title: 'Tinykin',
      addedAt: new Date('2026-01-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-02-01T18:00:00Z', 1);
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-07-01T00:00:00Z', {
      datePrecision: 'day',
    });

    assert.equal((await onlyGame()).lastPlayedAt?.toISOString(), '2026-02-01T19:00:00.000Z');
  });
});

// ══ ESTADO ACTUAL ═════════════════════════════════════════════════════════

describe('getGames · el estado actual derivado del log', () => {
  it('manda el evento más reciente del juego, esté en el playthrough que esté', async () => {
    // Rejugar algo que ya te habías pasado: el playthrough viejo sigue
    // completado, pero el juego está EN MARCHA. Mirar solo el último
    // playthrough, o solo el primero, da la respuesta contraria.
    const gameId = await makeGame(db, { title: 'Skyrim' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, first, 'completed', '2026-01-05T00:00:00Z');
    await makeStateEvent(db, second, 'started', '2026-03-01T00:00:00Z');

    assert.equal((await onlyGame()).currentState, 'started');
  });

  it('a igualdad de fecha exacta gana el último registrado', async () => {
    // Corregirse en el mismo minuto (o dos eventos con fecha de solo día, que
    // aterrizan los dos a medianoche) tiene que dejar ganar al que escribiste
    // después, no al primero que devuelva la base.
    const gameId = await makeGame(db, { title: 'Celeste' });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'on_hold', '2026-02-10T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeStateEvent(db, iterationId, 'completed', '2026-02-10T00:00:00Z', {
      datePrecision: 'day',
    });

    assert.equal((await onlyGame()).currentState, 'completed');
  });

  it('plan_to_play no es un estado, ni siendo el evento más reciente del juego', async () => {
    // El caso que lo puso ahí: un juego que estaba en el Plan y pasas a la
    // biblioteca diciendo "esto ya me lo pasé en su día". El evento real
    // (completed) lleva fecha ANTERIOR al "Planeado el X", así que sin ignorar
    // el plan ganaría siempre él y el juego saldría como... nada. Y por lo
    // mismo tampoco puede ser la fecha de "last played".
    const gameId = await makeGame(db, {
      title: 'Disco Elysium',
      addedAt: new Date('2026-02-01T09:00:00Z'),
    });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2023-08-01T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeStateEvent(db, iterationId, 'plan_to_play', '2026-01-05T00:00:00Z', {
      datePrecision: 'day',
    });

    const game = await onlyGame();
    assert.equal(game.currentState, 'completed');
    assert.equal(game.lastPlayedAt?.toISOString(), '2023-08-01T00:00:00.000Z');
  });

  it('haber jugado horas no inventa un estado: sin eventos, sigue siendo null', async () => {
    // El watcher abre y cierra sesiones sin escribir estados. Un juego que
    // solo has jugado (nunca lo marcaste) es Unplayed en la UI, y ese null es
    // información: nadie ha dicho todavía qué es de él.
    const gameId = await makeGame(db, { title: 'Rocket League' });
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-01-10T18:00:00Z', 4);

    const game = await onlyGame();
    assert.equal(game.currentState, null);
    assert.equal(game.totalHours, 4);
  });
});

// ══ QUÉ JUEGOS SALEN, Y EN QUÉ ORDEN ══════════════════════════════════════

describe('getGames · la lista en sí', () => {
  it('los juegos planeados no salen, tengan las horas que tengan', async () => {
    // La sección Plan to Play es la ÚNICA que los ve (getPlannedGames):
    // excluirlos aquí los saca de Library, Sessions, Stats y las columnas de
    // navegación de una sola vez. Y se le cuelgan horas y sesiones a propósito
    // — un planeado con historial (promocionado y devuelto al plan) no puede
    // colarse por la puerta de atrás ni contaminar al que sí sale.
    const plannedId = await makeGame(db, { title: 'Aardvark planeado', planned: true });
    const plannedIteration = await makeIteration(db, plannedId, { manualTotalPlayed: 50 });
    await makeSession(db, plannedIteration, '2026-01-10T18:00:00Z', 5);

    const realId = await makeGame(db, { title: 'Zeta jugado' });
    const realIteration = await makeIteration(db, realId);
    await makeSession(db, realIteration, '2026-01-11T18:00:00Z', 2);

    const games = await getGames();
    assert.deepEqual(
      games.map((game) => game.title),
      ['Zeta jugado'],
    );
    assert.equal(games[0].totalHours, 2);
    assert.equal(games[0].sessionCount, 1);
  });

  it('orden alfabético insensible a mayúsculas', async () => {
    // Sin el `collate nocase` SQLite ordena por ASCII puro y las minúsculas se
    // van todas detrás de las mayúsculas ('Celeste', 'Zelda', 'animal
    // crossing'), que en una biblioteca de cientos es un desorden que se ve a
    // simple vista. Un único sitio para el orden: la biblioteca y el rail
    // lateral leen los dos de esta query, así que coinciden gratis.
    await makeGame(db, { title: 'zelda' });
    await makeGame(db, { title: 'Baba Is You' });
    await makeGame(db, { title: 'animal crossing' });
    await makeGame(db, { title: 'Celeste' });

    const games = await getGames();
    assert.deepEqual(
      games.map((game) => game.title),
      ['animal crossing', 'Baba Is You', 'Celeste', 'zelda'],
    );
  });

  it('cada juego se lleva lo suyo: horas, sesiones y estado no se mezclan entre juegos', async () => {
    // Todos los agregados de esta query son Map por gameId construidos en el
    // mismo bucle. Basta equivocarse de clave una vez para que las horas de un
    // juego aparezcan en otro, y con un solo juego en la base eso no se ve.
    const aId = await makeGame(db, { title: 'Alpha' });
    const aIteration = await makeIteration(db, aId);
    await makeSession(db, aIteration, '2026-01-10T18:00:00Z', 2);
    await makeStateEvent(db, aIteration, 'completed', '2026-01-11T00:00:00Z');

    const bId = await makeGame(db, { title: 'Beta' });
    const bIteration = await makeIteration(db, bId, { manualTotalPlayed: 7 });
    await makeOpenSession(db, bIteration, '2026-01-12T18:00:00Z');

    const alpha = await gameNamed('Alpha');
    const beta = await gameNamed('Beta');
    assert.deepEqual(
      [alpha.totalHours, alpha.sessionCount, alpha.currentState, alpha.isLive],
      [2, 1, 'completed', false],
    );
    assert.deepEqual(
      [beta.totalHours, beta.sessionCount, beta.currentState, beta.isLive],
      [7, 1, null, true],
    );
  });
});

// ══ HORAS MANUALES POR AÑO ════════════════════════════════════════════════

describe('getGames · a qué año se cuelgan las horas manuales', () => {
  it('mandan la fecha de FIN del playthrough, no la de inicio', async () => {
    // "Me pasé Elden Ring en 2023" pone las 90 horas en 2023 aunque lo
    // empezaras en 2022, que es como se lo cuenta uno mismo. Sin este dato las
    // horas manuales solo existían dentro de totalHours y desaparecían al
    // filtrar Stats por año.
    const gameId = await makeGame(db, { title: 'Elden Ring' });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 90 });
    await makeStateEvent(db, iterationId, 'started', '2022-11-01T12:00:00Z');
    await makeStateEvent(db, iterationId, 'completed', '2023-04-20T12:00:00Z');

    assert.deepEqual((await onlyGame()).manualIterations, [{ iterationId, hours: 90, year: 2023 }]);
  });

  it('sin ninguna fecha en el log, las horas manuales no tienen año (solo All Time)', async () => {
    // Preferible a inventarse uno: colgarlas del año en curso metería 40 horas
    // falsas en el resumen de este año.
    const gameId = await makeGame(db, { title: 'Terraria' });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 40 });

    assert.deepEqual((await onlyGame()).manualIterations, [{ iterationId, hours: 40, year: null }]);
  });

  it('cada playthrough manual viaja por separado, con su año y su iterationId', async () => {
    // El "You vs HowLongToBeat" compara UN playthrough concreto, así que no
    // vale con un total de horas manuales por juego: hay que poder emparejar
    // cada bloque con el suyo.
    const gameId = await makeGame(db, { title: 'Dark Souls' });
    const first = await makeIteration(db, gameId, {
      label: 'Playthrough 1',
      manualTotalPlayed: 60,
    });
    const second = await makeIteration(db, gameId, { label: 'NG+', manualTotalPlayed: 25 });
    await makeStateEvent(db, first, 'completed', '2021-06-15T12:00:00Z');
    await makeStateEvent(db, second, 'dropped', '2024-09-10T12:00:00Z');

    const game = await onlyGame();
    assert.deepEqual(game.manualIterations, [
      { iterationId: first, hours: 60, year: 2021 },
      { iterationId: second, hours: 25, year: 2024 },
    ]);
    assert.equal(game.totalHours, 85);
  });

  it('un playthrough en curso cuelga sus horas manuales de la fecha de inicio', async () => {
    // Sin fin todavía, el principio es la mejor pista que hay. On Hold sí
    // contaría como fin (es una fecha de salida), 'started' no.
    const gameId = await makeGame(db, { title: 'Baldurs Gate 3' });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 12 });
    await makeStateEvent(db, iterationId, 'started', '2025-08-20T12:00:00Z');

    assert.deepEqual((await onlyGame()).manualIterations, [{ iterationId, hours: 12, year: 2025 }]);
  });

  it('el evento del alta tampoco decide el año de las horas manuales: sin fecha real, solo All Time', async () => {
    // ARREGLADO. Era una divergencia dentro de la MISMA función: das de alta un
    // juego hoy como "completado, 50 horas, jugado hace años y sin fecha", el
    // evento que lo escribe es un artefacto (cae pegado al addedAt) y se
    // ignoraba para lastPlayedAt — pero manualHoursAnchor recibía el log SIN
    // filtrar, así que esas 50 horas aterrizaban en el año del alta y Stats
    // "2026" enseñaba 50 horas que nadie jugó. La misma fecha no puede ser
    // mentira para la fecha y verdad para el año. Ahora las dos derivaciones
    // aplican isAddedAtArtifact y el año sale null: solo All Time.
    const addedAt = new Date('2026-08-01T10:00:00.000Z');
    const gameId = await makeGame(db, { title: 'Half-Life 2', addedAt });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 50 });
    await makeStateEvent(db, iterationId, 'completed', '2026-08-01T10:00:01.000Z');

    const game = await onlyGame();
    assert.equal(game.lastPlayedAt, null);
    assert.deepEqual(game.manualIterations, [{ iterationId, hours: 50, year: null }]);
  });

  it('el filtro del artefacto no se lleva por delante una fecha tecleada del mismo playthrough', async () => {
    // El borde que abre el arreglo: das de alta el juego como completado (el
    // 'completed' es artefacto) pero además tecleas cuándo lo empezaste. Esa
    // fecha sí es un dato tuyo, así que las horas manuales se cuelgan de ella —
    // se filtra el evento artefacto, no el playthrough entero. Es la misma
    // regla que ya usaba "Last played" mirando TODO el log.
    const addedAt = new Date('2026-08-01T10:00:00.000Z');
    const gameId = await makeGame(db, { title: 'Portal 2', addedAt });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 20 });
    await makeStateEvent(db, iterationId, 'started', '2019-04-10T00:00:00Z', {
      datePrecision: 'day',
    });
    await makeStateEvent(db, iterationId, 'completed', '2026-08-01T10:00:01.000Z');

    const game = await onlyGame();
    assert.deepEqual(game.manualIterations, [{ iterationId, hours: 20, year: 2019 }]);
    // Y el estado sigue siendo el del artefacto: no vale como fecha, sí como
    // estado.
    assert.equal(game.currentState, 'completed');
  });

  it('una fecha tecleada el mismo día del alta sí ancla las horas manuales', async () => {
    // El margen del artefacto son 5 segundos, no un día: al teclear una fecha
    // se guarda a medianoche, a horas del alta. "Lo añadí hoy y le puse que lo
    // acabé hoy, con 30 horas de la otra máquina" tiene que caer en su año, no
    // en All Time. Si alguien ampliara el margen a "mismo día", este caso y su
    // gemelo de Last played se caerían a la vez.
    const addedAt = new Date('2026-08-01T18:30:00.000Z');
    const gameId = await makeGame(db, { title: 'Stray', addedAt });
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 30 });
    await makeStateEvent(db, iterationId, 'completed', '2026-08-01T00:00:00Z', {
      datePrecision: 'day',
    });

    const game = await onlyGame();
    assert.deepEqual(game.manualIterations, [{ iterationId, hours: 30, year: 2026 }]);
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-08-01T00:00:00.000Z');
  });
});
