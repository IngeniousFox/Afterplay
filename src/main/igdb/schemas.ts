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
});

export const igdbSearchResponseSchema = z.array(igdbSearchGameSchema);

export const igdbDetailGameSchema = igdbSearchGameSchema.extend({
  artworks: z.array(imageSchema).optional(),
  screenshots: z.array(imageSchema).optional(),
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
