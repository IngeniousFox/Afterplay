// El freno del actualizador (puente 1.8, AFTERPLAY-2.0 §19.3 / D-07): una
// versión MAYOR nueva no se descarga ni se instala sola, porque la 2.0 migra
// los datos y eso tiene que ser una decisión explícita en cada PC. Las menores
// y los parches siguen como siempre.
//
// Sin imports de electron: es la parte que se prueba.

const majorOf = (version: string): number | null => {
  // "2.0.0", "v2.0.0-beta.1", "2" → 2. Cualquier cosa que no empiece por un
  // número no es una versión que sepamos comparar.
  const match = /^\s*v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
};

// ¿Subir de `current` a `next` cruza una versión mayor? Si alguna de las dos no
// se entiende se devuelve false: es el comportamiento de siempre (descargar), y
// frenar por un formato raro dejaría a la app sin actualizaciones menores.
export const isMajorUpgrade = (current: string, next: string): boolean => {
  const from = majorOf(current);
  const to = majorOf(next);
  return from !== null && to !== null && to > from;
};
