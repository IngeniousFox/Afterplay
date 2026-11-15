import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { isTimerStale, timerLastBeat } from '../../../../../shared/timerFreshness';
import {
  devices,
  gameMetadata,
  games,
  playthroughs,
  sessions,
  type SessionRow,
} from '../../schema';
import { alive } from '../../store';
import { liveSession, type QueryContext } from '../common';
import { closeOwnSession, computeDurationSec } from '../common/sessionsClose';
import { isGameAlive } from './start';
import { resolvePlaythroughForSession } from './resolvePlaythrough';

// El cronómetro del móvil (AFTERPLAY-2.0.md §7.4, §13.3, F-28).
//
// Un cronómetro es una sesión con `startedBy = 'timer'` cuyo dueño es el
// dispositivo `web` (el móvil no tiene proceso que vigilar). Estas consultas
// corren en el hub, dentro de `HubQueries.write`: el Durable Object atiende
// una petición cada vez, así que "comprobar que no hay otro" y "crear el mío"
// no se pueden cruzar con otra escritura (F-28). Por eso aquí no hay más
// protección que la propia transacción.
//
// REGLAS DE ARRANQUE (E-13), en este orden:
// 1. el juego existe y está vivo;
// 2. como mucho UN cronómetro vivo a la vez (de cualquier juego): no se
//    cronometran dos juegos a la vez, casi siempre sería un despiste. "Vivo" =
//    no rancio (`isTimerStale`, 24 h sin señal). Un cronómetro rancio no
//    cuenta: se cierra aquí, en su última señal, para no dejar una sesión
//    abierta para siempre (y porque la puerta no admite dos abiertas del
//    mismo juego en `web`);
// 3. el juego no tiene una sesión abierta y viva de otro dispositivo. Dos
//    sesiones del mismo juego a la vez serían horas dobles (D-15 admite que
//    pase si dos PCs lo abren a ciegas, pero aquí podemos verlo y no lo
//    permitimos).

/**
 * Cuánto tiempo sin señal puede llevar una sesión abierta de OTRO dispositivo
 * y seguir contando como "se está jugando ahí". Diez minutos, no los 3 de
 * "No signal for X" (`NO_SIGNAL_AFTER_MS`, que es un aviso): el PC solo
 * escribe `lastSeenAt` cada ≥60 s (§10.3) y sube con el ciclo de sync, y un
 * PC que acaba de recuperar la red llega con una señal de hace varios
 * minutos. Con un umbral corto el móvil abriría el cronómetro encima de una
 * sesión que en realidad sigue en marcha. Con uno largo, un PC apagado de
 * golpe bloquearía el cronómetro mientras no lo barra el hub (§10.5); diez
 * minutos es lo que se tarda en darse cuenta sin quedarse esperando.
 */
export const LIVE_ELSEWHERE_MS = 10 * 60_000;

/** El cronómetro activo, ya con el título del juego. */
export interface ActiveTimer {
  readonly sessionId: string;
  readonly gameId: string;
  readonly title: string;
  /** La carátula efectiva (la del usuario o la de IGDB). */
  readonly coverUrl: string | null;
  readonly startedAt: Date;
  /** La última señal de vida (null = aún no ha latido, cuenta `startedAt`). */
  readonly lastSeenAt: Date | null;
}

