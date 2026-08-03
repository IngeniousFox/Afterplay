// Las URLs de imagen de comunidad que devuelve la Steam Web API apuntan a
// una ubicación que Steam YA NO SIRVE para buena parte del catálogo — 404
// puro. Comprobado a mano contra la propia web de Steam (3-ago-2026, caso
// real: Factorio, appid 427520, con sus 88 iconos de logro rotos):
//
//   lo que da la API   steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/<appid>/<hash>.jpg  -> 404
//   lo que usa Steam   shared.akamai.steamstatic.com/community_assets/images/apps/<appid>/<hash>.jpg -> 200
//
// El HASH es el mismo: no se ha perdido ninguna imagen. Valve movió los
// assets de comunidad y no actualizó lo que devuelve su propia API.
//
// Dos avisos que costaron un rato averiguar:
//   1. Hay que cambiar host Y ruta A LA VEZ. El host nuevo con la ruta vieja
//      (/steamcommunity/public/images/) también da 404 — probarlo por
//      separado hacía parecer que la imagen no existía en ningún sitio.
//   2. No falla en TODOS los juegos: los anteriores a la migración siguen
//      duplicados en las dos ubicaciones, así que su URL vieja funciona. Los
//      que solo viven en la nueva daban error, y el fallo parecía aleatorio.
//
// Se aplica en dos sitios a propósito: al traer el catálogo (steam/api.ts),
// para que lo que se guarda ya nazca bien, y al resolver la imagen
// (images/cache.ts), para que los miles de logros YA guardados con la URL
// vieja funcionen sin tener que resincronizar la biblioteca entera.

const LEGACY_PREFIX = 'steamcdn-a.akamaihd.net/steamcommunity/public/images/';
const CURRENT_BASE = 'https://shared.akamai.steamstatic.com/community_assets/images/';

export const normalizeSteamCommunityImageUrl = (url: string): string => {
  const index = url.indexOf(LEGACY_PREFIX);
  if (index === -1) return url;
  return CURRENT_BASE + url.slice(index + LEGACY_PREFIX.length);
};
