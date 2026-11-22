# Fósforo: sistema de diseño

Base para implementar en Tailwind v4 (tokens en `@theme`, compartidos entre escritorio y PWA). Nueve hojas de 1600×1000, siempre en modo oscuro, interfaz en inglés. Generadas con `node render-sistema.mjs` (`build-sistema.mjs` + `build-sistema-b/c/d.mjs` + `sistema.css`).

| Hoja | Contenido |
|---|---|
| `sistema-tokens-color.png` | superficies, bordes, texto, acento, señales, LED de estado, escalera hover/active/disabled, matrices de contraste |
| `sistema-tokens-tipo.png` | escala tipográfica, espaciado, radios, iconos |
| `sistema-tokens-capas.png` | elevación, líneas de escaneo, brillo ámbar |
| `sistema-controles-botones.png` | botones (5 variantes), input, búsqueda, select en 6 estados; menú del select, menú contextual, paleta Ctrl K |
| `sistema-controles-seleccion.png` | checkbox, radio, switch, segmentado, pestañas, chip con LED en 6 estados; tooltip, slider, date picker |
| `sistema-superficies.png` | paneles y tablas, diálogo, alert dialog, sheet lateral, toasts, empty state, skeleton |
| `sistema-medios.png` | portada (tamaños y estados), banner con degradado de protección, cifra con unidad, medidor HLTB, barras de la semana |
| `sistema-movimiento.png` | tabla de qué se anima, curvas, duraciones, reduced motion |
| `sistema-movimiento-fotogramas.png` | fotogramas calculados con las curvas reales de las 9 animaciones clave |

## Principios (lo que hay que respetar al implementar)

1. **Una capa = un escalón de luminosidad + una línea.** Cinco capas: Inset `#0C1012` (pozos), Cabinet `#101416` (fondo), Panel `#171D20`, Raised `#1F272B`, Overlay `#242C31` (lo que flota). Las sombras solo existen en lo que flota, son tinta petróleo `rgb(3 6 7 / .8)` (nunca gris ni negro puro) y llevan un filo superior `inset 0 1px 0 rgb(233 228 216 / .06)`. Paneles y filas no proyectan sombra.
2. **Un solo acento.** Phosphor `#FFB347` es foco, selección, Play y cifras clave. Tube es sync/info/enlaces; Live es sesión en marcha, Stop y destructivo. El LED de estado es el único sitio con cinco tonos y va siempre junto a su palabra.
3. **Foco** = outline de 2 px Phosphor con offset de 2 px (`focus-visible`), nunca un relleno. En segmentado, pestañas, filas y menús el outline va hacia dentro (`outline-offset:-2px`) para que los vecinos no lo recorten.
4. **Pulsar** = `scale(.97)` (.96 chips, .98 portadas), 120 ms de entrada y 160 ms de salida.
5. **Disabled** = el mismo control al 40 % de opacidad, sin brillo y con cursor `not-allowed`. **Loading** = mismo ancho, etiqueta oculta con `opacity:0` y spinner centrado de 15 px (700 ms, lineal), `aria-busy`.
6. **Líneas de escaneo y brillo solo en zonas héroe**: banners, barra Now playing, arte de empty state, héroe de TV, portada cargando. Nunca en paneles, tablas, controles, diálogos ni texto corrido. Un único foco "caliente" por región.
7. **Cifras** siempre en Big Shoulders con la unidad a 0.45 em, peso 600, Dust (`38h 10m`; minutos con cero a la izquierda). Sin etiquetas en mayúsculas ni eyebrows. Texto mínimo 12 px (20 px en TV).
8. **Sin animar lo que el teclado repite**: Ctrl K, navegación por lista, cambio de contenido de pestañas, filtros.

## Hoja 1: color

Superficies, bordes, texto, acento y señales con hex y uso (ver PNG). Estados interactivos:

| Control | Reposo | Hover | Active | Disabled |
|---|---|---|---|---|
| Primario | `#FFB347` | `#FFC266` | `#E39A2E` | 40 % |
| Live | `#FF5E57` | `#FF756F` | `#E5463F` | 40 % |
| Secundario | `#1F272B` + borde `.17` | `#2A343A` + borde `.30` | `#1A2226` | 40 % |
| Fantasma | transparente, Dust | `rgb(233 228 216/.06)`, Bone | `.11`, Bone | 40 % |
| Fila | Panel | Raised | seleccionada: tinte Phosphor `.11` + filo de 2 px | 40 % |

