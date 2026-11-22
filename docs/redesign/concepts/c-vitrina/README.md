# Dirección C: "Vitrina"

**Idea.** Las portadas mandan. La interfaz es neutra (pizarra oscura, cristal suave) y el color lo pone el juego que miras: cada pantalla toma su acento del arte del juego destacado, como un reproductor que se tiñe con el disco. El acento tiñe solo el botón principal, los gráficos y el resplandor del fondo de esa pantalla.

## Paleta
- Slate `#15171C`: fondo. Deep `#0E1014`: zonas bajo el arte.
- Surface `rgba(255,255,255,.06)`, Surface-2 `.10`, Line `.10`: paneles, controles, bordes.
- Text `#F4F4F6`; Muted `#A3A5AE` (contraste ~7:1 sobre Slate).
- Glacier `#8FD3FF`: acento por defecto (Sessions, Ajustes, estado Playing).
- Acentos por juego: Silksong `#D2423B`, Expedition 33 `#D9A441`, Hades II `#3FBF8F`, Metaphor `#B48AF0` (derivado, no estaba en el brief).
- Estados fijos: Playing `#8FD3FF`, Beaten `#9ED98B`, Backlog `#C9B57A`, Resting `#A3A5AE`, Dropped `#E07A7A`.

## Tipografías
- **Bricolage Grotesque** (display, eje de anchura 90 y peso 700): títulos de pantalla y de juego, cifras grandes.
- **Hanken Grotesk**: toda la UI, con cifras tabulares.
- Solo dentro de las portadas generadas: Cinzel, Cormorant Garamond, Bowlby One, Archivo Black.

## Estructura por pantalla (frente a la app actual)
- **Home** (nueva): héroe a todo el ancho con el juego en marcha, título enorme, tiempo, "Stop" y "Add note" teñidos de carmesí. Debajo, carrusel "Continue", panel "This week" y estante "From your plan". Desaparecen el rail y la columna de juegos; la barra superior flotante con píldora de secciones los sustituye.
- **Library**: de rejilla única a estantes por estado (Playing, Backlog, Beaten...) con "See all"; chips de filtro arriba. El fondo ambiente se tiñe con la portada bajo el cursor (Hades II, levantada). Al filtrar pasaría a rejilla completa.
- **Ficha**: banner de ~55% de la altura, portada flotante superpuesta, título grande y botón "Play" pill en oro. El contenido pasa de 4 tarjetas + columna derecha a paneles translúcidos en tres columnas: cifras, HLTB con marcador, playthrough, instalado en, notas y tira de capturas.
- **Sessions**: arriba un calendario-mapa de calor del mes (cada día con el color y la miniatura del juego más jugado); debajo, lista por día con miniatura apaisada, nota, dispositivo y duración. Sustituye la lista por semanas con tarjetas grandes.
- **Plan**: de rejilla de portadas a tres columnas Next / Soon / Someday. El nº 1 de Next es una tarjeta grande con HLTB y "Start playing"; el orden de Next y Soon va numerado (1 a 5).
- **Ajustes**: de modal a hoja centrada sobre fondo desenfocado, con navegación de secciones a la izquierda. Sync muestra los dispositivos como tarjetas con un dibujo de cada tipo, "This PC" destacado y "Add device".
- **TV**: héroe del juego enfocado con fondo teñido, fila de portadas que se agrandan con foco y barra de ayudas del mando.
- **PWA**: Home teñida por el juego en marcha con cronómetro grande; Library en 3 columnas; ficha inmersiva; Plan en lista con el nº 1 grande. Barra de pestañas inferior translúcida.

## Ficheros
`home|library|detail|sessions|plan|settings|tv|pwa` en `.html` y `.png`; `styles.css` (tokens y portadas CSS), `lib.mjs` y `screens-*.mjs` (generadores), `build.mjs` (escribe los HTML) y `render.mjs` (renderiza los PNG).
Regenerar: `node build.mjs && node render.mjs`.

## Notas
- En el mapa de calor, Balatro usa su azul `#5B7CFF` para no confundirse con el carmesí de Silksong.
- Las fuentes se cargan desde Google Fonts: hace falta red al renderizar.
