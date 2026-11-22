# Fósforo: estados globales, ajustes, migración, overlay y ambiente

Prefijo `estados`. Generación: `node render-estados.mjs` (o `node render-estados.mjs sync avisos` para algunas). Ficheros: `build-estados.mjs`, `estados.css` (se carga después de `styles.css`), `render-estados.mjs` y 19 PNG `estados-*.png` a 1600×1000. Los juegos extra (Super Metroid, Metroid Dread, etc.) se definen en `build-estados.mjs`, sin tocar `build.mjs`.

Reglas comunes de todos los estados: rojo (`--live`) solo para sesión en marcha, Stop y error; ámbar solo para acción principal, "pendiente" y cifras clave; cian (`--tube`) para sync e información; gris (`--dust`) para "apagado". Texto mínimo 12 px. Foco visible: borde Phosphor con halo de 3 px. Con `prefers-reduced-motion` no hay giro ni shimmer ni deslizamiento.

## 1. `estados-nowplaying.png` (variantes de la barra)
Seis filas con la misma barra de 72 px.
- **Aquí**: pulso rojo, cronómetro Phosphor, Stop y Add note. Portada y título abren el juego (el hover sube la portada 2 px, como hoy).
- **Otro PC**: el pulso rojo se cambia por un anillo cian hueco y "on Living room PC" en cian con icono de PC. Sin Stop; en su lugar un texto con candado "Only Living room PC can stop this session". Add note se mantiene.
- **Dos sesiones**: la local conserva la barra entera arriba; la remota baja a una tira de 40 px debajo (portada de 22 px, "Also playing", nombre, PC, cronómetro de 24 px, Open game). El dock pasa a 112 px. Con 3 o más, la tira dice "+1 more". Al aparecer/desaparecer la tira, animación de 240 ms `cubic-bezier(.16,1,.3,1)`.
- **Sin señal 4 min**: todo en gris (portada al 50 % y desaturada, cronómetro sin brillo, anillo gris). Texto "no signal for 4 min" con triángulo (el icono lleva el significado, no solo el color) y la frase "Last heard at 20:48. It closes by itself…". El cronómetro sigue contando. Umbral: 3 min de silencio.
- **Emulador sin asignar**: tinte ámbar, icono de mando en lugar de portada, "Assign" primario en lugar de Stop.
- **Sin sesión: la barra desaparece.** Decisión: el último juego ya manda en Home ("Continue") y en el orden de Library, así que una barra "last played" repetiría información y gastaría 72 px fijos en todas las pantallas. Además, que la barra exista significa "hay algo en marcha". La página recupera los 72 px; al empezar una sesión la barra entra deslizándose y el contenido se reajusta con la misma curva.

## 2. `estados-sync.png`
Pastilla de sync en la barra superior (a la izquierda del engranaje), 4 estados:
- **Synced**: punto cian con brillo. **Pending 3**: pastilla con fondo ámbar suave y la cifra en Big Shoulders. **Offline**: punto cian hueco, gris, sin color de alarma. **Sync error**: único estado en rojo.
- Clic abre un desplegable de 388 px anclado bajo la pastilla (flecha de 10 px). Contiene estado grande en Big Shoulders, frase, datos (último sync, pendientes, dispositivos), y acciones: "Sync now" (primario), "Try again" (offline), "Copy details" (error) y el enlace "Open sync settings" (va a Ajustes, Sync). En pendiente lista los 3 cambios. En error, un recuadro con la causa y el código.
- Cierre con Esc, clic fuera o foco fuera. La pastilla se pone en `--rai` mientras está abierta; el foco muestra anillo Phosphor de 2 px.
- Abajo, los avisos específicos de §8.2/§8.7 que sustituyen la frase del desplegable: "Update Afterplay to sync again", "This PC's clock is 14 minutes ahead" e identidad duplicada. El tooltip de la bandeja repite los mismos 4 estados.

