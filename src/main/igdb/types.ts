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

export type IgdbGameDetail = {
  igdbId: number;
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
