import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH } from '../notifications/overlayHtml';
import type { AchievementToast } from '../notifications/overlay';

// LA VENTANA DEL AVISO FLOTANTE — las dos cosas que decide y que no se ven en
// ninguna consulta: DÓNDE sale y CUÁNDO deja de salir.
//
// Es una BrowserWindow aparte que vive lo que viva el proceso (la app se queda
// en la bandeja durante días), así que los dos fallos que cubre este test son
// de los que solo aparecen con el tiempo: la esquina calculada una vez para
// toda la sesión, y un vaciado que sigue presentando tarjetas después de que
// alguien haya cerrado el aviso — recreando la ventana justo detrás del Quit.
//
// Electron es de mentira porque aquí no hay nada de Electron que probar: lo que
// se comprueba es cuántas ventanas se crean y con qué bounds, que es
// exactamente lo que la app le pide al sistema.

type Bounds = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

// Dos monitores, y el segundo NO empieza en 0 — un monitor secundario a la
// derecha tiene x=1920, y ese offset es justo lo que hay que sumar para que la
// esquina caiga en la pantalla correcta.
const PRIMARIO: Bounds = { x: 0, y: 0, width: 1920, height: 1040 };
const SECUNDARIO: Bounds = { x: 1920, y: 0, width: 2560, height: 1400 };

let cursor: Point = { x: 100, y: 100 };

type PendingScript = { token: string; reject: (error: Error) => void };

// La ventana de mentira: apunta lo que la app le pide (bounds, mostrar,
// destruir) y deja que el test decida cuándo "termina" una tarjeta, que en la
// app real es la propia ventana cambiando su document.title.
class FakeWindow {
  public readonly boundsHistory: Bounds[] = [];
  public readonly calls: string[] = [];
  public destroyed = false;
  public shown = 0;
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  public pending: PendingScript | null = null;

  public readonly webContents = {
    setAudioMuted: (): void => {},
    executeJavaScript: (code: string): Promise<void> =>
      new Promise<void>((_resolve, reject) => {
        const json = code.slice(code.indexOf('(') + 1, code.lastIndexOf(')'));
        this.pending = { token: (JSON.parse(json) as { token: string }).token, reject };
      }),
  };

  constructor(public readonly options: Bounds & Record<string, unknown>) {
    windows.push(this);
  }

  public on(event: string, callback: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
  }
  public off(event: string, callback: (...args: unknown[]) => void): void {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((candidate) => candidate !== callback),
    );
  }
  private emit(event: string, ...args: unknown[]): void {
    for (const callback of [...(this.listeners.get(event) ?? [])]) callback(...args);
  }

  // Las tres que hacen que el aviso no estorbe (clics que atraviesan, siempre
  // encima, visible sobre pantalla completa) y la carga del HTML: aquí solo se
  // apuntan, pero se apuntan para que quitarlas de overlay.ts se note.
  public setIgnoreMouseEvents(): void {
    this.calls.push('setIgnoreMouseEvents');
  }
  public setAlwaysOnTop(): void {
    this.calls.push('setAlwaysOnTop');
  }
  public setVisibleOnAllWorkspaces(): void {
    this.calls.push('setVisibleOnAllWorkspaces');
  }
  public async loadURL(): Promise<void> {
    this.calls.push('loadURL');
  }
  public showInactive(): void {
    this.shown++;
  }
  public hide(): void {
    this.calls.push('hide');
  }
  public setBounds(bounds: Bounds): void {
    this.boundsHistory.push(bounds);
  }
  public isDestroyed(): boolean {
    return this.destroyed;
  }
  public destroy(): void {
    this.destroyed = true;
    // Igual que la real: con la ventana destruida, el executeJavaScript en
    // vuelo se rompe (y es lo que desbloquea al present que estaba esperando).
    this.pending?.reject(new Error('window destroyed'));
    this.pending = null;
    this.emit('closed');
  }

  // Lo que en la app hace la propia tarjeta al acabar su animación.
  public finish(): void {
    const token = this.pending?.token;
    this.pending = null;
    if (token) this.emit('page-title-updated', {}, `done:${token}`);
  }
}

const windows: FakeWindow[] = [];

