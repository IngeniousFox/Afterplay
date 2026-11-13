import { app } from 'electron';
import { join } from 'path';
import { isE2E } from './e2e';
import { activateDevProfile, isValidProfileName, profileFolderName } from './devProfileRules';

// EL PERFIL DE DESARROLLO: la app corriendo de verdad sobre una COPIA de tus
// datos, en una carpeta que no es la de la app instalada.
//
// Existe por la 2.0 (docs/AFTERPLAY-2.0.md §19.2). Hasta ahora `npm run dev`
// abría la carpeta de datos de la app instalada: la misma base, las mismas
// credenciales, la misma identidad de máquina. Para un cambio pequeño vale;
// para reescribir el esquema y el sync, no — y dos procesos sobre el mismo
// fichero de base ya la corrompieron una vez (db/index.ts).
//
// Hermano del modo E2E (e2e.ts), con una diferencia de fondo: aquel quiere una
// app muda y vacía, y este quiere una app VIVA con datos reales — con sus
// pasadas de fondo, sus integraciones y su watcher. Por eso no reutiliza
// aquella palanca. Lo que sí comparte es la postura:
//
//   1. La carpeta de datos es otra (%APPDATA%/Afterplay-dev-<nombre>). El
//      candado de instancia única va con la carpeta, así que este perfil y la
//      app instalada pueden estar abiertos a la vez.
//   2. JAMÁS se importa el .env del proyecto (el susto del 3-ago-2026: ver
//      credentials.ts). Las claves de un perfil son las que tenga su propia
//      carpeta, y nada más.
//   3. Solo se habla con recursos remotos de desarrollo — base de Turso y
//      bucket de partidas cuyo nombre lo diga (devProfileRules.ts). Pegar por
//      error las credenciales de producción en los Ajustes de un perfil no
//      conecta con nada.
//   4. No se toca "iniciar con Windows" (ipc/settings.ts).
//
// UNA SOLA PALANCA: la variable de entorno. Sin ella este fichero no cambia
// nada, y en una app empaquetada se ignora aunque esté puesta — el camino no
// existe en producción.
const PROFILE_ENV = 'AFTERPLAY_DEV_PROFILE';

// Llamar UNA vez, INMEDIATAMENTE después de app.setName() y antes de que
// nadie pregunte por getPath('userData') — misma exigencia que applyE2EUserData.
export const applyDevProfile = (): void => {
  const requested = process.env[PROFILE_ENV]?.trim() ?? '';
  if (requested === '') return;

  if (app.isPackaged) {
    console.warn(`[dev-profile] ${PROFILE_ENV} ignorada: esta es una app empaquetada`);
    return;
  }
  // Un test E2E trae su propia carpeta y sus propias reglas, más estrictas.
  if (isE2E()) return;

  // Un nombre raro no se "arregla": se para aquí. Seguir significaría arrancar
  // sobre la carpeta de datos REAL creyendo estar en un perfil.
  if (!isValidProfileName(requested)) {
    throw new Error(
      `${PROFILE_ENV}="${requested}" is not a valid profile name (lowercase letters, digits and dashes).`,
    );
  }

  const userData = join(app.getPath('appData'), profileFolderName(requested));
  app.setPath('userData', userData);
  activateDevProfile(requested);
  console.log(`[dev-profile] perfil "${requested}": carpeta de datos aislada en ${userData}`);
};
