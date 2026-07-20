// Horas de una iteración: manualTotalPlayed son las horas jugadas FUERA del
// tracking (antes de usar Afterplay, en otro PC, en consola…) y se SUMAN a lo
// que el watcher haya medido — son tiempos disjuntos por definición, no dos
// versiones del mismo dato.
//
// Antes reemplazaba en vez de sumar, y eso rompía un caso real: un
// playthrough con horas manuales que sigue activo y al que el watcher le
// cuelga sesiones nuevas se quedaba clavado en el número manual para siempre
// (las sesiones se guardaban, se veían en el Session History, pero el total
// las ignoraba). El bug histórico que motivó el "reemplaza" era otro: contar
// dos veces la MISMA sesión por tenerla duplicada en dos sitios, no esto.
export const resolveIterationHours = (
  manualTotalPlayed: number | null,
  trackedSeconds: number,
): number => (manualTotalPlayed ?? 0) + trackedSeconds / 3600;
