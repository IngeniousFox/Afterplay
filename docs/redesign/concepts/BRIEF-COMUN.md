# Brief común de los conceptos (Afterplay 2.0)

Afterplay: app de escritorio (Electron) para llevar la biblioteca de juegos de UNA persona:
sesiones cronometradas automáticamente, horas, plan de qué jugar después, notas, partidas
guardadas, logros, varios PCs sincronizados. Más una PWA para el móvil (cronómetro, plan,
consultar). Interfaz en INGLÉS. Es un diario personal de juego, no una tienda.

## Datos de ejemplo (iguales en las tres direcciones, para comparar)
- Biblioteca: 331 juegos. Estados: Playing 5, Beaten 142, Backlog 96, Resting 61, Dropped 27.
- Jugando ahora (sesión en marcha): "Hollow Knight: Silksong", 1h 12m transcurridos, en "Desk PC".
- Otros "Playing": Split Fiction (4h 45m), Clair Obscur: Expedition 33 (38h 10m), Hades II (22h 05m), Balatro (61h 30m).
- Más títulos para rejillas: Outer Wilds, Celeste, Disco Elysium, Hollow Knight, Hades, Tunic, Return of the Obra Dinn,
  Sea of Stars, Cocoon, Pentiment, Inscryption, Dredge, Animal Well, Lies of P, Alan Wake 2, Baldur's Gate 3,
  Cyberpunk 2077, Stardew Valley, Slay the Spire, Ori and the Will of the Wisps, Death Stranding, Elden Ring.
- Plan (el orden importa): 1 Metaphor: ReFantazio, 2 Pentiment, 3 Animal Well, 4 Lies of P, 5 Octopath Traveler II.
- Ficha de ejemplo: "Clair Obscur: Expedition 33" — 38h 10m, 14 sesiones, €49.99 gastado, €1.31/hora, Playing,
  playthrough #1 empezado Oct 3 2026, HLTB Main 30h / +Extra 45h / 100% 62h, instalado en Desk PC y Living room PC,
  géneros RPG, Turn-based; plataforma PC; lanzado 2025. Notas: un par de líneas de texto normal.
- Sesiones de ejemplo: hoy 2 (Silksong 19:40→en marcha; Balatro 13:05→13:50 45m), ayer 3, etc. Cada sesión tiene
  dispositivo ("Desk PC", "Living room PC", "Phone timer").
- Semana: 14h 20m en 9 sesiones.
- Sync: 3 dispositivos (Desk PC — this PC, Living room PC, Phone). Estado "Up to date".

## Portadas
NO uses arte real ni imágenes externas. Genera las portadas con CSS: degradados, formas geométricas,
texturas sencillas y el título con una tipografía que encaje con el juego. Cada juego con su color propio y
reconocible entre pantallas (Silksong carmesí/hueso, Expedition 33 oro/tinta, Hades II verde jade/negro,
Balatro rojo/azul, Split Fiction azul/naranja, etc.). Proporción 3:4 (portada) y 16:9 (banner).
Que se vean cuidadas, no cajas planas con texto.

## Reglas de diseño
- Nada de "eyebrows" en MAYÚSCULAS con tracking encima de cada título; nada de numeración decorativa
  (solo donde hay orden real: el plan). Nada de "→" pegado al texto de los botones. Sentence case.
- Texto mínimo 12px en escritorio, 13px en móvil; contraste AA. No trunques textos informativos.
- Un único momento llamativo por pantalla; el resto, sobrio.
- Iconos: trazos sencillos y coherentes (puedes dibujar SVG inline propios).
- Las pantallas deben parecer una app de escritorio real (ventana 1600×1000, sin barra de navegador),
  con controles creíbles.

## Entregables por dirección (carpeta propia)
HTML autocontenido por pantalla (puedes compartir un styles.css dentro de tu carpeta y cargar
Google Fonts) y su PNG renderizado:
1. home.png — Home (pantalla de inicio NUEVA en el escritorio) 1600×1000
2. library.png — Library 1600×1000
3. detail.png — ficha de juego (Expedition 33) 1600×1000
4. sessions.png — Sessions 1600×1000
5. plan.png — Plan 1600×1000
6. settings.png — Ajustes, sección Sync con la lista de dispositivos 1600×1000
7. tv.png — modo TV (Big Picture, mando, 10 pies) 1920×1080
8. pwa.png — 4 pantallas de móvil (Home, Library, ficha, Plan) en marcos de teléfono sobrios, 1920×1100

Render: escribe `render.mjs` en tu carpeta que use
`import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs'`
(o la ruta que funcione de ese paquete), abra cada HTML con file://, espere `document.fonts.ready`
y networkidle, y guarde el PNG con deviceScaleFactor 1. Ejecútalo con `node render.mjs`.
Mira TÚ cada PNG con la herramienta Read y corrige lo que falle (solapes, texto cortado, fuentes que no cargan)
antes de terminar.

Además, un `README.md` corto en español: nombre de la dirección, idea en 2 frases, paleta (hex con nombre y uso),
tipografías y rol, y para cada pantalla (Home, Library, ficha, Plan, Sessions, Ajustes, TV, PWA) 1–2 frases
de cómo cambia la ESTRUCTURA respecto a la app actual.

## App actual (para el README)
Escritorio: rail de iconos a la izquierda + columna fija con la lista de juegos (buscador, "Playing & on hold",
"All games") + panel de contenido. Fondo casi negro #0a0b0a, acento verde #2fdc7e, fuente del sistema.
No hay Home: se entra en Library (rejilla de portadas). Ficha: banner arriba, fila de botones, 4 tarjetas de
métricas, notas, capturas, columna derecha con HLTB y playthrough. Sessions: lista agrupada por semana con
tarjetas grandes. Plan: rejilla de portadas. Ajustes: modal. PWA: mismos colores, barra de pestañas abajo
(Home, Library, Plan, Sessions), Home con 4 tiles de cifras y sesiones recientes.

## Prohibido
Tocar nada fuera de tu carpeta. Nada de git (ni add ni commit). No abras %APPDATA%. No instales paquetes.
