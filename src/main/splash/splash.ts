import { BrowserWindow } from 'electron';
import { readFileSync } from 'fs';
import icon, { pngIcon } from '../lib/appIcon';
import { buildSplashHtml, SPLASH_SIZE } from './splashHtml';

// Pantalla de arranque (no confundir con los "Loading…" de dentro de la
// app, que son cosa del renderer/TanStack Query) — cubre el hueco real
// entre "el usuario hace doble clic" y "la ventana de verdad tiene algo que
// enseñar". Sin esto, esos segundos se ven como una ventana en blanco.
//
// Ese hueco ya NO es la suma de las dos esperas, que es lo que ponía aquí:
// desde que main/index.ts crea la ventana antes de migrar, el arranque del
// renderer (~155 ms) corre EN PARALELO con la preparación de la base
// (comprobación de Turso, 470 ms con la base despierta y hasta 4 s con ella
// dormida — ver db/index.ts). Lo que este splash tapa es la más larga de las
// dos, casi siempre la de Turso.
//
// HTML inline (data: URL) a propósito — nada de fichero aparte que haya
// que resolver bien tanto en dev como ya empaquetado; unas pocas líneas de
// CSS no lo justifican. El icono va embebido en base64 en vez de como
// file:// : una página data: corre en un origen opaco, y Chromium bloquea
// que cargue recursos file:// sueltos desde ahí (salía como imagen rota) —
// metido como base64 no hay ningún recurso externo que cargar.
const iconDataUrl = `data:image/png;base64,${readFileSync(pngIcon).toString('base64')}`;

const SPLASH_HTML = buildSplashHtml(iconDataUrl);

export const createSplashWindow = (): BrowserWindow => {
  // Sin transparent/hasShadow: esquinas cuadradas a propósito. Con
  // transparent:true, Windows dibuja su sombra nativa sobre el rectángulo
  // real de la ventana igual (aunque sea transparente), y esa sombra sale
  // como un halo cuadrado por fuera de la tarjeta redondeada del HTML — un
  // lío que una ventana opaca normal, del mismo tamaño que su contenido,
  // no tiene.
  const splash = new BrowserWindow({
    ...SPLASH_SIZE,
    title: 'Afterplay',
    icon,
    backgroundColor: '#0a0b0a',
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: true,
    skipTaskbar: true,
    webPreferences: { sandbox: true },
  });
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
  return splash;
};
