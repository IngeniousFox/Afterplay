import { basename, dirname, resolve, sep } from 'node:path';

// Protección de los datos de la app instalada frente al importador.
//
// Revisión (sospecha sobre importer/index.ts): hasta ahora solo el script
// `scripts/import-1x-to-v2.ts` se negaba a leer la base EN USO de la app y a
// escribir dentro de su carpeta de datos; `importLegacyDatabase` aceptaba
// cualquier ruta. Quien la llamase desde otro sitio (la propia app) no tenía
// la protección. Ahora la tienen los dos, con las mismas reglas.
//
// OJO para la fase 10 (corte de la app): entonces la app SÍ tendrá que leer
// su `Afterplay.db` y escribir `Afterplay2.db` en su carpeta de datos. Esa
// excepción hay que decidirla y hacerla explícita allí; hasta entonces, ningún
// camino del importador puede tocar los datos de la app.

/** Carpetas de datos de la app: `Afterplay` y los perfiles `Afterplay-dev-*`. */
const APP_FOLDER = /^afterplay(-dev-.*)?$/i;

/** ¿Está la ruta dentro de la carpeta de datos de la app o de un perfil suyo? */
export const isInsideAppData = (path: string): boolean =>
  resolve(path)
    .split(sep)
    .some((part) => APP_FOLDER.test(part));

/** ¿Es la base EN USO de la app (`Afterplay.db`/`Afterplay2.db` en su carpeta de datos)? */
export const isLiveDatabase = (path: string): boolean =>
  /^afterplay2?\.db$/i.test(basename(path)) && APP_FOLDER.test(basename(dirname(resolve(path))));

/** Ruta de una base en disco, o null si es en memoria (`location()` de node:sqlite). */
export const fileOf = (location: string | null | undefined): string | null =>
  location && location !== ':memory:' ? location : null;

/**
 * Falla si el origen es una base en uso de la app o si el destino está dentro
 * de su carpeta de datos. Las bases en memoria (tests) no tienen ruta.
 */
export function assertImportPathsAllowed(source: string | null, target: string | null): void {
  if (source !== null && isLiveDatabase(source)) {
    throw new Error(
      'importLegacyDatabase: el origen es una base EN USO de la app; importa desde una copia de seguridad.',
    );
  }
  if (target !== null && isInsideAppData(target)) {
    throw new Error(
      'importLegacyDatabase: la base 2.0 de destino está dentro de la carpeta de datos de la app ' +
        'o de uno de sus perfiles; el importador no escribe ahí.',
    );
  }
}
