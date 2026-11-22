# Dirección A: Bitácora (oscura)

El diario de juego como un cuaderno técnico bien editado: nocturno, frío y tranquilo, con bordes finos en lugar de sombras y datos (horas, fechas, sesiones) que se leen como un registro limpio. Rompe con el negro + verde actual; el único momento llamativo de cada pantalla es el naranja Signal.

## Paleta (solo modo oscuro; la app no tiene modo claro)
| Nombre | Hex | Uso |
|---|---|---|
| Night | #0F151C | Fondo de la ventana |
| Night sheet | #17202A | Paneles y superficies planas |
| Raised | #1E2935 | Elemento activo, hover y elevado |
| Hairline | rgba(230,234,238,.10) | Bordes finos (sustituyen a las sombras) |
| Texto | #E6EAEE | Texto principal (15:1 sobre Night) |
| Texto secundario | #8D99A6 | Metadatos (AA: 6:1 sobre Night, 5,4:1 sobre Night sheet) |
| Signal | #F0643F | Play, sesión en marcha, foco, punto de portada |
| Moss | #4FA37B | Completado / Beaten, sync correcto |
| Slate blue | #7C9CC6 | Backlog / información, estado Playing |

Notas: el texto del botón Play va en Night sobre Signal (6:1). Los botones secundarios son contornos finos, sin relleno llamativo; el carácter de cuaderno editorial se mantiene con superficies planas, bordes de 1px y mucho aire.

## Tipografías
- Instrument Serif: títulos de pantalla, fecha, nombres de juego grandes, números del plan.
- Geist: toda la UI, con `tabular-nums` en cifras.
- Las portadas (arte CSS) usan fuentes propias por juego (Cinzel, Bebas Neue, etc.) solo dentro de la portada.

## Estructura por pantalla (respecto a la app actual)
- **Home (Today)**: pantalla nueva y portada de entrada; fecha grande en serif, bloque "Now playing" con temporizador, nota y Stop, semana en 7 barras finas, "Pick up where you left off" y "Up next" numerado. Antes se entraba directo en la rejilla de Library.
- **Library**: desaparece la columna fija de lista de juegos; queda una barra de herramientas (buscador, estados con recuentos, orden, rejilla/lista) y una rejilla de 8 columnas con título y horas debajo de la portada.
- **Ficha**: cabecera tipo artículo (portada a la izquierda, título serif de 56px, metadatos y acciones) en lugar de banner + botones + 4 tarjetas. Columna principal con notas como texto, playthrough como registro vertical y últimas sesiones; lateral con "Facts" como lista de definiciones y HLTB como regla con posición actual.
- **Sessions**: libro de registro agrupado por día (día en serif a la izquierda), una fila por sesión con barra de duración proporcional; el resumen semanal es una sola línea en vez de 4 tarjetas.
- **Plan**: lista ordenada con asas; el nº 1 es una ficha "Up next" grande con "Start playing", el resto filas finas numeradas, y "Someday" como pila sin orden a la derecha (en lugar de una rejilla de portadas).
- **Ajustes**: página completa (no modal) con lista de secciones a la izquierda; Sync muestra estado del hub, "Sync now", lista de dispositivos con "This PC" destacado y código de emparejado.
- **TV**: título serif enorme sobre el banner, una única estantería horizontal con foco Signal muy visible y pistas de mando abajo; sin barras laterales.
- **PWA**: misma identidad oscura con barra de pestañas (Today, Library, Plan, Sessions); Today prioriza la tarjeta del cronómetro, Library es lista con portadas, la ficha y el Plan reutilizan la lista de definiciones y la regla HLTB en vertical.

## Ficheros
`build.mjs` y `build2.mjs` generan los HTML a partir de `lib.mjs` (datos, iconos y portadas CSS) y `styles.css`; `render.mjs` los pasa a PNG (`node build.mjs && node build2.mjs && node render.mjs`).