/** Los cronómetros abiertos y vivos (sin lápida), del más reciente al más antiguo. */
function openTimers(ctx: QueryContext): ActiveTimer[] {
  return ctx.db
    .select({
      sessionId: sessions.id,
      gameId: playthroughs.gameId,
      title: games.title,
      coverUrl: sql<string | null>`coalesce(${games.coverOverride}, ${gameMetadata.coverUrl})`,
      startedAt: sessions.startedAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(and(eq(sessions.startedBy, 'timer'), isNull(sessions.endedAt), liveSession()))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .all();
}

const isFresh = (timer: ActiveTimer, now: Date): boolean =>
  !isTimerStale({ startedAt: timer.startedAt, lastHeartbeatAt: timer.lastSeenAt }, now.getTime());

/** El cronómetro que sigue vivo ahora mismo, o null. Es una lectura: no cierra los rancios. */
export function getActiveTimer(ctx: QueryContext): ActiveTimer | null {
  const now = ctx.now();
  return openTimers(ctx).find((timer) => isFresh(timer, now)) ?? null;
}

export type StartTimerResult =
  | { readonly status: 'started'; readonly timer: ActiveTimer }
  | { readonly status: 'game_not_found' }
  /** Ya hay un cronómetro vivo (de este juego o de otro). */
  | { readonly status: 'timer_running'; readonly timer: ActiveTimer }
  /** El juego se está jugando en otro dispositivo (`deviceName`: cómo se llama). */
  | {
      readonly status: 'live_elsewhere';
      readonly deviceId: string;
      readonly deviceName: string;
    };

/** Cierra un cronómetro rancio en su última señal (lo que el hub barrería después). */
function closeStaleTimer(ctx: QueryContext, timer: ActiveTimer): void {
  closeOwnSession(ctx, timer.sessionId, {
    endedAt: timerLastBeat({ startedAt: timer.startedAt, lastHeartbeatAt: timer.lastSeenAt }),
    closedBy: 'janitor',
  });
}

/**
 * Sesiones abiertas y vivas del juego en cualquier dispositivo que dieron
 * señal hace menos de `LIVE_ELSEWHERE_MS`. La más reciente primero.
 */
function liveSessionsOfGame(
  ctx: QueryContext,
  gameId: string,
  now: Date,
): { deviceId: string; signal: number }[] {
  const rows = ctx.db
    .select({
      deviceId: sessions.deviceId,
      startedAt: sessions.startedAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(
      and(
        eq(playthroughs.gameId, gameId),
        isNull(sessions.endedAt),
        // Los cronómetros ya los ha juzgado la regla 2.
        ne(sessions.startedBy, 'timer'),
        liveSession(),
      ),
    )
    .all();
  return rows
    .map((row) => ({ deviceId: row.deviceId, signal: (row.lastSeenAt ?? row.startedAt).getTime() }))
    .filter((row) => now.getTime() - row.signal < LIVE_ELSEWHERE_MS)
    .sort((a, b) => b.signal - a.signal);
}

/** Cómo se llama el dispositivo en la lista (su id si ya no está). */
function deviceName(ctx: QueryContext, deviceId: string): string {
  const row = ctx.db
    .select({ name: devices.name })
    .from(devices)
    .where(and(eq(devices.id, deviceId), alive(devices)))
    .get();
  return row?.name ?? deviceId;
}

/** Arranca el cronómetro de un juego. Ver las reglas arriba. */
export function startTimer(ctx: QueryContext, gameId: string): StartTimerResult {
  return ctx.store.transaction((): StartTimerResult => {
    if (!isGameAlive(ctx, gameId)) return { status: 'game_not_found' };
    const now = ctx.now();

    for (const timer of openTimers(ctx)) {
      if (isFresh(timer, now)) return { status: 'timer_running', timer };
      closeStaleTimer(ctx, timer);
    }

    const elsewhere = liveSessionsOfGame(ctx, gameId, now)[0];
    if (elsewhere) {
      return {
        status: 'live_elsewhere',
        deviceId: elsewhere.deviceId,
        deviceName: deviceName(ctx, elsewhere.deviceId),
      };
    }

    const { playthroughId } = resolvePlaythroughForSession(ctx, gameId, now);
    const sessionId = ctx.store.create('sessions', {
      playthroughId,
      deviceId: ctx.deviceId,
      startedBy: 'timer',
      source: 'measured',
      startedAt: now,
      datePrecision: 'datetime',
      lastSeenAt: now,
    }).id;
    const timer = openTimers(ctx).find((candidate) => candidate.sessionId === sessionId);
    if (!timer) throw new Error(`timer: la sesión ${sessionId} desapareció al releerla`);
    return { status: 'started', timer };
  });
}

/** Una sesión cerrada, con lo que la PWA enseña. */
export interface StoppedTimer {
  readonly sessionId: string;
  readonly gameId: string;
  readonly title: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly durationSec: number;
}

export type StopTimerResult =
  /** La ha cerrado esta llamada. */
  | { readonly status: 'stopped'; readonly timer: StoppedTimer }
  /** Ya estaba cerrada (otro dispositivo la paró antes): no se recalcula. */
  | { readonly status: 'already_stopped'; readonly timer: StoppedTimer }
  /** No existe o tiene lápida. */
  | { readonly status: 'not_found' }
  /** Existe pero no es un cronómetro: no se para desde aquí. */
  | { readonly status: 'not_a_timer' };

/** Una sesión con el juego al que se imputa. */
interface TimerRow {
  readonly session: SessionRow;
  readonly gameId: string;
  readonly title: string;
}

function readTimerRow(ctx: QueryContext, sessionId: string): TimerRow | undefined {
  return ctx.db
    .select({
      session: sessions,
      gameId: playthroughs.gameId,
      title: games.title,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    .where(eq(sessions.id, sessionId))
    .get();
}

const toStopped = (
  row: { session: SessionRow; gameId: string; title: string },
  session: SessionRow,
): StoppedTimer => ({
  sessionId: session.id,
  gameId: row.gameId,
  title: row.title,
  startedAt: session.startedAt,
  endedAt: session.endedAt ?? session.startedAt,
  durationSec:
    session.durationSec ??
    computeDurationSec(session.startedAt, session.endedAt ?? session.startedAt),
});

/**
 * Para el cronómetro: lo cierra con `closedBy: 'user'` y su duración. Si está
 * rancio (24 h sin señal) se cierra en su última señal y no ahora, para no
 * regalar las horas de silencio (`timerLastBeat`). Parar uno ya cerrado no lo
 * toca (`already_stopped`), así que un doble toque no infla la duración.
 */
export function stopTimer(ctx: QueryContext, sessionId: string): StopTimerResult {
  return ctx.store.transaction((): StopTimerResult => {
    const row = readTimerRow(ctx, sessionId);
    if (!row || row.session.syncDeleted !== null) return { status: 'not_found' };
    if (row.session.startedBy !== 'timer') return { status: 'not_a_timer' };
    if (row.session.endedAt !== null) {
      return { status: 'already_stopped', timer: toStopped(row, row.session) };
    }

    const now = ctx.now();
    const stale = isTimerStale(
      { startedAt: row.session.startedAt, lastHeartbeatAt: row.session.lastSeenAt },
      now.getTime(),
    );
    const endedAt = stale
      ? timerLastBeat({ startedAt: row.session.startedAt, lastHeartbeatAt: row.session.lastSeenAt })
      : now;
    // Con el reloj del móvil por detrás del inicio no hay duración negativa.
    const result = closeOwnSession(ctx, sessionId, {
      endedAt:
        endedAt.getTime() < row.session.startedAt.getTime() ? row.session.startedAt : endedAt,
      closedBy: 'user',
    });
    if (!('session' in result)) return { status: 'not_found' };
    return {
      status: result.status === 'closed' ? 'stopped' : 'already_stopped',
      timer: toStopped(row, result.session),
    };
  });
}

/**
 * El latido: escribe `lastSeenAt` = ahora y dice si el cronómetro sigue vivo.
 * `false` si no existe, no es un cronómetro, ya se cerró (aquí o desde un PC)
 * o está rancio: la PWA deja de latir y enseña que se acabó.
 */
export function beatTimer(ctx: QueryContext, sessionId: string): boolean {
  return ctx.store.transaction((): boolean => {
    const row = readTimerRow(ctx, sessionId);
    if (!row || row.session.syncDeleted !== null) return false;
    if (row.session.startedBy !== 'timer' || row.session.endedAt !== null) return false;
    const now = ctx.now();
    if (
      isTimerStale(
        { startedAt: row.session.startedAt, lastHeartbeatAt: row.session.lastSeenAt },
        now.getTime(),
      )
    ) {
      return false;
    }
    ctx.store.patch('sessions', sessionId, { lastSeenAt: now });
    return true;
  });
}