## 3. `estados-avisos.png`
Se muestran sobre Library atenuada. Columna derecha: pila real (error, "story ready", sesión cerrada), con lo más nuevo abajo; la columna central enseña dos estados más del mismo toast. Izquierda, notas.
- **Sesión cerrada** (424 px): banner del juego tras velo y líneas de escaneo, portada, "Session ended", título, duración en Big Shoulders (Phosphor) y total. Bandas: récord (ámbar), logros (cian, con hasta 6 iconos), línea de estado rápido "How did it end?" con chips (Beaten/Resting/Dropped). Acciones: **Add note** (abre el campo en su sitio, sin robar foco) y **Open game** (primario). La barra de cuenta atrás de 3 px dura 15 s y se pausa con hover o foco dentro. Tras marcar estado: banda de confirmación con el color del estado.
- **Your November story is ready**: el texto real es de `useMemoryArrivalToast` ("Your <mes> story is ready / Read it in your Journey"). No existe un texto literal "your month is counted"; he interpretado que era este y le he añadido una línea de cifras del mes (62h 40m, 31 sesiones, 6 juegos). 12 s, clic lleva al Journey, dos periodos seguidos se apilan.
- **Error**: borde izquierdo rojo, icono de triángulo, mensaje y acción "Try again". 8 s o hasta cerrar si lleva botón.

## 4. `estados-pendientes.png` y `estados-asignar.png`
- **Badge**: círculo ámbar con la cifra (Big Shoulders) a la derecha de la pestaña Sessions, mientras haya pendientes (también de otros PCs). Sin pulso.
- **Bandeja "Pending sessions"**: panel con borde izquierdo ámbar sobre la cinta semanal. Fila: icono de mando, emulador y PC, cuándo (LIVE en rojo si sigue en marcha, o rango y duración), **Assign** primario y papelera. La papelera solo existe con la sesión terminada y pide confirmación como las demás.
- **AssignSessionModal** (640 px): cabecera con el emulador, fecha, duración y PC. Buscador con foco Phosphor, contador de resultados y pista "↑ ↓ to browse · Enter to pick", resultados con portada de 60 px (la primera resaltada con borde ámbar y barra lateral), y "Add new game…" punteado. Estado vacío ("No emulated games in your library yet") a la derecha, y banda roja de error bajo la lista. Esc cierra, salvo con la asignación en curso.

## 5. `estados-vacio-biblioteca.png` y `estados-vacios.png`
- **Primer arranque**: filtros a 0 y atenuados, "0" enorme en Phosphor, rejilla fantasma con borde punteado (la primera con "+") que se desvanece, y tres pasos numerados: 1 claves API (resaltado, es el aviso de bienvenida de credenciales), 2 carpetas, 3 primer juego; abajo "Join with a code" para quien ya usa otro PC.
- **Plan vacío**: "0" gris, una frase, "Add to queue" y atajo "From backlog 96", con cuatro portadas sugeridas.
- **Sin resultados** (paleta Ctrl K): frase con lo buscado, filtros activos como chips quitables, "Clear filters" y "Search IGDB for…".
- **Error del router**: reemplaza solo la pantalla (pestañas y barra se quedan). Mensaje de que los datos están a salvo, error técnico en recuadro mono, "Reload screen", "Go to Home", "Export diagnostics". El texto `errorText` + volver de `QueryStatePlaceholder` usa el mismo patrón en pequeño.
- **Carga**: esqueleto con el layout final y línea Phosphor de 2 px bajo la barra; aparece solo tras 150 ms para no parpadear. Shimmer de 1,6 s (desactivado con reduced motion).

