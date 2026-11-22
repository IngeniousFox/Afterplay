# Fósforo: Stats (prefijo `stats`)

Cubre las tres vistas de la sección: Stats global (Overview), Stats de un juego y Journey. Se genera con `node render-stats.mjs` (ejecuta `build-stats.mjs`, que importa `build-stats-2.mjs` y `stats-charts.mjs`; estilos en `stats.css`, que se carga después de `styles.css`).

## Capturas (9 PNG)
La página global es una sola página con scroll; cada PNG es una posición de scroll de la misma maqueta, cortada entre bloques para que ningún panel quede partido. Con 15 gráficas a 1600×1000 salen 5; la ficha de juego, 3.

| PNG | Qué enseña |
|---|---|
| `stats-overview.png` | Cabecera fija, cifra protagonista, récords, mapa de calor con tooltip |
| `stats-rhythm.png` | Horas y gasto por mes (tooltip), racha, día de la semana, hora del día, duración de sesiones |
| `stats-library.png` | Más jugados, géneros (radar), estados, completados, edad de los juegos |
| `stats-pace.png` | Tú contra HowLongToBeat, flujo del backlog y movimiento |
| `stats-cabinet.png` | Deuda del backlog, logros destacados, insignias |
| `stats-game.png` | Stats de un juego: banner, cifras, recorrido |
| `stats-game-signature.png` | Tu juego frente a la biblioteca, récords, vitrina, HLTB |
| `stats-game-rhythm.png` | Hora del día, día de la semana y actividad del juego |
| `stats-journey.png` | Journey: año, historia, noviembre en curso con el aviso, hover de carátula, toast |

## Stats global
- **Cabecera fija (68 px)** con "Stats" en Big Shoulders, conmutador Overview / Journey y selector de rango: "All time", los años con actividad como pestañas y "More years" para el resto. Seguir fija al hacer scroll mantiene a la vista qué rango se está leyendo. La pestaña activa lleva fondo Raised y subrayado Phosphor.
- **Hero (el único momento llamativo):** la cifra del total, "4,386h 20m", en Big Shoulders 164 px ámbar con brillo, sobre una zona con líneas de escaneo y el banner del juego líder al 28 % desvanecido a la derecha. Debajo, el titular ("Stardew Valley leads your archive."), la línea de apoyo y tres cifras secundarias sin caja (juegos, gasto, coste por hora). A la derecha, la tarjeta del juego líder (portada, horas, anillo con su porcentaje) y una lista de récords (sesión más larga, día más caliente, mes pico, finish line). Con un año elegido, bajo cada cifra secundaria va la comparación con el año anterior (icono de tendencia + "12h more than 2025"), igual que hoy; se omite si ese año no tiene actividad.
- **Capítulos:** se mantienen los cinco de hoy ("How the time moved", "The games that defined it", "How you actually play", "What entered, what left, what waits", "The cabinet"), con el título en Big Shoulders 32 px y la descripción en Dust al lado. Sin numeración ni eyebrows. Los bloques alternan de densidad: panel ancho, trío de paneles, filas abiertas sin caja.
- **Actividad:** 52 semanas × 7 días, celdas de 23 px con rampa de ámbar (5 niveles). Tooltip al pasar: fecha, horas en Big Shoulders ámbar, sesiones y desglose por juego (aquí el color SÍ es de juego, porque la serie es el juego). La celda bajo el ratón lleva aro Bone. La leyenda va en la cabecera del panel.
- **Horas y gasto por mes:** barras ámbar (horas, eje izquierdo) y línea Tube con puntos (euros, eje derecho), 12 meses; el mes en curso, a media opacidad y con asterisco. Hover sobre un mes: línea guía y tooltip con las dos series.
- **Racha:** número grande ámbar, 61 marcas (récord) de las que se rellenan las de la racha actual. No es una meta: solo da escala.
- **Día de la semana / hora del día:** barras ámbar, la mejor a opacidad total y con valor en Bone. La hora del día lleva 24 barras y corchetes por franja (Night, Morning, Afternoon, Evening) con su porcentaje; la franja dominante en negrita.
- **Duración de sesiones:** 5 tramos, el más frecuente resaltado; mediana, porcentaje bajo una hora y sesión más larga debajo.
- **Más jugados:** lista con rango real (ahí sí hay orden), portada, barra en el color del juego y horas. Es un top de 7 con enlace "Show 10". Clic en la fila abre la ficha.
- **Estados:** barra apilada y filas con LED, recuento y porcentaje. Con un año elegido pasa a "Status changes" (transiciones started, completed, dropped, put on hold) y la nota lo explica. Unplayed solo aparece en All time y no se dibuja en la maqueta (el brief de ejemplo suma 331 con cinco estados).
- **Géneros (radar):** 6 ejes (RPG, Action, Adventure, Strategy, Sim, Puzzle), polígono ámbar al 20 % con borde ámbar; cada eje lleva nombre y horas. Hover sobre un eje: vértice resaltado y el centro pasa a "Inspecting" como hoy.
- **Completados:** 8 portadas con LED verde y fecha; "Show all" para el resto.
- **Edad de los juegos:** anillo de 4 tramos en rampa ámbar (más brillante = más reciente), edad mediana en el centro y leyenda con horas y porcentaje.
- **Tú contra HLTB:** barra ámbar con el tiempo propio contra la marca Tube del Main Story al 50 % de la pista (el eje llega a 2×); a la derecha, "41h vs 24h" y "71 % beyond Main Story". Al lado, la mediana en grande y el reparto más rápido / igual / más lento.
- **Flujo del backlog:** tres líneas (Added to library en ámbar, Plan to play en Tube, Completed en el verde del estado Beaten) con etiqueta directa al final de cada serie. Al lado, "Backlog movement": horas que entraron frente a horas que salieron y el balance, con el aviso de que es información, no culpa.
- **Deuda del backlog:** juegos pendientes, horas estimadas, ritmo reciente y horizonte ("August 2029"); curva de horas restantes con marcas de mitad y final. Si no hay ritmo suficiente, el horizonte dice "Not enough signal".
- **Logros destacados:** número grande con el reparto de rareza (Common en gris, Rare en Tube, Ultra rare en ámbar), Hall of fame, Perfect games, Almost there y Harvest by year. "Unlocks by month" y "Where you hunted" siguen existiendo en la app, pero NO están dibujados en la maqueta por espacio: irían como dos bloques más al pie de este mismo panel.
- **Insignias (propuesta nueva):** la app global no las tiene hoy (viven por juego). Propongo un resumen: las 9 insignias personales con cuántos juegos las ganaron. El criterio va en el tooltip.

