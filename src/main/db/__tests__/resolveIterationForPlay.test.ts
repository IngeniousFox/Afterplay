import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { iterationsTable, stateEventsTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeStateEvent,
  type TestDb,
} from './harness';

// LA PREGUNTA DE SPEC 4/4.5: "¿en qué playthrough cae jugar a este juego?".
//
// Es la regla que comparten las DOS puertas por las que entra tiempo jugado
// —el watcher/botón Play (startGameSession, con `at` = ahora) y la asignación
// de una sesión pendiente de emulador (assignSession, con `at` = la fecha real
// de la sesión)— y de ella cuelga el invariante que más se nota cuando se
// rompe: como mucho UN playthrough activo por juego. Un fallo aquí no da un
// error, da una biblioteca con dos "Playing" del mismo juego, o unas horas
// colgadas de quien no las jugó.
//
// Los tests van contra la base REAL del andamio y llaman a la función dentro
// de una transacción, igual que producción: lo que se comprueba no es qué
// consulta se escribió, es qué quedó ESCRITO en el log de estados después.
//
// Hay una tercera fecha en juego además de `at`: HOY. Registrar algo que ya
// pasó no puede cambiar el estado de hoy —ese era el fantasma del "Playing
// para siempre"—, así que la función recibe también el "ahora" y varios tests
// mueven las dos fechas por separado (ver el helper `jugarEn`).
//
// Cada `it` fija una regla; varias son cicatrices que la cabecera de
// resolveIterationForPlay cuenta con nombre y fecha.

let db: TestDb;
let resolveIterationForPlay: typeof import('../queries/sessions/resolveIterationForPlay').resolveIterationForPlay;

before(async () => {
  ({ resolveIterationForPlay } = await import('../queries/sessions/resolveIterationForPlay'));
});

beforeEach(async () => {
  db = await freshDb();
});

after(() => cleanupDbs());

// El tipo de `tx` que espera la función viene del driver de PRODUCCIÓN
// (@tursodatabase/sync) y el del andamio es el de @libsql/client: mismo query
// builder de drizzle y mismo SQLite debajo, pero dos tipos nominales que no
// se solapan (solo cambia la forma de ResultSet). El cast es de tipos, no de
// comportamiento — ver la cabecera de harness.ts sobre por qué el andamio no
// puede usar el driver de producción.
type Tx = Parameters<typeof resolveIterationForPlay>[0];

// "Jugar a este juego el día X". Va dentro de una transacción porque la
// función SIEMPRE se llama así (escribe los eventos y a veces la iteración
// nueva: no puede quedar a medias) y porque es el único sitio donde se ve si
// las escrituras se pisan.
//
// `now` —cuándo se está tomando la decisión— por defecto es el propio `at`:
// eso es la puerta del watcher/botón Play, que siempre juega AHORA. Los tests
// de asignación retroactiva lo pasan a mano, y por eso ninguno depende del día
// en que se ejecute la suite (con `new Date()` de verdad, un test escrito con
// fechas de 2026 cambiaría de rama al pasar esa fecha).
const jugarEn = async (gameId: number, at: string, now: string = at): Promise<number> => {
  const { iterationId } = await db.transaction((tx) =>
    resolveIterationForPlay(tx as unknown as Tx, gameId, new Date(at), new Date(now)),
  );
  return iterationId;
};

type IteracionLeida = { id: number; label: string; playedPlatform: string };

const iteracionesDe = async (gameId: number): Promise<IteracionLeida[]> =>
  db
    .select({
      id: iterationsTable.id,
      label: iterationsTable.label,
      playedPlatform: iterationsTable.playedPlatform,
    })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

type EventoLeido = { id: number; type: string; occurredAt: Date };

// El log de un playthrough en orden de calendario, desempatando por id (dos
// eventos pueden compartir instante: manda el escrito después).
const eventosDe = async (iterationId: number): Promise<EventoLeido[]> =>
  db
    .select({
      id: stateEventsTable.id,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
    })
    .from(stateEventsTable)
    .where(eq(stateEventsTable.iterationId, iterationId))
    .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));

const tiposDe = async (iterationId: number): Promise<string[]> =>
  (await eventosDe(iterationId)).map((evento) => evento.type);

