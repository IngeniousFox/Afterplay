import { z } from 'zod';

// searchGame de SteamGridDB devuelve ediciones, DLC y hasta mods de fans
// junto al juego base (probado en vivo: "Elden Ring Seamless Co-op",
// "Baldur's Gate 3 Toolkit"...) — release_date es la señal que desambigua en
// match.ts, por eso se valida aunque no viaje tal cual al renderer.
export const sgdbGameSchema = z.object({
  id: z.number(),
  name: z.string(),
  release_date: z.number().nullable().optional(), // unix en segundos; algunas entradas no lo traen
});
export type SgdbGame = z.infer<typeof sgdbGameSchema>;

export const sgdbSearchResponseSchema = z.array(sgdbGameSchema);

// El .d.ts del paquete declara style: string[], pero la respuesta real de la
// API trae un string suelto (comprobado en vivo) — se valida la forma real,
// no la declarada, para no arrastrar la inexactitud del paquete a nuestro código.
export const sgdbImageSchema = z.object({
  id: z.number(),
  url: z.string(),
  thumb: z.string(),
  style: z.string().nullable().optional(),
  score: z.number().optional(),
});

export const sgdbImageResponseSchema = z.array(sgdbImageSchema);
