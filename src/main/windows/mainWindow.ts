import { emit } from '../ipc/contractHandlers';
import { is } from '@electron-toolkit/utils';
import { BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { mark } from '../bootstrap/startupClock';
import icon from '../lib/appIcon';
import { registerContextMenu } from '../lib/contextMenu';
import { isDevProfile, withDevProfileSuffix } from '../lib/devProfileRules';
import { wasOpenedHiddenAtLogin } from '../lib/loginItem';
import { getSavedWindowOptions, trackWindowState } from '../lib/windowState';
import { isAppQuitting } from '../lifecycle/quit';
import {
  isBigPictureMode,
  sendBigPictureState,
  setBigPictureMode,
  toggleBigPicture,
} from './bigPicture';

// La ventana principal a nivel de módulo para que el watcher pueda avisarle
// (webContents.send) sin acoplarse a createWindow. Null mientras no exista.
let mainWindow: BrowserWindow | null = null;
// Pantalla de arranque (ver splash/splash.ts) — vive a nivel de módulo para
// que createWindow() (llamada tanto en el arranque como luego desde
// 'activate'/el tray) pueda cerrarla la primera vez que la ventana real
// esté lista, sin necesidad de pasársela como parámetro.
let splashWindow: BrowserWindow | null = null;
// Arranque a bandeja con estado guardado "maximizada": la ventana queda
// oculta SIN maximizar (maximize() sobre una ventana oculta la muestra, ver
// revealWhenReady) — esta marca lo deja pendiente para la primera apertura
// desde el tray.
let pendingMaximize = false;
// La puerta de las peticiones de segunda instancia: "¿se ha enseñado ya la
// ventana?". Ver lifecycle/singleInstance.ts para el porqué completo.
let windowRevealed = false;
let pendingWindowRequest: 'show' | 'bigpicture' | null = null;

// El segundo de los TRES relojes que deciden cuándo se enseña la ventana (el
// primero es 'ready-to-show'): la base de datos, lista al terminar
// initAppDb. Ver revealWhenReady en createWindow.
let dbReady = false;
let revealPendingWindow: (() => void) | null = null;

export const getMainWindow = (): BrowserWindow | null => mainWindow;
export const getSplashWindow = (): BrowserWindow | null => splashWindow;
export const setSplashWindow = (window: BrowserWindow | null): void => {
  splashWindow = window;
};

// El final del arranque llama por aquí cuando la base ya está abierta.
export const markDbReady = (): void => {
  dbReady = true;
  revealPendingWindow?.();
};

// Aparca (o no) una petición de segunda instancia. Devuelve true si la dejó
// aparcada porque la ventana todavía no se ha enseñado.
export const parkSecondInstanceRequest = (wantsBigPicture: boolean): boolean => {
  if (windowRevealed) return false;
  // El modo TV gana sobre un "tráela delante" posterior: si Moonlight
  // pidió pantalla, el doble clic impaciente de después no debe degradar
  // la petición a ventana normal.
  if (wantsBigPicture) pendingWindowRequest = 'bigpicture';
  else if (pendingWindowRequest === null) pendingWindowRequest = 'show';
  console.log(
    '[startup] peticion de segunda instancia aparcada hasta que la ventana este a la vista',
  );
  return true;
};

// 'window:startup-content-ready' (ver ipc/startup.ts): el renderer avisa de que
// ya tiene contenido pintable.
export const onStartupContentReady = (): void => {
  if (startupContentPainted) return;
  startupContentPainted = true;
  if (contentGateDeadline) {
    clearTimeout(contentGateDeadline);
    contentGateDeadline = null;
  }
  mark('contenido pintable (datos + caratulas decodificadas)');
  revealPendingWindow?.();
};

// Y EL TERCER RELOJ: contenido de verdad pintable. Nació de una regresión de
// percepción real — al crear la ventana antes de esperar a la base (la
// optimización del arranque), 'ready-to-show' pasó a disparar con el primer
// frame del CASCARÓN: el splash se cerraba y los segundos de biblioteca
// poblándose (query + decodificar carátulas) ocurrían delante del usuario en
// vez de detrás del splash. El renderer avisa por
// 'window:startup-content-ready' cuando la lista de juegos resolvió y las
// primeras carátulas están decodificadas (ver useStartupContentSignal).
//
// Con RED DE SEGURIDAD, porque este reloj depende de que el renderer llegue a
// avisar: si la query falla o el aviso se pierde, un temporizador lo da por
// cumplido a los CONTENT_GATE_MAX_MS de que los otros dos relojes estén — el
// peor caso es exactamente el comportamiento de antes, nunca un splash
// eterno. Una vez cumplido se queda cumplido: las ventanas recreadas después
// (activate, tray) no pagan la puerta, que es solo del primer arranque.
let startupContentPainted = false;
let contentGateDeadline: ReturnType<typeof setTimeout> | null = null;
// 12s y no menos: en PRODUCCION la cadena entera (chunk de la app + query +
// decodificar caratulas) es sub-segundo y esta red no llega a correr nunca.
// En DESARROLLO, con Vite transformando cientos de modulos en frio, la
// cadena puede pasar de 8s — con la red a 4s disparaba ANTES de que hubiera
// contenido y ensenaba la ventana negra, que es justo lo que la puerta
// existe para impedir. El precio de 12s solo se paga si el renderer esta
// ROTO de verdad (y entonces 12s de splash es el menor de los problemas).
const CONTENT_GATE_MAX_MS = 12_000;

export function createWindow(): void {
  // La ventana principal es ÚNICA: con una viva delante esto no crea otra.
  // Reasignar mainWindow dejaba la anterior huérfana pero visible, con todos
  // los estropicios que cuenta el comentario del candado de instancia única.
  // Los otros dos caminos que llaman aquí ya preguntan antes ('activate' solo
  // si no queda ninguna ventana, showMainWindow solo si mainWindow es null),
  // pero el invariante se defiende en el sitio donde se rompe.
  if (mainWindow && !mainWindow.isDestroyed()) return;

  // Mismo tamaño/posición que tenía al cerrarla la última vez (o el de
  // siempre si es la primera vez, o si el monitor de entonces ya no está
  // conectado) — ver lib/windowState.ts.
  const { x, y, width, height, isMaximized } = getSavedWindowOptions();

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: false,
    // Arranque en frío con --bigpicture (o ventana recreada con el modo ya
    // activo): nace directamente a pantalla completa, sin parpadeo de
    // ventana normal por medio.
    fullscreen: isBigPictureMode(),
    title: withDevProfileSuffix('Afterplay'),
    icon,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  const window = mainWindow;
  trackWindowState(window);

  // En un perfil de desarrollo el título de la ventana lleva el nombre del
  // perfil, y hay que impedir que el <title> de la página lo pise: con el
  // perfil y la app instalada abiertos a la vez, es lo único que las distingue
  // en la barra de tareas y en Alt+Tab.
  if (isDevProfile()) window.on('page-title-updated', (event) => event.preventDefault());

  // DOS RELOJES: el renderer (~155 ms medidos desde que se crea la ventana
  // hasta su primer frame) y la base de datos. La ventana se crea antes de
  // abrir la base y el renderer carga en su propio proceso mientras tanto:
  // enseña el que llegue SEGUNDO.
  //
  // Enseñarla en cuanto el renderer esté, sin esperar a la base, se descartó a
  // propósito: la app aparecería con todo vacío mientras las consultas esperan
  // en la cola de IPC, que es exactamente el hueco que el splash existe para
  // tapar (ver splash/splash.ts).
  let rendererReady = false;
  let revealed = false;
  const revealWhenReady = (): void => {
    if (!rendererReady || !dbReady || revealed) return;

    // El tercer reloj (ver startupContentPainted arriba): con los otros dos
    // cumplidos, se espera a que el renderer tenga contenido de verdad — y se
    // ARMA aquí la red de seguridad, no antes: contarla desde que hay
    // renderer Y base es lo que garantiza que nunca añade más de
    // CONTENT_GATE_MAX_MS al peor caso, esté la base dormida lo que esté.
    if (!startupContentPainted) {
      if (!contentGateDeadline) {
        contentGateDeadline = setTimeout(() => {
          contentGateDeadline = null;
          startupContentPainted = true;
          mark('contenido pintable NO llego: se enseña igual (red de seguridad)');
          revealWhenReady();
        }, CONTENT_GATE_MAX_MS);
      }
      return;
    }
    revealed = true;
    // Y la misma marca fuera de este cierre, que es la puerta de las peticiones
    // de segunda instancia (ver windowRevealed): se pone ANTES de consumir
    // pendingWindowRequest y entre las dos no hay await, así que no queda ni un
    // hueco en el que una petición nueva se aparque sin que nadie la recoja.
    windowRevealed = true;

    // La petición de una segunda instancia aparcada durante el arranque (ver
    // pendingWindowRequest) se resuelve AQUÍ, que es el único momento en que
    // se sabe cuál fue la última: antes se resolvía justo antes de crear la
    // ventana, y ahora la ventana ya existe desde hace medio segundo.
    // setFullScreen sobre una ventana OCULTA no la muestra (comprobado; a
    // diferencia de maximize(), ver más abajo), así que el modo TV sigue
    // apareciendo ya a pantalla completa, sin parpadeo de ventana normal.
    //
    // El AVISO al renderer no es opcional, y su falta era la mitad del modo TV
    // que se perdía: aquí abajo el renderer YA está montado (el tercer reloj
    // exige que haya pintado contenido, o sea que su bigpicture:get ya resolvió
    // `false`) y solo cambia de árbol con 'bigpicture:changed'. Sin esta línea
    // Moonlight dejaba la ventana a pantalla completa con la interfaz de
    // ESCRITORIO dentro: sin menú TV ni navegación por mando, y sin arreglo
    // salvo pulsar F11 dos veces. 'enter-full-screen' no cubre el hueco: manda
    // 'window:fullscreen-change', que es otro canal y useBigPicture no escucha.
    if (pendingWindowRequest === 'bigpicture') {
      setBigPictureMode(true);
      if (!window.isFullScreen()) window.setFullScreen(true);
      sendBigPictureState();
    }

    // Si Windows/macOS arrancó la app sola por el login item, no se enseña la
    // ventana — arranca directa a la bandeja (SPEC 3E). Ver lib/loginItem.ts
    // para el porqué esto no es tan simple como parece en Windows.
    // `--bigpicture` GANA sobre el arranque oculto (BIG-PICTURE.md §2): si
    // pediste el modo TV, lo que quieres es pantalla, no bandeja. Y una
    // petición de segunda instancia aparcada durante el arranque gana igual:
    // alguien acaba de pedir la ventana a mano, esconderla en la bandeja es lo
    // contrario de lo que ha pedido.
    const wasOpenedAtLogin =
      wasOpenedHiddenAtLogin() && !isBigPictureMode() && pendingWindowRequest === null;
    pendingWindowRequest = null;

    // El splash se cierra aquí y no antes: este es el primer momento en que la
    // ventana real tiene algo pintado Y una base que responder. En llamadas
    // posteriores a createWindow() (activate del dock, tray) splashWindow ya
    // está a null — cerrar null no hace nada.
    splashWindow?.close();
    splashWindow = null;
    // maximize() AQUÍ y no nada más crear la ventana: en Windows, maximizar
    // una ventana oculta (show: false) la MUESTRA — con el estado guardado
    // en maximizado, aparecía una ventana blanca a pantalla completa (sin
    // contenido cargado aún) conviviendo con el splash. En el arranque a
    // bandeja (wasOpenedAtLogin) ni se maximiza: la ventana sigue oculta y
    // queda pendingMaximize para cuando se abra desde el tray.
    if (!wasOpenedAtLogin) {
      if (isMaximized) window.maximize();
      window.show();
    } else {
      pendingMaximize = isMaximized;
    }
    mark('VENTANA A LA VISTA');
  };

  // El final del arranque (whenReady) llama por aquí cuando la base ya está:
  // se guarda una referencia porque el otro reloj —ready-to-show— vive dentro
  // de esta función y no hay forma de alcanzarlo desde fuera.
  revealPendingWindow = revealWhenReady;

  window.on('ready-to-show', () => {
    mark('renderer con su primer frame (ready-to-show)');
    rendererReady = true;
    revealWhenReady();
  });

  window.on('maximize', () => {
    emit(window.webContents, 'window:maximized-change', true);
  });

  window.on('unmaximize', () => {
    emit(window.webContents, 'window:maximized-change', false);
  });

  // F11 (o el menú por defecto de Electron, que ya lo trae aunque no se
  // registre nada aquí) pone la ventana en fullscreen de VERDAD a nivel de
  // SO — pero nuestra TitleBar sigue siendo contenido normal de la página, no
  // chrome del sistema, así que sin este aviso se quedaba flotando encima de
  // un fullscreen que se suponía sin nada alrededor.
  window.on('enter-full-screen', () => {
    emit(window.webContents, 'window:fullscreen-change', true);
  });

  window.on('leave-full-screen', () => {
    emit(window.webContents, 'window:fullscreen-change', false);
  });

  // El modo ambiente no debe encenderse si no hay nadie delante de la
  // pantalla para verlo: minimizada o mandada a la bandeja, la app sigue viva
  // vigilando procesos (por eso sigue existiendo sin ventana), pero el
  // renderer no tenía forma de saberlo — su temporizador de inactividad solo
  // mira eventos de ratón/teclado, y sin ventana visible esos eventos
  // simplemente no llegan nunca, así que contaba como "inactivo" igual. Se
  // avisa en los cuatro eventos que pueden cambiar la visibilidad real: el
  // botón _ minimiza, "Open" del tray restaura, y close/el propio tray
  // ocultan/muestran sin pasar por minimizar.
  //
  // Cada evento manda el valor que ÉL MISMO significa, sin releer
  // isMinimized()/isVisible() dentro del manejador: en Windows el evento
  // 'minimize' puede dispararse ANTES de que el estado interno cambie, así
  // que preguntarle a la ventana en ese instante respondía "no está
  // minimizada" y el renderer se quedaba creyendo la ventana visible — con
  // el modo ambiente encendiéndose de fondo con la app minimizada. Del eje
  // que NO cambia en el evento sí se puede preguntar: ese no está en vuelo.
  const sendVisibility = (visible: boolean): void => {
    emit(window.webContents, 'window:visible-change', visible);
  };
  window.on('minimize', () => sendVisibility(false));
  window.on('hide', () => sendVisibility(false));
  // 'restore' des-minimiza: visible salvo que además estuviera oculta.
  window.on('restore', () => sendVisibility(window.isVisible()));
  // 'show' des-oculta: visible salvo que además estuviera minimizada.
  window.on('show', () => sendVisibility(!window.isMinimized()));

  // SPEC 3E — la X minimiza a la bandeja, no cierra la app (que sigue viva
  // vigilando procesos). isQuitting se marca en before-quit (cualquier vía de
  // cierre real: menú "Quit" del tray, apagado del sistema...) para dejar
  // pasar el cierre de verdad en ese caso, o esto bloquearía la app para
  // siempre.
  window.on('close', (event) => {
    if (!isAppQuitting()) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  // F11 = entrar/salir de Big Picture (BIG-PICTURE.md §2). El accelerator de
  // fullscreen que regalaba el menú por defecto ya no existe (el menú se
  // anula en whenReady), así que la tecla se captura aquí — y NO con
  // globalShortcut: F11 solo debe actuar con Afterplay enfocada, no
  // robarle la tecla al resto del sistema.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      toggleBigPicture();
    }
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  registerContextMenu(window);

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Traer la app delante, venga de donde venga la petición: el "Open" del
// tray, el clic en una notificación, o una segunda instancia (doble clic /
// Moonlight). Antes esta lógica estaba duplicada en cada sitio, con el
// pendingMaximize resuelto tres veces (BIG-PICTURE.md §1.1).
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (pendingMaximize) {
    pendingMaximize = false;
    mainWindow.maximize();
  } else {
    mainWindow.show();
  }
  mainWindow.focus();
}