Texto sobre acento: tinta `#1A1100` sobre Phosphor, `#1C0605` sobre Live (nunca blanco: 3.0:1).

### Contraste AA verificado (WCAG 2.x, calculado en el build)

Texto sobre superficies (mínimo 4.5:1):

| | Inset | Cabinet | Panel | Raised | Overlay |
|---|---|---|---|---|---|
| Bone `#E9E4D8` | 15.07 | 14.60 | 13.43 | 11.97 | 11.19 |
| Dust `#8A9496` | 6.15 | 5.96 | 5.48 | 4.88 | **4.57** |
| Phosphor | 10.73 | 10.40 | 9.56 | 8.52 | 7.97 |
| Tube | 10.82 | 10.48 | 9.64 | 8.59 | 8.03 |
| Live | 6.36 | 6.17 | 5.67 | 5.05 | 4.72 |
| Beaten | 11.19 | 10.84 | 9.97 | 8.89 | 8.31 |
| Resting | 9.07 | 8.79 | 8.08 | 7.20 | 6.73 |
| Caution `#E8C468` | 11.40 | 11.05 | 10.16 | 9.06 | 8.47 |

Otros pares: tinta sobre Phosphor 10.49 (hover 11.71, active 7.94); tinta Live sobre Live 6.49 (hover 7.45, active 4.90); Bone sobre fila seleccionada 11.50; **Edge `#707370`** (borde de controles) sobre Panel 3.55 y Raised 3.16 (mínimo 3:1, WCAG 1.4.11); anillo de foco Phosphor sobre Raised 8.52 y sobre Cabinet 10.40; Bone sobre el peor caso de banner con protección (Cyberpunk, amarillo) 8.2:1 frente a 1.32:1 sin protección.

Ajustes respecto a la primera ronda: Overlay pasa de la idea inicial `#262F34` (Dust 4.39, suspendía) a `#242C31`; los bordes de formularios usan Edge en lugar de `Line strong` (1.6:1 no cumplía 1.4.11). Disabled está exento (WCAG 1.4.3).

## Hoja 2: tipografía, espaciado, radios

| Token | Familia | Tamaño / interlineado | Tracking | Uso |
|---|---|---|---|---|
| `text-hero` | Big Shoulders 700 | 96 / 88 | .005em | cifra de página (Stats) |
| `text-stat` | Big Shoulders 700 | 76 / 72 | .005em | cifras de semana, tiempo en ficha |
| `text-page` | Big Shoulders 700 | 44 / 44 | .005em | títulos de pantalla, temporizador, recuento |
| `text-title` | Big Shoulders 700 | 28 / 30 | .01em | nombres de juego en tarjetas, títulos de diálogo, empty state |
| `text-figure` | Big Shoulders 700 | 20 / 20 | .02em | números de cola, contadores |
| `text-lead` | Barlow 600 | 16 / 22 | 0 | nombre en Now playing, títulos de panel |
| `text-body` | Barlow 400/500 | 14 / 20 | 0 | UI por defecto (botones 500) |
| `text-small` | Barlow 400/500 | 13 / 18 | 0 | metadatos, pies de portada |
| `text-micro` | Barlow 500 | 12 / 16 | 0 | franja de horas, kbd. Suelo. |

Big Shoulders 800 solo dentro de portadas. `font-variant-numeric: tabular-nums` global. TV: misma familia a ×1.5 (cuerpo 21, mínimo 20, título 42, página 66).

Espaciado: base 4 px (`--spacing: 4px`; p-5 = 20). Marco fijo: barra superior 56, Now playing 72, margen de ventana 28, controles 28/34/44, fila de lista 48 (36 en Sessions denso). Radios: 2 (segmentos, barras), 4 (controles, portadas, kbd), 8 (paneles, menús, diálogos, toasts, sheet), full (LED, chips, switch).

## Hoja 3: elevación, escaneo, brillo

