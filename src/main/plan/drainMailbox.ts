import { and, asc, eq, isNull, notInArray } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { createPlannedGame } from '../db/queries/games/createPlannedGame';
import { reorderUpNext, setPlanPinned } from '../db/queries/games/getPlannedGames';
import { planMailboxTable } from '../db/schema';
import type { PlanMailboxEntry } from '../../shared/planMailbox';

// El drenado del buzón del Plan (REMOTO.md §6.2).
//
// El móvil ENCOLA en `plan_mailbox`; esto lo aplica llamando al código de
// verdad. Cero lógica duplicada: un alta pasa por createPlannedGame, con su
// mismo enriquecimiento (IGDB + HLTB + SteamGridDB + appid de Steam) y su
// misma transacción. La web no sabe nada de eso y no tiene por qué.
//
// Corre después de CADA pull de Turso (ver runSyncCycle): las filas las
// escribió el Worker en el remoto, así que en local no existen hasta que el
// sync las baja.

// Tope por pasada. No es por rendimiento —el buzón nunca va a tener cientos de
// filas— sino por contención: cada alta es una llamada de red a IGDB y a HLTB
// dentro del candado de la DB, y drenar cincuenta de golpe dejaría la interfaz
// esperando en el primer arranque tras un fin de semana apuntando juegos.
const MAX_PER_PASS = 25;

// Cuántas veces se reintenta una orden que falló por algo PASAJERO antes de
// darla por perdida. Vive en memoria y no en la tabla a propósito: reiniciar la
// app es una oportunidad nueva y legítima, y añadir una columna de intentos
// obligaría a una migración para algo que no necesita sobrevivir al proceso.
const MAX_TRANSIENT_ATTEMPTS = 3;

// Un tipo de orden que este escritorio no conoce. No es un fallo: el payload
// es JSON precisamente para poder añadir tipos nuevos, así que lo normal es un
// Worker más nuevo hablándole a un escritorio que aún no se ha actualizado.
class UnknownEntryType extends Error {}

// La orden no casó con ninguna fila. No es una excepción del motor, así que
// hay que fabricarla: setPlanPinned y reorderUpNext devuelven `false` en vez
// de lanzar, y tragarse ese false era dar por aplicada una orden que no hizo
// nada — sin dejar rastro ni en pendientes ni en fallos.
class NothingMatched extends Error {}

// Fallos que NO son culpa de la orden: la red, un 5xx de Twitch, un timeout.
// Reintentarlos tiene sentido; quemarlos es destruir un alta perfectamente
// buena porque IGDB tuvo un mal minuto. La lista es de firmas, no de tipos,
// porque cada capa (fetch, axios, undici) envuelve el error a su manera.
const TRANSIENT_HINTS = [
  'fetch failed',
  'network',
  'timeout',
  'timed out',
  'econnreset',
  'econnrefused',
  'enotfound',
  'eai_again',
  'socket hang up',
  'request failed with status code 5',
  'status code 429',
  'devolvió 5',
  'devolvió 429',
];

const isTransient = (error: unknown): boolean => {
  const message = (
    (error as { cause?: unknown })?.cause instanceof Error
      ? ((error as { cause: Error }).cause.message ?? '')
      : error instanceof Error
        ? error.message
        : String(error)
  ).toLowerCase();
  return TRANSIENT_HINTS.some((hint) => message.includes(hint));
};

// El error que se GUARDA, que no es el que se registra en consola.
//
// Un fallo de drizzle trae el INSERT entero como mensaje —los 46 nombres de
// columna, los interrogantes y el RETURNING— y eso acaba en una tarjeta de un
// móvil de 375px. La causa real vive en `cause` y es una línea ("UNIQUE
// constraint failed: games.igdbid"); el resto es ruido que además esconde el
// dato. En consola sí se vuelca el error completo, que es donde sirve.
const MAX_STORED_ERROR = 200;

