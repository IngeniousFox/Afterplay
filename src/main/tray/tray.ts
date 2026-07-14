import { app, Menu, Tray } from 'electron';
import icon from '../../../resources/icon.png?asset';

export type TrayCallbacks = {
  onOpen: () => void;
  onQuit: () => void;
};

// SPEC sección 6 — icono persistente en la bandeja: mientras exista, el
// watcher sigue vigilando aunque la ventana esté oculta. Clic simple Y el
// primer item del menú hacen lo mismo (abrir) — en Windows es lo esperado,
// no todo el mundo hace clic derecho para descubrir el menú.
export const createAppTray = ({ onOpen, onQuit }: TrayCallbacks): Tray => {
  const tray = new Tray(icon);
  tray.setToolTip(app.getName());

  const menu = Menu.buildFromTemplate([
    { label: `Open ${app.getName()}`, click: onOpen },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', onOpen);

  return tray;
};

// Mejora progresiva opcional (SPEC 3E): el tooltip refleja de un vistazo si
// hay algo en marcha ahora mismo, sin tener que abrir la ventana.
export const setTrayActiveGames = (tray: Tray, titles: string[]): void => {
  tray.setToolTip(titles.length > 0 ? `${app.getName()} — ${titles.join(', ')}` : app.getName());
};
