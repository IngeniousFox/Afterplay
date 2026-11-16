// ── Cronómetro del arranque ──────────────────────────────────────────────
// El arranque es la única parte de la app que no se puede medir a posteriori:
// pasa una vez, antes de que exista ventana donde enseñar nada. Estas marcas
// van a consola SIEMPRE (un Date.now por línea, trece líneas en total) porque
// la alternativa —añadirlas el día que arranca mal— obliga a recompilar justo
// el binario que hay que observar.
//
// El origen es la creación del PROCESO y no la carga de este módulo: entre
// las dos está el arranque de Electron/Chromium, que en frío es la mayor
// tajada del total y no aparece en ninguna otra medida.
const PROCESS_START = process.getCreationTime?.() ?? Date.now();

export const mark = (label: string): void => {
  console.log(
    `[startup] ${String(Math.round(Date.now() - PROCESS_START)).padStart(6)} ms  ${label}`,
  );
};
