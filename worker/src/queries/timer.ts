import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { gamesTable, iterationsTable, sessionsTable } from '../../../src/main/db/schema';
import { computeDurationSec } from '../../../src/main/db/queries/sessions/sessionDuration';
import { endsPlaythrough, latestRealStateEvent } from '../../../src/shared/playthroughState';
import { stateEventsTable } from '../../../src/main/db/schema';
import type { ActiveTimer } from '../api-types';
import type { TenantDb } from '../db';

// EL CRONÓMETRO (REMOTO.md §7).
//
// Jugar en una Switch o una PS5 es hoy invisible para la app: no hay proceso
// que vigilar. Esto lo tapa — y de regalo cubre GeForce Now, los juegos de
// navegador y cualquier cosa que el watcher no pille.
//
// Lo que abre son SESIONES NORMALES (§7.1): `startedAt` y `endedAt` reales,
// `durationSec` real, `isManual: false`. Cuentan en el heatmap, las rachas, el
// histograma de duración, la franja horaria y los momentos igual que
// cualquier otra. La única diferencia es quién aprieta el botón — tú, en vez
// del vigilante de procesos — y eso se marca en `startedBy` para que la
// reconciliación del watcher no las mate (§7.3).
//
// POR QUÉ ESTO NO VA POR EL BUZÓN, a diferencia del Plan: una sesión en marcha
// tiene que existir AHORA. Una orden que el escritorio drena al arrancar no
// puede encender un "jugando ahora" ni recibir latidos. Es la única escritura
// de la web sobre tablas reales, y se limita a lo que no tiene alternativa:
// abrir la sesión (con el 'started' de su playthrough al lado, porque abrirla
// sin él deja el juego "sin jugar" con horas encima) y cerrarla — el latido,
// el "parar", y el cierre de la abandonada que manda el §7.4.

export class TimerError extends Error {}

// El playthrough al que colgar la sesión, y si además hay que dejarlo ACTIVO.
//
// La MISMA decisión que resolveIterationForPlay en el escritorio (SPEC 4.5)
// menos una rama: la de CREAR un playthrough nuevo. Esa ausencia es
// deliberada y responde la pregunta abierta del §9 — el cronómetro no
// inventa playthroughs desde el móvil; si el último se cerró para siempre, lo
// dice y te manda al PC.
//
// El resto sí se replica, rama a rama, y ninguna es un adorno:
//
//   - El 'started' cuando el playthrough no estaba activo. Esto devolvía solo
//     el id y startTimer se limitaba a insertar la sesión. Como el estado se
//     DERIVA del log de eventos, un juego recién dado de alta (playthrough con
//     CERO eventos) o uno aparcado en on_hold/resting acumulaba horas reales
//     mientras la biblioteca y las stats lo seguían contando como Unplayed/On
//     Hold — cuatro horas encima de un juego "sin jugar". El botón Play del
//     escritorio deja el 'started' escrito; este también.
//   - Qué iteración: la que esté en 'started' primero, y solo si no hay
//     ninguna, la última. Quedarse siempre con la de max(id) daba otra
//     respuesta cuando la activa no era la última.
//   - `endless`: en un juego sin final no hay playthroughs discretos, así que
//     un completed/dropped NO lo cierra para siempre — el escritorio vuelve a
//     su contenedor único (el `&& !game?.endless` de resolveIterationForPlay).
//     Sin esta rama, el cronómetro le contestaba "empieza otro desde tu PC" a
//     un endless: doblemente falso, porque no hay otro y el PC habría
//     reanudado este.
//   - `at`: lo POSTERIOR al instante que se pregunta no existe todavía para
//     esta decisión (el `lte(occurredAt, at)` de allí). Un 'completed'
//     fechado en el futuro —a mano, desde la ficha— bloqueaba el cronómetro en
//     la web mientras el PC seguía dejándote jugar.
type TimerTarget = { iterationId: number; needsStartEvent: boolean };

