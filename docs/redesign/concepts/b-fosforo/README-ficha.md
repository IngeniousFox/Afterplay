# Fósforo: ficha de juego y modales (prefijo `ficha`)

Ficheros: `build-ficha.mjs` (genera los HTML), `ficha.css` (estilos, se carga después de `styles.css`), `render-ficha.mjs` (captura los PNG: `node render-ficha.mjs`). Todo a 1600×1000. Juego de ejemplo: Expedition 33. Los modales de Add game se montan sobre `library.html` (se lee al construir) y Edit game y Restore sobre la ficha, todo atenuado.

## Decisiones comunes de la ficha
- **Cabecera compacta.** En Overview la cabecera mide 360 px (como `detail.png`). En el resto de pestañas es una banda de 104 px, como si la página se hubiera desplazado: título a 46 px, estado, botones y las cuatro utilidades. Al implementarlo, que sea sticky y se encoja con el scroll.
- **Utilidades del juego** (cambiar carátula/banner, abrir carpeta de instalación, refrescar datos, borrar): botones de icono. En la cabecera grande van arriba a la derecha sobre el banner; en la compacta, a la derecha tras un separador. Borrar se tiñe de Live al pasar el ratón. "Abrir carpeta" se deshabilita sin instalación.
- **Dispositivo.** Siempre icono pequeño + nombre; "This PC" como etiqueta gris. Phone timer usa el icono de teléfono.
- **Punto de atención en la pestaña Saves** (círculo con brillo) cuando el estado pide acción: ámbar = cambios sin copiar, Tube = por detrás o disponible, Live = divergido.

## ficha-sin-instalacion.png
Overview en un PC sin instalación. Play queda deshabilitado (gris, sin hover) y a su lado la acción "Link installation" en ámbar (contorno + fondo tenue), que abre el selector de ejecutable. La cabecera lo dice con un aviso ámbar junto al año ("Not installed on this PC"). En "Installed on": este PC en rojo-ámbar "Not installed on this PC", botón "Link installation" a ancho completo (con tooltip) y el otro PC con ruta y tamaño.

## ficha-otro-pc.png
Juego en marcha en Living room PC. El hueco de Play lo ocupa una píldora no interactiva con pulso rojo, "Playing on Living room PC" y el cronómetro en Big Shoulders; no hay Stop en ninguna parte. En Recent sessions aparece arriba una fila viva (banda roja a la izquierda, "Playing now"). El pie muestra dos sesiones apiladas: la local primero (con Stop) y la remota después, separada por una línea, sin Stop y con la nota "Stop it from that PC". Sin señal más de 3 min se escribiría "No signal for X" en la misma línea, en gris.

## ficha-avisos.png
- "Looks like the same game as …": franja a todo el ancho entre banner y pestañas, con barra Tube a la izquierda, motivo (mismo IGDB id, origen y qué se mueve), carátula del duplicado, botón Merge y X para descartar.
- "Two playthroughs are in progress": dentro de la tarjeta Playthrough, con paginador "2 of 2" y aviso ámbar con "Merge into Playthrough #1". El diálogo de confirmación es el actual (AlertDialog) y no se ha maquetado.

## ficha-sesiones.png
Izquierda: cabecera del playthrough (nombre, inicio, "still going", horas, sesiones, media) y sesiones agrupadas por semana, la más nueva arriba; el total de la semana va en la columna izquierda. Cada fila: día, horas, duración (Big Shoulders), dispositivo y una columna de marcas. Marcas discretas en gris 12,5 px: "Closed automatically" (icono de cronómetro; tooltip: lo cerró Afterplay al perder la señal y la hora final es la última vista), "Added by hand" (sin dispositivo, como las migradas de la 1.x), logros de la noche (icono de trofeo en Tube). La sesión con nota la muestra debajo, con icono de nota, a todo el ancho. Con varios playthroughs se repite el bloque por playthrough, el actual abierto y los anteriores plegados. Derecha: tiempo por dispositivo (barras) y el History (estado, gasto, plan) con editar y borrar al pasar el ratón.