## 6. Ajustes (8 capturas, `estados-ajustes-*.png`)
Página completa con navegación lateral de 230 px: **General, Library, Emulators, Saves, Integrations, Sync, Achievements, Backups, About**. Activa: fondo `--rai`, barra Phosphor de 2 px a la izquierda; engranaje activo en la barra. Abajo de la navegación, versión y PC. Cada bloque es un panel con título, descripción y acción arriba a la derecha.
Mapa respecto a las 6 pestañas actuales: General = General; Library = Game folders + External data + **Images** (movido desde Storage); Emulators = antes dentro de Library; Saves = Cloud saves + Local copies + identidad + inventario; Integrations = Credentials (las claves de Turso desaparecen, pasan a Sync); Sync = página aparte (`settings.png`); Achievements = Achievements + Your story + Game trivia (antes Journey); Backups = antes Data backups dentro de Storage.
- **General**: Start with Windows, Time format (12/24 h con muestra), Ambient mode (cuándo empieza, qué muestra), In-game overlay (activar y atajo con teclas).
- **Library**: carpetas de juegos (etiqueta "This PC", recuento por carpeta, quitar), External data con tres medidores y "Refresh all", Images con barra segmentada (covers verde, heroes cian, achievements ámbar, screenshots gris = prescindibles), "Redownload" y "Free 704 MB".
- **Emulators**: lista con la ruta de este PC y chips de dónde más está configurado ("not set up" punteado), formulario Add emulator, y un aviso de sesiones pendientes con acceso a Sessions.
- **Saves**: lista de juegos con interruptor "Backing up/Turn on", identidad con el aviso de identidad duplicada y sus dos acciones, inventario por PC con "Recover them", y copias locales con barra Still needed/Reclaimable.
- **Integrations**: aviso de bienvenida ámbar arriba; acordeón de servicios con estado (Needed/Connected/Optional), IGDB abierto con campos y "Save and test", y panel lateral "What each key unlocks".
- **Backups**: tabla de copias con Restore por fila, frecuencia/rotación, "Back up now" y "Restore from file…"; el panel de confirmación "Restore the backup from…" lista lo que se pierde y se conserva.
- **Achievements**: tres cifras, fuentes (Steam, RetroAchievements), juegos fallidos con causa y "Retry 3"; Your story y Game trivia con el aviso de clave de Anthropic que falta.
- **About**: versión, PC, base de datos, carpeta de datos, comprobar actualización, y Diagnostics con "Export diagnostics", lista de lo incluido y lo excluido, nivel de log y "Open logs folder".

## 7. Migración (`estados-migracion-pasos.png`, `estados-migracion-decisiones.png`)
Ventana con velo oscuro con tinte petróleo y líneas de escaneo, marca, **stepper de 5 pasos** (Check your PCs, Copy and validate, Pair, Upload, Finish): hecho = círculo Phosphor con check, activo = anillo con halo, pendiente = gris. El foco pasa al título al cambiar de estado (`tabIndex=-1`), y el texto se anuncia con `aria-live`.
- Pasos: copiar y validar (barra con %), emparejar (dirección y código en Big Shoulders), subir (barra con filas restantes y línea tranquila si hay problema transitorio), listo.
- Decisiones: PC rezagado (lista de PCs, el propio en rojo; "Wait for them" primario y "Continue anyway"), fallo de validación ("Nothing was migrated", tabla con la fila que no coincide en rojo, "Try again"/"Open report"), y PC reinstalado (recuperar identidad).
- Nota: el código actual tiene los pasos *Check, Copy, Connect, Upload, Finish*; los he renombrado *Copy and validate* y *Pair* para recoger "validar" y "emparejar" del encargo. Cambiar `CUTOVER_STEPS` si se aprueba.

## 8. `estados-overlay.png`
Ventana transparente sobre un juego simulado. Panel de 388 px arriba a la derecha (fondo `rgba(16,20,22,.8)` con blur y líneas de escaneo): cabecera con marca y tecla Esc, juego, **cronómetro de 104 px**, totales, **nota rápida** con foco Phosphor (Ctrl+Enter guarda, botón Save note) y **logros** (progreso, tres desbloqueados esta noche y uno bloqueado; el raro en violeta). Arriba al centro, toast de logro desbloqueado. Esc devuelve el foco al juego. Solo habla de la sesión de este PC: con una sesión de otro PC no se pinta.
- Sustituye el overlay a pantalla completa actual (HLTB, historial, catálogo completo de logros) por un HUD compacto: es decisión de esta exploración, no una limitación del overlay; si hay que conservar HLTB o historial pueden ir en una segunda pestaña del panel.

## 9. `estados-ambient.png`
La biblioteca borrosa y oscurecida de fondo, con viñeta y líneas de escaneo. Panel de cristal (1240 px) con portada de 290 px con halo del color del juego, título en Big Shoulders de 104 px, filete Phosphor y la frase (cifras y nombres destacados en ámbar). Extras de esta propuesta: reloj grande arriba a la derecha y línea inferior con el avance de la diapositiva (26 s) y "Move the mouse to go back" (se desvanece pasados unos segundos). Cualquier movimiento o tecla sale con fundido corto. Sin sesión en marcha ni diálogos abiertos, como hoy; cada diapositiva entra con fundido de 2,2 s y la portada deriva despacio.