- `shadow-float` (menús, popovers, tooltips), `shadow-modal` (diálogos, sheet, Ctrl K), `shadow-lift` (portada en hover), scrim `rgb(8 11 12 / .72)`.
- Escaneo: línea de 1 px cada 3 px, horizontal, blanco al 3.5 % (2 % sutil; 7 % es demasiado). Va sobre el arte y bajo el texto.
- Brillo: `glow-text` (temporizador), `glow-led`, `glow-bar` (pestaña activa, filo de fila seleccionada, barra de hoy al .4), `glow-halo` (solo foco de TV), `glow-ambient` (radial desde abajo-izquierda en banners y Now playing). Nunca para hover.

## Hojas 4 y 5: controles

Todos en seis estados; donde un estado no existe la celda lo dice ("n/a, instant" en checkbox y radio).

- **Botones**: primario ámbar (uno por vista), secundario (Raised + Line strong), fantasma, peligro Live, solo icono (34 px, con `aria-label` y tooltip). Tamaños 28/34/44.
- **Inputs**: relleno Inset, borde Edge, radio 4, 34 px. Foco: borde Phosphor + halo `0 0 0 3px rgb(255 179 71/.22)`. Error: borde Live + texto de ayuda con triángulo. Búsqueda abre con **Ctrl K** (kbd visible), paleta sin animación. Select: abre menú Overlay con origen en el disparador; el valor seleccionado lleva filo Phosphor y check.
- **Menú contextual**: items de 32 px, hover `rgb(233 228 216/.08)`, atajo a la derecha, peligro en Live separado por una línea, deshabilitado al 40 %.
- **Checkbox/radio** 18 px (zona de clic 34 px), **switch** 38×22 (el pulgar se estira a 19 px al pulsar; spinner si espera al sync), **segmentado** (Inset con ítem activo Raised + borde Phosphor al 35 %), **pestañas** (subrayado Phosphor con `glow-bar`, contador en Dust), **chip con LED** (LED atenuado al 55 % si no está activo).
- **Tooltip**: Overlay, 13 px, 28 px. Retraso 400 ms la primera vez y 0 ms si hubo otro abierto hace menos de 300 ms. Solo con `hover: hover` y foco de teclado.
- **Slider**: pista 4 px, pulgar 16 px (zona 40 px), burbuja de valor solo al arrastrar, flechas ±1 y Shift ±10.
- **Date picker**: campo escribible + popover; hoy con contorno Phosphor, seleccionado relleno, días con sesiones con punto Tube, futuros deshabilitados.

## Hoja 6: superficies

Panel plano (Panel + Line + radio 8) y tablas con filas de 48 px: hover Raised, seleccionada con tinte y filo Phosphor, foco con outline interior, fila en curso con texto Live (no relleno). Diálogo (Overlay, máx. 480, título Big Shoulders 26, pie con Line; foco en el primer campo). Alert dialog (400 px, el foco empieza en la acción segura, Esc = cancelar, botón Live que nombra la consecuencia). Sheet lateral (330-420 px, borde delantero recto, Delete aparte de Save; en PWA es bottom sheet). Toasts abajo a la derecha sobre Now playing, máx. 4, 5 s (8 s con acción, los errores persisten), pausan con hover o pestaña oculta, filo de 3 px de color. Empty state (arte con escaneo + título + una acción primaria) y skeleton de barras Raised con barrido ámbar.

## Hoja 7: medios

