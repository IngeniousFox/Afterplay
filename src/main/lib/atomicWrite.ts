import { randomUUID } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';

// Escribir un fichero de forma ATÓMICA: primero a un temporal en la MISMA
// carpeta y luego un rename sobre el destino. El rename dentro del mismo
// sistema de ficheros es atómico, así que un corte de luz o un cierre brusco
// a mitad deja como mucho un .tmp huérfano — nunca el fichero de verdad a
// medio escribir.
//
// Existe porque tres sitios distintos escribían directo sobre su ruta
// canónica con un writeFile(Sync) a pelo, y sus lectores tomaban un fichero
// truncado por bueno: config.json (ajustes perdidos en silencio ->
// DEFAULT_CONFIG), credentials.json (que además, corrupto, reimportaba el
// .env y podía apuntar a la base de PRODUCCIÓN, el incidente del 3-ago-2026)
// y la caché de imágenes (un .webp a medias que se sirve roto para siempre).
// El temporal lleva un sufijo único para que dos escrituras del mismo fichero
// no compartan el mismo .tmp.
const tmpPath = (path: string): string => `${path}.${randomUUID()}.tmp`;

export const writeFileAtomicSync = (path: string, data: string | Buffer): void => {
  const tmp = tmpPath(path);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (error) {
    // Si algo falló, no dejar el temporal tirado. best-effort: si tampoco se
    // puede borrar, el error original manda.
    try {
      rmSync(tmp, { force: true });
    } catch {
      // El temporal ya no está o no se puede tocar: da igual.
    }
    throw error;
  }
};

export const writeFileAtomic = async (path: string, data: string | Buffer): Promise<void> => {
  const tmp = tmpPath(path);
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
};
