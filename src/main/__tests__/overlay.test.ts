import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

// EL CONTADOR DE GENERACIÓN DEL OVERLAY (overlay.ts) — LA VENTANA RESUCITADA.
//
// createOverlayWindow() es async y `await`ea la carga de la SPA
// (loadFile/loadURL). En ese hueco la sesión puede morir (fin de partida,
// Win+L, overlay apagado en Ajustes) — destroyOverlay() solo sabía mirar
// `overlayWindow`, que sigue siendo null MIENTRAS la ventana está cargando,
// así que no destruía nada y la promesa acababa publicando una capa
// alwaysOnTop nivel screen-saver SIN sesión detrás. `windowGeneration` es el
// arreglo: se incrementa al cancelar, y la creación en vuelo compara su propia
// generación al terminar de cargar para saber si su mundo sigue existiendo.
//
// Lo que este fichero blinda: una ventana cancelada A MEDIA CARGA (1) se
// autodestruye sola en cuanto termina de cargar y (2) JAMÁS se convierte en
// la ventana vigente — sendToOverlay() después de eso no le llega nada. Y,
// como control de que el arnés de prueba de verdad ejercita el camino
// bueno: una ventana que termina de cargar SIN que nadie la cancele SÍ se
// convierte en la vigente y SÍ recibe lo que se le mande.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: overlay.ts es el módulo de verdad. Todo lo que
// toca —electron (BrowserWindow/globalShortcut/ipcMain/screen),
// @electron-toolkit/utils (arrastra 'electron' por dentro, de ahí que el
// doble de electron tenga que cubrir también `session`), config/store y
// gamepad— está doblado: son fachada de Electron/IO, no la decisión que se
// prueba. El control de "cuándo termina de cargar la SPA" es justo lo que el
// doble de BrowserWindow.loadFile() expone a mano, cosa que Electron real no
// permite.

type Bounds = { x: number; y: number; width: number; height: number };

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = [];

  destroyed = false;
  sentChannels: string[] = [];
  bounds: Bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  private listeners: Record<string, Array<() => void>> = {};
  webContents = {
    on: (): void => {},
    send: (channel: string): void => {
      this.sentChannels.push(channel);
    },
  };

  constructor() {
    FakeBrowserWindow.instances.push(this);
  }

  on(event: string, handler: () => void): void {
    (this.listeners[event] ??= []).push(handler);
  }

  loadFile(): Promise<void> {
    return new Promise<void>((resolve) => {
      pendingLoads.push(resolve);
    });
  }

  loadURL(): Promise<void> {
    return this.loadFile();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const handler of this.listeners['closed'] ?? []) handler();
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }
  getBounds(): Bounds {
    return this.bounds;
  }

  // Arrow functions en vez de métodos: son las stubs que no le importan a
  // este test (posicionamiento, foco, click-through), y como propiedades de
  // instancia no chocan con no-empty-function (que sí marca un método vacío).
  setIgnoreMouseEvents = (): void => {};
  setAlwaysOnTop = (): void => {};
  setVisibleOnAllWorkspaces = (): void => {};
  setFocusable = (): void => {};
  show = (): void => {};
  focus = (): void => {};
}

// Las resoluciones pendientes de loadFile/loadURL, en orden de creación —así
// el test decide EXACTAMENTE cuándo "termina de cargar" cada ventana, que es
// el instante que Electron de verdad nunca deja controlar desde fuera.
const pendingLoads: Array<() => void> = [];

let overlayEnabled = true;

