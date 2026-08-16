import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import { endsPlaythrough, latestRealStateEvent } from '../../../../shared/playthroughState';
import type { StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, stateEventsTable } from '../../schema';
import { nextPlaythroughLabel } from '../iterations/nextPlaythroughLabel';

// El `tx` de una transacción de drizzle — mismo query builder que la
// conexión, tipado desde ella para no importar internos de drizzle.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export type ResolvedIteration = {
  iterationId: number;
};

// El día natural LOCAL de una fecha, para preguntar "¿esto es de hoy?". Local
// y no UTC porque el usuario ve —y teclea— días locales: una sesión de las
// 23:30 es de hoy aunque en UTC ya sea mañana.
const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// "¿En qué playthrough cae jugar a este juego AHORA (o en `at`)?" — la regla
// única de SPEC 4/4.5 que antes vivía dentro de startGameSession, extraída
// para que la asignación de sesiones de emulador (EMULADORES.md §6) use
// EXACTAMENTE la misma lógica en vez de una copia: si hay iteración activa
// se usa esa; si la última terminó (Beaten/Dropped) se crea un playthrough
// nuevo; un on_hold/resting (o un Playthrough recién creado sin tocar) se
// reanuda. Si hace falta activar, inserta el evento 'started' con fecha
// `at` — "ahora" para el watcher/Play, la fecha real de la sesión para una
// asignación retroactiva.
//
// `at` no es solo la fecha del evento: es LA FECHA A LA QUE SE PREGUNTA. El
// estado de cada playthrough se deriva de sus eventos hasta `at`, igual que
// la ventana de reparto del gasto (SPEC 4.4: "el primer playthrough que
// seguía abierto en esa fecha"). Antes la decisión se tomaba con el último
// evento de HOY, y una sesión pendiente de emulador del 20-jul asignada en
// agosto —cuando su playthrough ya estaba Beaten— abría un playthrough nuevo
// fechado en julio: un fantasma con un 'started' como último evento, o sea
// activo para siempre, y las horas de julio colgadas de quien no las jugó.
//
// Pero el log entero SIGUE mirándose, porque preguntar solo hasta `at` deja
// dos agujeros y los dos se ven en pantalla:
//   · Un hermano activo HOY con su 'started' POSTERIOR a `at` es invisible
//     para la foto de `at`. Sin la segunda comprobación (activeNow), asignar
//     una sesión retroactiva creaba un playthrough más y le metía un 'started'
//     a pelo —sin la auto-pausa de hermanos de addStateEvent— dejando DOS
//     playthroughs con 'started' como último evento, contra SPEC 4.5.
//   · Y la iteración destino puede no tener ningún evento hasta `at` y sí un
//     'started' después (jugaste al emulador el martes, el playthrough arrancó
//     el viernes): insertar otro 'started' fechado el martes no activa nada
//     que no estuviera ya activo, solo deja un "Started" de más en el Journey
//     y mueve el ancla de las horas manuales.
//
// Y `at` tampoco es siempre "ahora": si la jugada es de un DÍA ANTERIOR a
// `now` es HISTORIA, y un playthrough que nace de historia nace con su
// desenlace puesto ('completed'). Sin eso, asignar una sesión de hace un mes
// dejaba el juego en "Playing" HOY —su último evento era el 'started' fechado
// en julio— y así se quedaba hasta que alguien lo cerrase a mano: la misma
// forma de fantasma que se describe arriba, por el otro camino. Beaten por
// defecto es decisión del dueño: un playthrough histórico tiene que nacer con
// un estado, y si en realidad lo dropeaste se edita después (lo que no puede
// pasar es que el juego se quede Playing por una sesión vieja).
//
// El corte es el DÍA natural y no un margen en minutos: la sesión de emulador
// que asignas por la noche es la de esta tarde, y ese juego SÍ es el que estás
// jugando; la de la semana pasada ya no.
//
// `now` es un parámetro y no `new Date()` a pelo para que el reloj sea
// inyectable: los tests fijan las dos fechas y así no cambian de resultado
// según el día en que se ejecuten (con las dos fechas iguales se prueba la
// puerta del watcher/Play, que siempre juega AHORA).
//
// SIEMPRE dentro de una transacción del que llama — esto escribe (eventos, y
// a veces la iteración nueva) y no debe quedar a medias.
export const resolveIterationForPlay = async (
  tx: Tx,
  gameId: number,
  at: Date,
  now: Date = new Date(),
): Promise<ResolvedIteration> => {
  const iterations = await tx
    .select({ id: iterationsTable.id, label: iterationsTable.label })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

  // El estado A FECHA `at` (lo posterior a `at` no existe todavía para esta
  // pregunta: un 'completed' de agosto no decide dónde cae una sesión de
  // julio) — es quien elige la rama nuevo/reanudar.
  const latestTypeAt = new Map<number, StateEvent['type']>();
  // El estado HOY, con el log entero. Solo se consulta si a fecha `at` no
  // había nada activo, y está para no romper "como mucho un playthrough
  // activo por juego" con una escritura retroactiva (ver cabecera).
  const latestTypeNow = new Map<number, StateEvent['type']>();
  // Iteraciones que ya tienen un 'started' en `at` o después: para ellas el
  // insert de abajo sobra, la activación ya está escrita y con mejor fecha.
  const startedFromAt = new Set<number>();
  // Los playthroughs históricos que fabricó ESTA función: log de exactamente
  // dos eventos, 'started' y 'completed', en el MISMO instante. Es una firma
  // que una mano no produce (las fechas tecleadas caen a medianoche del día y
  // el desenlace nunca coincide al milisegundo con el arranque) y hace falta
  // para no partir un mismo tirón en N playthroughs: las sesiones pendientes
  // de emulador se asignan de varias en varias, y si cada una viera "el último
  // terminó" abriría otro Playthrough — cinco tardes de la misma partida,
  // cinco playthroughs Beaten. Ver el bloque de creación de abajo.
  const autoClosedRuns = new Set<number>();

  if (iterations.length > 0) {
    const events = await tx
      .select({
        iterationId: stateEventsTable.iterationId,
        type: stateEventsTable.type,
        occurredAt: stateEventsTable.occurredAt,
        id: stateEventsTable.id,
      })
      .from(stateEventsTable)
      .where(
        inArray(
          stateEventsTable.iterationId,
          iterations.map((iteration) => iteration.id),
        ),
      )
      .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));

    // El corte por fecha se hace aquí y no en el WHERE porque hacen falta las
    // DOS lecturas del mismo log, y son los eventos de UN juego: traerlos
    // enteros cuesta lo mismo que traer la mitad.
    const atMs = at.getTime();
    const eventsByIteration = new Map<number, typeof events>();
    for (const event of events) {
      const list = eventsByIteration.get(event.iterationId) ?? [];
      list.push(event);
      eventsByIteration.set(event.iterationId, list);
    }
    // "El más reciente" sale del helper compartido: ignora 'plan_to_play' —
    // ver schema.ts, no es estado — y sin ese filtro un juego recién pasado
    // del Plan a la biblioteca tendría el plan como "último estado" y
    // confundiría la lógica de abajo.
    for (const [iterationId, iterationEvents] of eventsByIteration) {
      const latestNow = latestRealStateEvent(iterationEvents);
      if (latestNow) latestTypeNow.set(iterationId, latestNow.type);

      const latestAt = latestRealStateEvent(
        iterationEvents.filter((event) => event.occurredAt.getTime() <= atMs),
      );
      if (latestAt) latestTypeAt.set(iterationId, latestAt.type);

      const alreadyStarted = iterationEvents.some(
        (event) => event.type === 'started' && event.occurredAt.getTime() >= atMs,
      );
      if (alreadyStarted) startedFromAt.add(iterationId);

      // Los eventos vienen ordenados por fecha y, a igualdad, por id: el
      // 'completed' que se escribe justo después del 'started' es el segundo.
      const real = iterationEvents.filter((event) => event.type !== 'plan_to_play');
      const isAutoClosedRun =
        real.length === 2 &&
        real[0].type === 'started' &&
        real[1].type === 'completed' &&
        real[0].occurredAt.getTime() === real[1].occurredAt.getTime();
      if (isAutoClosedRun) autoClosedRuns.add(iterationId);
    }
  }

  const activeIteration = iterations.find(
    (iteration) => latestTypeAt.get(iteration.id) === 'started',
  );

  if (activeIteration) {
    // Estaba "Playing" en `at`: solo falta colgar la sesión (modelo v2 — la
    // fecha de inicio se deriva de sesiones+eventos al leer, no hay ancla que
    // mantener). Y no se inserta ningún 'started': ya lo había.
    return { iterationId: activeIteration.id };
  }

  // A fecha `at` no había nada activo, pero puede haberlo AHORA: un
  // playthrough reabierto después de `at`. Ese es el destino, y sin escribir
  // nada — su 'started' es posterior, así que un evento fechado en `at` no lo
  // reactivaría (ya está activo) y crear un playthrough al lado dejaría dos
  // activos a la vez. La sesión retroactiva se cuelga de él y las fechas se
  // recolocan solas al leer (getGameById deriva el inicio como el mínimo entre
  // la primera sesión y el primer 'started').
  const activeNow = iterations.find((iteration) => latestTypeNow.get(iteration.id) === 'started');
  if (activeNow) {
    return { iterationId: activeNow.id };
  }

  let targetIterationId: number;

  // La "última" sigue siendo la de id más alto y no "la última que existía en
  // `at`": una iteración recién creada por Add Game no tiene ni un evento del
  // que sacar su fecha, y es justo el destino bueno cuando no hay nada activo.
  const lastIteration = iterations[iterations.length - 1];
  const lastType = lastIteration ? latestTypeAt.get(lastIteration.id) : undefined;

  // Se lee ANTES de decidir la rama (no solo dentro del "crear") porque el
  // flag endless también decide: un ENDLESS no tiene playthroughs discretos,
  // así que retomarlo — aunque su último evento fuera un Dropped, que en un
  // juego normal significa "el próximo es un playthrough nuevo" — es SIEMPRE
  // volver a su contenedor único. Sin esto, jugar a un endless abandonado le
  // creaba un "Playthrough 2": un contenedor duplicado en un juego cuyo
  // modelo entero es que solo hay uno.
  const [game] = await tx
    .select({
      officialPlatforms: gamesTable.officialPlatforms,
      isEmulated: gamesTable.isEmulated,
      endless: gamesTable.endless,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);

  // ¿Se está jugando AHORA o se está registrando algo que ya pasó? Solo lo
  // segundo puede dejar el estado de hoy mintiendo (ver cabecera).
  const isPastPlay = startOfLocalDay(at) < startOfLocalDay(now);
  // Si el playthrough nace de una jugada del pasado, nace terminado.
  let bornClosed = false;

  if (!lastIteration || (endsPlaythrough(lastType) && !game?.endless)) {
    // Sin iteraciones o la última terminó (Beaten/Dropped): retomar es un
    // playthrough NUEVO (SPEC 4)...

    // ...salvo que la última sea uno de los históricos que esta misma función
    // cerró al vuelo y esto sea otra sesión vieja del mismo tirón: la segunda
    // tarde no estrena partida, se cuelga de la misma. Sin evento nuevo — el
    // playthrough ya tiene su arranque y su desenlace, y las horas van por la
    // sesión, no por el log.
    if (isPastPlay && lastIteration && autoClosedRuns.has(lastIteration.id)) {
      return { iterationId: lastIteration.id };
    }

    const [created] = await tx
      .insert(iterationsTable)
      .values({
        gameId,
        label: nextPlaythroughLabel(iterations.map((iteration) => iteration.label)),
        playedPlatform: game?.isEmulated ? 'Emulated' : (game?.officialPlatforms?.[0] ?? 'PC'),
        origin: 'Purchased',
        format: 'digital',
      })
      .returning({ id: iterationsTable.id });
    targetIterationId = created.id;
    // Nace cerrado solo si es historia Y venía de un desenlace: una segunda
    // vuelta a algo que ya te habías pasado, registrada a toro pasado, es una
    // partida terminada. Se deja fuera a propósito el primer playthrough de un
    // juego que no tenía ninguno (asignarle una sesión vieja a un juego recién
    // metido en la biblioteca): ahí no hay ningún desenlace previo que diga
    // que su historia está cerrada, y lo más probable es que esa partida siga
    // en marcha.
    bornClosed = isPastPlay && endsPlaythrough(lastType);
  } else {
    // Reanudar la última iteración: un on_hold/resting, un Playthrough
    // recién creado por Add Game que nunca se tocó, o el contenedor único de
    // un endless (venga del estado que venga — ver arriba).
    targetIterationId = lastIteration.id;
  }

  // Evento 'started' para dejar el playthrough activo (salvo que nazca ya
  // cerrado: el 'completed' de justo debajo). Va por insert directo y
  // no por addStateEvent —o sea, sin su auto-pausa de hermanos— y eso solo es
  // legítimo porque aquí arriba ya se ha descartado que haya ninguno activo,
  // ni a fecha `at` ni hoy: no queda nadie a quien pausar.
  //
  // Y solo si la iteración no traía ya un 'started' de `at` en adelante. Esa
  // rama existe porque el destino puede no tener NINGÚN evento hasta `at` y
  // seguir teniendo su arranque más tarde (la sesión de emulador del martes,
  // el playthrough empezado el viernes): ahí este insert no activaba nada —ya
  // lo estaba— y solo añadía un segundo "Started" al historial.
  if (!startedFromAt.has(targetIterationId)) {
    await tx.insert(stateEventsTable).values({
      iterationId: targetIterationId,
      type: 'started',
      occurredAt: at,
      datePrecision: 'datetime',
      note: null,
    });

    // Y su desenlace, en el mismo instante, si el playthrough acaba de nacer
    // para una jugada del pasado. Mismo instante y no "al final de la sesión"
    // porque aquí no se sabe cuánto duró (`at` es el arranque y la sesión la
    // cuelga el que llama): la fecha honesta es la de la partida, y el orden
    // lo desempata el id (latestRealStateEvent), así que el estado que se
    // deriva es Beaten y no Playing.
    if (bornClosed) {
      await tx.insert(stateEventsTable).values({
        iterationId: targetIterationId,
        type: 'completed',
        occurredAt: at,
        datePrecision: 'datetime',
        note: null,
      });
    }
  }

  return { iterationId: targetIterationId };
};