- **Portada** 3:4, radio 4, tamaños xs 42 / s 64 / m 118 / l 120 a 168 (fluida en la rejilla de la biblioteca; TV 240). LED de 9 px a 7 px de la esquina con anillo Cabinet; franja de horas de 20 px (Cabinet al 80 %, Barlow 12) solo en m y l. Hover 180 ms (arte 1.04, sube 2 px, anillo Bone .3, `shadow-lift`), foco Phosphor offset 3, seleccionada con check, sin carátula (placa Raised con trama diagonal, iniciales en Big Shoulders y mando; nunca un tono aleatorio), cargando con barrido.
- **Banner**: pila arte, escaneo, brillo ambiental, protección, texto. `--protect-bottom: linear-gradient(0deg,#101416 0%,rgb(16 20 22/.78) 30%,transparent 66%)` y `--protect-side: linear-gradient(90deg,rgb(16 20 22/.85) 0%,rgb(16 20 22/.5) 38%,transparent 72%)`.
- **Cifra** con unidad pequeña (hero 96, stat 76, page 44, title 28, figure 20).
- **Medidor HLTB**: 1 segmento = 1 h, relleno Phosphor, hora parcial proporcional, marcadores Main / +Extra / 100 % como marcas de 1 px, exceso en Bone al 38 %, cargando con barrido, sin datos con borde discontinuo y "Look up". Compacto en PWA: 18 px.
- **Barras de la semana**: escala = día más largo, los días vacíos conservan un tope de 3 px, hoy en Phosphor con brillo, hover con tooltip; variante compacta para PWA y semana vacía.

## Hojas 8 y 9: movimiento

Curvas y duraciones están en `@theme` más abajo. Reglas: nada pasa de 360 ms, todo lo que entra usa ease-out, las salidas duran ~60 % de la entrada, y los bucles (LED, skeleton) son decorativos.

- **Entrada de pantalla** 240 ms, bloques con opacidad 0→1 y `translateY(8px)→0`, desfase de 40 ms (máx. 6 bloques).
- **Hover de portada** 180 ms in / 120 ms out. **Pulsar** 120 / 160 ms.
- **Now playing** aparece 320 ms con `ease-drawer` (`translateY(100%)→0`), contenido con 200 ms de fundido tras 120 ms, brillo ambiental 600 ms.
- **LED Live** bucle 1.8 s: punto 1→.4→1 (ease-in-out) y anillo `scale 1→2.4` con opacidad .5→0.
- **Temporizador**: los dígitos cambian sin transición (tabulares, sin saltos); al iniciar "se enciende" en 240 ms (Dust→Phosphor, brillo 0→.35); en marcha el brillo respira .22↔.35 cada 3.6 s.
- **Diálogo** 220 ms (`scale .96→1`, centrado; salida 140 ms). **Sheet** 320 ms `ease-drawer` desde la derecha (salida 220 ms). **Scrim** 200-240 ms.
- **Toast** entra 360 ms (`translateY(16px)`), los anteriores suben 300 ms con ease-in-out, sale 200 ms con `translateX(24px)`.
- **Menús/popovers** 150 ms (`scale .97→1`, origen en el disparador). **Tooltip** 125 ms.
- **Foco de TV** 200 ms: escala 1.06, anillo Phosphor 2 px, halo, título con 60 ms de retraso; salida 120 ms.
- **Skeleton** barrido de 1.6 s. **Spinner** 700 ms lineal.

### prefers-reduced-motion

"Menos y más suave", no cero. Se quitan movimiento y escala; se mantienen opacidad y color porque explican el estado. Toda distancia es una variable (`--move-y`, `--move-x`, `--scale-from`, `--scale-hover`) que pasa a `0` / `1`, de modo que los keyframes siguen funcionando como fundidos puros:

```css
@media (prefers-reduced-motion: reduce) {
  :root { --move-y: 0px; --move-x: 0px; --scale-from: 1; --scale-hover: 1; }
}
```

Además: el LED deja de parpadear y conserva su anillo fijo y la palabra "Live"; el temporizador sigue contando pero sin respiración ni encendido; el skeleton queda estático; el spinner pasa a pulso de opacidad de 1.4 s (usa `motion-reduce:animate-[pulse-soft_1.4s_ease-in-out_infinite]`); el foco de TV mantiene anillo y halo sin escala; sheet y toast entran por opacidad (120-160 ms). Nada importante se comunica solo con movimiento.

## Tokens para copiar (`@theme` de Tailwind v4)

Fichero compartido (por ejemplo `packages/ui/theme.css`) importado desde `src/renderer/src/assets/main.css` y `web/src/index.css`.

