// LAS REGLAS DE UN PERFIL DE DESARROLLO, sin nada de Electron dentro.
//
// Un perfil de desarrollo (ver devProfile.ts) arranca la app de verdad sobre
// una COPIA de los datos reales del dueño. La copia es para trastear; lo que
// no se puede trastear es lo que hay fuera de ella: la base remota de
// producción y el bucket de partidas de producción. Una copia local que
// sincroniza contra la base real deja de ser una copia.
//
// Así que aquí hay una LISTA BLANCA, la misma postura que el .env.test de los
// E2E (e2e/credentials.ts): en un perfil de desarrollo solo se habla con
// recursos remotos cuyo NOMBRE dice que son de desarrollo. Lo que no encaje
// se trata como "sin configurar" — la app sigue funcionando en local y lo
// canta en el log.
//
// Vive aparte de devProfile.ts porque la usan módulos puros (y sus tests) que
// no pueden importar electron.

// El nombre de la base (primer segmento del host de Turso, lo que devuelve
// remoteLabel) o del bucket tiene que EMPEZAR por uno de estos.
export const DEV_RESOURCE_PREFIXES = [
  'afterplay-dev',
  'afterplay-test',
  'afterplay-v2',
  // "afterplay2-test" y compañía: el bucket de pruebas de la 2.0 se llama así.
  'afterplay2-',
] as const;

export const isDevResourceName = (name: string | null | undefined): boolean => {
  const normalized = name?.trim().toLowerCase() ?? '';
  if (normalized === '') return false;
  return DEV_RESOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

// Nombre de perfil: lo que acaba en el nombre de una carpeta. Corto y sin
// nada que un sistema de ficheros pueda interpretar.
const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const isValidProfileName = (name: string): boolean => PROFILE_NAME.test(name);

export const profileFolderName = (name: string): string => `Afterplay-dev-${name}`;

// El estado: QUÉ perfil está activo en este proceso, o ninguno. Lo fija
// devProfile.ts una sola vez en el arranque; en una app empaquetada no lo
// fija nunca, así que ahí todo lo de abajo contesta "no".
let activeProfile: string | null = null;

export const activateDevProfile = (name: string): void => {
  if (activeProfile !== null && activeProfile !== name) {
    throw new Error(`Dev profile already active (${activeProfile}); cannot switch to ${name}.`);
  }
  activeProfile = name;
};

export const devProfileName = (): string | null => activeProfile;

export const isDevProfile = (): boolean => activeProfile !== null;

// Para la barra de tareas y la bandeja: con el perfil y la app instalada
// abiertos a la vez, hay que poder distinguirlos de un vistazo.
export const withDevProfileSuffix = (name: string): string =>
  activeProfile === null ? name : `${name} [dev: ${activeProfile}]`;

// Avisos de una sola vez por recurso: estas preguntas se hacen en cada ciclo
// de sync y en cada backup, y la misma línea repetida cada minuto es justo lo
// que hace que se deje de leer.
const warned = new Set<string>();

const warnOnce = (key: string, message: string): void => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
};

// ¿Este perfil tiene prohibido hablar con esta base remota? Fuera de un perfil
// de desarrollo nunca bloquea nada.
export const devProfileBlocksRemote = (remoteName: string): boolean => {
  if (!isDevProfile()) return false;
  if (isDevResourceName(remoteName)) return false;
  warnOnce(
    `remote:${remoteName}`,
    `[dev-profile] la base remota [${remoteName}] NO es de desarrollo (su nombre tiene que empezar por ${DEV_RESOURCE_PREFIXES.join(' / ')}) - este perfil se queda en local y no sincroniza con ella`,
  );
  return true;
};

// Lo mismo para el bucket de partidas guardadas: una instalación de
// desarrollo que escribe (y PODA) en el bucket real es un segundo PC
// fantasma borrando copias de verdad.
export const devProfileBlocksBucket = (bucket: string): boolean => {
  if (!isDevProfile()) return false;
  if (isDevResourceName(bucket)) return false;
  warnOnce(
    `bucket:${bucket}`,
    `[dev-profile] el bucket [${bucket}] NO es de desarrollo (su nombre tiene que empezar por ${DEV_RESOURCE_PREFIXES.join(' / ')}) - este perfil no hace copias en la nube`,
  );
  return true;
};

// Solo para tests.
export const resetDevProfileForTests = (): void => {
  activeProfile = null;
  warned.clear();
};