mock.module('electron', {
  namedExports: {
    app: { isPackaged: true },
    session: {},
    BrowserWindow: FakeBrowserWindow,
    globalShortcut: {
      register: (): boolean => true,
      unregister: (): void => {},
    },
    ipcMain: {
      on: (): void => {},
      handle: (): void => {},
    },
    screen: {
      getCursorScreenPoint: (): { x: number; y: number } => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: (): { bounds: Bounds } => ({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    },
  },
});

mock.module('../config/store', {
  namedExports: {
    getConfigValue: (key: string): unknown => {
      if (key === 'overlayEnabled') return overlayEnabled;
      if (key === 'overlayShortcut') return 'F13';
      return undefined;
    },
  },
});

mock.module('../gamepad', {
  namedExports: {
    startGuideWatcher: async (): Promise<void> => {},
    stopGuideWatcher: (): void => {},
  },
});

let overlay: typeof import('../overlay');

before(async () => {
  overlay = await import('../overlay');
});

// gameLive es un booleano de módulo que sobrevive entre tests: notifyOverlay
// SessionStarted() no dispara ensureWindow() una segunda vez si gameLive ya
// era `true` (setGameLive corta con `if (live === gameLive) return`). Cada
// test necesita arrancar desde gameLive=false para poder disparar una
// creación de ventana con la que trabajar.
const reiniciarOverlay = (): void => {
  overlay.destroyOverlay(true); // desarma el timer del Play y cualquier ventana
  overlay.handleOverlayActiveGames(0); // gameLive -> false (el timer ya está desarmado)
};

beforeEach(() => {
  reiniciarOverlay();
  FakeBrowserWindow.instances.length = 0;
  pendingLoads.length = 0;
  overlayEnabled = true;
});

after(() => {
  reiniciarOverlay();
});

describe('el contador de generación frente a una ventana cancelada a media carga', () => {
  it('control: SIN cancelar, la ventana termina de cargar y se vuelve la vigente', async () => {
    overlay.notifyOverlaySessionStarted();
    assert.equal(FakeBrowserWindow.instances.length, 1);
    const creada = FakeBrowserWindow.instances[0];

    pendingLoads.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(creada.destroyed, false, 'nadie la canceló: sigue viva');
    overlay.sendToOverlay('overlay:test', 'x');
    assert.deepEqual(
      creada.sentChannels,
      ['overlay:test'],
      'es la ventana vigente: le llega lo que se manda',
    );
  });

  it('una ventana cancelada mientras cargaba se autodestruye y NUNCA se publica', async () => {
    overlay.notifyOverlaySessionStarted();
    assert.equal(FakeBrowserWindow.instances.length, 1, 'la ventana se crea SÍNCRONAMENTE');
    const creada = FakeBrowserWindow.instances[0];
    assert.equal(creada.destroyed, false);

    // Se cancela A MEDIA CARGA: fin de sesión, Win+L, overlay apagado desde
    // Ajustes — cualquiera de ellos pasa por aquí. windowGeneration++.
    overlay.destroyOverlay(true);

    // La SPA "termina de cargar" DESPUÉS de la cancelación — el hueco exacto
    // que windowGeneration existe para cerrar.
    pendingLoads.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      creada.destroyed,
      true,
      'la ventana huérfana se autodestruye sola al terminar de cargar',
    );

    overlay.sendToOverlay('overlay:test', 'x');
    assert.deepEqual(
      creada.sentChannels,
      [],
      'nunca llegó a ser la ventana vigente: nada se le manda jamás',
    );
  });

  it('tras la cancelación, la SIGUIENTE invocación crea una ventana NUEVA, no reutiliza la cancelada', async () => {
    overlay.notifyOverlaySessionStarted();
    const primera = FakeBrowserWindow.instances[0];
    overlay.destroyOverlay(true);
    pendingLoads.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(primera.destroyed, true);

    reiniciarOverlay();
    FakeBrowserWindow.instances.length = 0;
    pendingLoads.length = 0;

    overlay.notifyOverlaySessionStarted();
    assert.equal(
      FakeBrowserWindow.instances.length,
      1,
      'una ventana fresca, no la vieja resucitada',
    );
    const segunda = FakeBrowserWindow.instances[0];
    assert.notEqual(segunda, primera);

    pendingLoads.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    overlay.sendToOverlay('overlay:test', 'y');
    assert.deepEqual(segunda.sentChannels, ['overlay:test'], 'esta sí es la vigente');
  });
});
