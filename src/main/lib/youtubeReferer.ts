import { session } from 'electron';

// El tráiler de la ficha, y por qué hace falta esto.
//
// EL SÍNTOMA: en la app INSTALADA todos los tráilers salían con "Error 153 —
// Error de configuración del reproductor de vídeo". En desarrollo funcionaban.
//
// LA CAUSA: el reproductor de YouTube valida quién lo incrusta mirando la
// cabecera `Referer`. Y de dónde carga la ventana cambia según la build (ver
// createWindow en main/index.ts):
//
//   dev        -> loadURL('http://localhost:5173')  -> manda Referer -> va
//   instalada  -> loadFile('.../index.html')        -> file://, SIN Referer
//
// Una página `file://` tiene origen `null` y no manda referente ninguno, así
// que YouTube no tiene nada que validar y se planta. Por eso fallaba en todos
// los tráilers y solo en la versión que usa la gente.
//
// EL ARREGLO: rellenar ese hueco, y SOLO ese hueco.
const YOUTUBE_FILTER = { urls: ['*://*.youtube-nocookie.com/*'] };

// El dominio del propio reproductor. No se suplanta ninguna web ajena: se le
// dice que la petición viene del sitio al que ya pertenece el iframe, que es
// lo más parecido a la verdad que se puede mandar desde un `file://`.
const REFERER = 'https://www.youtube-nocookie.com/';

export const applyYoutubeReferer = (): void => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    // Acotado a youtube-nocookie.com, que es además el ÚNICO dominio que el
    // CSP del renderer deja incrustar (ver index.html). Ninguna otra petición
    // de la app pasa por aquí.
    YOUTUBE_FILTER,
    (details, callback) => {
      const headers = details.requestHeaders;

      // Solo si NO hay referente. En desarrollo ya viene uno válido
      // (localhost) y YouTube lo acepta — pisarlo sería arreglar algo que no
      // está roto y, de paso, dejar de probar en dev lo mismo que corre en
      // producción.
      const hasReferer = Object.keys(headers).some((key) => key.toLowerCase() === 'referer');
      if (!hasReferer) headers.Referer = REFERER;

      callback({ requestHeaders: headers });
    },
  );
};
