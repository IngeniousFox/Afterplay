# Dirección B: "Fósforo"

Idea: el calor de una recreativa y de un monitor CRT, pero adulto y sobrio. Fondo oscuro con tinte petróleo, un único acento ámbar de fósforo y cifras enormes en tipografía condensada, como un cuadro de mandos de juego. La textura (líneas de escaneo al 3-4 % y un leve brillo ámbar) solo aparece en las zonas héroe: banners y "Now playing". El resto es plano.

## Paleta
| Nombre | Hex | Uso |
|---|---|---|
| Cabinet | `#101416` | fondo |
| Panel | `#171D20` | superficies |
| Raised | `#1F272B` | elevadas, hover, selección |
| Line | `rgba(233,228,216,.09)` | bordes |
| Bone | `#E9E4D8` | texto principal |
| Dust | `#8A9496` | texto secundario (AA sobre Cabinet, Panel y Raised) |
| Phosphor | `#FFB347` | acento: foco, selección, Play, cifras clave |
| Tube | `#5FD3E0` | sync, información, enlaces |
| Live | `#FF5E57` | sesión en marcha, Stop |
| Estados | Playing `#FFB347`, Beaten `#9BD67A`, Backlog `#5FD3E0`, Resting `#B9A6FF`, Dropped `#8A9496` | LED de estado |

## Tipografía
- Big Shoulders Display (600-800): cifras grandes, títulos de pantalla y de juego, temporizador.
- Barlow (400-600): toda la UI; cifras tabulares.
- Playfair Display solo dentro de portadas generadas (Clair Obscur, Pentiment, etc.).

Radios: 4 px en controles, 8 px en paneles.

## Pantallas (cambio de estructura)
- **Home** (nueva): "Tonight". Tarjeta "Continue" con banner y cronómetro, tira de cifras de la semana con mini gráfico por día, y tres estanterías (Playing, Up next numerada, Recently beaten). Sustituye a entrar directamente en la biblioteca.
- **Library**: desaparece la columna fija de juegos y el rail. Panel de filtros a la izquierda (estados con recuentos, plataformas, "Installed on this PC", orden) y rejilla densa de 8 portadas con LED de estado y franja de horas. Cabecera con "331" en numerales grandes.
- **Ficha**: banner a sangre de 360 px con el título enorme abajo y Play/Edit/Add spend; una tira de pestañas parte la página larga. Overview: cuatro cifras en fila sin cajas, notas y sesiones recientes a la izquierda; HLTB como medidor segmentado, playthrough e "Installed on" a la derecha, sin tarjetas.
- **Plan**: el nº 1 es una tarjeta grande "Next up" sobre banner; el resto, una cola tipo lista de reproducción (asa, nº, portada, HLTB Main, fecha, acciones) con un panel lateral para añadir desde la biblioteca. Ya no es una rejilla.
- **Sessions**: arriba una cinta semanal (7 filas con eje de 24 h, cada sesión es un bloque del color de su juego, marcador de "ahora"); debajo, tabla compacta con fecha, juego, horario, duración, dispositivo y nota. Sustituye a las tarjetas agrupadas.
- **Ajustes**: página completa con navegación lateral, no modal. Sync: estado grande con "Sync now", tabla de dispositivos (This PC destacado), actividad reciente y "Add device" con el código en Big Shoulders.
- **TV**: misma estética a 10 pies; hero con el juego en marcha, estanterías horizontales, foco con borde Phosphor y halo (título solo en el elegido) y pistas de mando abajo.
- **PWA**: mini-reproductor con el cronómetro sobre la barra de pestañas inferior en todas las pantallas. Home con bloque de cifras y Continue; Library en lista con chips de estado; ficha con banner y cifras; Plan como cola con "Next up".

Navegación de escritorio: barra superior de 56 px (logotipo, pestañas, buscador con Ctrl K, LED de sync, ajustes) y "Now playing" acoplado abajo en 72 px, visible en todas las pantallas.

## Ficheros
`build.mjs` genera los HTML (datos y componentes compartidos), `styles.css` es la hoja común y `render.mjs` ejecuta el build y renderiza los PNG: `node render.mjs` (o `node render.mjs home tv` para algunos).
