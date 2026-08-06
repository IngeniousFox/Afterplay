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

// Precisión de una fecha de lanzamiento (PLAN-TO-PLAY.md §7bis) — el mismo
// vocabulario que el datePrecision que la app ya usa en tres tablas, así que
// formatByPrecision() la pinta sin traducir nada.
export type ReleaseDatePrecision = 'year' | 'month' | 'day';

// Todo lo que el lote de IGDB trae de un juego ya dado de alta: las notas de
// siempre más la sinopsis, las sagas y la fecha completa (§5.1). Un solo
// viaje, un solo checkedAt.
export type GameExternalData = GameRatings & {
  summary: string | null;
  igdbCollections: { id: number; name: string }[] | null;
  releaseYear: number | null;
  releaseDate: Date | null;
  releaseDatePrecision: ReleaseDatePrecision | null;
};

// Un juego de una saga (PLAN-TO-PLAY.md §3.5), con lo justo para pintar su
// carátula en el carrusel. Es la MISMA forma que devuelve el radar semanal
// (§4): las dos preguntas son "qué hay en estas colecciones", solo cambia el
// filtro de fecha.
export type CollectionGame = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  releaseDate: Date | null;
  releaseDatePrecision: ReleaseDatePrecision | null;
  // Las sagas a las que pertenece, en ids. El radar las cruza con las tuyas
  // para poder decir "de la saga Fable" en la fila del horizonte — que es lo
  // que convierte un título desconocido en una noticia que te importa.
  collectionIds: number[];
  // Otras EDICIONES de este mismo capítulo: el remaster, el port, la
  // "Panoramic Edition". No son juegos distintos de la saga —son el mismo
  // juego en otra caja—, así que no ocupan hueco propio en la línea temporal:
  // viajan colgadas de su capítulo para que el carrusel pueda enseñar la
  // versión que TÚ tienes en vez de una vanilla que no es la tuya.
  editions: CollectionGameEdition[];
};

// Lo justo para reconocer una edición y pintarla en el sitio de su capítulo.
// Sin fecha a propósito: la que manda en el carrusel es la del capítulo (una
// "Panoramic Edition" de 2022 de un juego de 2014 pertenece a 2014, y poner
// su año propio bajo la carátula parecería un fallo de ordenación).
export type CollectionGameEdition = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
};

// Etiqueta de Steam con sus votos (§8) — top 8, ya ordenadas. Vocabulario de
// jugadores (Metroidvania, Souls-like, Cozy), no de catálogo.
export type SteamTag = { name: string; votes: number };

// Estado del bloque de datos externos de Ajustes: qué parte de la biblioteca
// tiene ya cada cosa. Los "nunca preguntados" son el motivo de que el botón
// exista — juegos dados de alta antes de que estos campos existieran.
export type ExternalDataStatus = {
  total: number;
  withRatings: number;
  withSummary: number;
  withFullDate: number;
  neverChecked: number;
  // Solo los juegos con appid pueden tener etiquetas/reseñas de Steam: el
  // retro emulado no está en Steam, y eso no es un fallo que arreglar.
  steamEligible: number;
  withSteamData: number;
  // ¿Hay una pasada en marcha AHORA? El candado vive en el main, así que una
  // pantalla recién montada (abrir Ajustes a mitad de pasada, volver al Plan)
  // lo sabe sin esperar al siguiente evento de progreso.
  running: boolean;
};

// Progreso de la pasada, por el canal 'external:activity'. Existe porque la
// parte de SteamSpy va a ~1 petición por segundo y con la biblioteca entera
// son MINUTOS: en ese rato el usuario cierra Ajustes o se va a otra pantalla,
// y el estado no puede vivir en un componente que se desmonta. Con esto la
// pasada se ve igual desde donde estés, y termina donde estés.
export type ExternalRefreshEvent = {
  running: boolean;
  // Qué puerta la arrancó — solo para el texto ("your plan" vs "your
  // library"): la pasada es la misma.
  scope: 'plan' | 'all';
  // 'igdb' son 1-2 peticiones que vuelan; 'steam' es la larga y la que de
  // verdad se ve avanzar; 'saving' es la transacción final.
  phase: 'igdb' | 'steam' | 'saving' | 'done';
  done: number;
  // El total es el de SteamSpy (los juegos con appid): es la única parte que
  // avanza juego a juego.
  total: number;
  currentTitle: string | null;
  // Solo en el evento final, y solo si terminó bien.
  summary: ExternalRefreshSummary | null;
  // El invoke ya contestó cuando la pasada arranca, así que un fallo no tiene
  // promesa por la que subir: viaja aquí.
  error: string | null;
};

// Resumen de una pasada de refresco. Los contadores honestos de siempre:
// cuántos se pidieron, cuántos contestó IGDB (la diferencia son juegos que ya
// no están en su catálogo y se quedan como estaban) y qué se ganó de nuevo.
export type ExternalRefreshSummary = {
  total: number;
  updated: number;
  withRatings: number;
  withSummary: number;
  withFullDate: number;
  // Cuántos juegos con appid se le preguntaron a SteamSpy y de cuántos supo.
  steamChecked: number;
  steamFound: number;
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
  // La fecha completa con su precisión (§7bis) — null cuando IGDB solo tiene
  // un TBD o un formato que no sabemos leer: ahí manda el releaseYear de
  // siempre y RELEASED sigue pintando el año a secas.
  release: { date: Date; precision: ReleaseDatePrecision } | null;
  // Las sagas de IGDB a las que pertenece, con nombre. null = ninguna.
  igdbCollections: { id: number; name: string }[] | null;
  platforms: string[];
  genres: string[];
  summary: string | null;
  developer: string | null;
  publisher: string | null;
  covers: string[];
  heroes: string[];
  screenshots: string[];
};
