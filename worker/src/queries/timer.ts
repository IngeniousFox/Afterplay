import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../../../src/main/db/schema';
import { computeDurationSec } from '../../../src/main/db/queries/sessions/sessionDuration';
import {
  resolvePlaythroughForPlay,
  type PlaythroughStateEventRow,
} from '../../../src/shared/domain/resolvePlaythrough';
import { TIMER_STALE_MS, isTimerStale, timerLastBeat } from '../../../src/shared/timerFreshness';
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
// sin él deja el juego "sin jugar" con horas encima, y con el playthrough
// mismo si la regla compartida dice que toca uno nuevo) y cerrarla — el latido,
// el "parar", y el cierre de la abandonada que manda el §7.4.

export class TimerError extends Error {}

// LAS FILAS que necesita la decisión de "a qué playthrough cuelga la sesión".
//
// La decisión NO está aquí: es resolvePlaythroughForPlay
// (src/shared/domain/resolvePlaythrough.ts), la misma función pura que usa el
// escritorio. Aquí vivió una réplica "rama a rama" escrita a mano
// (resolveIterationForTimer) que se había quedado atrás de la del PC
// (AFTERPLAY-2.0 F-26): no miraba el log posterior a `at`, así que no veía un
// hermano ya activo ni un 'started' ya escrito. Ahora el Worker lee las filas,
// pide la decisión y la ejecuta — salvo cuando la decisión es CREAR un
// playthrough: eso el cronómetro lo sigue rechazando a propósito (ver
// startTimer).
//
// Las tres lecturas van en UN `batch` (un viaje a Turso, y una foto
// coherente: es una transacción de lectura). Para eso los eventos se buscan
// por el juego con un join y no con los ids de las iteraciones, que obligaría
// a esperar a la primera lectura. El log va ENTERO, sin cortar por `at`: la
// decisión necesita también lo posterior.
const readPlaythroughRows = async (
  db: TenantDb,
  gameId: number,
): Promise<{
  game: { endless: boolean; isEmulated: boolean; officialPlatforms: string[] | null } | undefined;
  playthroughs: { id: number; label: string }[];
  events: PlaythroughStateEventRow<number>[];
}> => {
  const [games, playthroughs, events] = await db.batch([
    db
      .select({
        endless: gamesTable.endless,
        isEmulated: gamesTable.isEmulated,
        officialPlatforms: gamesTable.officialPlatforms,
      })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1),
    db
      .select({ id: iterationsTable.id, label: iterationsTable.label })
      .from(iterationsTable)
      .where(eq(iterationsTable.gameId, gameId)),
    db
      .select({
        id: stateEventsTable.id,
        iterationId: stateEventsTable.iterationId,
        type: stateEventsTable.type,
        occurredAt: stateEventsTable.occurredAt,
      })
      .from(stateEventsTable)
      .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id))
      .where(eq(iterationsTable.gameId, gameId)),
  ]);

  const [game] = games;
  // Precondición del CRONÓMETRO, no de la regla: antes un gameId inexistente
  // caía en "no tiene ningún playthrough" y se rechazaba de rebote; ahora que
  // la decisión puede contestar "crea uno", acabaría en un playthrough
  // colgando de un juego que no está. Se rechaza antes de decidir nada.
  if (!game) throw new TimerError('ese juego no existe');

  return { game, playthroughs, events };
};

