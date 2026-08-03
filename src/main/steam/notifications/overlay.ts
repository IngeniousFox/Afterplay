import { BrowserWindow, screen } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { cacheImage } from '../../images/cache';
import { buildOverlayHtml, OVERLAY_HEIGHT, OVERLAY_WIDTH } from './overlayHtml';
import type { OverlayPayload } from './overlayHtml';

// El aviso flotante de "logro desbloqueado" (LOGROS.md §8).
//
// Es una ventana APARTE de la principal, y esa es toda la gracia: funciona
// con Afterplay minimizada, escondida en la bandeja o cerrada a la X. No es
// una notificación de Windows — es una tarjeta nuestra, con nuestra
// tipografía y nuestro verde, dibujada encima del juego.
//
// Las tres claves para que no estorbe, comprobadas en el presentador de Hydra
// (MIT), que resuelve el mismo problema:
//   · focusable:false + showInactive() -> aparece SIN robarle el foco al
//     juego. Si se lo robara, un juego a pantalla completa se minimizaría.
//   · setIgnoreMouseEvents(true) -> los clics ATRAVIESAN la tarjeta y llegan
//     al juego. Nadie pincha un aviso sin querer en mitad de un tiroteo.
//   · setAlwaysOnTop(true, 'screen-saver') -> el nivel más alto de Windows.
//
// Límite honesto: esto funciona en ventana y en ventana sin bordes (como
// juega casi todo el mundo). En pantalla completa EXCLUSIVA ninguna ventana
// normal puede dibujar encima — Steam lo consigue inyectándose en el proceso
// del juego, que es una técnica que los anticheat marcan y que esta app no
// va a hacer.

export type AchievementToast = {
  displayName: string;
  iconUrl: string | null;
  globalPercent: number | null;
  gameTitle: string;
  // Hero del juego, de fondo tras el velo — el mismo recurso que usa el aviso
  // de sesión cerrada, para que los dos avisos hablen el mismo idioma.
  gameHeroUrl: string | null;
  // La tarjeta del 100% (LOGROS-IDEAS.md §3.6): dorada, con su propia línea
  // — se dispara al completar el último logro de un juego, no por rareza.
  celebration?: boolean;
};

const GREEN = '#2fdc7e';
const AMBER = '#e3b24a';
const VIOLET = '#e0a3ff';

const RARE = 10;
const ULTRA_RARE = 5;

const SINGLE_MS = 4200;
const COMBINED_MS = 5200;
// Hueco entre tarjetas: sin él, la siguiente entra pisando la animación de
// salida de la anterior y se ve un parpadeo en vez de dos avisos.
const GAP_MS = 260;

// Por encima de esto no se enseñan de uno en uno. Es exactamente lo que pasó
// al arreglar Goldberg en el 007: el juego volvió a reportar 25 logros de
// golpe. Veinticinco tarjetas en fila son dos minutos de aviso — se resume.
const COMBINE_THRESHOLD = 3;

let window: BrowserWindow | null = null;
let queue: AchievementToast[] = [];
let showing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const accentFor = (percent: number | null): string => {
  if (percent === null) return GREEN;
  if (percent < ULTRA_RARE) return VIOLET;
  if (percent < RARE) return AMBER;
  return GREEN;
};

