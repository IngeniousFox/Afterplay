import { sql } from 'drizzle-orm';
import { sessions } from '../../schema';

// LOS AGREGADOS DE SESIONES POR PLAYTHROUGH, copia 2.0 de
// `iterationSessionTotals` (db/queries/games/iterationHours.ts).
//
// Copia y no import, a propósito (CONSULTAS.md §2.2): el objeto 1.x lo
// comparte hoy el escritorio con el Worker (worker/src/queries/library.ts), y
// el Worker sigue con el esquema 1.x hasta la fase 5. Cambiarlo allí para el
// 2.0 rompería el Worker; aquí apunta a `sessions` del 2.0 (`playthroughId`
// en vez de `iterationId`).
//
// Misma regla de qué cuenta, y por las mismas razones (ver la cabecera del
// original y `deriveLibrary` en shared/domain/library.ts):
//
//  · sessionCount — COUNT(sessions.id), no COUNT(*): con el LEFT JOIN un
//    playthrough sin sesiones es una fila de NULLs. Cuenta TODAS, la abierta
//    incluida, y de CUALQUIER dispositivo.
//  · trackedSeconds — `sum` ignora la abierta (sin duración todavía).
//  · liveSince — el arranque más reciente entre las abiertas. En el
//    escritorio toda abierta está en marcha (CONSULTAS.md §1.3: `isLive` es
//    toda sesión abierta de cualquier PC, como hoy).
//  · lastSessionAt — cuándo se DEJÓ la última (endedAt; el arranque si sigue
//    abierta): la base de "Last played".
//  · firstSessionAt — el arranque más temprano: último recurso para fechar
//    las horas manuales del playthrough.
//
// Las sesiones `legacy_manual` (solo las escribe el importador) cuentan igual
// que contaban las `isManual` de la 1.x: sus horas y su fecha entran.
//
// Quien los usa debe unir `sessions` con su condición de vida en el ON del
// LEFT JOIN (si va al WHERE, el LEFT se vuelve INNER y desaparecen los
// playthroughs sin sesiones).
export const playthroughSessionTotals = {
  sessionCount: sql<number | bigint>`count(${sessions.id})`,
  trackedSeconds: sql<number | bigint>`coalesce(sum(${sessions.durationSec}), 0)`,
  liveSince: sql<
    number | bigint | null
  >`max(case when ${sessions.endedAt} is null then ${sessions.startedAt} end)`,
  lastSessionAt: sql<
    number | bigint | null
  >`max(coalesce(${sessions.endedAt}, ${sessions.startedAt}))`,
  firstSessionAt: sql<number | bigint | null>`min(${sessions.startedAt})`,
};
