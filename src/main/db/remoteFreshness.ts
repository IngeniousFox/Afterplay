// ¿ESTÁ LA COPIA LOCAL AL DÍA CON TURSO?
//
// La base de este PC es una réplica local: lo que el móvil escribe en Turso
// (el cronómetro, REMOTO.md §7) solo existe aquí después de un pull. Casi todo
// el código puede ignorarlo — leer un dato de hace un minuto no rompe nada —
// salvo quien DECIDE Y ESCRIBE a partir de lo que cree que pasó en remoto.
//
// LA CICATRIZ. El barrido de cronómetros abandonados del watcher decidía sobre
// la copia local sin preguntarse cuánto llevaba sin sincronizar:
//
//   1. Arrancas el cronómetro en el móvil; el PC, encendido, baja la sesión
//      abierta.
//   2. El PC se suspende (o lo apagas, o se queda sin red). Su copia se queda
//      con esa sesión ABIERTA y su latido en la hora de arranque.
//   3. Juegas tres horas en la consola y paras desde el móvil. Turso queda
//      bien: tres horas.
//   4. El PC vuelve pasado el plazo de abandono (timerFreshness.ts). El
//      watcher sondea ANTES del primer sync, ve una sesión "abierta y muda
//      desde hace más de un día" y la cierra en su
//      último latido — el arranque: duración cero.
//   5. El ciclo de sync sube primero y baja después: ese cierre a cero llega
//      a Turso y PISA las tres horas buenas.
//
// La sesión se veía bien en el móvil al parar y se convertía en 0h 0m al
// encender el PC. Con el móvil bloqueado el latido no llega nunca (los
// navegadores suspenden las pestañas de fondo), así que el "último latido"
// era casi siempre el propio arranque.
//
// La regla que sale de ahí: con un remoto configurado, la copia local solo
// vale para DECIDIR si se ha completado un pull hace poco. Vive en su propio
// módulo, sin estado de conexión ni imports de la base, para que el watcher y
// sus tests lo usen sin arrastrar db/index.

// Tres tics del ciclo de sync (60s, main/index.ts): un pull perdido no cierra
// la puerta, y una suspensión de horas sí.
export const REMOTE_FRESH_MS = 3 * 60_000;

let remoteExpected = false;
let lastPullAt: number | null = null;

// Si esta instalación tiene un Turso configurado. Sin él no hay nada con lo
// que estar desfasado: la base local es la única y siempre está "al día".
export const setRemoteExpected = (expected: boolean): void => {
  remoteExpected = expected;
};

// Un pull que ha terminado bien, traiga cambios o no: "no hay nada nuevo"
// también es saber cómo está el remoto.
export const markRemotePullSucceeded = (now: number = Date.now()): void => {
  lastPullAt = now;
};

export const isLocalCopyFresh = (now: number = Date.now()): boolean => {
  if (!remoteExpected) return true;
  // `now < lastPullAt` (el reloj del sistema saltó hacia atrás) cuenta como
  // desfasada: sin saber cuánto ha pasado, no se decide nada.
  return lastPullAt !== null && now >= lastPullAt && now - lastPullAt <= REMOTE_FRESH_MS;
};

// Solo para los tests: el estado es del módulo y sobrevive entre casos.
export const resetRemoteFreshness = (): void => {
  remoteExpected = false;
  lastPullAt = null;
};
