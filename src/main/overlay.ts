import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'path';
import type { OverlayShortcutStatus } from '../shared/types';
import { getConfigValue } from './config/store';
import { startGuideWatcher, stopGuideWatcher } from './gamepad';

// Overlay in-game (OVERLAY.md) — la capa que se abre SOBRE el juego con la
// sesión en vivo, sus logros y la nota rápida.
//
// Decisión del 2026-08-07, encima del documento: abre DIRECTO en modo
// interactivo a pantalla completa, estilo Steam. El "HUD pasivo" de esquina
// del MVP (§7.1) se probó y se descartó por pequeño. Tomar el foco al abrir
// es el trato que §5.2/§6.3.2 documentan para el interactivo: equivale a un
// Alt-Tab, y elegir el momento es del jugador (§6.3.3) — nunca se abre solo.
//
// Lo que NO cambia de las reglas del documento: NUNCA inyección (§2.3);
// solo existe mientras hace falta (§5.1) y muere con la sesión (§5.7); en
// reposo vuelve a focusable:false + click-through; y el atajo global solo se
// registra con un juego vivo (§6.1).
//
// ── LA COREOGRAFÍA DE APERTURA, y por qué es así ────────────────────────
// Costó una tarde de síntomas raros ("no abre hasta la tercera pulsación",
// "sale en negro y se quita", "abre desplazada y luego se coloca"). Tres de
// las cuatro causas estaban aquí o en el renderer, y ninguna era la ventana
// en sí:
//
//  1. EL AVISO PERDIDO. La ventana se creaba en la primera invocación y el
//     estado se enviaba justo tras loadURL — pero cargar la SPA no es tener
//     React montado, así que el 'overlay:state' llegaba ANTES de que nadie
//     escuchara y se perdía: ventana enseñada, componente en fase 'hidden',
//     nada pintado. Cada pulsación siguiente solo alternaba el booleano
//     hasta que por casualidad un `true` caía con el listener ya puesto.
//     Arreglo: el renderer AVISA de que está listo ('overlay:ready') y
//     además puede PREGUNTAR el estado al montar ('overlay:getState') — el
//     patrón get()+onChange que ya usa Big Picture en toda la casa.
//  2. LA VENTANA FRÍA. Crearla en la primera invocación metía la carga
//     entera de la SPA dentro del tiempo de respuesta del atajo. Ahora se
//     PRECALIENTA en cuanto arranca una sesión de juego: para cuando pulsas,
//     lleva rato lista.
//  3. EL PRIMER FRAME. show() antes de que el renderer tuviera algo
//     compuesto presentaba una superficie vacía. Ahora se espera al ACK de
//     'ready' y se manda el estado ANTES del show, con la ventana aún
//     oculta: lo que aparece ya es la composición terminada.
//
// (La cuarta causa vivía en el CSS global de la app — el hueco de 2rem que
// #root reserva para la TitleBar y el fondo opaco del body, heredados por
// esta ventana. Se neutraliza en renderer/main.tsx, ver allí.)

let overlayWindow: BrowserWindow | null = null;
let overlayVisible = false;
// La creación EN VUELO, para que dos invocaciones seguidas esperen a LA
// MISMA ventana en vez de crear dos.
let windowInFlight: Promise<BrowserWindow> | null = null;
// Se resuelve cuando el renderer del overlay dice 'overlay:ready'. Es la
// puerta que garantiza que nadie enseña una ventana sin contenido.
let rendererReady: Promise<void> | null = null;
let markRendererReady: (() => void) | null = null;

let registeredShortcut: string | null = null;
let shortcutConflict = false;
let gameLive = false;
let warnedConflictFor: string | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
// Un pelín por encima de los 200ms de la animación de salida del renderer.
const HIDE_ANIMATION_MS = 230;
// Cuándo se enseñó por última vez: el cierre por blur respeta una gracia
// para que un juego que re-reclama el foco al abrir no la mate en el acto.
let lastShownAt = 0;
const BLUR_GRACE_MS = 450;

// La ventana se pasa UN PÍXEL de cada borde del monitor, a propósito: una
// ventana borderless que mide EXACTAMENTE la pantalla es la firma con la que
// Windows/DWM detecta "juego en borderless fullscreen" y le aplica su
// transición de promoción al enseñarse con foco. El sobrante cuelga FUERA
// del monitor: cobertura visual intacta.
const overhangBounds = (display: Electron.Display): Electron.Rectangle => ({
  x: display.bounds.x - 1,
  y: display.bounds.y - 1,
  width: display.bounds.width + 2,
  height: display.bounds.height + 2,
});

const sendState = (): void => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:state', overlayVisible);
  }
};