const conciseError = (error: unknown): string => {
  const cause = (error as { cause?: unknown })?.cause;
  const message =
    cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
  // La primera línea: los errores del motor traen la buena delante y el stack
  // detrás.
  const firstLine = message.split('\n')[0].trim();
  return firstLine.length > MAX_STORED_ERROR
    ? `${firstLine.slice(0, MAX_STORED_ERROR - 1)}…`
    : firstLine;
};

// Aplica UNA orden llamando al código de verdad.
//
// Nada de UPDATEs a mano: setPlanPinned y reorderUpNext ya existen y llevan
// dentro invariantes que a pelo se pierden — acotar por `planned = true`, y
// repartir las marcas que YA existen en vez de inventar fechas nuevas.
const applyEntry = async (entry: PlanMailboxEntry): Promise<void> => {
  if (entry.type === 'add') {
    await createPlannedGame({
      source: entry.source,
      note: entry.note,
      // El alta desde el móvil no pregunta notas del juego ni arte a medida:
      // es un gesto de una pulsación. Lo que haga falta se edita luego en el
      // escritorio, que es donde están las herramientas.
      gameNotes: null,
      coverUrl: entry.coverUrl,
      heroUrl: null,
      steamGridDbId: null,
    });
    return;
  }

  // El `false` de estas dos SÍ importa: significa que el juego ya no está
  // planeado (lo promocionaste antes de que drenara) o que ya no queda nada
  // fijado que reordenar. Dejarlo pasar marcaba la orden como aplicada con
  // error null, y entonces no aparecía ni en pendientes ni en fallos.
  if (entry.type === 'pin') {
    if (!(await setPlanPinned(entry.gameId, true))) {
      throw new NothingMatched('el juego ya no está en tu plan');
    }
    return;
  }

  if (entry.type === 'unpin') {
    if (!(await setPlanPinned(entry.gameId, false))) {
      throw new NothingMatched('el juego ya no está en tu plan');
    }
    return;
  }

  if (entry.type === 'reorder') {
    if (!(await reorderUpNext(entry.orderedIds))) {
      throw new NothingMatched('ya no quedan suficientes juegos fijados que reordenar');
    }
    return;
  }

  // Sin este `throw`, el `if` de arriba era un `else` implícito y CUALQUIER
  // tipo desconocido caía en el reorden, reventaba dentro de la transacción, y
  // la fila se marcaba procesada igualmente: la orden quedaba destruida sin
  // posibilidad de recuperarla ni actualizando el escritorio después.
  throw new UnknownEntryType(`tipo de orden desconocido: ${(entry as { type: string }).type}`);
};

// Órdenes que esta VERSIÓN de la app no sabe aplicar, y que por tanto se dejan
// pendientes para una futura. Se recuerdan aquí para poder EXCLUIRLAS de la
// consulta: la página es `ORDER BY id ASC LIMIT 25`, así que sin esto un puñado
// de órdenes desconocidas se queda clavado en la cabeza de la cola y ninguna
// orden posterior —de un tipo que sí entendemos— llega a drenarse nunca.
const unsupportedIds = new Set<number>();
// Intentos gastados por orden en fallos pasajeros. Misma vida que el proceso.
const transientAttempts = new Map<number, number>();

export type DrainResult = { applied: number; failed: number; deferred: number };

// Guarda de re-entrancia, igual que la de runSyncCycle.
//
// Sin ella, el tic de 60s podía arrancar una pasada sobre las MISMAS filas que
// otra todavía estaba aplicando: `processedAt` se sella al final de cada
// orden, y withDbAccess es un contador de queries en vuelo, no un mutex. Con
// 25 altas —cada una con su ida y vuelta a IGDB y a HLTB— la pasada pasa de un
// minuto de sobra, y como `games.steamAppId` no lleva UNIQUE el resultado eran
// dos juegos planeados idénticos.
let draining = false;

