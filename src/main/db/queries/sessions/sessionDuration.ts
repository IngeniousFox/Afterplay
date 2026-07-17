// Duración en segundos entre dos instantes, nunca negativa (un reloj raro o
// un fin igual al inicio no debe dar una sesión con duración negativa) y
// redondeada al segundo — usada tanto al cerrar una sesión a mano/desde el
// watcher (closeSession) como al cerrar la sesión abierta que un hito
// terminal pilla en marcha (addStateEvent).
export const computeDurationSec = (startedAt: Date, endedAt: Date): number =>
  Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