```css
@import 'tailwindcss';

@theme {
  /* Reset: solo existen los tokens de Fósforo */
  --color-*: initial;
  --shadow-*: initial;
  --radius-*: initial;

  /* Superficies (de más profunda a más alta) */
  --color-inset: #0c1012;
  --color-cabinet: #101416;
  --color-panel: #171d20;
  --color-raised: #1f272b;
  --color-overlay: #242c31;
  --color-raised-hover: #2a343a;
  --color-raised-active: #1a2226;
  --color-selected: #2a2923;

  /* Bordes */
  --color-line: rgb(233 228 216 / 0.09);
  --color-line-strong: rgb(233 228 216 / 0.17);
  --color-line-hover: rgb(233 228 216 / 0.3);
  --color-edge: #707370;

  /* Texto */
  --color-bone: #e9e4d8;
  --color-dust: #8a9496;
  --color-ink: #1a1100;
  --color-ink-live: #1c0605;

  /* Acento y señales */
  --color-phosphor: #ffb347;
  --color-phosphor-hi: #ffc266;
  --color-phosphor-lo: #e39a2e;
  --color-phosphor-tint: rgb(255 179 71 / 0.11);
  --color-tube: #5fd3e0;
  --color-tube-hi: #8ce4ee;
  --color-live: #ff5e57;
  --color-live-hi: #ff756f;
  --color-live-lo: #e5463f;
  --color-success: #9bd67a;
  --color-caution: #e8c468;
  --color-scrim: rgb(8 11 12 / 0.72);

  /* LED de estado */
  --color-st-playing: #ffb347;
  --color-st-beaten: #9bd67a;
  --color-st-backlog: #5fd3e0;
  --color-st-resting: #b9a6ff;
  --color-st-dropped: #8a9496;

  /* Tipografía */
  --font-display: 'Big Shoulders Display', 'Barlow Condensed', sans-serif;
  --font-sans: 'Barlow', system-ui, sans-serif;
  --font-serif: 'Playfair Display', serif; /* solo dentro de portadas generadas */

  --text-hero: 96px;
  --text-hero--line-height: 88px;
  --text-hero--letter-spacing: 0.005em;
  --text-stat: 76px;
  --text-stat--line-height: 72px;
  --text-stat--letter-spacing: 0.005em;
  --text-page: 44px;
  --text-page--line-height: 44px;
  --text-page--letter-spacing: 0.005em;
  --text-title: 28px;
  --text-title--line-height: 30px;
  --text-title--letter-spacing: 0.01em;
  --text-figure: 20px;
  --text-figure--line-height: 20px;
  --text-figure--letter-spacing: 0.02em;
  --text-lead: 16px;
  --text-lead--line-height: 22px;
  --text-body: 14px;
  --text-body--line-height: 20px;
  --text-small: 13px;
  --text-small--line-height: 18px;
  --text-micro: 12px;
  --text-micro--line-height: 16px;

  /* Espaciado: base de 4 px */
  --spacing: 4px;

  /* Radios */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-full: 9999px;

  /* Elevación (solo lo que flota) */
  --shadow-float: inset 0 1px 0 rgb(233 228 216 / 0.06), 0 18px 40px -10px rgb(3 6 7 / 0.8);
  --shadow-modal: inset 0 1px 0 rgb(233 228 216 / 0.06), 0 28px 70px -14px rgb(3 6 7 / 0.9);
  --shadow-lift: 0 10px 20px -8px rgb(3 6 7 / 0.8);
  --shadow-glow-text: 0 0 18px rgb(255 179 71 / 0.35);
  --shadow-glow-bar: 0 0 12px rgb(255 179 71 / 0.6);
  --shadow-glow-halo: 0 0 0 2px #ffb347, 0 0 32px rgb(255 179 71 / 0.45);
  --shadow-focus-field: 0 0 0 3px rgb(255 179 71 / 0.22);

  /* Texturas (se usan con bg-(image:--scan) y compañía) */
  --scan: repeating-linear-gradient(0deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 3px);
  --glow-ambient: radial-gradient(70% 90% at 15% 110%, rgb(255 179 71 / 0.2), transparent 70%);
  --protect-bottom: linear-gradient(0deg, #101416 0%, rgb(16 20 22 / 0.78) 30%, transparent 66%);
  --protect-side: linear-gradient(90deg, rgb(16 20 22 / 0.85) 0%, rgb(16 20 22 / 0.5) 38%, transparent 72%);

  /* Curvas */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);

  /* Duraciones (se usan con duration-(--duration-dialog)) */
  --duration-press: 120ms;
  --duration-tip: 125ms;
  --duration-pop: 150ms;
  --duration-cover: 180ms;
  --duration-dialog: 220ms;
  --duration-screen: 240ms;
  --duration-sheet: 320ms;
  --duration-toast: 360ms;

  /* Animaciones */
  --animate-screen-in: screen-in var(--duration-screen) var(--ease-out) both;
  --animate-pop-in: pop-in var(--duration-pop) var(--ease-out) both;
  --animate-dialog-in: dialog-in var(--duration-dialog) var(--ease-out) both;
  --animate-dialog-out: dialog-out 140ms var(--ease-out) both;
  --animate-sheet-in: sheet-in var(--duration-sheet) var(--ease-drawer) both;
  --animate-sheet-out: sheet-out 220ms var(--ease-drawer) both;
  --animate-toast-in: toast-in var(--duration-toast) var(--ease-out) both;
  --animate-toast-out: toast-out 200ms var(--ease-out) both;
  --animate-np-in: np-in var(--duration-sheet) var(--ease-drawer) both;
  --animate-fade-in: fade-in 160ms var(--ease-out) both;
  --animate-led-live: led-live 1.8s var(--ease-in-out) infinite;
  --animate-led-ring: led-ring 1.8s var(--ease-out) infinite;
  --animate-timer-breathe: timer-breathe 3.6s var(--ease-in-out) infinite;
  --animate-sweep: sweep 1.6s var(--ease-in-out) infinite;
  --animate-spin-fast: spin 700ms linear infinite;
  --animate-pulse-soft: pulse-soft 1.4s var(--ease-in-out) infinite;

  @keyframes screen-in { from { opacity: 0; transform: translateY(var(--move-y, 8px)); } to { opacity: 1; transform: none; } }
  @keyframes pop-in { from { opacity: 0; transform: scale(var(--scale-from, 0.97)); } to { opacity: 1; transform: none; } }
  @keyframes dialog-in { from { opacity: 0; transform: scale(var(--scale-dialog, 0.96)); } to { opacity: 1; transform: none; } }
  @keyframes dialog-out { to { opacity: 0; transform: scale(var(--scale-out, 0.98)); } }
  @keyframes sheet-in { from { opacity: var(--sheet-fade, 1); transform: translateX(var(--sheet-x, 100%)); } to { opacity: 1; transform: none; } }
  @keyframes sheet-out { to { opacity: var(--sheet-fade, 1); transform: translateX(var(--sheet-x, 100%)); } }
  @keyframes toast-in { from { opacity: 0; transform: translateY(var(--move-y-toast, 16px)); } to { opacity: 1; transform: none; } }
  @keyframes toast-out { to { opacity: 0; transform: translateX(var(--move-x-toast, 24px)); } }
  @keyframes np-in { from { opacity: var(--np-fade, 1); transform: translateY(var(--np-y, 100%)); } to { opacity: 1; transform: none; } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes led-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes led-ring { from { opacity: 0.5; transform: scale(1); } to { opacity: 0; transform: scale(2.4); } }
  @keyframes timer-breathe { 0%, 100% { text-shadow: 0 0 18px rgb(255 179 71 / 0.22); } 50% { text-shadow: 0 0 18px rgb(255 179 71 / 0.35); } }
  @keyframes sweep { from { background-position: 100% 0; } to { background-position: 0 0; } }
  @keyframes pulse-soft { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
}

/* Reduced motion: se anula la distancia, se conserva el fundido */
@media (prefers-reduced-motion: reduce) {
  :root {
    --move-y: 0px; --move-y-toast: 0px; --move-x-toast: 0px;
    --scale-from: 1; --scale-dialog: 1; --scale-out: 1; --scale-hover: 1;
    --sheet-x: 0px; --sheet-fade: 0; --np-y: 0px; --np-fade: 0;
  }
}
```

