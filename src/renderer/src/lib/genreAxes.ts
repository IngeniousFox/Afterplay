// Bloque 5E — 6 ejes fijos del radar. Los géneros reales de IGDB no
// encajan 1:1 con estos 6 (son mucho más finos — "Shooter", "Hack and
// slash/Beat 'em up", "Racing"...), así que cada uno se mapea al eje más
// cercano.
export const GENRE_AXES = ['RPG', 'Action', 'Adventure', 'Strategy', 'Sim', 'Puzzle'] as const;

export type GenreAxis = (typeof GENRE_AXES)[number];

// Cubre los 23 géneros reales del catálogo de IGDB. IGDB no tiene ningún
// género que se llame literalmente "Action" — los que en la práctica SON
// acción (Shooter, Platform, Fighting, Arcade, Hack and slash/Beat 'em up)
// están repartidos bajo otros nombres, así que es aquí donde aterrizan.
// 'Music' (ritmo) e 'Indie' (una etiqueta de negocio, no de jugabilidad) no
// encajan bien en ninguno de los 6 ejes — se dejan fuera a propósito
// (mapGenreToAxis devuelve null para ellos).
const GENRE_TO_AXIS: Record<string, GenreAxis> = {
  'Role-playing (RPG)': 'RPG',
  RPG: 'RPG',
  Fighting: 'Action',
  Shooter: 'Action',
  Platform: 'Action',
  Arcade: 'Action',
  "Hack and slash/Beat 'em up": 'Action',
  Adventure: 'Adventure',
  'Point-and-click': 'Adventure',
  'Visual Novel': 'Adventure',
  Strategy: 'Strategy',
  'Real Time Strategy (RTS)': 'Strategy',
  'Turn-based strategy (TBS)': 'Strategy',
  Tactical: 'Strategy',
  MOBA: 'Strategy',
  'Card & Board Game': 'Strategy',
  Simulator: 'Sim',
  Sport: 'Sim',
  Racing: 'Sim',
  Puzzle: 'Puzzle',
  'Quiz/Trivia': 'Puzzle',
  Pinball: 'Puzzle',
};

// Cada juego cuenta para UN solo eje — su primer género (el "principal" de
// IGDB), igual que ya se hace en otros sitios de la app cuando hace falta
// un único valor de un array (ej. officialPlatforms?.[0] en ActionBar).
// A diferencia del prototipo (que hacía caer cualquier género no listado en
// Action), aquí un juego SIN género (o con un género que no reconocemos)
// devuelve null y queda FUERA del radar — con datos reales, la mayoría de
// la biblioteca no tiene género cargado, y contarlos igualmente como
// "Action" inflaría ese eje con horas que no son de ningún género real.
export const mapGenreToAxis = (genre: string | null | undefined): GenreAxis | null =>
  (genre && GENRE_TO_AXIS[genre]) || null;