const resolveIterationForTimer = async (
  db: TenantDb,
  gameId: number,
  at: Date,
): Promise<TimerTarget> => {
  const iterations = await db
    .select({ id: iterationsTable.id })
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));

  if (iterations.length === 0) {
    throw new TimerError('este juego todavía no tiene ningún playthrough — ábrelo en tu PC');
  }

  const events = await db
    .select({
      id: stateEventsTable.id,
      iterationId: stateEventsTable.iterationId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
    })
    .from(stateEventsTable)
    .where(
      and(
        inArray(
          stateEventsTable.iterationId,
          iterations.map((iteration) => iteration.id),
        ),
        lte(stateEventsTable.occurredAt, at),
      ),
    );

  const eventsByIteration = new Map<number, typeof events>();
  for (const event of events) {
    const list = eventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    eventsByIteration.set(event.iterationId, list);
  }

  // El helper compartido ignora 'plan_to_play' (solo historial, nunca estado
  // real — ver schema.ts) y desempata por id.
  const latestTypeByIteration = new Map<number, (typeof events)[number]['type']>();
  for (const [iterationId, list] of eventsByIteration) {
    const latest = latestRealStateEvent(list);
    if (latest) latestTypeByIteration.set(iterationId, latest.type);
  }

  const active = iterations.find(
    (iteration) => latestTypeByIteration.get(iteration.id) === 'started',
  );
  if (active) return { iterationId: active.id, needsStartEvent: false };

  const last = iterations[iterations.length - 1];
  // La MISMA regla que usa el escritorio para saber si un playthrough se
  // cerró para siempre (completed/dropped). On Hold y Resting quedan fuera a
  // propósito: son pausas, y seguir jugándolas es seguir el mismo recorrido —
  // por eso se reanudan, con su 'started' encima.
  if (endsPlaythrough(latestTypeByIteration.get(last.id))) {
    // El flag `endless` se pregunta AQUÍ y no arriba como en el escritorio: es
    // la única rama que lo necesita y allí la lectura sale del SQLite local,
    // mientras que aquí es un viaje más a Turso desde el Worker.
    const [game] = await db
      .select({ endless: gamesTable.endless })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);

    if (!game?.endless) {
      throw new TimerError('este playthrough ya está cerrado — empieza otro desde tu PC');
    }
  }

  return { iterationId: last.id, needsStartEvent: true };
};

// Cuánto puede callarse un cronómetro antes de darlo por abandonado (§7.4).
//
// Seis horas, el MISMO número que ProcessWatcher.TIMER_STALE_HOURS, y por el
// mismo motivo: los navegadores móviles suspenden las pestañas de fondo sin
// piedad, así que el latido se para MIENTRAS SIGUES JUGANDO (§7.5). Un umbral
// corto partiría por la mitad una tarde de consola con el móvil en el
// bolsillo; el precio opuesto —dormirse con el cronómetro puesto suma hasta
// seis horas de más— está asumido en el §7.6 y se corrige editando la sesión.
//
// Está escrito dos veces, aquí y en el watcher (ProcessWatcher.
// TIMER_STALE_HOURS). El sitio bueno es src/shared, junto a playthroughState,
// que es donde ya viven las reglas que los dos lados comparten: mientras siga
// aquí, tocar un número obliga a tocar el otro. Dentro del Worker se exporta
// para que la biblioteca aplique la MISMA vara sin una tercera copia.
export const TIMER_STALE_MS = 6 * 3_600_000;

