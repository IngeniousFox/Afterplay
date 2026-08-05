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
  category: z.number().optional(),
  version_parent: z.number().optional(),
  parent_game: z.number().optional(),
  collection: z.number().optional(),
  total_rating_count: z.number().optional(),
  follows: z.number().optional(),
  hypes: z.number().optional(),
});

export const igdbSearchResponseSchema = z.array(igdbSearchGameSchema);

export const igdbDetailGameSchema = igdbSearchGameSchema.extend({
  artworks: z.array(imageSchema).optional(),
  screenshots: z.array(imageSchema).optional(),
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
});

export const igdbDetailResponseSchema = z.array(igdbDetailGameSchema);

// Puntuaciones de un LOTE de juegos (el "Refresh all" de Ajustes): solo el id
// y los cuatro campos de notas — nada de covers ni companies, que a 400
// juegos por petición serían peso muerto multiplicado.
export const igdbRatingsBatchResponseSchema = z.array(
  z.object({
    id: z.number(),
    aggregated_rating: z.number().optional(),
    aggregated_rating_count: z.number().optional(),
    rating: z.number().optional(),
    rating_count: z.number().optional(),
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
