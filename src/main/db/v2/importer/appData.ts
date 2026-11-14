import { basename, dirname, join, resolve, sep } from 'node:path';

// Protección de los datos de la app instalada frente al importador.
//
// Revisión (sospecha sobre importer/index.ts): hasta ahora solo el script
// `scripts/import-1x-to-v2.ts` se negaba a leer la base EN USO de la app y a
// escribir dentro de su carpeta de datos; `importLegacyDatabase` aceptaba
// cualquier ruta. Quien la llamase desde otro sitio (la propia app) no tenía
// la protección. Ahora la tienen los dos, con las mismas reglas.
//
// EL CORTE (fase 10, §19.6). La app tendrá que escribir `Afterplay2.db` en su
// propia carpeta de datos. Para eso existe UNA excepción, explícita y estrecha
// (`CutoverTarget`): solo la acepta `importLegacyDatabase` cuando quien llama
// la pasa, y solo permite exactamente `<carpeta de datos>/Afterplay2.db`. El
// script de desarrollo no la pasa nunca.
//
// El ORIGEN no tiene excepción, tampoco en el corte: la app no importa desde
// su `Afterplay.db` en uso, sino desde una copia consistente que saca antes
// (`copySourceConsistently`, a su carpeta `backups/`), con la conexión 1.x ya
// cerrada. Así la base 1.x sigue intacta pase lo que pase (§19.1, "nada se
// destruye") y la importación lee una foto que nadie cambia por debajo.

/** Carpetas de datos de la app: `Afterplay` y los perfiles `Afterplay-dev-*`. */
const APP_FOLDER = /^afterplay(-dev-.*)?$/i;

/** Nombre de la base 2.0 dentro de la carpeta de datos (§7.9). */
export const LOCAL_DATABASE_FILE = 'Afterplay2.db';

/**
 * La única excepción a "no escribir en la carpeta de datos de la app": el
 * corte de la fase 10. `userDataDir` es la carpeta de datos de la app que
 * migra (`app.getPath('userData')`).
 */
export interface CutoverTarget {
  readonly userDataDir: string;
}

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

// Windows no distingue mayúsculas en las rutas.
const samePath = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Falla si el origen es una base en uso de la app o si el destino está dentro
 * de su carpeta de datos. Las bases en memoria (tests) no tienen ruta.
 *
 * Con `cutover`, el destino tiene que ser EXACTAMENTE la base 2.0 de esa
 * carpeta de datos, en disco, y nada más; el origen sigue sin poder ser una
 * base en uso.
 */
export function assertImportPathsAllowed(
  source: string | null,
  target: string | null,
  cutover?: CutoverTarget,
): void {
  if (source !== null && isLiveDatabase(source)) {
    throw new Error(
      'importLegacyDatabase: el origen es una base EN USO de la app; importa desde una copia de seguridad.',
    );
  }
  if (cutover !== undefined) {
    if (!APP_FOLDER.test(basename(resolve(cutover.userDataDir)))) {
      throw new Error(
        'importLegacyDatabase: el corte solo se hace en una carpeta de datos de la app.',
      );
    }
    const expected = join(cutover.userDataDir, LOCAL_DATABASE_FILE);
    if (target === null || !samePath(target, expected)) {
      throw new Error(
        `importLegacyDatabase: en el corte, la base 2.0 de destino tiene que ser ${LOCAL_DATABASE_FILE} ` +
          'de la carpeta de datos de la app, y ninguna otra.',
      );
    }
    return;
  }
  if (target !== null && isInsideAppData(target)) {
    throw new Error(
      'importLegacyDatabase: la base 2.0 de destino está dentro de la carpeta de datos de la app ' +
        'o de uno de sus perfiles; el importador no escribe ahí.',
    );
  }
}