// La sesión de cronómetro VIVA ahora mismo, si la hay. Como mucho una: el
// §7 no contempla cronometrar dos juegos a la vez, y permitirlo sería casi
// siempre un despiste, no una intención.
//
// "Viva" es la regla de frescura del §7.4, no `endedAt IS NULL`: si el último
// latido lleva horas mudo la sesión se da por abandonada y SE CIERRA en ese
// latido, exactamente como hace sweepStaleTimerSessions en el PC. Y se cierra
// de verdad, no se ignora, porque una fila abierta para siempre envenena a
// todo el que pregunte "¿está jugando?" por su cuenta.
//
// Los otros que lo preguntan, y cómo quedan:
//   - isLive de /api/library y el `live` de /api/stats/summary: NO esperan a
//     este barrido, aplican la misma vara ellos mismos (buildLibraryData
//     importa TIMER_STALE_MS). Sin eso, abrir la portada pintaba LIVE un
//     cronómetro rancio si la carga llegaba antes que este GET.
//   - la guarda de startTimer: llama aquí primero, así que barre y decide con
//     la base ya limpia.
//   - isLive de /api/games/:id (queries/game.ts): ese sigue mirando solo
//     `endedAt === null`. Es la puerta que queda abierta; hasta el primer
//     barrido, la ficha enseña LIVE un cronómetro que la lista ya no enseña.
//
// ESTO ESCRIBE, y es el handler de un GET. Es a propósito y no hay otro sitio:
// el barrido tiene que ocurrir en el hueco en que el PC está apagado, y en ese
// hueco lo único que corre es esta web. El precio es que rompe el "GET lee,
// POST escribe" del router — que por eso trata /api/timer como ruta de
// escritura para la guarda CSRF (ver index.ts).
//
// Lo hace el Worker porque en ese hueco no lo hace nadie: el escritorio SÍ
// barre en cada ciclo (watcher.ts, sweepStaleTimerSessions), pero solo
// mientras está encendido. Un cronómetro olvidado el viernes, con el PC
// apagado el fin de semana, seguía "en marcha" el sábado desde el móvil:
// contador de 18 h y un 409 a cualquier otro Start.
//
// `now` es el instante de la petición y entra siempre. Con un Date.now() por
// defecto aquí dentro, el GET decidía la frescura con un reloj distinto del
// que el router ya tenía en la mano.
export const getActiveTimer = async (db: TenantDb, now: number): Promise<ActiveTimer | null> => {
  const rows = await db
    .select({
      sessionId: sessionsTable.id,
      gameId: iterationsTable.gameId,
      gameTitle: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
    .where(and(isNull(sessionsTable.endedAt), eq(sessionsTable.startedBy, 'timer')))
    .orderBy(desc(sessionsTable.id));

  let live: (typeof rows)[number] | undefined;

  for (const row of rows) {
    // Si nunca llegó a latir (la pestaña murió en el primer minuto), el
    // arranque hace de latido: es lo mismo que hace el watcher.
    const lastBeat = row.lastHeartbeatAt ?? row.startedAt;
    if (now - lastBeat.getTime() < TIMER_STALE_MS) {
      // Vienen ordenadas por id descendente: la primera fresca es la última.
      if (!live) live = row;
      continue;
    }

    // Mismo cierre que closeSessionIfOpen en el escritorio, con su misma
    // guarda: el `endedAt IS NULL` del WHERE deja que un "parar" que llegue a
    // la vez mande sobre esto (§7.5) en vez de pisarle la hora de fin.
    const closed = await db
      .update(sessionsTable)
      .set({ endedAt: lastBeat, durationSec: computeDurationSec(row.startedAt, lastBeat) })
      .where(and(eq(sessionsTable.id, row.sessionId), isNull(sessionsTable.endedAt)))
      .returning({ id: sessionsTable.id });

    // El log DESPUÉS de comprobar que el UPDATE tocó algo, igual que el
    // `if (!closed) continue` del escritorio. Si ganó el "parar" simultáneo, la
    // hora de fin la puso el usuario: cantar "cerrada en su ultimo latido"
    // sería inventarse por escrito la misma explicación que stopTimer se cuida
    // de no dar en voz alta.
    if (closed.length === 0) continue;
    console.log(
      `[timer] [info] sesion ${row.sessionId} de cronometro sin latir ${TIMER_STALE_MS / 3_600_000}h - cerrada en su ultimo latido`,
    );
  }

  if (!live) return null;

  return {
    sessionId: live.sessionId,
    gameId: live.gameId,
    gameTitle: live.gameTitle,
    coverUrl: live.coverUrl,
    startedAt: live.startedAt.getTime(),
    lastHeartbeatAt: live.lastHeartbeatAt ? live.lastHeartbeatAt.getTime() : null,
  };
};

export const startTimer = async (
  db: TenantDb,
  gameId: number,
  now: number,
): Promise<ActiveTimer> => {
  // La frescura del §7.4 va PRIMERO, y de paso barre: getActiveTimer cierra
  // el cronómetro rancio que quedara abierto, así que un olvido de anteayer ya
  // no bloquea la guarda de aquí abajo — que es justo lo que hacía.
  const live = await getActiveTimer(db, now);
  if (live) throw new TimerError('ya tienes un cronómetro en marcha');

  // Una cualquiera abierta —del watcher o de otro cronómetro— bloquea: dos
  // sesiones vivas del mismo juego serían horas contadas dos veces, y de
  // juegos distintos casi siempre es un cronómetro que se te olvidó parar.
  // La rama 'timer' del mensaje se queda como red: aquí ya no puede llegar una
  // sesión de cronómetro viva, pero sí una que getActiveTimer no ve (sin
  // iteración o sin juego, que sus joins descartan).
  const [anyOpen] = await db
    .select({ id: sessionsTable.id, startedBy: sessionsTable.startedBy })
    .from(sessionsTable)
    .where(isNull(sessionsTable.endedAt))
    .limit(1);

  if (anyOpen) {
    throw new TimerError(
      anyOpen.startedBy === 'timer'
        ? 'ya tienes un cronómetro en marcha'
        : 'ya hay una sesión en marcha en tu PC',
    );
  }

  const startedAt = new Date(now);
  const target = await resolveIterationForTimer(db, gameId, startedAt);

  const sessionInsert = db
    .insert(sessionsTable)
    .values({
      iterationId: target.iterationId,
      // Tiempo medido de verdad, igual que la del watcher. Lo único distinto
      // es quién apretó el botón.
      isManual: false,
      startedAt,
      endedAt: null,
      durationSec: null,
      // El primer latido es el propio arranque: si el móvil se queda mudo
      // desde el minuto uno, el barrido de rancias —el de aquí y el del
      // watcher— tiene de dónde agarrarse para poner la hora de fin.
      lastHeartbeatAt: startedAt,
      startedBy: 'timer',
      datePrecision: 'datetime',
    })
    .returning({ id: sessionsTable.id });

  // Los dos INSERTs van en un `batch` de libsql, que es una transacción: o
  // están la sesión y el 'started' o no está ninguno. A medias sería
  // exactamente el estado que este arreglo viene a quitar — horas colgando de
  // un playthrough que nadie ve activo, o al revés.
  //
  // Lo que el batch NO cubre, y el escritorio sí (allí resolveIterationForPlay
  // corre dentro de la transacción de quien llama): la DECISIÓN se lee fuera.
  // Entre aquel SELECT y este batch cabe una escritura ajena —el PC, el
  // drenado del buzón— y el 'started' acabaría encima de un playthrough que ya
  // no es el que se leyó. El cliente HTTP de libsql sí sabe abrir una
  // transacción interactiva, pero son tres o cuatro viajes más a Turso por cada
  // Start; se prefiere un viaje y una ventana de milisegundos, porque el caso
  // que de verdad duele —dos sesiones vivas a la vez— lo corta la guarda de
  // arriba, que es lo que se comprueba justo antes.
  const inserted = target.needsStartEvent
    ? (
        await db.batch([
          sessionInsert,
          db.insert(stateEventsTable).values({
            iterationId: target.iterationId,
            type: 'started',
            // La misma fecha que el arranque de la sesión, y con precisión de
            // instante: esto no es una fecha tecleada, es un botón pulsado.
            occurredAt: startedAt,
            datePrecision: 'datetime',
            note: null,
          }),
        ])
      )[0]
    : await sessionInsert;

  const [session] = inserted;

  const active = await getActiveTimer(db, now);
  if (!active) throw new TimerError(`no se pudo abrir la sesión ${session.id}`);
  return active;
};

// El latido. Frecuencia de ~1 por minuto: una sesión de tres horas son 180
// peticiones, nada frente a las 100.000 diarias del plan gratuito. El watcher
// late cada ~5s porque puede; aquí sería quemar peticiones sin ganar nada.
export const beatTimer = async (db: TenantDb, sessionId: number, now: number): Promise<boolean> => {
  const rows = await db
    .update(sessionsTable)
    .set({ lastHeartbeatAt: new Date(now) })
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        isNull(sessionsTable.endedAt),
        eq(sessionsTable.startedBy, 'timer'),
      ),
    )
    .returning({ id: sessionsTable.id });

  return rows.length > 0;
};

