import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import {
  resolvePlaythroughForPlay,
  type PlaythroughStateEventRow,
} from '../../../../shared/domain/resolvePlaythrough';
import { gamesTable, iterationsTable, stateEventsTable } from '../../schema';

// El `tx` de una transacción de drizzle — mismo query builder que la
// conexión, tipado desde ella para no importar internos de drizzle.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export type ResolvedIteration = {
  iterationId: number;
};

// "¿En qué playthrough cae jugar a este juego AHORA (o en `at`)?" — la regla
// única de SPEC 4/4.5 que comparten las dos puertas del escritorio por las que
// entra tiempo jugado: el watcher/botón Play (startGameSession, `at` = ahora) y
// la asignación de sesiones de emulador (assignSession, `at` = la fecha real
// de la sesión, EMULADORES.md §6).
//
// LA REGLA YA NO ESTÁ AQUÍ: vive en src/shared/domain/resolvePlaythrough.ts
// como decisión pura, y la usa también el cronómetro del móvil (el Worker).
// Estuvo escrita dos veces —esta y una réplica a mano en el Worker que se había
// quedado atrás (AFTERPLAY-2.0 F-26)— y las dos contestaban distinto. Lo que
// queda aquí es solo el papel del escritorio: LEER las filas, PEDIR la decisión
// y EJECUTARLA dentro de la transacción del que llama. Las razones de cada rama
// (la foto en `at`, el hermano activo hoy, el "nace cerrado", la firma de los
// cerrados al vuelo…) están contadas allí, junto al código que las decide.
//
// `now` es un parámetro y no `new Date()` a pelo para que el reloj sea
// inyectable: los tests fijan las dos fechas y así no cambian de resultado
// según el día en que se ejecuten.
//
// SIEMPRE dentro de una transacción del que llama — esto escribe (eventos, y
// a veces la iteración nueva) y no debe quedar a medias. Y es esa transacción
// la que hace verdad lo que la decisión pura no puede garantizar sola: que las
// filas que se leen aquí sigan siendo las mismas cuando se escribe.
export const resolveIterationForPlay = async (
  tx: Tx,
  gameId: number,
  at: Date,
  now: Date = new Date(),
): Promise<ResolvedIteration> => {
  const playthroughs = await tx
    .select({ id: iterationsTable.id, label: iterationsTable.label })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

  // El log ENTERO de esos playthroughs, sin cortar por `at`: la decisión
  // necesita las dos lecturas (a fecha `at` y hoy), y son los eventos de UN
  // juego — traerlos enteros cuesta lo mismo que traer la mitad.
  const events: PlaythroughStateEventRow[] =
    playthroughs.length === 0
      ? []
      : await tx
          .select({
            id: stateEventsTable.id,
            iterationId: stateEventsTable.iterationId,
            type: stateEventsTable.type,
            occurredAt: stateEventsTable.occurredAt,
          })
          .from(stateEventsTable)
          .where(
            inArray(
              stateEventsTable.iterationId,
              playthroughs.map((playthrough) => playthrough.id),
            ),
          );

  // El juego se lee siempre (antes solo cuando no había nada activo): la
  // decisión pura no puede pedirlo a medias, y en el SQLite local es una
  // lectura por clave primaria.
  const [game] = await tx
    .select({
      officialPlatforms: gamesTable.officialPlatforms,
      isEmulated: gamesTable.isEmulated,
      endless: gamesTable.endless,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);

  const decision = resolvePlaythroughForPlay({ playthroughs, events, game, at, now });

  if (decision.kind === 'use') return { iterationId: decision.iterationId };

  let iterationId: number;
  if (decision.kind === 'create') {
    const [created] = await tx
      .insert(iterationsTable)
      .values({ gameId, ...decision.playthrough })
      .returning({ id: iterationsTable.id });
    iterationId = created.id;
  } else {
    iterationId = decision.iterationId;
  }

  // Uno a uno y EN ORDEN: cuando nace cerrado, el 'completed' comparte instante
  // con el 'started' y lo que decide el estado es el id (latestRealStateEvent).
  // Un insert múltiple también los numeraría en orden, pero así no depende de
  // cómo lo traduzca el driver.
  for (const event of decision.events) {
    await tx.insert(stateEventsTable).values({ iterationId, ...event });
  }

  return { iterationId };
};