// El invariante de SPEC 4.5 medido A MANO —último evento real de cada
// iteración— en vez de con `latestRealStateEvent`, que es justo el helper que
// usa el código bajo prueba. Si ese helper se rompiera algún día, este test
// tiene que cantarlo, no heredar el mismo fallo y dar verde.
const playthroughsActivos = async (gameId: number): Promise<number[]> => {
  const activos: number[] = [];
  for (const iteracion of await iteracionesDe(gameId)) {
    const reales = (await eventosDe(iteracion.id)).filter(
      (evento) => evento.type !== 'plan_to_play',
    );
    const ultimo = reales[reales.length - 1];
    if (ultimo?.type === 'started') activos.push(iteracion.id);
  }
  return activos;
};

describe('resolveIterationForPlay: cuando ya hay algo en marcha', () => {
  it('el playthrough activo en esa fecha se reanuda sin escribir un segundo started', async () => {
    const gameId = await makeGame(db, { title: 'Hollow Knight' });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');

    const destino = await jugarEn(gameId, '2026-01-12T21:00:00Z');

    assert.equal(destino, p1);
    // Ni un evento más: el playthrough ya estaba activo, la sesión solo se
    // cuelga de él. Un "Started" extra por cada tarde de juego llenaría el
    // Journey de ruido y movería el ancla de las horas manuales.
    assert.deepEqual(await tiposDe(p1), ['started']);
  });

  it('pulsar Play dos veces no apila dos started: el segundo ya lo encuentra activo', async () => {
    // El watcher y el botón Play entran por la misma puerta, y el watcher
    // puede detectar el arranque justo después de que tú lo pulses.
    const gameId = await makeGame(db, { title: 'Celeste' });
    await makeIteration(db, gameId);

    const primera = await jugarEn(gameId, '2026-02-01T18:00:00Z');
    const segunda = await jugarEn(gameId, '2026-02-01T18:00:30Z');

    assert.equal(segunda, primera);
    assert.deepEqual(await tiposDe(primera), ['started']);
    assert.deepEqual(await playthroughsActivos(gameId), [primera]);
  });

  it('una pausa no es un final: el on_hold se reanuda en el mismo playthrough', async () => {
    // SPEC 4.5 — `endsPlaythrough` deja fuera on_hold y resting a propósito:
    // aparcar algo y retomarlo es SEGUIR el mismo playthrough. Si esto abriera
    // uno nuevo, cada pausa partiría las horas de una misma partida en dos.
    const gameId = await makeGame(db, { title: 'Disco Elysium' });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, p1, 'on_hold', '2026-01-20T23:00:00Z');

    const destino = await jugarEn(gameId, '2026-02-01T19:00:00Z');

    assert.equal(destino, p1);
    assert.equal((await iteracionesDe(gameId)).length, 1);
    assert.deepEqual(await tiposDe(p1), ['started', 'on_hold', 'started']);
    assert.deepEqual(await playthroughsActivos(gameId), [p1]);
  });

  it('el playthrough recién creado por el alta, sin un solo evento, es el destino', async () => {
    // Add Game crea la iteración antes de que exista ningún estado. Ese hueco
    // ("último estado: nada") no es un final: es un playthrough sin estrenar, y
    // estrenarlo es escribirle su primer started, no crear un Playthrough 2 al
    // lado el primer día.
    const gameId = await makeGame(db, { title: 'Outer Wilds' });
    const p1 = await makeIteration(db, gameId);

    const destino = await jugarEn(gameId, '2026-03-05T20:00:00Z');

    assert.equal(destino, p1);
    assert.equal((await iteracionesDe(gameId)).length, 1);
    assert.deepEqual(await tiposDe(p1), ['started']);
  });
});