mock.module('electron', {
  namedExports: {
    BrowserWindow: FakeWindow,
    screen: {
      getCursorScreenPoint: (): Point => cursor,
      getDisplayNearestPoint: (point: Point): { workArea: Bounds } => ({
        workArea: point.x >= SECUNDARIO.x ? SECUNDARIO : PRIMARIO,
      }),
    },
    // images/cache lo importa arriba del todo aunque aquí no se llegue a usar
    // (los avisos de este test no llevan imagen).
    app: { getPath: (): string => '.' },
  },
});

let overlay: typeof import('../notifications/overlay');

before(async () => {
  overlay = await import('../notifications/overlay');
});
after(() => {
  overlay.closeAchievementOverlay();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await sleep(5);
  }
};

// Sin icono ni hero a propósito: toDataUri devuelve null enseguida y el test no
// depende de la caché de imágenes.
const toast = (displayName: string): AchievementToast => ({
  displayName,
  iconUrl: null,
  globalPercent: null,
  gameTitle: 'Hollow Knight',
  gameHeroUrl: null,
});

// La esquina inferior derecha del monitor, con los 16 px de margen de la app.
const cornerOf = (display: Bounds): Bounds => ({
  x: display.x + display.width - OVERLAY_WIDTH - 16,
  y: display.y + display.height - OVERLAY_HEIGHT - 16,
  width: OVERLAY_WIDTH,
  height: OVERLAY_HEIGHT,
});

const showing = (): FakeWindow | undefined =>
  windows.find((window) => !window.destroyed && window.pending !== null);

describe('el aviso flotante sale donde estás jugando y se calla cuando se cierra', () => {
  it('cada aviso se recoloca en el monitor del cursor, no solo el primero', async () => {
    // ARREGLADO. La posición se calculaba SOLO al crear la ventana, y la
    // ventana no se cierra hasta que se cierra la app (before-quit). Con dos
    // monitores: juegas por la tarde en el primario y el aviso nace ahí; por la
    // noche te llevas el juego al secundario sin cerrar Afterplay (vive en la
    // bandeja) y todos los avisos siguientes seguían saliendo en una pantalla
    // que ya no estás mirando.
    cursor = { x: 100, y: 100 };
    overlay.enqueueAchievementToasts([toast('Grimm')]);
    await waitUntil(() => showing() !== undefined, 'primera tarjeta en pantalla');

    const window = windows.at(-1) as FakeWindow;
    assert.deepEqual(window.boundsHistory.at(-1), cornerOf(PRIMARIO));

    window.finish();
    await waitUntil(() => showing() === undefined, 'primera tarjeta terminada');

    // Mismo proceso, misma ventana, otro monitor.
    cursor = { x: 2500, y: 300 };
    overlay.enqueueAchievementToasts([toast('Hornet')]);
    await waitUntil(() => showing() !== undefined, 'segunda tarjeta en pantalla');

    assert.equal(windows.at(-1), window, 'la ventana se reutiliza, no se recrea');
    assert.deepEqual(window.boundsHistory.at(-1), cornerOf(SECUNDARIO));
    window.finish();
    await waitUntil(() => showing() === undefined, 'segunda tarjeta terminada');
  });

  it('cerrar el aviso corta el lote en vuelo en vez de recrear la ventana', async () => {
    // ARREGLADO. drain() ya se había llevado su lote a una variable local, así
    // que vaciar la cola no le llegaba: el `for` seguía con la tarjeta
    // siguiente, present() llamaba a ensureWindow(), la encontraba destruida y
    // CREABA UNA VENTANA NUEVA — a mitad del cierre de la app, que es justo lo
    // que el before-quit llama a closeAchievementOverlay para impedir ("una
    // tarjeta en pantalla al salir mantendría el proceso vivo").
    cursor = { x: 100, y: 100 };
    overlay.enqueueAchievementToasts([toast('Uno'), toast('Dos')]);
    await waitUntil(() => showing() !== undefined, 'primera tarjeta del lote');

    const abiertas = windows.length;
    overlay.closeAchievementOverlay();

    // Margen de sobra para el hueco entre tarjetas (260 ms) y la segunda
    // presentación que NO debe ocurrir.
    await sleep(700);
    assert.equal(windows.length, abiertas, 'no se ha creado ninguna ventana nueva');
    assert.equal(showing(), undefined);
  });
});
