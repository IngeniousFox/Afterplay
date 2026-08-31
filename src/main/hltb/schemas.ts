import { z } from 'zod';

// La forma que ./client YA ha normalizado, escrita una vez para que api.ts
// tenga algo que afirmar en el borde.
//
// AVISO, porque aqui ponia lo contrario: esto NO es una red de seguridad
// contra los cambios de HLTB. Lo era cuando la respuesta cruda llegaba hasta
// aqui; desde que el cliente propio construye cada candidato coaccionando
// todos los campos (`String(raw.game_id ?? '')`, `raw.game_name ?? ''`,
// tiempos que salen de secondsToHours), la forma SIEMPRE encaja — ni aunque
// HLTB renombre sus campos enteros, que saldria un candidato con id '' y
// nombre '' perfectamente valido para zod. La defensa real vive en
// ./client.ts, en esos `??`.
//
// Y tampoco "descarta el match": `.parse` LANZA, y esa excepcion sube por
// getHltbTimes hasta el catch de quien llame (que en ipc/hltb.ts no existe,
// asi que ahi rechaza el invoke). Si algun dia hace falta la red de verdad,
// tiene que validar la respuesta CRUDA de HLTB (el RawGame de client.ts) con
// safeParse, que es el unico sitio donde puede rechazar algo.
export const hltbGameSchema = z.object({
  id: z.string(),
  name: z.string(),
  releaseYear: z.number().optional(),
  completionTimes: z.object({
    main: z.number().optional(),
    mainExtra: z.number().optional(),
    completionist: z.number().optional(),
  }),
});

export const hltbSearchResultSchema = z.array(hltbGameSchema);

export type HltbGame = z.infer<typeof hltbGameSchema>;
