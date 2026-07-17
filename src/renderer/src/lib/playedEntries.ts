export type PlayedEntry = { id: number; title: string; coverUrl: string | null; hours: number };

// SPEC 10.7 / prototipo — top N por horas, fuera los juegos con 0h en la
// ventana activa: con un año concreto seleccionado, `entries` trae TODOS los
// juegos de la biblioteca (para que Genre Radar pueda sumar sobre el mismo
// conjunto), incluidos los que se añadieron después de ese año — sin este
// filtro, rellenaban hasta los huecos con juegos que ese año ni existían aún.
export const topPlayedEntries = (entries: PlayedEntry[], max: number): PlayedEntry[] =>
  entries
    .filter((entry) => entry.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, max);
