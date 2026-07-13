import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { app } from 'electron';
import axios from 'axios';
import { extname, join } from 'path';

// Solo estos dos tipos por ahora (SPEC 4.6) — el nombre coincide con el de
// la carpeta dentro de userData, así no hace falta mapear uno a otro.
export type ImageCacheType = 'covers' | 'heroes';

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

// Descarga `url` a userData/<type>/ y devuelve la ruta local absoluta. Si el
// fichero ya está cacheado, no vuelve a descargar. Es la MISMA operación
// tanto si se llama "al guardar la imagen elegida" (para tenerla lista de
// antemano) como "al mostrarla" (lazy, ver images/api.ts) — no hace falta
// una función distinta para cada momento, cachear ya es de por sí "usa lo
// que haya, descarga si no hay nada".
export const cacheImage = async (url: string, type: ImageCacheType): Promise<string> => {
  const dir = getImageCacheDir(type);
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, filenameForUrl(url));
  if (existsSync(filePath)) return filePath;

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 15_000,
  });
  await writeFile(filePath, Buffer.from(response.data));
  return filePath;
};
