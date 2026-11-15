import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { resolveIterationHours } from '../../../../../shared/domain/hours';
import { deriveMoments, type MemorySession } from '../../../../../shared/memory/moments';
import type {
  PendingSession,
  SessionClosedEvent,
  SessionWithGame,
} from '../../../../../shared/types';
import { emulators, gameMetadata, games, playthroughs, sessions } from '../../schema';
import { alive } from '../../store';
import { liveEmulator, livePlaythrough, liveSession, type QueryContext } from '../common';

// Lecturas de sesiones para la interfaz (sustituyen a `getAllSessions.ts`,
// `getPendingSessions.ts` y `getSessionClosedInfo.ts` de la 1.x; CONSULTAS.md
// §1.3 y §2.2).
//
// A diferencia de lo que lee el watcher (`open.ts`), aquí entran las sesiones
// de TODOS los dispositivos: las horas jugadas en otro PC son del usuario, y
// una abierta en otro PC se ve "en vivo" (§10.8 pintará "Jugando en PC-A").
// Todas filtran vivas con la regla F-11 (`liveSession()`): una sesión cuyo
// playthrough o juego tiene lápida está borrada aunque su propia lápida no
// haya llegado todavía.

export interface GetAllSessionsOptions {
  /** Solo las de este juego (el historial de la ficha). Sin él, todas. */
  readonly gameId?: string;
  /** Una página: cuántas. Sin él, todas. El orden es el de siempre, así que las páginas encajan. */
  readonly limit?: number;
  /** Cuántas saltarse (solo con `limit`). */
  readonly offset?: number;
}

/**
 * Cuántas sesiones devolvería `getAllSessions` sin paginar (las asignadas y
 * vivas). Es el total de "Page 2 of 7": una sola fila de resultado.
 */
