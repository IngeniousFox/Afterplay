// El puente entre las plataformas de IGDB (strings como "PlayStation 2" en
// games.officialPlatforms) y los IDs de consola de RetroAchievements
// (RETROACHIEVEMENTS.md §5). Los IDs son los públicos y estables de RA,
// verificados contra GetConsoleIDs en vivo (3-ago-2026) — la lista completa
// de sistemas activos se guarda aparte (state.ts) para detectar consolas
// NUEVAS; este mapa estático solo traduce nombres, y un sistema que no esté
// aquí simplemente no se empareja hasta añadir su línea.
//
// El matching es por "contiene" sobre el nombre normalizado de IGDB, porque
// IGDB no es consistente: "Super Nintendo Entertainment System (SNES)",
// "Sega Mega Drive/Genesis", "Nintendo GameCube"... Contra una lista corta
// de firmas únicas, contiene es suficiente y no se pisa.

const SIGNATURES: [string, number][] = [
  // Orden IMPORTA: las firmas más específicas antes que sus prefijos
  // ("game boy advance" antes que "game boy", "playstation 2" antes que
  // "playstation").
  ['game boy advance', 5],
  ['game boy color', 6],
  ['game boy', 4],
  ['playstation 5', -1],
  ['playstation 4', -1],
  ['playstation 3', -1],
  ['playstation 2', 21],
  ['playstation portable', 41],
  ['playstation vita', -1],
  ['playstation', 12],
  ['nintendo dsi', 78],
  ['nintendo ds', 18],
  ['nintendo 3ds', -1],
  ['nintendo 64', 2],
  ['gamecube', 16],
  ['wii u', -1],
  ['wii', 19],
  ['super nintendo', 3],
  ['snes', 3],
  ['super famicom', 3],
  ['nintendo entertainment system', 7],
  ['famicom', 7],
  ['mega drive', 1],
  ['genesis', 1],
  ['sega cd', 9],
  ['sega 32x', 10],
  ['master system', 11],
  ['game gear', 15],
  ['saturn', 39],
  ['dreamcast', 40],
  ['neo geo pocket', 14],
  ['turbografx', 8],
  ['pc engine', 8],
  ['wonderswan', 53],
  ['virtual boy', 28],
  ['atari 2600', 25],
  ['atari 7800', 51],
  ['atari lynx', 13],
  ['atari jaguar', 17],
  ['arcade', 27],
  ['msx', 29],
  ['colecovision', 44],
  ['intellivision', 45],
  ['3do', 43],
];

// IDs de las plataformas que RA NO soporta (o no soportará pronto) pero que
// conviene reconocer para no confundirlas con sus hermanas: "playstation 3"
// contiene "playstation" y sin su firma explícita (-1) se emparejaría con
// PS1. -1 = reconocida y descartada.
const UNSUPPORTED = -1;

// Los IDs de consola de RA que corresponden a las plataformas de un juego.
// Vacío = ninguna de sus plataformas está en RA (juegos de PC, PS3, Switch…).
export const raConsoleIdsForPlatforms = (platforms: string[] | null): number[] => {
  if (!platforms) return [];
  const ids = new Set<number>();
  for (const platform of platforms) {
    const normalized = platform.toLowerCase();
    for (const [signature, consoleId] of SIGNATURES) {
      if (!normalized.includes(signature)) continue;
      if (consoleId !== UNSUPPORTED) ids.add(consoleId);
      break; // primera firma que casa manda — por eso el orden importa
    }
  }
  return [...ids];
};