// "Sigue jugando AHORA", que no es lo mismo que "la fila no tiene endedAt".
//
// Vive aquí, junto al resto del cronómetro, y lo aplican los TRES que
// contestan esa pregunta: la lista (buildLibraryData), la ficha
// (getGameDetail) y el barrido de aquí abajo. Estuvo solo en dos de los tres
// y el resultado era que la ficha pintaba LIVE un cronómetro que la lista ya
// no pintaba: dos pantallas de la misma app contestando distinto a "¿está
// jugando?" hasta que alguien pedía /api/timer.
//
// Las de CRONÓMETRO llevan pegada la regla de frescura del §7.4 —la
// compartida con el watcher, ver src/shared/timerFreshness—: se abren desde el
// móvil y se olvidan (§7.6), así que un latido de hace horas significa
// abandonada.
//
// Las del WATCHER se quedan como estaban, y no es un olvido: su regla no es un
// umbral de tiempo sino "¿sigue vivo el proceso?", y eso solo lo puede
// contestar el PC. Su latido además se pausa cuando la pantalla se bloquea, o
// sea que un latido viejo ahí no significa nada. Una que quede abierta por un
// corte de luz sigue pintando LIVE hasta que el PC arranque y reconcilie:
// mismo comportamiento que el escritorio, y no es una consulta quien lo
// cambia.
//
// Cerrarlas tampoco es cosa de quien pregunta: la lista y la ficha son
// LECTURAS. El único que cierra es getActiveTimer, y que un GET escriba ya es
// bastante excepción con una.
export const isSessionLive = (
  session: { startedBy: 'watcher' | 'timer'; startedAt: Date; lastHeartbeatAt: Date | null },
  now: number,
): boolean => (session.startedBy !== 'timer' ? true : !isTimerStale(session, now));

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
//     este barrido, aplican la misma vara ellos mismos (isSessionLive, aquí
//     arriba). Sin eso, abrir la portada pintaba LIVE un cronómetro rancio si
//     la carga llegaba antes que este GET.
//   - isLive de /api/games/:id (queries/game.ts): lo mismo, y por lo mismo.
//     Antes miraba solo `endedAt === null` y era la puerta que quedaba
//     abierta: hasta el primer barrido, la ficha enseñaba LIVE un cronómetro
//     que la lista ya no enseñaba.
//   - la guarda de startTimer: llama aquí primero, así que barre y decide con
//     la base ya limpia.
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
    // arranque hace de latido: no es "lo mismo que hace el watcher", es
    // LITERALMENTE la función del watcher (src/shared/timerFreshness).
    const lastBeat = timerLastBeat(row);
    if (!isTimerStale(row, now)) {
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
  const rows = await readPlaythroughRows(db, gameId);
  // `at` y `now` son el MISMO instante: el cronómetro siempre juega AHORA, así
  // que las ramas de "historia" de la decisión (nacer cerrado, reutilizar un
  // cerrado al vuelo) no pueden dispararse desde aquí.
  const decision = resolvePlaythroughForPlay({ ...rows, at: startedAt, now: startedAt });

  // LA POLÍTICA DEL CRONÓMETRO, que NO es la regla compartida: el móvil no
  // inventa playthroughs (REMOTO.md §9). La regla compartida sabe contestar
  // "crea uno nuevo" porque el escritorio lo necesita —el botón Play estrena
  // Playthrough 1 y abre el siguiente tras un Beaten—, pero empezar un
  // playthrough es una decisión con plataforma, origen y formato detrás, y
  // desde un cronómetro del móvil se tomaría a ciegas. Así que aquí la
  // respuesta "crear" se convierte en el mismo rechazo de siempre. Lo que el
  // Worker SÍ gana al usar la regla del PC es elegir bien entre los
  // playthroughs que ya existen (ver los tests de "hermano activo").
  if (decision.kind === 'create') {
    throw new TimerError(
      rows.playthroughs.length === 0
        ? 'este juego todavía no tiene ningún playthrough — ábrelo en tu PC'
        : 'este playthrough ya está cerrado — empieza otro desde tu PC',
    );
  }
  const targetIterationId = decision.iterationId;

  const sessionInsert = db
    .insert(sessionsTable)
    .values({
      iterationId: targetIterationId,
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

  // Todos los INSERTs van en un `batch` de libsql, que es una transacción: o
  // están la sesión y sus eventos, o no está
  // ninguno. A medias sería exactamente el estado que el 'started' viene a
  // quitar — horas colgando de un playthrough que nadie ve activo, o al revés.
  // Los eventos van en el orden de la decisión: si alguna vez llega uno con el
  // mismo instante que otro, el estado lo desempata el id.
  //
  // Lo que el batch NO cubre, y el escritorio sí (allí resolveIterationForPlay
  // corre dentro de la transacción de quien llama): la DECISIÓN se toma con
  // filas leídas fuera. Entre aquella lectura y este batch cabe una escritura
  // ajena —el PC, el drenado del buzón— y el 'started' (o el playthrough
  // nuevo) acabaría encima de un estado que ya no es el que se leyó. Es la
  // misma carrera "comprobar y luego insertar" de la guarda de arriba
  // (AFTERPLAY-2.0 F-28), que se resuelve con otro diseño (§13.3) y no aquí.
  const eventInserts =
    decision.kind === 'use'
      ? []
      : decision.events.map((event) =>
          db.insert(stateEventsTable).values({ iterationId: targetIterationId, ...event }),
        );

  const [session] =
    eventInserts.length > 0
      ? (await db.batch([sessionInsert, ...eventInserts]))[0]
      : await sessionInsert;

  const active = await getActiveTimer(db, now);
  if (!active) throw new TimerError(`no se pudo abrir la sesión ${session.id}`);
  return active;
};

// El latido. Frecuencia de ~1 por minuto: una sesión de tres horas son 180
// peticiones, nada frente a las 100.000 diarias del plan gratuito. El watcher
// late cada ~5s porque puede; aquí sería quemar peticiones sin ganar nada.
//
// UN LATIDO QUE LLEGA TARDE NO RESUCITA NADA (§7.4). Antes esto era un UPDATE
// pelado con `endedAt IS NULL`, así que la PWA volviendo del limbo a las diez
// horas —el caso NORMAL, no el raro: el §7.5 dice justo que los navegadores
// móviles suspenden las pestañas de fondo— declaraba fresca otra vez una
// sesión que ya estaba abandonada, y esas diez horas de silencio acababan
// contadas como jugadas. Bastaba con que ese latido llegara antes de que
// alguien pidiera /api/timer.
//
// Ese latido CIERRA, no reanuda, y la tabla del §7.4 no deja otra lectura:
// "latido rancio (horas sin latir) → abandonada: se cierra en el último
// latido". Se cierra igual que el barrido —en el último latido, no ahora— y se
// contesta `false`, que es lo que la PWA ya sabe leer (TimerBar invalida su
// consulta y el contador desaparece). El "parar" explícito sigue mandando
// (§7.5): eso es un gesto tuyo y llega por stopTimer, esto es una pestaña que
// despierta sola.
export const beatTimer = async (db: TenantDb, sessionId: number, now: number): Promise<boolean> => {
  const [session] = await db
    .select({
      id: sessionsTable.id,
      startedAt: sessionsTable.startedAt,
      lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        isNull(sessionsTable.endedAt),
        eq(sessionsTable.startedBy, 'timer'),
      ),
    )
    .limit(1);

  // Ni existe, ni es del cronómetro, ni sigue abierta: nada que latir. Sin
  // distinguir cuál de los tres, igual que antes — el latido no es sitio para
  // contarle al móvil qué pasó con su sesión.
  if (!session) return false;

  if (isTimerStale(session, now)) {
    const lastBeat = timerLastBeat(session);
    // El MISMO cierre que el barrido de getActiveTimer, con la misma guarda:
    // el `endedAt IS NULL` deja ganar a un "parar" que llegue a la vez en vez
    // de pisarle la hora de fin.
    const closed = await db
      .update(sessionsTable)
      .set({ endedAt: lastBeat, durationSec: computeDurationSec(session.startedAt, lastBeat) })
      .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.endedAt)))
      .returning({ id: sessionsTable.id });

    if (closed.length > 0) {
      console.log(
        `[timer] [info] latido tardio en la sesion ${sessionId} tras ${TIMER_STALE_MS / 3_600_000}h mudo - cerrada en su ultimo latido`,
      );
    }
    return false;
  }

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
