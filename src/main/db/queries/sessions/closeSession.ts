import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Session } from '../../../../shared/types';
import { sessionColumns } from '../../projections';
import { sessionsTable } from '../../schema';
import { computeDurationSec } from './sessionDuration';

// Cierra una sesión abierta (botón Play del detalle, o el watcher del
// Bloque 3 al detectar que el proceso murió). Idempotente a propósito: si ya
// estaba cerrada, se devuelve tal cual sin recalcular nada. Sin esto, marcar
// un hito terminal (Beaten/Dropped) mientras el juego seguía en marcha cierra
// la sesión en ese instante (ver addStateEvent.ts) — cuando el watcher
// detecte el cierre real del proceso más tarde, volvería a llamar aquí sobre
// esa MISMA sesión ya cerrada, y sin esta guarda le pisaría la duración
// correcta con una inflada hasta ese momento posterior.
// "Ciérrala SOLO si estaba abierta, y dime si has sido tú."
//
// Existe porque `closeSession` no distingue entre "la he cerrado yo ahora" y
// "ya estaba cerrada, te la devuelvo tal cual", y hay un sitio donde esa
// diferencia importa: el watcher, que al morir el proceso llama aquí y con la
// respuesta dispara el aviso de sesión cerrada y el backup de la partida.
//
// El caso real: pulsas Stop en la ficha con el juego TODAVÍA abierto. La
// sesión se cierra bien (y a partir de ahí ya no se cuenta más tiempo, que es
// justo lo que pediste). Horas después cierras el juego de verdad, el watcher
// llama aquí sobre esa misma sesión, recibía la fila de vuelta y volvía a
// cantar el aviso de "sesión cerrada" — un toast con una sesión que terminó
// hace horas, y el diario "¿dónde lo dejaste?" pidiéndose por segunda vez.
export const closeSessionIfOpen = async (id: number, endedAt: Date): Promise<Session | null> => {
  const db = getDb();

  const [session] = await db
    .select(sessionColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  if (!session || session.endedAt !== null) return null;

  // Un fin ANTERIOR a su propio inicio no se guarda: la fila quedaba con
  // endedAt < startedAt y durationSec 0 (por el Math.max(0) de
  // computeDurationSec), un dato imposible que ninguna lectura de la app sabe
  // interpretar — y como cerrar es idempotente, esas horas medidas no se
  // recuperaban nunca. Se deja ABIERTA, que es reversible: el watcher la
  // cerrará bien cuando muera el proceso.
  //
  // La misma guarda que addStateEvent ya tenía para el mismo cálculo ("solo si
  // el hito cae DESPUÉS del inicio de esa sesión"). Estaba en un sitio y no en
  // el otro, y aquí la puerta la cerraba solo la convención: hoy nadie manda
  // una fecha del pasado (el renderer manda new Date(), el watcher
  // lastHeartbeatAt ?? startedAt).
  if (endedAt.getTime() < session.startedAt.getTime()) return null;

  const durationSec = computeDurationSec(session.startedAt, endedAt);

  const [updated] = await db
    .update(sessionsTable)
    .set({ endedAt, durationSec })
    .where(eq(sessionsTable.id, id))
    .returning(sessionColumns);
  return updated ?? null;
};

export const closeSession = async (id: number, endedAt: Date): Promise<Session | null> => {
  const closed = await closeSessionIfOpen(id, endedAt);
  if (closed) return closed;

  // Ya estaba cerrada (o no existe): se devuelve tal cual, sin recalcular.
  const [session] = await getDb()
    .select(sessionColumns)
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  return session ?? null;
};
