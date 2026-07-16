import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../..';
import type { StateEvent } from '../../../../shared/types';
import { gamesTable, iterationsTable, stateEventsTable } from '../../schema';

// El `tx` de una transacción de drizzle — mismo query builder que la
// conexión, tipado desde ella para no importar internos de drizzle.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export type ResolvedIteration = {
  iterationId: number;
  // La iteración destino no tenía sesión de inicio — quien llame debe anclar
  // la sesión que cree/asigne como startSessionId de la iteración.
  needsStartAnchor: boolean;
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
// SIEMPRE dentro de una transacción del que llama — esto escribe (evento, y
// a veces la iteración nueva) y no debe quedar a medias.
export const resolveIterationForPlay = async (
  tx: Tx,
  gameId: number,
  at: Date,
): Promise<ResolvedIteration> => {
  const iterations = await tx
    .select({ id: iterationsTable.id, startSessionId: iterationsTable.startSessionId })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

  const latestTypeByIteration = new Map<number, StateEvent['type']>();
  if (iterations.length > 0) {
    const events = await tx
      .select({ iterationId: stateEventsTable.iterationId, type: stateEventsTable.type })
      .from(stateEventsTable)
      .where(
        inArray(
          stateEventsTable.iterationId,
          iterations.map((iteration) => iteration.id),
        ),
      )
      .orderBy(asc(stateEventsTable.occurredAt), asc(stateEventsTable.id));
    for (const event of events) {
      // 'plan_to_play' es solo historial (ver schema.ts), no estado — sin
      // esto, un juego recién pasado del Plan a la biblioteca tendría el
      // plan como "último estado" y confundiría la lógica de abajo.
      if (event.type === 'plan_to_play') continue;
      latestTypeByIteration.set(event.iterationId, event.type);
    }
  }

  const activeIteration = iterations.find(
    (iteration) => latestTypeByIteration.get(iteration.id) === 'started',
  );

  // Si la iteración destino ya tiene sesión de inicio, su "Started At" está
  // fijado y no se toca; si no, la sesión que cuelgue el llamador pasa a ser
  // su inicio. Cubre los tres casos: iteración nueva, iteración reanudada
  // que nunca se ancló (Playthrough recién creado por Add Game, sin
  // sesiones), y por robustez una activa a la que le faltara.
  if (activeIteration) {
    // Ya está "Playing": solo falta colgar la sesión.
    return {
      iterationId: activeIteration.id,
      needsStartAnchor: activeIteration.startSessionId == null,
    };
  }

  let targetIterationId: number;
  let targetHasStartSession: boolean;

  const lastIteration = iterations[iterations.length - 1];
  const lastType = lastIteration ? latestTypeByIteration.get(lastIteration.id) : undefined;
  const lastIsTerminal = lastType === 'completed' || lastType === 'dropped';

  if (!lastIteration || lastIsTerminal) {
    // Sin iteraciones o la última terminó (Beaten/Dropped): retomar es un
    // playthrough NUEVO (SPEC 4).
    const [game] = await tx
      .select({
        officialPlatforms: gamesTable.officialPlatforms,
        isEmulated: gamesTable.isEmulated,
      })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);

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
    targetHasStartSession = false; // su inicio = la sesión del llamador
  } else {
    // Reanudar la última iteración: un on_hold/resting (ya tiene su inicio)
    // o un Playthrough recién creado por Add Game que nunca se tocó (sin
    // sesiones → el llamador la anclará).
    targetIterationId = lastIteration.id;
    targetHasStartSession = lastIteration.startSessionId != null;
  }

  // Evento 'started' para dejar el playthrough activo. No hay hermano activo
  // que pausar (acabamos de comprobar que no hay iteración activa), así que
  // basta el insert directo sin la lógica de pausa de addStateEvent.
  await tx.insert(stateEventsTable).values({
    iterationId: targetIterationId,
    type: 'started',
    occurredAt: at,
    datePrecision: 'datetime',
    note: null,
  });

  return { iterationId: targetIterationId, needsStartAnchor: !targetHasStartSession };
};
