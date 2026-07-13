import { z } from 'zod';

// hltb-client trae tipos de TS, pero es un scraper: la forma real en runtime
// puede desviarse si HLTB cambia su web. Validamos defensivamente lo que
// usamos, para fallar limpio (match descartado) en vez de propagar basura.
export const hltbGameSchema = z.object({
  id: z.string(),
  name: z.string(),
  releaseYear: z.number().optional(),
  reviewScore: z.number().optional(),
  completionTimes: z.object({
    main: z.number().optional(),
    mainExtra: z.number().optional(),
    completionist: z.number().optional(),
    allStyles: z.number().optional(),
  }),
});

export const hltbSearchResultSchema = z.array(hltbGameSchema);

export type HltbGame = z.infer<typeof hltbGameSchema>;
