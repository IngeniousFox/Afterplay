// El contenido de la ventana flotante de logro desbloqueado.
//
// HTML+CSS+JS en un string y cargado como data: URL, en vez de una segunda
// entrada de Vite. El porqué: es una ventana de 380×96 con dos elementos, y
// darle React + Tailwind + su propio HTML en el empaquetado sería una tubería
// entera para pintar una tarjeta. Así no toca ni electron.vite.config ni
// electron-builder, y arranca en el primer frame porque no carga nada.
//
// Todo lo que necesite viaja YA RESUELTO desde el main (el icono como data
// URI, ver overlay.ts): esta ventana no pide nada a nadie.

export type OverlayPayload = {
  title: string;
  subtitle: string;
  // El juego, en gris bajo el logro. Se omite si ya es el subtítulo.
  gameTitle: string;
  // Data URI del icono; null = se pinta el trofeo de reserva.
  iconDataUri: string | null;
  // Data URI del hero del JUEGO, de fondo tras un velo — el mismo recurso y
  // el mismo velo que usa el aviso de sesión cerrada (SessionClosedToast).
  // Es lo que hace que el aviso se lea como una ficha del juego y no como un
  // mensaje de sistema. null = fondo liso.
  heroDataUri: string | null;
  // Color del acento (verde normal, ámbar/violeta si es raro).
  accent: string;
  // "2.4% of players" — solo si aporta.
  rarity: string | null;
  // Milisegundos que se queda en pantalla.
  durationMs: number;
  // Sonido: un logro normal suena discreto; uno raro se permite una nota más.
  rare: boolean;
};

export const OVERLAY_WIDTH = 392;
export const OVERLAY_HEIGHT = 108;

// El sonido va SINTETIZADO con WebAudio, no como fichero: mismo criterio que
// el modo TV (sound.ts). Dos ventajas concretas — cero peso en el
// empaquetado, y se puede afinar cambiando números en vez de reexportando un
// wav. Es un arpegio corto ascendente con una quinta arriba: suena a
// "conseguido" sin el estruendo de una fanfarria.
const SOUND_SCRIPT = `
// UN solo AudioContext para toda la vida de la ventana, no uno por aviso.
// Con un juego en primer plano, crear y cerrar contextos de audio a cada rato
// es justo lo que acaba en silencio: el navegador puede dejarlo 'suspended'
// (no hubo gesto del usuario en esta ventana, y nunca lo habrá porque ignora
// el raton) y cerrarlo despues no deja rastro de por que no sono.
var sharedCtx = null;

function getCtx() {
  if (!sharedCtx) {
    sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Reanudar SIEMPRE antes de sonar: basta con que el sistema cambie de
  // dispositivo de audio, o que el navegador decida suspenderlo en segundo
  // plano, para que se quede parado sin avisar.
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

function playChime(rare) {
  try {
    var ctx = getCtx();
    var now = ctx.currentTime;
    var master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    // Un logro raro añade la octava arriba: la misma frase, un peldaño más.
    var notes = rare ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 783.99];
    notes.forEach(function (freq, i) {
      var t = now + i * 0.075;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      // Triangular y no seno puro: el seno a este volumen se pierde sobre el
      // audio de un juego (misma lección que los SFX del modo TV).
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.9, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 0.45);
    });
    // Sin ctx.close(): el contexto se reutiliza (ver getCtx). Cerrarlo era lo
    // que obligaba a crear uno nuevo en cada aviso.
  } catch (e) {}
}
`;

