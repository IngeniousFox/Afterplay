import { Notification } from 'electron';
import { pngIcon } from '../lib/appIcon';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { setSessionClosedNotifier } from '../watcher/notifySession';
import { getMainWindow, showMainWindow } from './mainWindow';

// "1h 47m" para el cuerpo de la notificación de Windows. Aquí y no en
// lib/format del renderer: el main no puede importar del renderer, y son tres
// líneas.
const formatDuration = (seconds: number): string => {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

// Notificaciones nativas todavía en pantalla. Electron NO retiene sus propias
// Notification: sin una referencia viva desde JS, el recolector se lleva el
// objeto en cuanto el callback que lo creó termina, y con él sus manejadores
// de eventos — el aviso aparecía pero pulsarlo no hacía nada.
const liveNotifications = new Set<Notification>();

// Cierre de un juego: el aviso va por una vía u otra según DÓNDE puedas
// verlo. Con la ventana a la vista, un toast dentro de la app (Sonner);
// con la app en la bandeja —que es el caso normal mientras juegas— una
// notificación nativa de Windows, porque un toast en una ventana oculta no
// lo vería nadie. Las dos llevan al mismo sitio: la ficha del juego con su
// última sesión resaltada.
export const wireSessionClosedNotice = (): void => {
  setSessionClosedNotifier((event) => {
    // Acabas de cerrar el juego: sus logros son lo único que puede haber
    // cambiado, y este es el momento de recogerlos (LOGROS.md §4) — tanto de
    // la API de Steam como de los ficheros que el crack acabe de escribir.
    void queueAchievementsRefreshForGame(event.gameId);

    const window = getMainWindow();
    // "A la vista" son DOS cosas en Windows, y aquí solo se miraba una:
    // isVisible() mapea a IsWindowVisible(), que sigue diciendo `true` con la
    // ventana MINIMIZADA (minimizar no quita el WS_VISIBLE). Dejar la app
    // minimizada en la barra de tareas mientras juegas —no escondida en la
    // bandeja— mandaba por tanto el toast a una ventana que nadie ve, y como
    // dura 15 s y se va solo (useSessionClosedToast), el aviso de la sesión
    // desaparecía sin que hubiera existido: la rama de la notificación nativa
    // de aquí abajo ni se llegaba a mirar. Mismo predicado que ipc/window.ts
    // usa para contestar "¿se ve la ventana?".
    if (window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()) {
      window.webContents.send('sessions:closed', event);
      return;
    }

    if (!Notification.isSupported()) return;
    // Con sonido (el de Windows por defecto): esto avisa de algo que acaba de
    // pasar mientras NO estabas mirando la app — un aviso mudo en una ventana
    // oculta es un aviso que no existe.
    const notification = new Notification({
      icon: pngIcon,
      title: event.gameTitle,
      body: `${formatDuration(event.durationSec)} played${
        event.isLongest ? ' · your longest session yet' : ''
      }`,
    });

    // RETENER la notificación mientras esté en pantalla. Sin esto, en cuanto
    // este callback termina el objeto queda sin referencias, el recolector se
    // lo lleva y con él su manejador de 'click' — el aviso se veía pero
    // pulsarlo no hacía absolutamente nada. En Windows la notificación
    // sobrevive en el centro de actividades bastante después de mostrarse, así
    // que la ventana para que esto pase es enorme.
    liveNotifications.add(notification);
    const release = (): void => {
      liveNotifications.delete(notification);
    };
    notification.on('close', release);
    notification.on('failed', release);

    notification.on('click', () => {
      release();
      // Traer la ventana Y llevarla a la ficha: llegar a la biblioteca
      // genérica obligaría a buscar el juego a mano justo cuando el aviso
      // acaba de decirte cuál es.
      showMainWindow();
      const target = getMainWindow();
      if (!target) return;

      // La ventana puede acabar de crearse (app arrancada a bandeja y nunca
      // abierta): mandar el evento antes de que el renderer cargue lo tira al
      // vacío. Con 'did-finish-load' ya hay quien escuche.
      if (target.webContents.isLoading()) {
        target.webContents.once('did-finish-load', () => {
          target.webContents.send('sessions:closed', { ...event, openGame: true });
        });
      } else {
        target.webContents.send('sessions:closed', { ...event, openGame: true });
      }
    });
    notification.show();
  });
};