## ficha-logros.png
Cifra "38/52" grande (el 38 en ámbar), barra de 52 segmentos, fuente (Steam) y última comprobación. La pieza más rara, grande y con brillo ámbar si es ultra rara (<1 %), más dos "Also rare" a la derecha. Debajo: buscador, filtros (All, Unlocked, Locked, Rare) y refrescar. Dos columnas: Unlocked y Locked, con icono por logro, descripción, porcentaje (ámbar ultra rara, Tube rara, blanco el resto) con nombre de la rareza, y fecha. Los ocultos muestran "Hidden achievement" y se revelan al hacer clic. "Show N more" despliega.

## ficha-saves.png y ficha-saves-estados.png
Arriba, un bloque de estado único con la misma forma siempre: icono en círculo del color del estado, frase, PC y antigüedad, y la acción principal (ámbar) más una secundaria. Colores: al día verde, cambios sin copiar ámbar, por detrás y disponible Tube, divergido Live, "no sé decir" gris. La hoja de estados muestra los siete casos de §12.4 (los dos divergidos y el informativo de 1.x). Debajo, lista de versiones con un grafo de linaje a la izquierda: un carril por dispositivo (ámbar Desk PC, Tube Living room PC), nodos con aro en las puntas ("Latest") y líneas que unen cada versión con la que continúa; texto "Continues Desk PC, Nov 20 22:14" o "No lineage: made before 2.0". Restore destacado (contorno ámbar) en las puntas y discreto en el resto. Derecha: Cloud backup (interruptor, Back up now), dónde guarda en este PC (detectado y propio, aviso de ID de Steam, añadir carpeta/archivo, reset de detección) y destino de restauración.

## ficha-notas.png
Editor de notas enriquecidas a la izquierda con la barra de herramientas actual (negrita, cursiva, tachado, código, H1 a H3, listas, cita, bloque de código, enlace, separador, deshacer, rehacer); el botón activo lleva fondo oscuro y borde ámbar; "Saved" en verde. Estilos: viñetas ámbar, cita con barra ámbar, enlaces Tube. Derecha: carrusel de capturas (primera diapositiva, tráiler; 16:9, flechas redondas, miniaturas con borde ámbar en la activa) y las notas de sesión.

## ficha-add-buscar.png
Modal sobre Library. Conmutador "Search the catalog / Scan your folders", campo de búsqueda con foco ámbar y resultados de IGDB: carátula, título, año en Big Shoulders y plataformas como etiquetas. Estados de fila: "In your library" (apagada, no seleccionable), "In your plan, pick it to move it into your library" (Tube) y fila con foco de teclado (fondo elevado, barra ámbar, "↵ Pick"). Pie con la ayuda de teclado.

## ficha-add-escanear.png
Mismo modal en modo "Scan your folders": carpetas vigiladas (con quitar), Add another, Rescan y la nota de que cada subcarpeta es un juego. Resultados en grupos con casillas: New to your library (coincidencia de IGDB, ruta, tamaño, exe y "N other matches"), In your plan and installed here (mover a la biblioteca), Already in your library, not installed on this PC (vincular, marcado por defecto, "Link installation") y Not matched (buscador propio). Los ya vinculados quedan plegados. El pie resume la selección y el botón dice "Add 4 and link 2".

## ficha-editar.png
Dos columnas. Izquierda: Game info (título, desarrollador, distribuidora, géneros, fecha, Steam App ID), Cover and banner y Playthrough. Derecha: Launch and install con la etiqueta "On this PC", "Find in my game folders", carpeta y ejecutable de este PC (cada campo rotulado "Desk PC") y la nota de que los otros PCs conservan sus rutas; Game type y Notes. Los valores fijados a mano llevan un punto ámbar, "Set by hand" y el enlace "Reset to automatic" (publisher, géneros, carátula); lo automático se marca con "Chosen automatically".

## ficha-restaurar.png
Diálogo en dos pasos, aquí ya en el segundo (plan visible). Aviso Tube de linaje (qué versión continúa), tres modos como tarjetas (el destructivo "Where it belongs" teñido de Live con su botón final rojo "Restore for real"; los otros dos neutros), la casilla "Leave the save folder exactly as in this version" desmarcada, nota de copia de seguridad previa y el plan: carpeta destino, totales y archivos plegables.

## Interacción común
Foco: anillo ámbar de 3 px en campos; hover de filas con fondo Raised; el modal entra con un fundido de 150 ms y el fondo se atenúa al 76 % con 2 px de desenfoque; Esc cierra. Respetar reduced motion.
