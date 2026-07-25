import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Dónde vive el ejecutable de ludusavi y si se puede contar con él
// (PARTIDAS-GUARDADAS.md §5): viaja DENTRO del paquete y se ejecuta desde
// resources/, sin copiarse jamás a userData. Esa decisión es la que hace que
// actualizar Afterplay sea actualizar ludusavi, y vuelve imposible por
// construcción el bug de Hydra (copiar el binario una vez y quedarse con el
// viejo para siempre).
//
// En desarrollo se coge de ./ludusavi del proyecto, que es donde lo deja
// scripts/fetch-ludusavi.ts. Mismo salto relativo que usa db/index.ts para
// llegar a ./drizzle: out/main -> out -> raíz.

const getLudusaviDir = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'ludusavi')
    : join(__dirname, '..', '..', 'ludusavi');

export const getLudusaviPath = (): string => join(getLudusaviDir(), 'ludusavi.exe');

// Se queda fijo con la versión del lock. Si algún día no cuadra, la única
// consecuencia es que la pantalla de licencias enseña un fichero menos —
// nunca que la función de partidas deje de ir.
const LUDUSAVI_LEGAL_VERSION = '0.31.0';

// Los textos de licencia que hay que poder enseñar por redistribuir el
// binario (§6.4). Pueden faltar en una instalación de desarrollo sin
// `npm run ludusavi:fetch`, así que se devuelve solo lo que exista.
export const getLudusaviLegalFiles = (): { name: string; path: string }[] => {
  const legalDir = join(getLudusaviDir(), 'legal');
  return ['ludusavi-LICENSE.txt', `ludusavi-v${LUDUSAVI_LEGAL_VERSION}-legal.txt`]
    .map((name) => ({ name, path: join(legalDir, name) }))
    .filter((file) => existsSync(file.path));
};

// El binario puede FALTAR aunque la app esté bien instalada: no está firmado
// (§11.2) y un antivirus puede haberlo puesto en cuarentena por heurística.
// Cuando eso pase, la función de partidas se apaga con un motivo claro y
// Afterplay sigue funcionando con normalidad — nunca un app.quit(), que es
// justo lo que hace Hydra con su sidecar.
export const isLudusaviAvailable = (): boolean => existsSync(getLudusaviPath());