// Parar. El §7.5 en una línea: el "parar" explícito MANDA sobre el latido.
//
// Los navegadores móviles suspenden las pestañas de fondo, así que es probable
// que el latido se haya parado hace rato aunque siguieras jugando. Por eso el
// fin es AHORA y no el último latido: el latido solo decide cuando nunca
// llegaste a pararlo.
export const stopTimer = async (
  db: TenantDb,
  sessionId: number,
  now: number,
): Promise<{ durationSec: number }> => {
  const [session] = await db
    .select({
      id: sessionsTable.id,
      startedAt: sessionsTable.startedAt,
      endedAt: sessionsTable.endedAt,
      startedBy: sessionsTable.startedBy,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  if (!session) throw new TimerError('esa sesión no existe');
  if (session.startedBy !== 'timer') {
    throw new TimerError('esa sesión no la abrió el cronómetro');
  }
  // Ya cerrada. No se reabre, y NO se afirma por qué: aquí no hay forma de
  // saber si la paraste tú desde otra pestaña o si el escritorio la recogió
  // por llevar horas muda. Decir lo segundo cuando fue lo primero —que es lo
  // que hacía— es inventarse una explicación delante del usuario.
  if (session.endedAt !== null) {
    throw new TimerError('esa sesión ya estaba parada');
  }

  const endedAt = new Date(now);
  // La MISMA función que usa closeSession en el escritorio: nunca negativa y
  // redondeada al segundo.
  const durationSec = computeDurationSec(session.startedAt, endedAt);

  await db
    .update(sessionsTable)
    .set({ endedAt, durationSec })
    .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.endedAt)));

  return { durationSec };
};