## Stats de un juego (Expedition 33)
- Cabecera fija con migas "Overview > nombre" y los botones "All games" y "Open game" (el primario, ámbar).
- Banner de 244 px a sangre con el título enorme, estado, géneros, plataforma, y a la derecha el puesto en la biblioteca ("#19" en ámbar) con su porcentaje de horas.
- Horas totales en 124 px ámbar y a su lado, sin cajas, sesiones (con la media), coste por hora y gasto.
- **Your journey:** chips del ciclo (Added to Plan, Added to Afterplay, Started, tiempo de espera, última vez que se jugó) y una curva en escalones de horas acumuladas contra la línea Tube del Main de HLTB, con hitos (10 h, 25 h, "Passed the Main estimate"). Debajo, "Every run": una fila por partida (hoy solo una).
- **Versus your library:** anillo con el porcentaje, puesto y tres frases comparativas con la cifra clave en ámbar. **Session records:** 6 récords en rejilla de 2 columnas (media, más larga, mejor día, racha, días jugados, mes más cargado).
- **Trophy cabinet:** 9 insignias. Ganadas: medallón ámbar con brillo y barra llena. Bloqueadas: medallón discontinuo gris, el progreso actual como cifra y una barra parcial (así se ve cuánto falta sin pasar el ratón); el criterio siempre visible.
- **How long to beat:** medidor de 62 segmentos (uno por hora del 100 %) con marcador "You" y marcas Main (Tube), +Extra y 100 %; las tres diferencias en el subtítulo.
- **Play rhythm:** hora del día y día de la semana en barras, y actividad del juego con su propio selector de año. En esta pantalla todas las series son el juego, así que usan su color (oro de Expedition 33) en vez del ámbar de sistema; el ámbar queda para cifras y selección.

## Journey
- Cabecera fija con las tres cifras globales (juegos jugados, horas, sesiones) a la derecha.
- Línea temporal vertical con nodo por mes (el color del nodo es el estado de su protagonista), año como hito (2026 en 84 px) y a la derecha un índice fijo de años y meses sincronizado con el scroll (clic salta; el actual lleva barra ámbar).
- **Historia del año** como panel con lomo ámbar y titular en Big Shoulders; el mes tiene su historia más corta.
- **Aviso "Your month is counted"** (pieza nueva): en el mes abierto, banda Tube con campana: "Your month is counted. November is still open, and its story is written on Dec 1." Mi interpretación: el mes en curso ya suma sus horas y su historia se genera al cerrarse. Si el aviso debía ser otra cosa, solo cambia el texto y la ubicación (arriba del mes).
- El protagonista del mes es una tarjeta ancha con su banner, cifras y estado; el resto, carátulas con LED, insignia de rejugada ("2") y horas.
- **Hover de carátula:** panel flotante sobre la carátula (banner, fechas, horas, sesiones, rastro de puntos de sesiones y última nota). Se abre también con foco de teclado y se coloca arriba si abajo no cabe.
- **Toast** "Your October story is ready" abajo a la derecha; al pulsarlo salta al mes. Dura 12 s.

## Decisiones visuales
- Cifras en Big Shoulders, UI en Barlow, ámbar para la serie principal y la cifra clave, Tube para la serie secundaria (euros, línea HLTB, estimaciones) y colores de juego solo cuando la serie es un juego (más jugados, desglose del tooltip, página de un juego).
- Todos los SVG a escala 1:1 (sin viewBox escalado): texto mínimo 12,5 px en ejes y etiquetas, 13 px en valores.
- Sin eyebrows en mayúsculas ni numeración decorativa; las únicas cifras de orden son las del top de más jugados.
- Hover: filas y barras elevan a Raised y se resalta la serie; foco con borde Phosphor; tooltips siguen al cursor y se acotan al panel. Entrada: barras crecen desde la base y los contadores suben (200-600 ms); con reduced motion, sin animación.
- Al cambiar de rango se vuelve a montar la página (cascada de entrada y contadores otra vez).

## Ficheros
`build-stats.mjs`, `build-stats-2.mjs`, `stats-charts.mjs`, `stats.css`, `render-stats.mjs` y los `stats-*.html/.png`.
