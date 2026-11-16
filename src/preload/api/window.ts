import { invoke, send, subscribe } from '../ipc';

export const windowApi = {
  // La versión instalada — el pie de Ajustes.
  getVersion: (): Promise<string> => invoke('window:get-version'),
  // El TERCER reloj del arranque (ver revealWhenReady en main/index.ts): el
  // renderer avisa cuando la biblioteca tiene contenido DE VERDAD pintable —
  // datos cargados y las primeras carátulas decodificadas. Sin esto, la
  // ventana se enseñaba con el primer frame del cascarón y las carátulas
  // aterrizaban delante del usuario, que es justo el hueco feo que el splash
  // existe para tapar.
  startupContentReady: (): void => send('window:startup-content-ready'),
  minimize: (): void => send('window:minimize'),
  maximize: (): void => send('window:maximize'),
  close: (): void => send('window:close'),
  onMaximizedChange: (callback: (isMaximized: boolean) => void): (() => void) =>
    subscribe('window:maximized-change', callback),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void): (() => void) =>
    subscribe('window:fullscreen-change', callback),
  isVisible: (): Promise<boolean> => invoke('window:is-visible'),
  onVisibleChange: (callback: (isVisible: boolean) => void): (() => void) =>
    subscribe('window:visible-change', callback),
  // ── Big Picture (BIG-PICTURE.md) ────────────────────────────────────────
  // El estado vive en el main (argv/F11/second-instance nacen allí); aquí
  // solo la consulta inicial + el aviso de cambios — mismo contrato que la
  // visibilidad de arriba.
  bigPicture: {
    get: (): Promise<boolean> => invoke('bigpicture:get'),
    enter: (): void => send('bigpicture:enter'),
    exit: (): void => send('bigpicture:exit'),
    onChange: (callback: (active: boolean) => void): (() => void) =>
      subscribe('bigpicture:changed', callback),
  },
  // El cierre REAL (menú del modo TV) — el close() de arriba solo esconde a
  // la bandeja, por diseño.
  quitApp: (): void => send('app:quit'),
};