Mapa a las variables de shadcn (`components.json` usa `cssVariables: true`, estilo `base-nova`). Se declara una vez en `:root` y las utilidades de shadcn siguen funcionando:

```css
:root {
  --background: var(--color-cabinet);
  --foreground: var(--color-bone);
  --card: var(--color-panel);
  --card-foreground: var(--color-bone);
  --popover: var(--color-overlay);
  --popover-foreground: var(--color-bone);
  --primary: var(--color-phosphor);
  --primary-foreground: var(--color-ink);
  --secondary: var(--color-raised);
  --secondary-foreground: var(--color-bone);
  --muted: var(--color-raised);
  --muted-foreground: var(--color-dust);
  --accent: var(--color-raised);
  --accent-foreground: var(--color-bone);
  --destructive: var(--color-live);
  --border: var(--color-line);
  --input: var(--color-edge);
  --ring: var(--color-phosphor);
  --radius: 8px;
}
```

Uso en JSX (clases literales para que Tailwind las detecte): `bg-panel border border-line rounded-md`, `text-stat font-display font-bold`, `bg-phosphor text-ink hover:bg-phosphor-hi active:bg-phosphor-lo active:scale-[.97] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor`, `animate-screen-in motion-reduce:animate-fade-in`.

## Correspondencia con `components/ui` actual

