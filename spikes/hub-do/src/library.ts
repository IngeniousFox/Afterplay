// "Portada de la biblioteca" del móvil, con la MISMA FORMA que
// worker/src/queries/library.ts (seis consultas + derivación en JS), pero
// sobre el esquema 2.0 (ids de texto, lápidas, playthroughs).
//
// Es una función de Drizzle pura que corre igual en el Durable Object
// (drizzle-orm/durable-sqlite) y en Node (drizzle-orm/libsql): eso también es
// parte de S-01. Diferencias deliberadas con library.ts:
//   - `planned` ya no está en games (va a plan_entries, que no está en el
//     spike): aquí "biblioteca" = juegos vivos.
//   - Portada y año van en game_metadata (fuera del spike): se usa coverOverride.
//   - Las reglas de src/shared (latestRealStateEvent, manualHoursAnchor...) se
//     sustituyen por una versión simplificada del mismo coste: recorrer el log
//     entero de eventos y quedarse con el último por occurredAt/syncCreated.
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { SQLiteAsyncDatabase } from 'drizzle-orm/sqlite-core';
import { games, playthroughs, sessions, stateEvents } from './schema';

type AnyDb = SQLiteAsyncDatabase<'sync' | 'async', any, any>;

const SESSION_WINDOW_MS = 367 * 24 * 60 * 60 * 1000;

export type LibraryGame = {
  id: string;
  title: string;
  coverUrl: string | null;
  totalHours: number;
  sessionCount: number;
  currentState: string | null;
  lastPlayedAt: number | null;
  isLive: boolean;
};

const aliveGame = isNull(games.syncDeleted);
const alivePt = isNull(playthroughs.syncDeleted);

export async function buildLibrary(db: AnyDb, now = Date.now()) {
  const windowFrom = now - SESSION_WINDOW_MS;

  const gameRows = await db
    .select({
      id: games.id,
      title: games.title,
      coverUrl: games.coverOverride,
      addedAt: games.addedAt,
      promotedAt: games.promotedAt,
    })
    .from(games)
    .where(aliveGame)
    .orderBy(sql`${games.title} collate nocase`);

  const ptRows = await db
    .select({ id: playthroughs.id, gameId: playthroughs.gameId, manualHours: playthroughs.manualHours })
    .from(playthroughs)
    .innerJoin(games, eq(playthroughs.gameId, games.id))
    .where(and(aliveGame, alivePt));

  const sessionTotals = await db
    .select({
      gameId: playthroughs.gameId,
      playthroughId: playthroughs.id,
      trackedSeconds: sql<number>`coalesce(sum(${sessions.durationSec}), 0)`,
      sessionCount: sql<number>`count(*)`,
      firstStartedAt: sql<number>`min(${sessions.startedAt})`,
      lastPlayedAt: sql<number>`max(coalesce(${sessions.endedAt}, ${sessions.startedAt}))`,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(sessions.playthroughId, playthroughs.id))
    .innerJoin(games, eq(playthroughs.gameId, games.id))
    .where(and(aliveGame, alivePt, isNull(sessions.syncDeleted)))
    .groupBy(playthroughs.id);

  const openSessions = await db
    .select({ gameId: playthroughs.gameId, startedAt: sessions.startedAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(playthroughs, eq(sessions.playthroughId, playthroughs.id))
    .innerJoin(games, eq(playthroughs.gameId, games.id))
    .where(and(aliveGame, alivePt, isNull(sessions.syncDeleted), isNull(sessions.endedAt)))
    .orderBy(sessions.id);

  const recentSessions = await db
    .select({ gameId: playthroughs.gameId, startedAt: sessions.startedAt, durationSec: sessions.durationSec })
    .from(sessions)
    .innerJoin(playthroughs, eq(sessions.playthroughId, playthroughs.id))
    .innerJoin(games, eq(playthroughs.gameId, games.id))
    .where(and(aliveGame, alivePt, isNull(sessions.syncDeleted), gte(sessions.startedAt, windowFrom)));

  const eventRows = await db
    .select({
      gameId: playthroughs.gameId,
      playthroughId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
      syncCreated: stateEvents.syncCreated,
    })
    .from(stateEvents)
    .innerJoin(playthroughs, eq(stateEvents.playthroughId, playthroughs.id))
    .innerJoin(games, eq(playthroughs.gameId, games.id))
    .where(and(aliveGame, alivePt, isNull(stateEvents.syncDeleted)));

  // ---- derivación en JS (mismo coste asintótico que library.ts) ----
  const tracked = new Map<string, number>();
  const sessionCount = new Map<string, number>();
  const lastSession = new Map<string, number>();
  for (const r of sessionTotals) {
    tracked.set(r.playthroughId, Number(r.trackedSeconds));
    sessionCount.set(r.gameId, (sessionCount.get(r.gameId) ?? 0) + Number(r.sessionCount));
    const prev = lastSession.get(r.gameId);
    if (prev === undefined || Number(r.lastPlayedAt) > prev) lastSession.set(r.gameId, Number(r.lastPlayedAt));
  }
  const live = new Set<string>();
  for (const r of openSessions) if (r.lastSeenAt && now - r.lastSeenAt < 3 * 60_000) live.add(r.gameId);

  const hours = new Map<string, number>();
  for (const p of ptRows) {
    const h = (tracked.get(p.id) ?? 0) / 3600 + (p.manualHours ?? 0);
    hours.set(p.gameId, (hours.get(p.gameId) ?? 0) + h);
  }

  const latest = new Map<string, (typeof eventRows)[number]>();
  const lastEvent = new Map<string, number>();
  for (const e of eventRows) {
    const cur = latest.get(e.gameId);
    if (
      !cur ||
      e.occurredAt > cur.occurredAt ||
      (e.occurredAt === cur.occurredAt && e.syncCreated > cur.syncCreated)
    )
      latest.set(e.gameId, e);
    if (e.datePrecision !== 'unknown') {
      const prev = lastEvent.get(e.gameId);
      if (prev === undefined || e.occurredAt > prev) lastEvent.set(e.gameId, e.occurredAt);
    }
  }

  let hoursThisYear = 0;
  const yearStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  for (const s of recentSessions) if (s.startedAt >= yearStart) hoursThisYear += (s.durationSec ?? 0) / 3600;

  const list: LibraryGame[] = gameRows.map((g) => {
    const a = lastSession.get(g.id) ?? null;
    const b = lastEvent.get(g.id) ?? null;
    return {
      id: g.id,
      title: g.title,
      coverUrl: g.coverUrl,
      totalHours: Math.round((hours.get(g.id) ?? 0) * 10) / 10,
      sessionCount: sessionCount.get(g.id) ?? 0,
      currentState: latest.get(g.id)?.type ?? null,
      lastPlayedAt: a === null ? b : b === null ? a : Math.max(a, b),
      isLive: live.has(g.id),
    };
  });

  return {
    games: list,
    hoursThisYear: Math.round(hoursThisYear * 10) / 10,
    rowCounts: {
      games: gameRows.length,
      playthroughs: ptRows.length,
      sessionTotals: sessionTotals.length,
      openSessions: openSessions.length,
      recentSessions: recentSessions.length,
      events: eventRows.length,
    },
  };
}
