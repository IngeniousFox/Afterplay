import { net, protocol } from 'electron';
import { pathToFileURL } from 'url';

// Chromium bloquea que una página cargada por http(s) referencie file://
// directamente ("Not allowed to load local resource") — y en dev la ventana
// SIEMPRE carga desde http://localhost:5173, nunca desde file://. Por eso
// getImageSrc no puede devolver una file:// a secas: hace falta un esquema
// propio que sirva esos ficheros locales, permitido explícitamente en el
// CSP de index.html (img-src).
export const IMAGE_PROTOCOL_SCHEME = 'afterplay-image';

// Tiene que llamarse ANTES de app.whenReady() — Electron lo exige así para
// registrar esquemas con privilegios (aquí: que se comporte como un origen
// seguro normal, para que <img src> lo cargue sin líos de CORS).
export const registerImageProtocolScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
};

// Al revés que el registro de arriba: esto solo funciona DESPUÉS de
// app.whenReady(), así que va dentro del bloque async del arranque.
export const registerImageProtocolHandler = (): void => {
  protocol.handle(IMAGE_PROTOCOL_SCHEME, (request) => {
    const localPath = decodeURIComponent(
      request.url.replace(`${IMAGE_PROTOCOL_SCHEME}://local/`, ''),
    );
    // net.fetch sí puede leer file:// sin restricción — la restricción de
    // Chromium es para que la PÁGINA lo pida directo, no para que el propio
    // proceso principal lo lea internamente.
    return net.fetch(pathToFileURL(localPath).toString());
  });
};

export const toImageProtocolUrl = (localPath: string): string =>
  `${IMAGE_PROTOCOL_SCHEME}://local/${encodeURIComponent(localPath)}`;
