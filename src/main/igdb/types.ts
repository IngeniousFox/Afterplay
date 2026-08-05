// Formas que viajan al renderer — ya transformadas y con las URLs de imagen
// construidas. Las listas de imágenes del detalle (covers/heroes/screenshots)
// son deliberadamente neutrales respecto a la fuente: cuando entre
// SteamGridDB, sus imágenes se mezclarán en estas MISMAS listas y para el
// renderer será transparente de dónde salió cada una.
export type IgdbSearchResult = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  platforms: string[];
  genres: string[];
  summary: string | null;
};

// Las cuatro puntuaciones que se guardan en la fila del juego (ver
// schema.ts para el porqué de mantenerlas separadas). Nombre compartido con
// el patch de refresco manual (igdb:refreshRatings) — es la misma forma en
// los dos sitios, así que un solo tipo cubre ambos.
export type GameRatings = {
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
};

// Estado del bloque Ratings de Ajustes: cuántos juegos tienen alguna nota y
// cuántos no se han preguntado nunca (los dados de alta antes de que esta
// función existiera).
export type RatingsStatus = {
  total: number;
  withRatings: number;
  neverChecked: number;
};

// Resumen del "Refresh all": cuántos respondió IGDB (updated) y cuántos de
// ellos traen alguna nota — la diferencia con total son juegos que ya no
// están en el catálogo (rarísimo) y se quedan como estaban.
export type RatingsRefreshSummary = {
  total: number;
  updated: number;
  withRatings: number;
};

export type IgdbGameDetail = GameRatings & {
  igdbId: number;
  // Appid de Steam tal cual viene ATADO a este juego en la misma respuesta
  // (external_games) — gratis, sin petición extra. Puede no ser el appid con
  // el que se piden los logros: cuando el juego tiene un `parentIgdbId`,
  // manda el del juego base (ver resolveAchievementsSteamAppId en api.ts).
  // Por eso se llama "direct" y no "steamAppId" a secas: quien quiera EL
  // appid de los logros tiene que resolverlo, no leer este campo.
  directSteamAppId: number | null;
  // El juego BASE del que este cuelga, si IGDB lo declara — la pista para
  // resolver el appid de los logros. null si este es el juego base.
  parentIgdbId: number | null;
  title: string;
  coverUrl: string | null; // cover_big, para detalle/biblioteca
  releaseYear: number | null;
  platforms: string[];
  genres: string[];
  summary: string | null;
  developer: string | null;
  publisher: string | null;
  covers: string[];
  heroes: string[];
  screenshots: string[];
};
