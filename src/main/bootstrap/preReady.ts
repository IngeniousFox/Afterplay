import { app } from 'electron';
import { registerImageProtocolScheme } from '../images/protocol';
import { applyDevProfile } from '../lib/devProfile';
import { applyE2EUserData } from '../lib/e2e';

// Lo que tiene que pasar ANTES de app.whenReady(), en este orden y como
// primera cosa del módulo de entrada.
export const configureBeforeReady = (): void => {
  // Overrides the userData folder name (would otherwise be "afterplay", lowercase,
  // taken from package.json's "name"). Must run before any app.getPath('userData')
  // call — including the one inside initAppDb() — so it's the very first thing
  // this module does, before app.whenReady() or anything async.
  app.setName('Afterplay');

  // Un perfil de desarrollo (AFTERPLAY_DEV_PROFILE, solo sin empaquetar) lleva
  // la carpeta de datos a otra parte: una copia de tus datos para trastear, sin
  // tocar la de la app instalada. Mismo sitio y mismo motivo que la línea de
  // abajo. Ver lib/devProfile.ts.
  applyDevProfile();

  // Y, si esto es un test de extremo a extremo, la carpeta de datos AISLADA —
  // aquí y no más abajo por lo mismo que setName: todo lo que cuelga de
  // userData (la base, las credenciales, las copias, la caché) se calcula a
  // partir de esta línea. Sin la variable de entorno no hace nada. Ver e2e.ts.
  applyE2EUserData();

  // El aviso de logros suena SIN que nadie haya pulsado nada en su ventana — y
  // no puede pulsarse, porque ignora el ratón a propósito (LOGROS.md §8). Sin
  // esto, la política de autoreproducción de Chromium deja su AudioContext
  // suspendido y el aviso sale mudo. Tiene que ir antes de whenReady().
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  // También tiene que ir antes de whenReady() — Electron lo exige para poder
  // registrar esquemas con privilegios (ver images/protocol.ts).
  registerImageProtocolScheme();
};