| Existente | Cambio en Fósforo |
|---|---|
| `button.tsx` (variantes default/outline/secondary/ghost/destructive/link; radio `lg`) | `default` = primario ámbar; `secondary` = Raised + Line strong; `ghost`; `destructive` pasa de tinte translúcido a **Live sólido** (Stop/Delete); `outline` se retira o se alía a secondary; radio 4; añadir `active:scale-[.97]`, estado `loading` (spinner, mismo ancho) y tamaños 28/34/44 (`icon` 34) |
| `dialog.tsx`, `modal-shell.tsx` | Overlay, borde Line strong, radio 8, `shadow-modal`, `animate-dialog-in`, título `text-title font-display`, pie con Line |
| `alert-dialog.tsx` | 400 px, foco inicial en la acción segura, botón Live con consecuencia nombrada |
| `popover.tsx`, `tooltip.tsx` | Overlay + `shadow-float`, `origin-(--transform-origin)`, 150 / 125 ms, tooltip con retraso 400 ms y 0 ms si hay otro abierto (`delay` + `closeDelay` de Base UI) |
| `calendar.tsx` | Estados de día de la hoja 5 (hoy contorno, seleccionado ámbar, puntos Tube de sesiones) |
| `number-input.tsx` | Input Inset + borde Edge + foco Phosphor |
| `loading-notice.tsx` | Spinner de 700 ms con `motion-reduce` a pulso suave |

**Faltan y hay que añadir** (shadcn/Base UI): `input`, `select`, `checkbox`, `radio-group`, `switch`, `toggle-group` (segmentado), `tabs`, `slider`, `context-menu` y `dropdown-menu`, `command` (Ctrl K), `sheet`, `sonner` o toast propio, `skeleton`, `scroll-area`. Componentes propios de Fósforo: `Cover` (con LED, franja de horas, fallback), `Banner` (con protección), `Figure` (cifra + unidad), `HltbMeter`, `WeekBars`, `StatusChip`.

## Dudas

- **Overlay `#242C31`**: es un paso por encima de Raised y por debajo de lo ideal estético (casi no se distingue de Raised, 1.07:1); la separación la hacen la línea y el filo superior. Si se quiere más contraste visual hay que subir también Dust en Overlay.
- **Bordes de control con Edge `#707370`** son más visibles que las líneas actuales de la 2.0; es el precio de cumplir 1.4.11. Se puede relajar a `Line strong` en controles que van acompañados de etiqueta y relleno propio (botones secundarios ya lo hacen).
- **Caution `#E8C468`** y Phosphor se parecen; por eso Caution solo aparece con triángulo. Si resulta confuso, se puede retirar y dejar avisos en Phosphor.
- **Duraciones y TV**: los 200 ms del foco de TV están pensados para un mando; si el hardware real va justo, bajar a 140 ms y quitar la escala.
- Los componentes shadcn "base-nova" usan `rounded-lg` y `transition-all` por defecto; hay que sustituirlos por transiciones de propiedades concretas (`transition-[background-color,transform]`).
