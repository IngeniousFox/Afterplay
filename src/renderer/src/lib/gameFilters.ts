import type { GameListItem } from '../../../shared/types';
import { STATE_TO_STATUS_KEY, type StatusKey } from './gameStatus';

// Filtros de las columnas de navegación (MiddleColumn). SOLO de esas
// columnas: la biblioteca en rejilla y su equivalente de Plan to Play se
// quedan como están, enseñando siempre todo.
//
// Semántica: OR dentro de cada grupo, AND entre grupos — "Playing o Beaten"
// Y "de los 2010". Un juego tiene UN estado, UNA década, UN tramo de horas,
// así que pedirlos en AND no devolvería nunca nada.
//
// Género y banderas son la excepción, y van en AND: un juego SÍ puede ser
// "RPG y Estrategia" a la vez, o "emulado y sin terminar". Ahí marcar un
// chip más tiene que estrechar la búsqueda, no ampliarla — que es lo que
// espera cualquiera al ir sumando condiciones.

export type PlaytimeBucket = 'none' | 'short' | 'medium' | 'long';
export type EraBucket = 'now' | 'tens' | 'aughts' | 'retro';
export type FlagKey = 'emulated' | 'endless';

export type SortKey =
  | 'title'
  | 'last-played'
  | 'hours-desc'
  | 'hours-asc'
  | 'added-desc'
  | 'release-desc'
  | 'sessions-desc';

export type GameFilters = {
  statuses: StatusKey[];
  genres: string[];
  playtime: PlaytimeBucket[];
  eras: EraBucket[];
  flags: FlagKey[];
  sort: SortKey;
};

// Qué grupos tiene sentido enseñar en cada columna. En Plan to Play, por
// ejemplo, todos los juegos comparten estado y ninguno tiene horas: ofrecer
// esos filtros sería ofrecer botones que no hacen nada.
export type FilterGroup = 'status' | 'genre' | 'playtime' | 'era' | 'flags';

export const EMPTY_FILTERS: GameFilters = {
  statuses: [],
  genres: [],
  playtime: [],
  eras: [],
  flags: [],
  sort: 'title',
};

export const PLAYTIME_LABELS: Record<PlaytimeBucket, string> = {
  none: 'Untouched',
  short: 'Under 5h',
  medium: '5–20h',
  long: 'Over 20h',
};

export const ERA_LABELS: Record<EraBucket, string> = {
  now: '2020s',
  tens: '2010s',
  aughts: '2000s',
  retro: "'90s & older",
};

export const FLAG_LABELS: Record<FlagKey, string> = {
  emulated: 'Emulated',
  endless: 'Endless',
};

export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title (A–Z)',
  'last-played': 'Last played',
  'hours-desc': 'Most played',
  'hours-asc': 'Least played',
  'added-desc': 'Recently added',
  'release-desc': 'Newest release',
  'sessions-desc': 'Most sessions',
};

export const statusKeyOf = (game: GameListItem): StatusKey =>
  game.currentState === null ? 'unplayed' : STATE_TO_STATUS_KEY[game.currentState];

const playtimeOf = (hours: number): PlaytimeBucket => {
  if (hours <= 0) return 'none';
  if (hours < 5) return 'short';
  if (hours < 20) return 'medium';
  return 'long';
};

// null (juego sin año de lanzamiento conocido) devuelve null y NO entra en
// ningún cubo: filtrar por década a un juego cuya década no sabemos sería
// inventarse el dato.
const eraOf = (releaseYear: number | null): EraBucket | null => {
  if (releaseYear === null) return null;
  if (releaseYear >= 2020) return 'now';
  if (releaseYear >= 2010) return 'tens';
  if (releaseYear >= 2000) return 'aughts';
  return 'retro';
};

const matchesFlag = (game: GameListItem, flag: FlagKey): boolean =>
  // "Endless" es una propiedad del JUEGO (SPEC 10.8), no de cómo va: entran
  // TODOS los que no tienen final, incluidos los que abandonaste. Cruzarlo
  // con el estado es cosa de los chips de STATUS, que ya están al lado.
  flag === 'emulated' ? game.isEmulated : game.endless;

const SORTERS: Record<SortKey, (a: GameListItem, b: GameListItem) => number> = {
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  // Lo más reciente arriba. `lastPlayedAt` ya viene resuelto del backend con
  // la regla "última sesión, y si no hay, último evento de estado" — ver
  // getGames.ts. Los que no se han tocado nunca van al final, no al
  // principio como pasaría tratando el null como fecha 0.
  'last-played': (a, b) =>
    (b.lastPlayedAt?.getTime() ?? -Infinity) - (a.lastPlayedAt?.getTime() ?? -Infinity),
  'hours-desc': (a, b) => b.totalHours - a.totalHours,
  'hours-asc': (a, b) => a.totalHours - b.totalHours,
  'added-desc': (a, b) => b.addedAt.getTime() - a.addedAt.getTime(),
  // Los juegos sin año se van al final en vez de colarse como si fueran del
  // año 0 — un dato que falta no es un dato pequeño.
  'release-desc': (a, b) => (b.releaseYear ?? -Infinity) - (a.releaseYear ?? -Infinity),
  'sessions-desc': (a, b) => b.sessionCount - a.sessionCount,
};

// Cuántos filtros hay puestos — el numerito del botón. El orden NO cuenta
// como filtro: siempre hay uno activo (aunque sea el alfabético por defecto)
// y marcarlo daría un "1" permanente que no significa nada.
export const countActiveFilters = (filters: GameFilters): number =>
  filters.statuses.length +
  filters.genres.length +
  filters.playtime.length +
  filters.eras.length +
  filters.flags.length;

// Los géneros que de verdad aparecen en esta lista, ordenados por cuántos
// juegos tienen. Ofrecer el catálogo entero de IGDB llenaría el panel de
// filtros que no devuelven nada.
export const availableGenres = (games: GameListItem[]): string[] => {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const genre of game.genres ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))
    .map(([name]) => name);
};

export const applyFilters = (games: GameListItem[], filters: GameFilters): GameListItem[] => {
  const filtered = games.filter((game) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(statusKeyOf(game))) return false;

    // AND, no OR: marcar "RPG" y "Strategy" pide los que son las DOS cosas.
    // Los géneros no son excluyentes entre sí (un juego trae varios), así
    // que sumar chips tiene que recortar la lista.
    if (filters.genres.length > 0) {
      const genres = game.genres ?? [];
      if (!filters.genres.every((genre) => genres.includes(genre))) return false;
    }

    if (filters.playtime.length > 0 && !filters.playtime.includes(playtimeOf(game.totalHours))) {
      return false;
    }

    if (filters.eras.length > 0) {
      const era = eraOf(game.releaseYear);
      if (era === null || !filters.eras.includes(era)) return false;
    }

    // Las banderas son el único grupo en AND consigo mismo: marcar "Emulado"
    // y "Sin terminar" pide los que cumplen las DOS. Son afirmaciones sueltas
    // sobre el juego, no valores de una misma dimensión — en OR, añadir una
    // bandera ampliaría la lista, que es justo lo contrario de lo que uno
    // espera al marcar una casilla más.
    if (filters.flags.some((flag) => !matchesFlag(game, flag))) return false;

    return true;
  });

  // `.filter()` ya devolvió un array nuevo, así que ordenarlo in situ no
  // toca el que vive en la caché de react-query.
  return filtered.sort(SORTERS[filters.sort]);
};
