import axios from 'axios';
import { z } from 'zod';
import type { SteamTag } from '../igdb/types';

// SteamSpy (PLAN-TO-PLAY.md §6) — la fuente de las ETIQUETAS de Steam y de
// sus reseñas. Gratis, sin clave, y una sola petición trae las dos cosas:
//
//   steamspy.com/api.php?request=appdetails&appid=367520  (Hollow Knight)
//     tags:     { "Metroidvania": 5623, "Souls-like": 4307, ... }
//     positive: 403641   negative: 12305
//
// Por qué las etiquetas valen más que los géneros de IGDB: IGDB dice
// "Platform, Adventure"; las etiquetas dicen la verdad cultural del juego —
// Metroidvania, Souls-like, Cozy. Vocabulario de jugadores, no de catálogo.
//
// La letra pequeña, asumida a propósito (§6.2):
//  1. SOLO juegos con appid de Steam. El retro emulado se queda sin ellas y
//     el bloque simplemente no aparece — no es un hueco que explicar.
//  2. Es un tercero que ya se ha roto otras veces: TODO esto es dato
//     DECORATIVO. Si SteamSpy muere, lo guardado se queda y deja de
//     refrescarse; nada de la app depende de que conteste.

// Las etiquetas llegan como objeto {nombre: votos}. Cuando un juego no tiene
// ninguna, SteamSpy manda un ARRAY vacío en vez de un objeto vacío (así es
// PHP): las dos formas se aceptan.
const tagsSchema = z.union([z.record(z.string(), z.number()), z.array(z.unknown())]);

const appDetailsSchema = z.object({
  // 0 = appid desconocido para SteamSpy; viene con el resto de campos a cero.
  appid: z.number(),
  name: z.string().nullable().optional(),
  positive: z.number().optional(),
  negative: z.number().optional(),
  tags: tagsSchema.optional(),
});

// Steam lista una veintena; a partir de la décima son ruido de cola larga.
const MAX_TAGS = 8;

// ~1 petición por segundo es lo que SteamSpy pide en su documentación para
// `appdetails`. Se respeta con margen: el barrido va en SERIE y espera esto
// entre juegos, así una biblioteca entera tarda minutos — que es exactamente
// lo que debe tardar algo que se pide una vez y se guarda.
export const STEAMSPY_DELAY_MS = 1100;

export type SteamSpyData = {
  steamTags: SteamTag[] | null;
  steamPositive: number | null;
  steamNegative: number | null;
};

const toTags = (raw: z.infer<typeof tagsSchema> | undefined): SteamTag[] | null => {
  if (!raw || Array.isArray(raw)) return null;
  const tags = Object.entries(raw)
    .map(([name, votes]) => ({ name, votes }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, MAX_TAGS);
  return tags.length > 0 ? tags : null;
};

// Los datos de UN juego. null = SteamSpy no sabe nada de este appid (o
// contestó algo que no se puede leer): quien llama estampa igualmente su
// checkedAt y conserva lo que hubiera — misma convención que el resto de
// fuentes externas de la casa.
export const getSteamSpyData = async (appId: number): Promise<SteamSpyData | null> => {
  if (!Number.isInteger(appId) || appId <= 0) return null;

  try {
    const response = await axios.get<unknown>('https://steamspy.com/api.php', {
      params: { request: 'appdetails', appid: appId },
      timeout: 10_000,
    });
    const data = appDetailsSchema.parse(response.data);
    // appid 0 es su forma de decir "no lo conozco"; sin nombre, lo mismo.
    if (data.appid === 0) return null;

    const steamTags = toTags(data.tags);
    const steamPositive = data.positive ?? null;
    const steamNegative = data.negative ?? null;
    // Sin etiquetas Y sin reseñas no hay nada que guardar — devolverlo como
    // "encontrado" inflaría el contador de la pasada con juegos vacíos.
    if (steamTags === null && steamPositive === null && steamNegative === null) return null;

    return { steamTags, steamPositive, steamNegative };
  } catch (error) {
    // Solo ASCII, misma convención que el resto de logs del main: la consola
    // de Windows no siempre usa UTF-8.
    console.warn(`[steamspy] sin datos para el appid ${appId} (sigo sin ellos):`, error);
    return null;
  }
};
