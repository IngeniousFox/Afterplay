import { and, asc, eq, isNull, notInArray } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { createPlannedGame } from '../db/queries/games/createPlannedGame';
import { reorderUpNext, setPlanPinned } from '../db/queries/games/getPlannedGames';
import { warmImageCache, warmSteamData } from '../external/warmNewGame';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
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

// Tope por pasada. No es por la DB —el buzón nunca va a tener cientos de
// filas— sino por la red: cada alta pide IGDB, HLTB, SteamGridDB y la tienda de
// Steam de una en una, y drenar cincuenta de golpe encadena cincuenta rondas
// justo en el arranque tras un fin de semana apuntando juegos, que es cuando el
// resto de la app también está pidiendo lo suyo.
//
// Cicatriz de la que conviene enterarse aquí: cada orden se aplica DENTRO de
// withDbAccess, red incluida, porque createPlannedGame enriquece y escribe de
// una pieza y desde este lado no hay por dónde partirlo. El candado se suelta
// entre orden y orden, así que el tope no le acorta la espera a nadie: quien
// espera es el swap de conexión en caliente, que necesita la DB ociosa (y si no
// la consigue a tiempo, se pospone). Lo único que el tope acorta es cuánto dura
// la pasada entera.
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
//
// Aquí vivían además 'devolvió 5' y 'devolvió 429', que no las produce NINGÚN
// error del main: axios habla en inglés y no hay un solo `throw` con ese
// texto. Eran dos firmas muertas que daban una sensación falsa de cobertura
// del 5xx y del 429; lo que sí los pilla de verdad es el `status` de la
// respuesta, que ahora se mira aparte y por estructura.
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
];

// Las mismas firmas de arriba, pero por ESTRUCTURA en vez de por texto: el
// mensaje de axios ("Request failed with status code 502") es cosa de la
// versión de axios de turno, mientras que `response.status` y `code` son el
// dato de verdad. Y hay huecos que el texto no tapa: "connect ETIMEDOUT
// 1.2.3.4:443" no contiene ninguno de los HINTS —'timed out' lleva espacio—
// así que un timeout de conexión seco se colaba como definitivo.
const TRANSIENT_CODES = [
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_NETWORK',
];

const hasTransientShape = (error: unknown): boolean => {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && TRANSIENT_CODES.includes(code.toUpperCase());
};

// Tope de eslabones al recorrer las causas. `cause` es un campo cualquiera y
// nada impide que alguien monte un ciclo; un bucle infinito aquí congelaría el
// drenado entero, que corre después de cada pull.
const MAX_CAUSE_DEPTH = 5;

// El error de fuera Y toda su cadena de causas.
//
// Antes se miraba UNO de los dos: si había `cause`, solo la causa; si no, solo
// el mensaje de fuera. Con eso, una capa que envuelva un fallo de red en un
// error propio —o que envuelva dos veces— llega al drenado disfrazada de
// veredicto definitivo, y un alta perfectamente buena se sella con
// `processedAt` sin gastar ni uno de los tres intentos.
const causeChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== null && current !== undefined;
    depth++
  ) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
};

// El texto de un eslabón cualquiera, sin poder lanzar.
//
// `String(...)` NO es una operación segura: un valor con prototipo nulo
// (Object.create(null)) o con un toString propio que revienta tira una
// excepción al convertirlo. Suena a laboratorio, pero esto corre DENTRO del
// `catch` del bucle de órdenes, y ahí una excepción no la para nadie hasta
// runPlanMailboxDrain: se lleva por delante el resto de la pasada y deja la
// fila a medias, sin processedAt y sin el error guardado. Mientras solo se
// miraba el mensaje del error de fuera el riesgo no existía; recorrer la
// cadena entera lo trajo, porque un `cause` puede ser literalmente cualquier
// valor. Un eslabón ilegible no ciega a los demás: se queda sin texto y la
// cadena sigue.
const textOf = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    return '';
  }
};

// PUNTO CIEGO conocido, y no se tapa desde aquí: esto solo puede clasificar lo
// que le LLEGA. Un 502 o un timeout de la tienda de Steam durante un alta con
// source { steamAppId } no llega — getSteamStoreDetails (steam/store.ts) se
// traga cualquier error en su catch y devuelve null, y resolveFromSteam
// (db/queries/games/resolveGameEnrichment.ts) convierte ese null en un Error
// pelado, sin cause, sin response.status y sin code, e indistinguible del juego
// retirado de la tienda de verdad. Así que se clasifica como definitivo y la
// orden se quema sin gastar ni uno de los tres intentos.
//
// El arreglo vive en esos dos ficheros: que el fallo original viaje como
// `cause`, o que la tienda devuelva un resultado discriminado. En cuanto
// llegue, lo de aquí ya lo ve sin tocar nada. Casar el texto en castellano
// desde este lado sería peor: ata el drenado a la redacción exacta de otro
// módulo y reintentaría tres veces de más los juegos retirados de verdad.
const isTransient = (error: unknown): boolean =>
  causeChain(error).some((link) => {
    if (hasTransientShape(link)) return true;
    const message = textOf(link).toLowerCase();
    return TRANSIENT_HINTS.some((hint) => message.includes(hint));
  });

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
  // Por textOf y no por String() por lo mismo que arriba: esto también se
  // llama dentro del catch del bucle.
  const message = cause instanceof Error ? cause.message : textOf(error);
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
    const game = await createPlannedGame({
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
    // LO MISMO que hace el botón "Add" del escritorio, ni más ni menos.
    // Faltaba: createPlannedGame resuelve el appid, pero las etiquetas, las
    // reseñas y el catálogo de logros los pedía el handler IPC, y por aquí no
    // se pasa. Un juego añadido desde el móvil se quedaba a medias hasta el
    // siguiente refresco general — Ōkami HD era exactamente eso.
    //
    // Los tres, y con las MISMAS opciones que el handler (ver ipc/games.ts,
    // 'games:createPlanned'): sin aviso en pantalla para los logros, porque
    // planear un juego no es haberlo jugado. Curiosidades no, por lo mismo
    // que allí — se generan al pasar a la biblioteca.
    warmImageCache(game);
    warmSteamData(game);
    void queueAchievementsRefreshForGame(game.id, { notify: false });
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
