import { and, eq, isNull } from 'drizzle-orm';
import { isTimerStale } from '../../../../../shared/timerFreshness';
import { emulators, games, playthroughs, sessions } from '../../schema';
import { alive } from '../../store';
import { liveEmulator, liveGame, liveSession, type QueryContext } from '../common';
import { rereadSession, type SessionDto } from './dto';
import { resolvePlaythroughForSession } from './resolvePlaythrough';

// Abrir sesiones (sustituye a `startGameSession.ts` y `createEmulatorSession.ts`
// de la 1.x; CONSULTAS.md §2.2 y §3.2).
//
// Toda sesión que abre el escritorio es de ESTE dispositivo (§10.1), medida,
// con precisión de instante y con su primera señal de vida en el arranque:
// `deviceId` = este, `source: 'measured'`, `datePrecision: 'datetime'`,
// `lastSeenAt = startedAt`. `startedBy` dice quién la abrió: `'watcher'` o
// `'play'` (el botón Play). Los cronómetros (`'timer'`) no los crea nunca el
// escritorio: su dueño es el dispositivo `web` (§13.3).
//
// UNICIDAD (§7.7, §10.4): como mucho una sesión abierta por juego (o por
// emulador) EN ESTE DISPOSITIVO. La consulta lo comprueba antes de crear y
// devuelve `null`, como hoy; la regla de la puerta (`open_session`) queda solo
// como red de seguridad. Lo que cambia respecto a la 1.x: una sesión abierta
// en OTRO PC ya no bloquea. Si el juego arranca aquí, se abre la mía y habrá
// dos abiertas, una por PC, que es lo que pasó (D-15).
//
// CONTRATO DE ERRORES: `null` para todo caso esperado (ya abierta, juego o
// emulador borrado o inexistente, cronómetro vivo). Un `StoreError` de la
// puerta se propaga sin escribir nada (la transacción se deshace entera); el
// watcher lo captura por sesión con `captureStoreError` (ver `errors.ts`).

export type SessionOpener = 'watcher' | 'play';

/** ¿Hay una sesión propia abierta para algún playthrough del juego? */
function ownOpenSessionForGame(ctx: QueryContext, gameId: string): boolean {
  // La misma condición que la red de seguridad de la puerta
  // (`assertSingleOpenSession`): sesión propia, abierta y sin lápida, de
  // cualquier playthrough del juego (con lápida o sin ella). Si fueran
  // distintas, la puerta podría rechazar lo que esta consulta deja pasar.
  const row = ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(
      and(
        eq(playthroughs.gameId, gameId),
        eq(sessions.deviceId, ctx.deviceId),
        isNull(sessions.endedAt),
        alive(sessions),
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * ¿Lleva el tiempo de este juego un cronómetro vivo (de cualquier
 * dispositivo)? §10.4: "como hoy, no se abre otra; el tiempo lo lleva el
 * cronómetro". Solo si NO está rancio (`isTimerStale`, 24 h sin señal): en la
 * 1.x el watcher cerraba el rancio en el mismo ciclo y luego abría la suya;
 * en la 2.0 ese barrido es del hub (§10.5) y este PC no puede cerrarlo (no es
 * el dueño), así que contar uno rancio bloquearía el juego para siempre. La
 * señal de vida del cronómetro es su `lastSeenAt`. En la fase 2 no llega
 * ninguno (sin sync), pero la rama se conserva.
 */
function freshTimerForGame(ctx: QueryContext, gameId: string, now: Date): boolean {
  const timers = ctx.db
    .select({ startedAt: sessions.startedAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(
      and(
        eq(playthroughs.gameId, gameId),
        eq(sessions.startedBy, 'timer'),
        isNull(sessions.endedAt),
        liveSession(),
      ),
    )
    .all();
  return timers.some(
    (timer) =>
      !isTimerStale(
        { startedAt: timer.startedAt, lastHeartbeatAt: timer.lastSeenAt },
        now.getTime(),
      ),
  );
}

/**
 * Empezar a jugar un juego: garantiza un playthrough activo
 * (`resolvePlaythroughForSession`, creando uno si toca) y le cuelga una
 * sesión medida abierta, todo en una transacción. El evento `started` y la
 * sesión comparten el mismo instante (`ctx.now()` una sola vez).
 *
 * Devuelve `null` sin escribir nada si: el juego no existe o está borrado; ya
 * hay una sesión propia abierta del juego; o un cronómetro vivo lleva su
 * tiempo. Un `StoreError` inesperado se propaga.
 */
export function startGameSession(
  ctx: QueryContext,
  gameId: string,
  startedBy: SessionOpener,
): SessionDto | null {
  const sessionId = ctx.store.transaction((): string | null => {
    if (!isGameAlive(ctx, gameId)) return null;
    if (ownOpenSessionForGame(ctx, gameId)) return null;
    const now = ctx.now();
    if (freshTimerForGame(ctx, gameId, now)) return null;

    const { playthroughId } = resolvePlaythroughForSession(ctx, gameId, now);
    return ctx.store.create('sessions', {
      playthroughId,
      deviceId: ctx.deviceId,
      startedBy,
      source: 'measured',
      startedAt: now,
      datePrecision: 'datetime',
      lastSeenAt: now,
    }).id;
  });
  return sessionId === null ? null : rereadSession(ctx, sessionId);
}

/** ¿Existe el juego y está vivo? */
export function isGameAlive(ctx: QueryContext, gameId: string): boolean {
  return (
    ctx.db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.id, gameId), liveGame()))
      .get() !== undefined
  );
}

/** ¿Existe el emulador y está vivo? */
export function isEmulatorAlive(ctx: QueryContext, emulatorId: string): boolean {
  return (
    ctx.db
      .select({ id: emulators.id })
      .from(emulators)
      .where(and(eq(emulators.id, emulatorId), liveEmulator()))
      .get() !== undefined
  );
}

/**
 * El watcher ha visto un emulador en marcha: sesión SIN juego asignado
 * (`playthroughId` null, `emulatorId` puesto), la bandeja "Pending".
 *
 * Devuelve `null` sin escribir si el emulador no existe o está borrado, o si
 * ya hay una sesión PROPIA abierta con ese emulador, asignada o no. Es la
 * regla de hoy y es más estricta que la de la puerta, que solo cuenta las no
 * asignadas como "del emulador" (`store.ts`, `assertSingleOpenSession`): una
 * sesión de emulador asignada en caliente sigue siendo la del proceso que el
 * watcher vigila (clave `emu:`), y abrir otra contaría dos veces la misma
 * tarde. Un `StoreError` inesperado se propaga.
 */
export function createEmulatorSession(ctx: QueryContext, emulatorId: string): SessionDto | null {
  const sessionId = ctx.store.transaction((): string | null => {
    if (!isEmulatorAlive(ctx, emulatorId)) return null;
    const open = ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.emulatorId, emulatorId),
          eq(sessions.deviceId, ctx.deviceId),
          isNull(sessions.endedAt),
          alive(sessions),
        ),
      )
      .get();
    if (open) return null;

    const now = ctx.now();
    return ctx.store.create('sessions', {
      emulatorId,
      deviceId: ctx.deviceId,
      startedBy: 'watcher',
      source: 'measured',
      startedAt: now,
      datePrecision: 'datetime',
      lastSeenAt: now,
    }).id;
  });
  return sessionId === null ? null : rereadSession(ctx, sessionId);
}
