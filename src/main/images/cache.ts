import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { app } from 'electron';
import axios from 'axios';
import { extname, join } from 'path';

// El nombre coincide con el de la carpeta dentro de userData, así no hace
// falta mapear uno a otro. 'screenshots' se añade en el Bloque 2H para el
// carrusel del detalle.
export type ImageCacheType = 'covers' | 'heroes' | 'screenshots';

// Sin cachear el resultado (a diferencia de getDb()): app.getPath() es
// barato de llamar cada vez, y así no hay que preocuparse de invalidar nada.
const getImageCacheDir = (type: ImageCacheType): string => join(app.getPath('userData'), type);

// Mismo hash siempre para la misma URL → mismo nombre de fichero. Así
// "cachear" es idempotente sin más: si el fichero ya existe, ni se descarga.
const filenameForUrl = (url: string): string => {
  const hash = createHash('sha256').update(url).digest('hex');
  // Las URLs de IGDB (.webp) y SteamGridDB (.png/.jpg) siempre traen
  // extensión — el fallback es solo por si algún día llega una URL rara.
  const ext = extname(new URL(url).pathname) || '.jpg';
  return `${hash}${ext}`;
};

// El CoverPicker pide de golpe varias decenas de candidatas (IGDB +
// SteamGridDB), y la biblioteca/el rail lateral piden una por cada juego
// visible — sin límite, eso dispara una ráfaga de descargas simultáneas
// contra el mismo CDN, que a veces rechaza o corta alguna a medias (falla
// justo esa, no las demás — parecía aleatorio pero es contención de red).
// Un límite de concurrencia + reintento aquí es la solución de raíz, no un
// parche por cada sitio que usa useImageSrc.
const MAX_CONCURRENT_DOWNLOADS = 6;
let activeDownloads = 0;
const downloadQueue: (() => void)[] = [];

const acquireDownloadSlot = (): Promise<void> => {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => downloadQueue.push(resolve));
};

// Si hay alguien en cola, el hueco pasa a ser suyo directamente (activeDownloads
// no baja); si no hay nadie esperando, el hueco queda libre de verdad.
const releaseDownloadSlot = (): void => {
  const next = downloadQueue.shift();
  if (next) next();
  else activeDownloads--;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ATTEMPTS = 3;

const downloadWithRetry = async (url: string): Promise<Buffer> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 15_000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      lastError = error;
      // Backoff corto — casi siempre es contención momentánea del CDN por la
      // ráfaga de descargas simultáneas, no un fallo real de la URL.
      if (attempt < ATTEMPTS) await sleep(attempt * 400);
    }
  }
  throw lastError;
};

// Peticiones de la MISMA url ya en curso (dos componentes montados a la vez
// pidiendo la misma imagen, p.ej. la carátula ya elegida apareciendo también
// entre las candidatas del picker) esperan la misma promesa en vez de lanzar
// una descarga cada una por su cuenta.
const inFlight = new Map<string, Promise<string>>();

// Descarga `url` a userData/<type>/ y devuelve la ruta local absoluta. Si el
// fichero ya está cacheado, no vuelve a descargar. Es la MISMA operación
// tanto si se llama "al guardar la imagen elegida" (para tenerla lista de
// antemano) como "al mostrarla" (lazy, ver images/api.ts) — no hace falta
// una función distinta para cada momento, cachear ya es de por sí "usa lo
// que haya, descarga si no hay nada".
export const cacheImage = async (url: string, type: ImageCacheType): Promise<string> => {
  const dir = getImageCacheDir(type);
  const filePath = join(dir, filenameForUrl(url));
  if (existsSync(filePath)) return filePath;

  const key = `${type}:${url}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    await acquireDownloadSlot();
    try {
      // Puede que otra petición haya terminado de escribirlo mientras
      // esperábamos turno en la cola.
      if (existsSync(filePath)) return filePath;
      await mkdir(dir, { recursive: true });
      const buffer = await downloadWithRetry(url);
      await writeFile(filePath, buffer);
      return filePath;
    } finally {
      releaseDownloadSlot();
    }
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    // Se quita tanto si sale bien como si falla — un fallo real (sin
    // conexión) no debe dejar el siguiente intento reutilizando una promesa
    // ya rechazada para siempre.
    inFlight.delete(key);
  }
};