describe('resolveIterationForPlay: cuando el último playthrough terminó', () => {
  it('tras un Beaten, volver a jugar abre el siguiente playthrough con su propio started', async () => {
    const gameId = await makeGame(db, { title: 'Dark Souls' });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-02-01T23:30:00Z');

    const destino = await jugarEn(gameId, '2026-02-10T19:00:00Z');

    assert.notEqual(destino, p1);
    const iteraciones = await iteracionesDe(gameId);
    assert.equal(iteraciones.length, 2);
    assert.equal(iteraciones[1].label, 'Playthrough 2');
    // El playthrough viejo se queda EXACTAMENTE como estaba: su Beaten es un
    // hecho del pasado y la segunda vuelta no lo reescribe.
    assert.deepEqual(await tiposDe(p1), ['started', 'completed']);
    const eventos = await eventosDe(destino);
    assert.deepEqual(
      eventos.map((evento) => evento.type),
      ['started'],
    );
    assert.equal(eventos[0].occurredAt.toISOString(), '2026-02-10T19:00:00.000Z');
    // Y solo uno activo: el nuevo. El viejo sigue Beaten.
    assert.deepEqual(await playthroughsActivos(gameId), [destino]);
  });

  it('un Dropped cierra igual que un Beaten: también abre uno nuevo', async () => {
    // Los dos —y solo los dos— están en ENDS_PLAYTHROUGH. Se prueba aparte
    // porque el día que alguien mueva 'dropped' de conjunto (a
    // `leavesEndDate`, por ejemplo, que es el de al lado) esto lo canta.
    const gameId = await makeGame(db, { title: 'Kenshi' });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, p1, 'dropped', '2026-01-25T22:00:00Z');

    const destino = await jugarEn(gameId, '2026-04-01T18:00:00Z');

    assert.notEqual(destino, p1);
    assert.equal((await iteracionesDe(gameId)).length, 2);
    assert.deepEqual(await playthroughsActivos(gameId), [destino]);
  });

  it('un juego sin ninguna iteración estrena Playthrough 1', async () => {
    // Pasa de verdad: un juego importado o promovido puede quedarse sin
    // contenedor, y el watcher detecta su .exe igual. Aquí no hay "última
    // iteración" que mirar, y aun así tiene que salir un destino escribible.
    const gameId = await makeGame(db, { title: 'Factorio' });

    const destino = await jugarEn(gameId, '2026-05-01T17:00:00Z');

    const iteraciones = await iteracionesDe(gameId);
    assert.equal(iteraciones.length, 1);
    assert.equal(iteraciones[0].id, destino);
    assert.equal(iteraciones[0].label, 'Playthrough 1');
    assert.deepEqual(await tiposDe(destino), ['started']);
  });

  it('el playthrough nuevo nace en la plataforma del juego: Emulated manda sobre la oficial', async () => {
    // La plataforma no es decorativa: es lo que separa "jugué a Chrono Trigger
    // en un emulador" de "en SNES". Un juego emulado la lleva a 'Emulated'
    // aunque IGDB diga otra cosa (EMULADORES.md §5), y sin plataformas
    // oficiales el respaldo es 'PC' — nunca vacío, la columna es NOT NULL.
    const emulado = await makeGame(db, {
      title: 'Chrono Trigger',
      isEmulated: true,
      officialPlatforms: ['Super Nintendo'],
    });
    const consola = await makeGame(db, {
      title: 'Bloodborne',
      officialPlatforms: ['PlayStation 4'],
    });
    const sinPlataformas = await makeGame(db, { title: 'Juego sin ficha' });

    await jugarEn(emulado, '2026-06-01T18:00:00Z');
    await jugarEn(consola, '2026-06-01T18:00:00Z');
    await jugarEn(sinPlataformas, '2026-06-01T18:00:00Z');

    assert.equal((await iteracionesDe(emulado))[0].playedPlatform, 'Emulated');
    assert.equal((await iteracionesDe(consola))[0].playedPlatform, 'PlayStation 4');
    assert.equal((await iteracionesDe(sinPlataformas))[0].playedPlatform, 'PC');
  });

  it('la etiqueta del nuevo sale del número más alto ya usado, no de contar iteraciones', async () => {
    // ARREGLADO (era CARACTERIZACIÓN): la etiqueta se calculaba como
    // `Playthrough ${nº de iteraciones + 1}`. Este es el borde que lo rompía,
    // montado tal cual queda tras borrar el playthrough del medio
    // (deleteIteration es una acción real de la ficha): con 2 iteraciones vivas
    // etiquetadas 1 y 3, la siguiente volvía a llamarse "Playthrough 3" y el
    // juego enseñaba dos filas con el mismo nombre, indistinguibles en el
    // desplegable. Cosmético, pero reproducible al 100%.
    //
    // Ahora la regla vive en queries/iterations/nextPlaythroughLabel.ts y la
    // comparten las dos puertas que estrenan playthrough (esta y
    // createIteration), que antes tenían la fórmula copiada.
    const gameId = await makeGame(db, { title: 'Baldurs Gate 3' });
    const p1 = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, p1, 'completed', '2026-01-20T22:00:00Z');
    const p3 = await makeIteration(db, gameId, { label: 'Playthrough 3' });
    await makeStateEvent(db, p3, 'completed', '2026-02-20T22:00:00Z');

    const destino = await jugarEn(gameId, '2026-03-01T18:00:00Z');

    const iteraciones = await iteracionesDe(gameId);
    assert.equal(iteraciones.length, 3);
    assert.equal(iteraciones[2].id, destino);
    assert.deepEqual(
      iteraciones.map((iteracion) => iteracion.label),
      ['Playthrough 1', 'Playthrough 3', 'Playthrough 4'],
    );
  });

  it('con los playthroughs rebautizados a mano, el recuento sigue siendo el suelo', async () => {
    // El borde contrario del arreglo de arriba: si el usuario les puso nombre
    // propio no hay ningún número del que tirar, y ahí "contar" es justo lo
    // que hay que hacer — un juego con dos vueltas jugadas no puede estrenar
    // un "Playthrough 1". Se prueba porque la tentación al arreglar el nombre
    // repetido es quedarse solo con el máximo, y eso reiniciaría la cuenta.
    const gameId = await makeGame(db, { title: 'Dragon Quest XI' });
    const primera = await makeIteration(db, gameId, { label: 'Primera vuelta' });
    await makeStateEvent(db, primera, 'completed', '2026-01-20T22:00:00Z');
    const ngPlus = await makeIteration(db, gameId, { label: 'NG+' });
    await makeStateEvent(db, ngPlus, 'completed', '2026-02-20T22:00:00Z');

    await jugarEn(gameId, '2026-03-01T18:00:00Z');

    assert.deepEqual(
      (await iteracionesDe(gameId)).map((iteracion) => iteracion.label),
      ['Primera vuelta', 'NG+', 'Playthrough 3'],
    );
  });

  it('un endless no tiene playthroughs discretos: ni un Dropped le abre un Playthrough 2', async () => {
    // La cicatriz que puso el flag `endless` ANTES de elegir la rama: un
    // endless abandonado y retomado se llevaba un "Playthrough 2" —un
    // contenedor duplicado en un juego cuyo modelo entero es que solo hay uno—
    // porque 'dropped' significa "el próximo es nuevo" en un juego normal.
    const gameId = await makeGame(db, { title: 'Slay the Spire', endless: true });
    const unico = await makeIteration(db, gameId, { label: 'Endless' });
    await makeStateEvent(db, unico, 'started', '2026-01-05T18:00:00Z');
    await makeStateEvent(db, unico, 'dropped', '2026-03-01T21:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-01T18:00:00Z');

    assert.equal(destino, unico);
    assert.equal((await iteracionesDe(gameId)).length, 1);
    // Y sí se reactiva: el contenedor vuelve a estar en marcha.
    assert.deepEqual(await tiposDe(unico), ['started', 'dropped', 'started']);
    assert.deepEqual(await playthroughsActivos(gameId), [unico]);
  });

  it('un plan_to_play posterior no borra el desenlace: el Beaten sigue mandando', async () => {
    // Forma real, no inventada: un juego promovido del Plan con fechas del
    // pasado deja el 'plan_to_play' como el evento de fecha MÁS ALTA, por
    // debajo del started/completed retroactivos que tecleaste al promoverlo.
    // Planear no es un estado (ver schema.ts), y sin el filtro de
    // latestRealStateEvent este juego parecería "no terminado": volver a
    // jugarlo le apilaría un started encima del Beaten en vez de abrir la
    // segunda vuelta.
    const gameId = await makeGame(db, { title: 'Nier Automata' });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-02-01T22:00:00Z');
    await makeStateEvent(db, p1, 'plan_to_play', '2026-03-01T10:00:00Z');

    const destino = await jugarEn(gameId, '2026-03-10T18:00:00Z');

    assert.notEqual(destino, p1);
    assert.equal((await iteracionesDe(gameId)).length, 2);
    assert.deepEqual(await tiposDe(p1), ['started', 'completed', 'plan_to_play']);
  });
});

