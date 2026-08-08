import { z } from 'zod';

// IGDB omite los campos sin valor (no manda null) — de ahí tanto .optional().
const imageSchema = z.object({ image_id: z.string() });
const namedSchema = z.object({ name: z.string() });

export const igdbSearchGameSchema = z.object({
  id: z.number(),
  name: z.string(),
  cover: imageSchema.optional(),
  first_release_date: z.number().optional(), // unix en SEGUNDOS, no ms
  platforms: z.array(namedSchema).optional(),
  genres: z.array(namedSchema).optional(),
  summary: z.string().optional(),
  // Campos solo para filtrar/puntuar el buscador (rank.ts) — no viajan al
  // renderer, se quedan aquí en cuanto se resuelve el ranking.
  // `game_type` y no `category`: el segundo está muerto (ver igdb/api.ts).
  // Mismo enum de ids, así que rank.ts no cambia sus números.
  game_type: z.number().optional(),
  version_parent: z.number().optional(),
  parent_game: z.number().optional(),
  // PLURAL y sin expandir = lista de ids. El singular `collection` que se
  // pedía antes está MUERTO (ver igdb/api.ts): se aceptaba y venía siempre
  // vacío, así que el empujón de "saga dominante" del ranking llevaba
  // tiempo sin dispararse nunca. Comprobado en vivo el 2026-08-06.
  collections: z.array(z.number()).optional(),
  total_rating_count: z.number().optional(),
  follows: z.number().optional(),
  hypes: z.number().optional(),
});

export const igdbSearchResponseSchema = z.array(igdbSearchGameSchema);

// Una fecha de lanzamiento concreta (una por plataforma/región) con su
// FORMATO — el campo que dice cuánto de esa fecha se conoce de verdad.
// date_format sin expandir viaja como número; se acepta también el objeto
// expandido por si alguna llamada lo pide así.
export const igdbReleaseDateSchema = z.object({
  // Ausente en los TBD: una ficha anunciada sin fecha ninguna.
  date: z.number().optional(),
  date_format: z.union([z.number(), z.object({ id: z.number() })]).optional(),
});

export const igdbDetailGameSchema = igdbSearchGameSchema.extend({
  artworks: z.array(imageSchema).optional(),
  screenshots: z.array(imageSchema).optional(),
  // En el detalle las colecciones sí van expandidas: hace falta el nombre
  // ("Super Mario") para poder enseñar de qué saga viene un juego.
  collections: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  release_dates: z.array(igdbReleaseDateSchema).optional(),
  // Puntuaciones — solo en el detalle, no en SEARCH_FIELDS: el buscador no
  // las enseña, y pedirlas en cada tecleo sería peso sin uso.
  // aggregated_rating es la media de CRÍTICA que IGDB agrega (0-100);
  // rating es la nota de la COMUNIDAD de IGDB (0-100, escala distinta a la
  // de 0-10 que se ve en su web). Los dos vienen con su *_count — la
  // muestra sobre la que se calculan, imprescindible para no enseñar un
  // número sacado de dos votos como si fuera fiable.
  aggregated_rating: z.number().optional(),
  aggregated_rating_count: z.number().optional(),
  rating: z.number().optional(),
  rating_count: z.number().optional(),
  // Identidades del juego en tiendas externas — de aquí sale el appid de
  // Steam, filtrando por external_game_source (ver el porqué en igdb/api.ts).
  external_games: z
    .array(z.object({ uid: z.string(), external_game_source: z.number().optional() }))
    .optional(),
  involved_companies: z
    .array(
      z.object({
        company: namedSchema,
        developer: z.boolean(),
        publisher: z.boolean(),
      }),
    )
    .optional(),
  // Vídeos del juego: `video_id` es un id de YouTube, no una URL ni un
  // fichero — IGDB no aloja vídeo, solo apunta. `name` viene a ser
  // "Launch Trailer", "Gameplay", "Dev Diary #2"…, y es lo único con lo que
  // distinguir el tráiler de un diario de desarrollo.
  videos: z.array(z.object({ video_id: z.string(), name: z.string().optional() })).optional(),
});

export const igdbDetailResponseSchema = z.array(igdbDetailGameSchema);

// Los datos externos de un LOTE de juegos (el "Refresh" de Ajustes y el de la
// cabecera del Plan): id, notas, sinopsis, colecciones y fecha con precisión —
// nada de covers ni companies, que a 400 juegos por petición serían peso
// muerto multiplicado. Todo lo demás (etiquetas y reseñas de Steam) sale de
// la API de la tienda de Steam, no de aquí.
export const igdbExternalBatchResponseSchema = z.array(
  z.object({
    id: z.number(),
    aggregated_rating: z.number().optional(),
    aggregated_rating_count: z.number().optional(),
    rating: z.number().optional(),
    rating_count: z.number().optional(),
    summary: z.string().optional(),
    first_release_date: z.number().optional(),
    collections: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
    release_dates: z.array(igdbReleaseDateSchema).optional(),
  }),
);

// Respuesta del endpoint external_games para el backfill por lotes: una fila
// por (juego, tienda), ya filtrada a Steam en la propia query.
export const igdbExternalGamesResponseSchema = z.array(
  z.object({ game: z.number(), uid: z.string() }),
);

// Ediciones de un juego (version_parent apunta al juego base) — el respaldo
// para encontrar el appid cuando el puerto de PC salió como "Complete
// Edition" y es la edición, no el juego base, la que lleva el enlace a Steam.
export const igdbGameVersionsResponseSchema = z.array(
  z.object({ id: z.number(), version_parent: z.number() }),
);

// Los miembros de una colección (PLAN-TO-PLAY.md §3.5): lo mínimo para pintar
// una carátula en el carrusel de la saga. Sin summary, sin companies, sin
// plataformas — de veinticinco juegos, todo eso sería peso muerto.
export const igdbCollectionGamesResponseSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    cover: imageSchema.optional(),
    first_release_date: z.number().optional(),
    release_dates: z.array(igdbReleaseDateSchema).optional(),
    // Sin expandir (ids pelados): el radar solo necesita saber DE QUÉ saga
    // tuya viene cada anuncio, y el nombre ya lo tiene en casa — está
    // guardado en tus propios juegos.
    collections: z.array(z.number()).optional(),
    // Los dos que distinguen un capítulo de una edición de ese capítulo: el
    // tipo (0 = juego principal; 8/9/10/11 = remake/remaster/expandido/port)
    // y a quién cuelga. Ausentes en la respuesta del radar, que no los pide.
    game_type: z.number().optional(),
    parent_game: z.number().optional(),
  }),
);
