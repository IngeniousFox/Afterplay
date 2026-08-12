import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import { endsPlaythrough, latestRealStateEvent } from '../../../../shared/playthroughState';
import type { StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, stateEventsTable } from '../../schema';

// El `tx` de una transacción de drizzle — mismo query builder que la
// conexión, tipado desde ella para no importar internos de drizzle.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export type ResolvedIteration = {
  iterationId: number;
};

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
// SIEMPRE dentro de una transacción del que llama — esto escribe (evento, y
// a veces la iteración nueva) y no debe quedar a medias.
export const resolveIterationForPlay = async (
  tx: Tx,
  gameId: number,
  at: Date,
): Promise<ResolvedIteration> => {
  const iterations = await tx
    .select({ id: iterationsTable.id })
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

  if (!lastIteration || (endsPlaythrough(lastType) && !game?.endless)) {
    // Sin iteraciones o la última terminó (Beaten/Dropped): retomar es un
    // playthrough NUEVO (SPEC 4).
    const [created] = await tx
      .insert(iterationsTable)
      .values({
        gameId,
        label: `Playthrough ${iterations.length + 1}`,
        playedPlatform: game?.isEmulated ? 'Emulated' : (game?.officialPlatforms?.[0] ?? 'PC'),
        origin: 'Purchased',
        format: 'digital',
      })
      .returning({ id: iterationsTable.id });
    targetIterationId = created.id;
  } else {
    // Reanudar la última iteración: un on_hold/resting, un Playthrough
    // recién creado por Add Game que nunca se tocó, o el contenedor único de
    // un endless (venga del estado que venga — ver arriba).
    targetIterationId = lastIteration.id;
  }

  // Evento 'started' para dejar el playthrough activo. Va por insert directo y
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
  }

  return { iterationId: targetIterationId };
};