// El renderer, al montar, dice que está listo y puede preguntar en qué
// estado debería estar — así una ventana que se monta tarde no se pierde el
// aviso que ya pasó (patrón get()+onChange de la casa).
ipcMain.on('overlay:ready', () => markRendererReady?.());
ipcMain.handle('overlay:getState', () => overlayVisible);
ipcMain.on('overlay:dismiss', () => hideOverlay());

const createOverlayWindow = async (): Promise<BrowserWindow> => {
  // Nace ya con los bounds definitivos (§5.5) — nunca maximize(), la ruina
  // conocida de las transparentes en Windows, y nunca un tamaño de cortesía
  // que obligue a un resize visible en el primer show.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const birth = overhangBounds(display);
  rendererReady = new Promise((resolve) => {
    markRendererReady = () => resolve();
  });

  const created = new BrowserWindow({
    x: birth.x,
    y: birth.y,
    width: birth.width,
    height: birth.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    fullscreenable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Sin las esquinas redondeadas de Windows 11: en una ventana que cubre
    // el monitor dejaban cuatro muescas por las que asomaba el juego.
    roundedCorners: false,
    webPreferences: {
      // El MISMO preload que la principal: el HUD necesita window.api.
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Sin estrangular en segundo plano (mismo flag que el overlay de
      // logros): una ventana estrangulada no pinta mientras está oculta, y
      // su show() presentaba una superficie vacía. En reposo su árbol
      // devuelve null — no hay ticks ni contenido, solo un compositor vivo.
      backgroundThrottling: false,
    },
  });

  // Estado de REPOSO: click-through y sin foco (§5.3). showOverlay abre el
  // modo interactivo y hideOverlay devuelve aquí.
  created.setIgnoreMouseEvents(true, { forward: true });
  created.setAlwaysOnTop(true, 'screen-saver', 1);
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Estilo Steam: al perder el foco la capa se cierra sola — abierta y sin
  // foco sería un velo huérfano sobre el juego. La gracia evita que un juego
  // que re-reclama el foco al abrir la mate en el mismo frame.
  created.on('blur', () => {
    if (overlayVisible && Date.now() - lastShownAt > BLUR_GRACE_MS) hideOverlay();
  });

  created.webContents.on('render-process-gone', () => {
    console.warn('[overlay] renderer caído: destruyo y recreo a la próxima invocación');
    created.destroy();
  });
  created.on('closed', () => {
    overlayWindow = null;
    overlayVisible = false;
    rendererReady = null;
    markRendererReady = null;
  });

  // Misma SPA, ruta propia, chunk lazy (§8.1).
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await created.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/overlay`);
  } else {
    await created.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' });
  }

  overlayWindow = created;
  return created;
};

const ensureWindow = (): Promise<BrowserWindow> => {
  if (overlayWindow && !overlayWindow.isDestroyed()) return Promise.resolve(overlayWindow);
  if (windowInFlight) return windowInFlight;
  windowInFlight = createOverlayWindow().finally(() => {
    windowInFlight = null;
  });
  return windowInFlight;
};

// Con un límite por si el 'ready' no llegara nunca (un fallo del bundle):
// mejor enseñar algo tarde que dejar el atajo muerto para siempre.
const waitForRenderer = async (): Promise<void> => {
  if (!rendererReady) return;
  await Promise.race([rendererReady, new Promise((resolve) => setTimeout(resolve, 3000))]);
};

const showOverlay = async (): Promise<void> => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const window = await ensureWindow();
  await waitForRenderer();
  if (window.isDestroyed()) return;

  // El monitor donde está el cursor (§5.5) ENTERO. Solo se tocan los bounds
  // si de verdad cambió el monitor: redimensionar una transparente provoca
  // un relayout visible. Siempre ANTES del show (§5.6).
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const current = window.getBounds();
  const target = overhangBounds(display);
  if (
    current.x !== target.x ||
    current.y !== target.y ||
    current.width !== target.width ||
    current.height !== target.height
  ) {
    window.setBounds(target);
  }

  window.setFocusable(true);
  window.setIgnoreMouseEvents(false);
  overlayVisible = true;

  // PINTAR PRIMERO, ENSEÑAR DESPUÉS: el estado viaja con la ventana aún
  // oculta (backgroundThrottling:false la mantiene pintando) y el show()
  // presenta la composición ya terminada.
  sendState();
  await new Promise((resolve) => setTimeout(resolve, 32));
  if (!overlayVisible || window.isDestroyed()) return;
  lastShownAt = Date.now();
  window.show();
  window.focus();
};

function hideOverlay(): void {
  if (!overlayVisible) return;
  overlayVisible = false;
  // El aviso primero: el renderer toca su salida animada mientras la
  // ventana sigue en pantalla.
  sendState();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // El CONTROL vuelve al juego YA — solo lo visual espera a la animación.
    // (setFocusable(false) dispara blur; su handler ya está guardado por
    // overlayVisible, que acaba de ponerse a false.)
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setFocusable(false);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    }, HIDE_ANIMATION_MS);
  }
}

const toggleOverlay = (): void => {
  if (overlayVisible) hideOverlay();
  else void showOverlay().catch((error) => console.warn('[overlay] no se pudo mostrar:', error));
};

const syncShortcut = (): void => {
  const wanted =
    gameLive && getConfigValue('overlayEnabled') ? getConfigValue('overlayShortcut') : null;

  if (registeredShortcut && registeredShortcut !== wanted) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
    shortcutConflict = false;
  }
  if (!wanted || registeredShortcut === wanted) return;

  let ok = false;
  try {
    ok = globalShortcut.register(wanted, toggleOverlay);
  } catch (error) {
    console.warn(`[overlay] accelerator inválido "${wanted}":`, error);
  }
  if (ok) {
    registeredShortcut = wanted;
    shortcutConflict = false;
    warnedConflictFor = null;
  } else {
    // Otro programa lo tiene: aviso una vez + estado visible en Ajustes —
    // nunca fallar en silencio (§6.1).
    shortcutConflict = true;
    if (warnedConflictFor !== wanted) {
      warnedConflictFor = wanted;
      console.warn(`[overlay] el atajo "${wanted}" ya lo usa otro programa: overlay sin atajo`);
    }
  }
};

// Guía abre/cierra (el juego no ve ese botón, §6.1-bis); B cierra SOLO con
// el overlay a la vista — cerrado, ese botón es del juego y de nadie más.
const handleControllerButton = (button: 'guide' | 'b'): void => {
  if (button === 'guide') {
    toggleOverlay();
    return;
  }
  if (overlayVisible) hideOverlay();
};

const syncGamepad = (): void => {
  if (gameLive && getConfigValue('overlayEnabled')) {
    void startGuideWatcher(handleControllerButton);
  } else {
    stopGuideWatcher();
  }
};

// Enciende o apaga toda la maquinaria del overlay (atajo + mando + ventana
// precalentada) según haya o no juego en marcha.
const setGameLive = (live: boolean): void => {
  if (live === gameLive) return;
  gameLive = live;
  syncShortcut();
  syncGamepad();
  if (live) {
    // PRECALENTADO: la ventana se crea al empezar a jugar, no en la primera
    // pulsación — así el atajo nunca paga la carga de la SPA (ver la
    // coreografía de arriba). Fire-and-forget: un fallo aquí solo significa
    // que la primera invocación la creará como antes.
    if (getConfigValue('overlayEnabled')) {
      void ensureWindow().catch((error) =>
        console.warn('[overlay] no pude precalentar la ventana:', error),
      );
    }
  } else {
    destroyOverlay(false);
  }
};

// El enganche del watcher (index.ts, sobre onActiveGamesChange — dispara en
// arranque, cierre Y adopción de sesiones). Es la vía para los juegos
// lanzados POR FUERA de la app, y llega con hasta 5s de retraso: es lo que
// tarda el siguiente ciclo de sondeo en ver el proceso.
export const handleOverlayActiveGames = (activeCount: number): void => {
  setGameLive(activeCount > 0);
};

// La vía INMEDIATA: el botón Play abre la sesión en la DB al instante, pero
// el watcher no se entera hasta su siguiente sondeo — y hasta entonces el
// atajo ni existía. Eso era el "tienes que esperar cinco segundos antes de
// que el botón haga caso". Aquí no hay nada que sondear: quien arranca la
// sesión avisa, y el overlay queda armado en el mismo tick.
//
// Idempotente y sin desincronizar nada: cuando el watcher adopte esa sesión
// llamará a handleOverlayActiveGames(1), setGameLive verá que no cambia y no
// hará nada. El apagado sigue siendo suyo — es quien sabe que el proceso
// murió.
export const notifyOverlaySessionStarted = (): void => {
  setGameLive(true);
};

// Ajustes acaba de cambiar (toggle o atajo): re-evaluar en caliente.
export const refreshOverlaySettings = (): void => {
  syncShortcut();
  syncGamepad();
  if (!getConfigValue('overlayEnabled')) destroyOverlay(false);
  else if (gameLive) void ensureWindow().catch(() => undefined);
};

export const getOverlayShortcutStatus = (): OverlayShortcutStatus => {
  if (!registeredShortcut && !shortcutConflict) return 'inactive';
  return shortcutConflict ? 'conflict' : 'ok';
};

// fromQuit=true en before-quit (suelta también atajo y mando); false cuando
// termina la sesión de juego (§5.7).
export const destroyOverlay = (fromQuit = true): void => {
  if (fromQuit) {
    stopGuideWatcher();
    if (registeredShortcut) {
      globalShortcut.unregister(registeredShortcut);
      registeredShortcut = null;
    }
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  overlayVisible = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  overlayWindow = null;
  rendererReady = null;
  markRendererReady = null;
};