// El icono viaja como data URI, no como URL. Motivo: la ventana se carga
// desde una data: URL y su origen es opaco, así que no puede pedir ni
// afterplay-image:// ni al CDN de Steam. Convertirlo aquí deja la ventana
// sin ninguna dependencia externa — y el fichero ya está en la caché de
// imágenes, así que es leer del disco.
const toDataUri = async (
  url: string | null,
  type: 'achievements' | 'heroes' = 'achievements',
): Promise<string | null> => {
  if (!url) return null;
  try {
    const localPath = await cacheImage(url, type);
    const buffer = await readFile(localPath);
    const ext = extname(localPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    // Sin icono se pinta el trofeo de reserva: un aviso sin imagen sigue
    // siendo un aviso útil.
    return null;
  }
};

const ensureWindow = async (): Promise<BrowserWindow> => {
  if (window && !window.isDestroyed()) return window;

  // Esquina inferior derecha del monitor donde está el cursor — que es el
  // monitor en el que estás jugando. workArea y no bounds: así respeta la
  // barra de tareas en vez de quedar debajo.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;

  const created = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: x + width - OVERLAY_WIDTH - 16,
    y: y + height - OVERLAY_HEIGHT - 16,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Lo que hace que no le robe el foco al juego.
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      sandbox: false,
      // CLAVE para que el sonido suene con un juego en primer plano. Por
      // defecto Chromium estrangula timers y audio de las ventanas que
      // considera de fondo — y esta lo está SIEMPRE por definición: nunca
      // tiene el foco (focusable:false) y encima suele haber un juego a
      // pantalla completa delante. Sin esto, el aviso se veía pero no sonaba
      // justo en el único momento en el que importa: mientras juegas.
      backgroundThrottling: false,
    },
  });

  // Y que nada de fuera pueda silenciarla por error.
  created.webContents.setAudioMuted(false);

  created.setIgnoreMouseEvents(true);
  created.setAlwaysOnTop(true, 'screen-saver', 1);
  // Que se vea también sobre juegos a pantalla completa de otras ventanas y
  // en todos los escritorios virtuales.
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  await created.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml())}`);

  created.on('closed', () => {
    window = null;
    showing = false;
  });

  window = created;
  return created;
};

// Enseña UNA tarjeta y espera a que termine. La ventana avisa de que acabó
// cambiando su document.title (page-title-updated) — la vía más simple de
// hablar de vuelta sin montarle un preload propio a una ventana de 380px.
const present = async (payload: OverlayPayload & { token: string }): Promise<void> => {
  const target = await ensureWindow();

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      target.off('page-title-updated', onTitle);
      clearTimeout(guard);
      resolve();
    };

    const onTitle = (_event: unknown, title: string): void => {
      if (title === `done:${payload.token}`) finish();
    };

    // Red de seguridad: si el renderer se atasca, la cola NO se queda colgada
    // para siempre. Se le da su duración más un margen generoso.
    const guard = setTimeout(finish, payload.durationMs + 2000);

    target.on('page-title-updated', onTitle);
    target.showInactive();
    void target.webContents
      .executeJavaScript(`window.showAchievement(${JSON.stringify(payload)})`)
      .catch(finish);
  });

  if (target && !target.isDestroyed()) target.hide();
};

const drain = async (): Promise<void> => {
  if (showing) return;
  showing = true;

  try {
    while (queue.length > 0) {
      const batch = queue;
      queue = [];

      if (batch.length > COMBINE_THRESHOLD) {
        // Resumen: cuántos y de qué juego. Enseñar 25 seguidos sería un
        // castigo, no una celebración.
        const game = batch[0].gameTitle;
        await present({
          token: `c${Date.now()}`,
          title: `${batch.length} achievements unlocked`,
          subtitle: game,
          gameTitle: game,
          iconDataUri: await toDataUri(batch[0].iconUrl),
          heroDataUri: await toDataUri(batch[0].gameHeroUrl, 'heroes'),
          accent: GREEN,
          rarity: null,
          durationMs: COMBINED_MS,
          rare: false,
        });
        continue;
      }

      for (const toast of batch) {
        // El 100% viste ORO fijo y su propia letra — es el final de una
        // cacería, no un logro más.
        const celebration = toast.celebration === true;
        const accent = celebration ? AMBER : accentFor(toast.globalPercent);
        await present({
          token: `s${Date.now()}-${toast.displayName}`,
          title: toast.displayName,
          subtitle: celebration ? '100% complete' : 'Achievement unlocked',
          gameTitle: toast.gameTitle,
          iconDataUri: await toDataUri(toast.iconUrl),
          heroDataUri: await toDataUri(toast.gameHeroUrl, 'heroes'),
          accent,
          rarity: celebration
            ? 'Every achievement unlocked'
            : toast.globalPercent !== null && toast.globalPercent < RARE
              ? `Only ${toast.globalPercent.toFixed(1)}% of players have this`
              : null,
          durationMs: celebration ? COMBINED_MS : SINGLE_MS,
          rare: celebration || accent !== GREEN,
        });
        if (queue.length > 0 || batch.indexOf(toast) < batch.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, GAP_MS));
        }
      }
    }
  } catch (error) {
    console.warn('[steam] fallo enseñando el aviso de logro:', error);
  } finally {
    showing = false;
  }
};

// Encola avisos. Espera un pelín antes de vaciar a propósito: los logros
// llegan de una tacada (una lectura del fichero del crack devuelve todos los
// nuevos a la vez), y sin esa espera el primero se enseñaría suelto y los
// otros veinticuatro se resumirían aparte.
export const enqueueAchievementToasts = (toasts: AchievementToast[]): void => {
  if (toasts.length === 0) return;
  queue.push(...toasts);

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void drain();
  }, 400);
};

export const closeAchievementOverlay = (): void => {
  if (flushTimer) clearTimeout(flushTimer);
  queue = [];
  if (window && !window.isDestroyed()) window.destroy();
  window = null;
};