export const drainPlanMailbox = async (): Promise<DrainResult> => {
  const result: DrainResult = { applied: 0, failed: 0, deferred: 0 };
  if (draining) return result;
  draining = true;

  try {
    const skip = [...unsupportedIds];
    const pending = await withDbAccess(async () =>
      getDb()
        .select({ id: planMailboxTable.id, payload: planMailboxTable.payload })
        .from(planMailboxTable)
        .where(
          skip.length === 0
            ? isNull(planMailboxTable.processedAt)
            : and(isNull(planMailboxTable.processedAt), notInArray(planMailboxTable.id, skip)),
        )
        .orderBy(asc(planMailboxTable.id))
        .limit(MAX_PER_PASS),
    );

    if (pending.length === 0) return result;
    console.log(`[plan] drenando ${pending.length} orden(es) del buzón`);

    for (const row of pending) {
      let failure: string | null = null;
      try {
        await withDbAccess(async () => applyEntry(row.payload));
        result.applied++;
        transientAttempts.delete(row.id);
      } catch (error) {
        // Un tipo que esta versión no conoce se queda PENDIENTE y se aparta de
        // la cola: lo normal es que sea un Worker más nuevo, y la orden es
        // válida — solo le falta una versión de la app que sepa aplicarla.
        if (error instanceof UnknownEntryType) {
          if (!unsupportedIds.has(row.id)) {
            console.warn(
              `[plan] orden #${row.id} de un tipo que esta versión no conoce, la dejo para más adelante`,
            );
          }
          unsupportedIds.add(row.id);
          result.deferred++;
          continue;
        }

        // Un fallo PASAJERO tampoco quema la orden: un 503 de Twitch o un
        // corte de red no dicen nada sobre si el alta era buena. Se reintenta
        // en los próximos ciclos, con tope para que un error mal clasificado
        // no se quede dando vueltas para siempre.
        const attempts = (transientAttempts.get(row.id) ?? 0) + 1;
        if (isTransient(error) && attempts < MAX_TRANSIENT_ATTEMPTS) {
          transientAttempts.set(row.id, attempts);
          result.deferred++;
          console.warn(
            `[plan] orden #${row.id} falló por algo pasajero (intento ${attempts}/${MAX_TRANSIENT_ATTEMPTS}), la reintento:`,
            error,
          );
          continue;
        }

        failure = conciseError(error);
        result.failed++;
        // Completo en consola (con su stack), recortado en la tabla.
        console.warn(`[plan] la orden #${row.id} del buzón falló:`, error);
      }

      // Se marca procesada pase lo que pase MENOS en los dos casos de arriba.
      // Una orden que revienta de verdad —un juego que IGDB ya no tiene, uno
      // borrado entre medias— no puede quedarse reintentándose en cada ciclo
      // para siempre: el error queda guardado para poder mirarlo, no para
      // insistir.
      transientAttempts.delete(row.id);
      await withDbAccess(async () =>
        getDb()
          .update(planMailboxTable)
          .set({ processedAt: new Date(), error: failure })
          .where(eq(planMailboxTable.id, row.id)),
      );
    }

    console.log(
      `[plan] buzón drenado: ${result.applied} aplicada(s), ${result.failed} fallida(s)` +
        (result.deferred > 0 ? `, ${result.deferred} para más adelante` : ''),
    );
    return result;
  } finally {
    draining = false;
  }
};

// Nunca lanza: un buzón que falla no puede tumbar el arranque ni el ciclo de
// sync.
//
// `onChanged` avisa al renderer. Hace falta porque los hooks de juegos usan
// `staleTime: Infinity`, y eso solo es seguro mientras TODO el que escribe
// avisa: hasta ahora los escritores eran las mutations del renderer y el
// watcher, y este drenado era un tercero silencioso. Sin el aviso, un juego
// añadido desde el móvil no aparecía en el PC en toda la sesión.
export const runPlanMailboxDrain = async (onChanged?: () => void): Promise<void> => {
  try {
    const { applied } = await drainPlanMailbox();
    if (applied > 0) onChanged?.();
  } catch (error) {
    console.warn(
      '[plan] fallo inesperado drenando el buzón (se reintenta en el próximo ciclo):',
      error,
    );
  }
};