describe('resolveIterationForPlay: la foto se toma en `at`, no hoy', () => {
  it('la sesión de julio cae en el playthrough que seguía abierto en julio, aunque hoy esté Beaten', async () => {
    // LA cicatriz de esta función. Una sesión pendiente de emulador del 20-jul
    // asignada en agosto, cuando su playthrough ya estaba Beaten: la decisión
    // se tomaba con el ÚLTIMO evento del log (completed) y abría un
    // playthrough nuevo fechado en julio — un fantasma con un 'started' como
    // último evento, o sea activo para siempre, y las horas de julio colgadas
    // de quien no las jugó.
    const gameId = await makeGame(db, { title: 'Elden Ring', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-07-10T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-08-01T23:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-10T12:00:00Z');

    assert.equal(destino, p1);
    assert.equal((await iteracionesDe(gameId)).length, 1);
    // Ni un evento nuevo: en esa fecha ya estaba activo, no hay nada que
    // activar. El Beaten de agosto sigue siendo el último estado.
    assert.deepEqual(await tiposDe(p1), ['started', 'completed']);
    assert.deepEqual(await playthroughsActivos(gameId), []);
  });

  it('si a esa fecha ya había terminado, el playthrough nuevo nace fechado en la sesión Y ya cerrado', async () => {
    // ARREGLADO (era CARACTERIZACIÓN). El contraste del test de arriba: mismo
    // juego, misma asignación retroactiva, pero el desenlace cae ANTES de la
    // sesión. Ahí sí toca segunda vuelta — y su 'started' lleva la fecha REAL
    // en que se jugó (EMULADORES.md §6), porque un playthrough que arranca "el
    // día que asignaste la sesión" miente en el Journey y en las stats por año.
    //
    // Lo que estaba mal: ese Playthrough 2 se quedaba con un 'started' como
    // ÚLTIMO evento, o sea el juego pasaba a "Playing" HOY por asignar una
    // sesión de hace un mes, y así hasta que alguien lo cerrase a mano — la
    // misma forma de fantasma que la cabecera de la función describe ("activo
    // para siempre"), por el otro camino. Ahora un playthrough que nace de una
    // jugada de un día ANTERIOR nace con su desenlace puesto: Beaten por
    // defecto (decisión del dueño; si en realidad lo dropeaste se edita, lo que
    // no puede pasar es que el juego se quede Playing por una sesión vieja).
    const gameId = await makeGame(db, { title: 'Super Metroid', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-06-01T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-07-01T22:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.notEqual(destino, p1);
    const eventos = await eventosDe(destino);
    assert.deepEqual(
      eventos.map((evento) => evento.type),
      ['started', 'completed'],
    );
    // Los dos en el instante de la sesión: aquí no se sabe cuánto duró (`at`
    // es el arranque, la sesión la cuelga el que llama), y la fecha honesta es
    // la de la partida. El empate lo rompe el id, que es como
    // latestRealStateEvent decide el estado.
    assert.deepEqual(
      eventos.map((evento) => evento.occurredAt.toISOString()),
      ['2026-07-20T21:00:00.000Z', '2026-07-20T21:00:00.000Z'],
    );
    // Y lo que de verdad importa: hoy el juego NO está Playing.
    assert.deepEqual(await playthroughsActivos(gameId), []);
  });

  it('la misma jugada, pero de hoy, sí deja el juego Playing', async () => {
    // El borde contrario del arreglo de arriba, y su guarda: el corte es el DÍA
    // natural, no el instante. Pulsar Play esta tarde —o asignar la sesión de
    // emulador de hace dos horas, que es la MISMA partida— tiene que dejar el
    // playthrough abierto; solo lo de días anteriores es historia. Las fechas
    // van sin Z a propósito: se parsean en hora LOCAL, que es con la que la
    // función compara los días (y con la que el usuario ve su calendario).
    const gameId = await makeGame(db, { title: 'Hollow Knight: Silksong', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-06-01T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-07-01T22:00:00Z');

    const destino = await jugarEn(gameId, '2026-08-13T17:00:00', '2026-08-13T22:30:00');

    assert.notEqual(destino, p1);
    assert.deepEqual(await tiposDe(destino), ['started']);
    assert.deepEqual(await playthroughsActivos(gameId), [destino]);
  });

  it('varias sesiones viejas del mismo tirón caen en el mismo playthrough, no una por sesión', async () => {
    // La trampa del arreglo de arriba, y por la que existe la firma
    // "auto-cerrado" en el código: las sesiones pendientes de emulador se
    // asignan de varias en varias (una por tarde). Si cada asignación viera "el
    // último playthrough terminó" —lo terminó ella misma hace un segundo—
    // abriría otro, y cinco tardes de la misma partida dejarían cinco
    // "Playthrough N" Beaten en la ficha. La segunda tarde se cuelga de la
    // primera sin escribir ni un evento más.
    const gameId = await makeGame(db, { title: 'Chrono Trigger', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-06-01T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-07-01T22:00:00Z');

    const hoy = '2026-08-13T12:00:00Z';
    const primeraTarde = await jugarEn(gameId, '2026-07-20T21:00:00Z', hoy);
    const segundaTarde = await jugarEn(gameId, '2026-07-21T20:00:00Z', hoy);
    const terceraTarde = await jugarEn(gameId, '2026-07-23T19:00:00Z', hoy);

    assert.equal(segundaTarde, primeraTarde);
    assert.equal(terceraTarde, primeraTarde);
    assert.equal((await iteracionesDe(gameId)).length, 2);
    assert.deepEqual(await tiposDe(primeraTarde), ['started', 'completed']);
    assert.deepEqual(await playthroughsActivos(gameId), []);
  });

  it('un playthrough terminado A MANO no se reabre con una sesión vieja: esa sí estrena otro', async () => {
    // La otra cara de la firma: solo se reutiliza el playthrough que esta misma
    // función cerró al vuelo (started y completed en el MISMO instante). Un
    // Beaten tecleado por ti —fecha propia, a días del arranque— es un hecho
    // cerrado, y colgarle una sesión posterior le movería el final. Este test
    // es quien lo nota si la firma se relaja.
    // El caso rozando la firma: una partida REAL de una tarde, tecleada por ti
    // (empezada y terminada el mismo día, pero a horas distintas). No es un
    // auto-cierre, así que la sesión de la semana siguiente estrena su propio
    // playthrough en vez de mover el final que tú pusiste.
    const gameId = await makeGame(db, { title: 'Silent Hill 2', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-07-01T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-07-01T22:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.notEqual(destino, p1);
    assert.deepEqual(await tiposDe(p1), ['started', 'completed']);
    assert.equal((await iteracionesDe(gameId)).length, 2);
    assert.deepEqual(
      (await eventosDe(p1)).map((evento) => evento.occurredAt.toISOString()),
      ['2026-07-01T18:00:00.000Z', '2026-07-01T22:00:00.000Z'],
    );
  });

  it('el PRIMER playthrough de un juego sí nace abierto, aunque la sesión sea vieja', async () => {
    // El límite del arreglo, escrito a propósito: "nace cerrado" solo cuando
    // venía de un desenlace. Asignarle una sesión de la semana pasada a un
    // juego recién metido en la biblioteca no dice que esa partida terminase
    // —no hay ningún final previo que cierre su historia— y lo más probable es
    // que la sigas jugando. Marcarlo Beaten solo, sin que tú lo digas, sería
    // inventarse un desenlace.
    const gameId = await makeGame(db, { title: 'Suikoden II', isEmulated: true });

    const destino = await jugarEn(gameId, '2026-08-05T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.deepEqual(await tiposDe(destino), ['started']);
    assert.deepEqual(await playthroughsActivos(gameId), [destino]);
  });

  it('reanudar un playthrough pausado con una sesión vieja no lo cierra: sigue en marcha', async () => {
    // El otro límite. Aquí no nace nada: la iteración existía, estaba On Hold y
    // la sesión del pasado la reanuda. Que el juego quede Playing es discutible
    // —una sesión de hace un mes tampoco dice que hoy lo estés jugando— pero la
    // decisión del dueño habla del playthrough NUEVO, y cerrar a la fuerza uno
    // que TÚ pausaste sí sería reescribirte el historial. Queda anotado como
    // caso abierto; este test fija dónde está hoy la frontera.
    const gameId = await makeGame(db, { title: 'Vagrant Story', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-05-01T18:00:00Z');
    await makeStateEvent(db, p1, 'on_hold', '2026-06-10T21:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.equal(destino, p1);
    assert.deepEqual(await tiposDe(p1), ['started', 'on_hold', 'started']);
    assert.deepEqual(await playthroughsActivos(gameId), [p1]);
  });

  it('si la iteración ya tiene un started en `at` o después, no se le escribe otro', async () => {
    // Jugaste al emulador el martes y el playthrough arrancó el viernes: a
    // fecha de la sesión esa iteración no tiene NINGÚN evento, así que la rama
    // de "reanudar" quería escribirle un 'started' del martes. No activaba
    // nada (ya lo estaba, o ya terminó) y solo dejaba un "Started" de más en el
    // Journey y movía el ancla de las horas manuales. Las fechas se recolocan
    // solas al leer: getGameById deriva el inicio como el mínimo entre la
    // primera sesión y el primer 'started'.
    const gameId = await makeGame(db, { title: 'Metroid Prime', isEmulated: true });
    const p1 = await makeIteration(db, gameId);
    await makeStateEvent(db, p1, 'started', '2026-08-01T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-08-15T22:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-20T12:00:00Z');

    assert.equal(destino, p1);
    assert.equal((await iteracionesDe(gameId)).length, 1);
    assert.deepEqual(await tiposDe(p1), ['started', 'completed']);
    // Y el juego NO revive: una asignación retroactiva no resucita un
    // playthrough terminado, solo le cuelga las horas.
    assert.deepEqual(await playthroughsActivos(gameId), []);
  });
});

describe('resolveIterationForPlay: como mucho un playthrough activo por juego', () => {
  it('con uno vivo hoy, la sesión retroactiva cae en él aunque a su fecha todo estuviera terminado', async () => {
    // El segundo agujero de mirar solo hasta `at`: un hermano activo HOY con
    // su 'started' POSTERIOR a la sesión es invisible en la foto de esa fecha.
    // Aquí la última iteración (P2) estaba Dropped en julio, así que la rama de
    // "crear nuevo" se dispararía y le metería un 'started' A PELO —este insert
    // no pasa por addStateEvent, o sea sin su auto-pausa de hermanos—: dos
    // playthroughs con 'started' como último evento, contra SPEC 4.5.
    const gameId = await makeGame(db, { title: 'Hades', isEmulated: true });

    const p1 = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-03-01T22:00:00Z');
    // Reabierto en agosto: hoy P1 es el único vivo.
    await makeStateEvent(db, p1, 'started', '2026-08-01T18:00:00Z');

    const p2 = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, p2, 'started', '2026-05-01T18:00:00Z');
    await makeStateEvent(db, p2, 'dropped', '2026-06-15T20:00:00Z');

    const destino = await jugarEn(gameId, '2026-07-20T21:00:00Z', '2026-08-13T12:00:00Z');

    assert.equal(destino, p1);
    // Ni Playthrough 3, ni un evento nuevo en ningún sitio.
    assert.equal((await iteracionesDe(gameId)).length, 2);
    assert.deepEqual(await tiposDe(p1), ['started', 'completed', 'started']);
    assert.deepEqual(await tiposDe(p2), ['started', 'dropped']);
    assert.deepEqual(await playthroughsActivos(gameId), [p1]);
  });

  it('una jugada nueva sobre un juego con un hermano activo no abre un segundo activo', async () => {
    // Mismo invariante por la puerta de "ahora": P1 quedó Beaten y P2 sigue en
    // marcha. Pulsar Play tiene que caer en P2 —el activo manda sobre "la
    // última iteración"— y no estrenar un tercero.
    const gameId = await makeGame(db, { title: 'Persona 5' });
    const p1 = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, p1, 'started', '2026-01-10T18:00:00Z');
    await makeStateEvent(db, p1, 'completed', '2026-02-20T22:00:00Z');
    const p2 = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, p2, 'started', '2026-03-01T18:00:00Z');

    const destino = await jugarEn(gameId, '2026-03-15T19:00:00Z');

    assert.equal(destino, p2);
    assert.equal((await iteracionesDe(gameId)).length, 2);
    assert.deepEqual(await playthroughsActivos(gameId), [p2]);
  });
});