export const buildOverlayHtml = (): string => `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width:100%; height:100%;
    background:transparent;
    overflow:hidden;
    /* Sin interacción: la ventana ya ignora el ratón desde el main, esto
       evita además cualquier selección o arrastre accidental. */
    user-select:none; -webkit-user-select:none;
    font-family:'Segoe UI', system-ui, sans-serif;
  }
  #card {
    position:absolute; inset:8px;
    display:flex; align-items:center; gap:13px;
    padding:0 16px 0 14px;
    border-radius:14px;
    overflow:hidden;
    background:#141614;
    border:1px solid rgba(255,255,255,.09);
    box-shadow:0 20px 55px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.07);
    /* Entra deslizando desde la derecha. translateX y opacity solamente:
       las dos son propiedades que el compositor anima sin repintar. */
    transform:translateX(120%);
    opacity:0;
    transition:transform .42s cubic-bezier(.16,1,.3,1), opacity .3s ease;
  }
  #card.in { transform:translateX(0); opacity:1; }
  #card.out { transform:translateX(120%); opacity:0; }
  /* Hero del juego de fondo con el velo de izquierda a derecha — copiado del
     aviso de sesión cerrada: da identidad de FICHA sin comerse el texto. */
  #hero { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  #veil {
    position:absolute; inset:0;
    background:linear-gradient(90deg, rgba(18,20,19,.97) 0%, rgba(18,20,19,.93) 45%, rgba(18,20,19,.68) 100%);
  }
  #iconwrap { position:relative; flex:none; width:52px; height:52px; }
  #glow {
    position:absolute; inset:-3px; border-radius:13px;
    filter:blur(7px); opacity:.55;
  }
  #icon {
    position:relative; width:52px; height:52px;
    border-radius:11px; object-fit:cover;
    border:1px solid rgba(255,255,255,.14);
    background:#1b1e1c;
  }
  #fallback {
    position:relative; width:52px; height:52px; border-radius:11px;
    border:1px solid rgba(255,255,255,.14); background:#1b1e1c;
    display:flex; align-items:center; justify-content:center;
    font-size:24px;
  }
  #text { position:relative; min-width:0; flex:1; }
  #sub {
    display:flex; align-items:center; gap:5px;
    font-size:10px; font-weight:800; letter-spacing:.13em; text-transform:uppercase;
    opacity:.95;
  }
  #title {
    margin-top:3px;
    font-size:14.5px; font-weight:800; color:#f2f5f3;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  #rarity { margin-top:2px; font-size:10.5px; font-weight:700; opacity:.8; }
  #game {
    margin-top:2px; font-size:10.5px; color:rgba(255,255,255,.42);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  /* Cuenta atrás abajo, igual que el aviso de sesión cerrada: dice cuánto le
     queda en pantalla en vez de desaparecer de golpe. */
  #countdown { position:absolute; left:0; right:0; bottom:0; height:2px; background:rgba(255,255,255,.08); }
  #bar { height:100%; width:100%; transform-origin:left center; }
  #bar.run { transition:transform linear; transform:scaleX(0); }
</style></head>
<body>
  <div id="card">
    <img id="hero" style="display:none" />
    <div id="veil"></div>
    <div id="iconwrap">
      <div id="glow"></div>
      <img id="icon" style="display:none" />
      <div id="fallback">🏆</div>
    </div>
    <div id="text">
      <div id="sub"><span id="subdot"></span><span id="subtext"></span></div>
      <div id="title"></div>
      <div id="rarity"></div>
      <div id="game"></div>
    </div>
    <div id="countdown"><div id="bar"></div></div>
  </div>
<script>
${SOUND_SCRIPT}

var card = document.getElementById('card');
var hideTimer = null;

// La llama el main con executeJavaScript. Devuelve enseguida: la ventana se
// esconde sola y avisa por el título del documento (ver overlay.ts), que es
// la vía más simple de hablar de vuelta sin montar un preload para esto.
window.showAchievement = function (data) {
  clearTimeout(hideTimer);
  card.classList.remove('out');

  document.getElementById('subtext').textContent = data.subtitle;
  document.getElementById('sub').style.color = data.accent;
  document.getElementById('glow').style.background = data.accent;
  document.getElementById('title').textContent = data.title;

  var rarity = document.getElementById('rarity');
  rarity.textContent = data.rarity || '';
  rarity.style.display = data.rarity ? 'block' : 'none';
  rarity.style.color = data.accent;

  // El juego, en gris y pequeño: contexto sin robarle protagonismo al logro.
  // No se repite cuando el subtítulo YA es el nombre del juego (el aviso
  // combinado lo usa de titular).
  var game = document.getElementById('game');
  var showGame = data.gameTitle && data.gameTitle !== data.subtitle;
  game.textContent = showGame ? data.gameTitle : '';
  game.style.display = showGame ? 'block' : 'none';

  var hero = document.getElementById('hero');
  if (data.heroDataUri) {
    hero.src = data.heroDataUri;
    hero.style.display = 'block';
  } else {
    hero.style.display = 'none';
  }

  var img = document.getElementById('icon');
  var fallback = document.getElementById('fallback');
  if (data.iconDataUri) {
    img.src = data.iconDataUri;
    img.style.display = 'block';
    fallback.style.display = 'none';
  } else {
    img.style.display = 'none';
    fallback.style.display = 'flex';
  }

  // La cuenta atrás se reinicia a mano: quitar la clase, forzar un reflow y
  // volver a ponerla. Sin el reflow el navegador agrupa los dos cambios y la
  // animación no vuelve a arrancar en el segundo aviso.
  var bar = document.getElementById('bar');
  bar.className = '';
  bar.style.background = data.accent;
  bar.style.opacity = '.55';
  bar.style.transitionDuration = '0s';
  void bar.offsetWidth;
  bar.style.transitionDuration = data.durationMs + 'ms';
  bar.className = 'run';

  // Un frame de margen para que el navegador vea el estado inicial y la
  // transición de entrada se dispare de verdad (sin esto salta ya puesta).
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { card.classList.add('in'); });
  });

  playChime(!!data.rare);

  hideTimer = setTimeout(function () {
    card.classList.remove('in');
    card.classList.add('out');
    // Al acabar la animación de salida, avisar al main cambiando el título.
    setTimeout(function () { document.title = 'done:' + data.token; }, 450);
  }, data.durationMs);
};
</script>
</body></html>`;
