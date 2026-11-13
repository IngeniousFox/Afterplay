import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { localSessionBeats, playthroughs, sessions, type SessionStartedBy } from '../../schema';
import { liveSession, type QueryContext } from '../common';

// Las sesiones abiertas que necesita el watcher (sustituye a
// `getOpenSessions.ts` de la 1.x; CONSULTAS.md §2.2, §2.4 y §3.2).
//
// FILTRO POR DISPOSITIVO (§10.4): el watcher solo adopta, late, reconcilia y
// cierra lo SUYO. Una sesión abierta de otro PC no aparece aquí, así que ni
// la reconciliación del arranque ni el barrido de "no vista en 120 s" pueden
// tocarla, sin que `watcher.ts` tenga que cambiar su lógica. La única
// excepción son los cronómetros (`startedBy = 'timer'`, dueño el dispositivo
// `web`): se incluyen los vivos de cualquier dispositivo porque el watcher los
// lee para no abrir una sesión propia mientras un cronómetro lleva el tiempo
// de ese juego (§10.4, rama de `watcher.ts:445-459`). En la fase 2 no llega
// ninguno (sin sync) y la rama queda inerte.
//
// Para la interfaz ("en vivo", la lista de sesiones) están las lecturas de
// `read.ts`, que sí incluyen todos los dispositivos.

/** Lo que el watcher sabe de una sesión abierta. Mismo contrato que la 1.x, ids de texto. */
export interface OpenSession {
  readonly sessionId: string;
  /** Juego al que se imputan las horas (vía su playthrough); null en las de emulador sin asignar. */
  readonly gameId: string | null;
  readonly playthroughId: string | null;
  readonly emulatorId: string | null;
  /** Dueño. Siempre este PC, salvo en los cronómetros. */
  readonly deviceId: string;
  readonly startedAt: Date;
  /**
   * La mejor estimación del último instante en que seguía viva, con el
   * nombre de la 1.x para que el watcher no cambie: `beatAt ?? lastSeenAt`
   * (§3.2). El watcher cierra en `lastHeartbeatAt ?? startedAt`, que queda
   * `beatAt ?? lastSeenAt ?? startedAt`. En un cronómetro no hay latido
   * local: es su `lastSeenAt`, que es lo que lee la regla de frescura
   * (`shared/timerFreshness.ts`).
   */
  readonly lastHeartbeatAt: Date | null;
  /** Último latido local (`local_session_beats`); null si nunca latió aquí. */
  readonly lastBeatAt: Date | null;
  /** Señal de vida sincronizada (`sessions.lastSeenAt`). */
  readonly lastSeenAt: Date | null;
  readonly startedBy: SessionStartedBy;
}

/**
 * Sesiones abiertas y vivas (F-11) de ESTE dispositivo, más los cronómetros
 * abiertos y vivos de cualquier dispositivo. Orden por inicio y creación.
 */
export function getOpenSessions(ctx: QueryContext): OpenSession[] {
  const rows = ctx.db
    .select({
      sessionId: sessions.id,
      gameId: playthroughs.gameId,
      playthroughId: sessions.playthroughId,
      emulatorId: sessions.emulatorId,
      deviceId: sessions.deviceId,
      startedAt: sessions.startedAt,
      lastSeenAt: sessions.lastSeenAt,
      lastBeatAt: localSessionBeats.beatAt,
      startedBy: sessions.startedBy,
    })
    .from(sessions)
    // LEFT: las de emulador sin asignar no tienen playthrough y el watcher
    // tiene que verlas igual (si no, sus cierres no se detectarían). La vida
    // del playthrough ya la exige `liveSession()`.
    .leftJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .leftJoin(localSessionBeats, eq(localSessionBeats.sessionId, sessions.id))
    .where(
      and(
        isNull(sessions.endedAt),
        liveSession(),
        or(eq(sessions.deviceId, ctx.deviceId), eq(sessions.startedBy, 'timer')),
      ),
    )
    .orderBy(asc(sessions.startedAt), asc(sessions.syncCreated), asc(sessions.id))
    .all();

  return rows.map((row) => ({
    ...row,
    // El latido local solo existe para las propias.
    lastBeatAt: row.deviceId === ctx.deviceId ? row.lastBeatAt : null,
    lastHeartbeatAt:
      (row.deviceId === ctx.deviceId ? row.lastBeatAt : null) ?? row.lastSeenAt ?? null,
  }));
}
