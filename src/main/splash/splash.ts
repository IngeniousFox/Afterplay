import { BrowserWindow } from 'electron';
import { readFileSync } from 'fs';
import icon from '../../../resources/icon.png?asset';

// Pantalla de arranque (no confundir con los "Loading…" de dentro de la
// app, que son cosa del renderer/TanStack Query) — cubre el hueco real
// entre "el usuario hace doble clic" y "la ventana de verdad tiene algo que
// enseñar": migraciones + conexión con Turso (hasta 4s si hay que
// reintentar, ver db/index.ts) + arranque del bundle del renderer. Sin
// esto, esos segundos se ven como una ventana en blanco.
//
// HTML inline (data: URL) a propósito — nada de fichero aparte que haya
// que resolver bien tanto en dev como ya empaquetado; unas pocas líneas de
// CSS no lo justifican. El icono va embebido en base64 en vez de como
// file:// : una página data: corre en un origen opaco, y Chromium bloquea
// que cargue recursos file:// sueltos desde ahí (salía como imagen rota) —
// metido como base64 no hay ningún recurso externo que cargar.
const iconDataUrl = `data:image/png;base64,${readFileSync(icon).toString('base64')}`;

const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    -webkit-app-region: drag;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%;
    background: #0a0b0a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #eaece9;
    -webkit-user-select: none;
  }
  .logo {
    width: 60px; height: 60px; border-radius: 15px;
    box-shadow: 0 10px 28px rgba(47,220,126,.32);
    margin-bottom: 16px;
  }
  .logo img { width: 100%; height: 100%; border-radius: 15px; display: block; }
  .title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; margin-bottom: 20px; }
  .dots { display: flex; gap: 6px; }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #2fdc7e;
    animation: afterplay-splash-pulse 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: .15s; }
  .dot:nth-child(3) { animation-delay: .3s; }
  @keyframes afterplay-splash-pulse {
    0%, 80%, 100% { opacity: .25; transform: scale(.85); }
    40% { opacity: 1; transform: scale(1); }
  }
</style>
</head>
<body>
  <div class="logo"><img src="${iconDataUrl}" alt="" /></div>
  <div class="title">Afterplay</div>
  <div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
</body>
</html>`;

export const createSplashWindow = (): BrowserWindow => {
  // Sin transparent/hasShadow: esquinas cuadradas a propósito. Con
  // transparent:true, Windows dibuja su sombra nativa sobre el rectángulo
  // real de la ventana igual (aunque sea transparente), y esa sombra sale
  // como un halo cuadrado por fuera de la tarjeta redondeada del HTML — un
  // lío que una ventana opaca normal, del mismo tamaño que su contenido,
  // no tiene.
  const splash = new BrowserWindow({
    width: 320,
    height: 320,
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
