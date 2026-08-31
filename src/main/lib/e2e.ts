import { app } from 'electron';

// EL MODO E2E: la app corriendo de verdad, pero sin poder tocar NADA tuyo.
//
// Los tests de extremo a extremo arrancan la app real (Playwright habla con
// el proceso main por su puerto de depuracion), y una app real hace cosas de
// app real: escribe su base, sus credenciales, sus copias, su caché de
// imágenes, y si tiene credenciales de Turso se conecta a la remota. Ninguna
// de esas cosas puede pasarle a la instalación del dueño mientras un test
// pulsa botones.
//
// UNA SOLA PALANCA, Y NO DOS: la variable de entorno que enciende este modo
// es la MISMA que trae la carpeta de datos aislada. No hay forma de encender
// el modo sin sandbox ni de dar sandbox sin encender el modo — con dos
// interruptores independientes, olvidarse de uno es cuestión de tiempo, y el
// olvido caro es justo ese. Si la variable no está, este fichero no cambia
// absolutamente nada: el camino permisivo no existe en producción porque
// depende de algo que allí nadie define (misma postura que el ENVIRONMENT de
// worker/src/env.ts).
//
// POR QUÉ HACE FALTA UN GATE Y NO BASTA CON LA CARPETA: una carpeta de datos
// virgen es exactamente el escenario del susto del 3-ago-2026. Al no
// encontrar credentials.json, initCredentials importa el .env DEL PROYECTO
// (lo hace cuando !app.isPackaged, que es como corren los tests), y ese .env
// contiene la base que el dueño tenga activa ese día — aquel día, la REAL, a
// la que se le empujó una migración. O sea que aislar la carpeta SIN cerrar
// esa puerta no solo no protege: abre la peor de todas.
//
// Lo que el modo apaga, todo en la dirección segura (no toca lo de fuera):
//   1. La importación del .env legado — nunca, bajo ningún .env.
//   2. El sync remoto, SALVO que el test lo pida a propósito (segunda
//      variable, AFTERPLAY_E2E_ALLOW_SYNC, que el andamio solo pone cuando el
//      sandbox lleva credenciales de Turso). Dos cerraduras para la única
//      puerta que escribe fuera del sandbox: hacen falta las credenciales Y
//      la bandera. Sin las dos, un test que teclee credenciales de Turso en
//      Ajustes tampoco se conecta a nada.
//   3. El "iniciar con Windows" — es lo único de la app que escribe en el
//      registro del sistema operativo, o sea fuera de la carpeta de datos.
//
// Lo que NO apaga, porque ya se apaga solo: sin credenciales no hay red
// (IGDB, SteamGridDB, Anthropic y los logros de Steam se quedan quietos) ni
// copias en la nube (R2 necesita sus cuatro claves). Una instalación virgen
// es local y muda por diseño, y eso es justo lo que un test quiere.
//
// El candado de instancia única sale gratis: Electron lo deriva de la carpeta
// de datos, así que una app de test y la tuya abierta a la vez no se pisan.
const USER_DATA_ENV = 'AFTERPLAY_E2E_USER_DATA';
const ALLOW_SYNC_ENV = 'AFTERPLAY_E2E_ALLOW_SYNC';

// Se lee UNA vez, al cargar el módulo: así el modo no puede cambiar a mitad
// de vida del proceso (ni siquiera si alguien escribe en process.env), y las
// tres puertas de abajo contestan siempre lo mismo.
const e2eUserData = process.env[USER_DATA_ENV]?.trim() ?? '';

export const isE2E = (): boolean => e2eUserData !== '';

// ¿Este test pidió hablar con una remota? Solo tiene sentido en modo E2E: en
// un arranque normal esta función no decide nada (ver su uso en db/index.ts).
const e2eAllowSync = (process.env[ALLOW_SYNC_ENV] ?? '').trim() === '1';

export const e2eBlocksSync = (): boolean => isE2E() && !e2eAllowSync;

// Llamar UNA vez en el arranque, INMEDIATAMENTE después de app.setName() y
// antes de que nadie pregunte por getPath('userData') — la misma exigencia
// que ya documenta setName en main/index.ts, por el mismo motivo: media
// docena de módulos calculan sus rutas a partir de ahí.
export const applyE2EUserData = (): void => {
  if (!isE2E()) return;
  app.setPath('userData', e2eUserData);
  // Se dice en voz alta y con la ruta: si algún día un arranque normal
  // apareciera con esta línea en el log, es que alguien dejó la variable
  // puesta en su terminal — y es mejor verlo que descubrirlo por una
  // biblioteca que sale vacía.
  console.log(`[e2e] modo test: carpeta de datos aislada en ${e2eUserData}`);
};
