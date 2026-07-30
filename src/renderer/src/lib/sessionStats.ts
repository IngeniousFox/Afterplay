type DurationSession = { endedAt: Date | null; durationSec: number | null };

// Duración de sesión más larga y media — solo sobre sesiones CERRADAS (una en
// marcha no tiene duración final todavía). Compartido por Sessions.tsx y
// GameStats.tsx, que enseñan las dos cifras en sitios distintos y tienen que
// dar el mismo número.
export const sessionDurationStats = (
  sessions: DurationSession[],
): { longestSec: number; avgSec: number } => {
  const closed = sessions.filter((session) => session.endedAt !== null);
  const longestSec = closed.reduce((max, session) => Math.max(max, session.durationSec ?? 0), 0);
  const avgSec =
    closed.length > 0
      ? closed.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / closed.length
      : 0;
  return { longestSec, avgSec };
};

// ── Qué sesiones entran en las gráficas de hábitos ─────────────────────────
//
// Todas las gráficas que dicen algo sobre CÓMO juegas — el heatmap de
// actividad, horas por mes, el histograma de duración, la franja horaria del
// día y las rachas — miran solo tiempo medido de verdad. Las sesiones
// manuales del modelo antiguo pueden llevar precisión de solo mes o año, así
// que no representan ni un día ni una hora concretos: meterlas ahí sería
// inventarse cuándo jugaste (ver isManual en schema.ts).
//
// Son dos preguntas parecidas pero distintas, y por eso dos funciones:

// ¿Pasó de verdad, en un momento concreto? Vale también si sigue abierta —
// para el heatmap y las rachas, ABRIR la sesión ya pinta el día; no hace
// falta esperar a que termine.
export const isMeasuredSession = (session: { isManual: boolean }): boolean => !session.isManual;

// ¿Y además sabemos cuánto duró? Lo que necesita todo lo que suma o reparte
// tiempo: una sesión en marcha todavía no tiene duración final, y contarla
// como 0 hundiría la media.
export const hasMeasuredDuration = (session: {
  isManual: boolean;
  endedAt: Date | null;
}): boolean => !session.isManual && session.endedAt !== null;