export function countAllSessions(ctx: QueryContext): number {
  const row = ctx.db
    .select({ total: sql<number>`count(*)` })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    .where(liveSession())
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Las sesiones asignadas a un juego, con el juego resuelto y su carátula
 * efectiva (override del usuario ?? caché). Las de emulador sin asignar NO
 * entran: no cuentan en ninguna estadística hasta asignarse (están en
 * `getPendingSessions`). Más reciente primero; a igual inicio, la creada
 * después primero (antes, `id desc`).
 */
export function getAllSessions(
  ctx: QueryContext,
  options: GetAllSessionsOptions = {},
): SessionWithGame<string>[] {
  const query = ctx.db
    .select({
      id: sessions.id,
      iterationId: playthroughs.id,
      source: sessions.source,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
      lastSeenAt: sessions.lastSeenAt,
      datePrecision: sessions.datePrecision,
      note: sessions.note,
      gameId: games.id,
      gameTitle: games.title,
      coverUrl: sql<string | null>`coalesce(${games.coverOverride}, ${gameMetadata.coverUrl})`,
      deviceId: sessions.deviceId,
      closedBy: sessions.closedBy,
      startedBy: sessions.startedBy,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    // La caché de un juego que `liveSession()` ya exige vivo: `alive` a secas.
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(
      and(
        liveSession(),
        options.gameId === undefined ? undefined : eq(playthroughs.gameId, options.gameId),
      ),
    )
    .orderBy(desc(sessions.startedAt), desc(sessions.syncCreated), desc(sessions.id))
    .$dynamic();
  const rows =
    options.limit === undefined
      ? query.all()
      : query
          .limit(options.limit)
          .offset(options.offset ?? 0)
          .all();

  return rows.map(({ source, lastSeenAt, ...row }) => ({
    ...row,
    isManual: source === 'legacy_manual',
    lastHeartbeatAt: lastSeenAt,
  }));
}

/**
 * La bandeja "Pending": sesiones vivas de emulador sin asignar
 * (`playthroughId` null) con su emulador vivo. De todos los dispositivos:
 * asignar se puede desde cualquiera (§7.4). Más reciente primero.
 */
export function getPendingSessions(ctx: QueryContext): PendingSession<string>[] {
  return ctx.db
    .select({
      id: sessions.id,
      emulatorId: emulators.id,
      emulatorName: emulators.name,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
    })
    .from(sessions)
    .innerJoin(emulators, eq(emulators.id, sessions.emulatorId))
    .where(and(isNull(sessions.playthroughId), liveSession(), liveEmulator()))
    .orderBy(desc(sessions.startedAt), desc(sessions.syncCreated), desc(sessions.id))
    .all();
}

/**
 * Los datos del aviso "acabas de cerrar X", armados en el main porque quien
 * detecta el cierre es el watcher. `null` si la sesión no existe, está
 * borrada (F-11 incluida) o no está asignada a un juego.
 *
 * - `totalHours`: el del JUEGO entero con la regla de la casa
 *   (`resolveIterationHours`: horas manuales + medidas), playthrough a
 *   playthrough, incluidos los que no tienen ni una sesión medida, y con las
 *   sesiones de todos los dispositivos.
 * - `isLongest`: lo decide `deriveMoments`, la misma regla que el diario
 *   (solo sesiones medidas: `isManual` ← `source`).
 * - `coverUrl` y `heroUrl` efectivos.
 */
export function getSessionClosedInfo(
  ctx: QueryContext,
  sessionId: string,
): SessionClosedEvent<string> | null {
  const session = ctx.db
    .select({
      id: sessions.id,
      durationSec: sessions.durationSec,
      iterationId: playthroughs.id,
      gameId: games.id,
      gameTitle: games.title,
      coverUrl: sql<string | null>`coalesce(${games.coverOverride}, ${gameMetadata.coverUrl})`,
      heroUrl: sql<string | null>`coalesce(${games.heroOverride}, ${gameMetadata.heroUrl})`,
      endless: games.endless,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .innerJoin(games, eq(games.id, playthroughs.gameId))
    // Caché de un juego ya exigido vivo por `liveSession()`: `alive` a secas.
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
    .where(and(eq(sessions.id, sessionId), liveSession()))
    .get();
  if (!session) return null;

  const siblings = ctx.db
    .select({
      id: sessions.id,
      syncCreated: sessions.syncCreated,
      iterationId: playthroughs.id,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
      source: sessions.source,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(and(eq(playthroughs.gameId, session.gameId), liveSession()))
    .all();

  const iterations = ctx.db
    .select({ id: playthroughs.id, manualHours: playthroughs.manualHours })
    .from(playthroughs)
    .where(and(eq(playthroughs.gameId, session.gameId), livePlaythrough()))
    .all();

  const trackedByPlaythrough = new Map<string, number>();
  for (const row of siblings) {
    trackedByPlaythrough.set(
      row.iterationId,
      (trackedByPlaythrough.get(row.iterationId) ?? 0) + (row.durationSec ?? 0),
    );
  }
  const totalHours = iterations.reduce(
    (sum, iteration) =>
      sum +
      resolveIterationHours(iteration.manualHours, trackedByPlaythrough.get(iteration.id) ?? 0),
    0,
  );

  const memorySessions: MemorySession<string>[] = siblings.map((row) => ({
    id: row.id,
    syncCreated: row.syncCreated,
    gameId: session.gameId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    isManual: row.source === 'legacy_manual',
  }));
  const isLongest = deriveMoments(memorySessions).some(
    (moment) => moment.type === 'longest_session' && moment.sessionId === session.id,
  );

  return {
    sessionId: session.id,
    gameId: session.gameId,
    iterationId: session.iterationId,
    endless: session.endless,
    gameTitle: session.gameTitle,
    coverUrl: session.coverUrl,
    heroUrl: session.heroUrl,
    durationSec: session.durationSec ?? 0,
    totalHours,
    isLongest,
  };
}
