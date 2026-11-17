# Afterplay 2.0 — diseño y plan de migración

Estado: **borrador para revisión** · Fecha: 2026-11-13 · Parte de: Afterplay 1.7.3

## §0. Cómo leer este documento

Este documento hace tres cosas: diagnostica la 1.7.3 con evidencia, define la 2.0 y describe cómo llegar de una a otra sin perder datos ni dejar de usar la app por el camino.

- Las secciones van numeradas (`§7.3`) para citarlas desde el código, como el resto de specs.
- Cada elemento lleva un identificador estable:
  - `F-nn`: fallo o debilidad diagnosticada en la 1.7.3 (§4).
  - `D-nn`: decisión tomada (§3).
  - `E-nn`: escenario de aceptación que la 2.0 debe pasar (§17.3).
  - `S-nn`: comprobación previa ("spike") que hay que hacer antes de comprometer una pieza (§20.1).
  - `R-nn`: riesgo (§22). `P-nn`: pregunta que estuvo abierta, con su resolución (§23).
- Grado de certeza de cada afirmación del diagnóstico:
  - **VERIFICADO**: seguido en el código, con fichero y línea.
  - **DEDUCIDO**: se sigue de la semántica de una librería o de un comentario del código, pero no se ha reproducido.
  - **SOSPECHA**: plausible, sin comprobar.
- Las líneas citadas son de la 1.7.3 en la rama de trabajo del 2026-11-13 y se moverán; el nombre de la función es la referencia estable.
- El código cita también los documentos de diseño de la 1.x (`PARTIDAS-GUARDADAS.md`, `BIG-PICTURE.md`, `EMULADORES.md`, `PLAN-TO-PLAY.md`, `REMOTO.md`, `OVERLAY.md`…). No están en el repositorio: se guardan aparte, con el resto de notas de trabajo. `CONSULTAS.md` y `MAPA-1X.md` sí están, en `src/main/db/v2/`.

Nada de lo que aquí se describe está implementado. Ningún escenario multi-PC se ha ejecutado: el diagnóstico sale de leer el código.

---

## §1. Resumen

Afterplay 1.x funciona y cumple su objetivo en un PC. Con varios, falla por una causa común: **todo el sistema asume que solo escribe una máquina**. Esa suposición está en el esquema (ids autoincrementales, rutas locales en filas compartidas, sesiones sin dueño), en el watcher (cierra lo que no ve correr aquí), en las partidas guardadas (cada PC solo se compara consigo mismo) y en el móvil (un lector lateral que escribe en la base por otra puerta).

La 2.0 cambia cuatro cosas de fondo y ordena el resto:

1. **Identidad global y dueño explícito.** Ids que no chocan entre máquinas, una tabla de dispositivos y un `deviceId` en todo lo que pertenece a una máquina. Regla central: _solo el dispositivo dueño de una sesión la cierra, la adopta o la late_.
2. **Sync propio, lógico y por campo.** Se abandona `@tursodatabase/sync`. Cada cliente guarda su SQLite local y sincroniza filas con un **hub** (un Durable Object por persona en Cloudflare, con núcleo portable). El esquema nunca viaja por el sync.
3. **Lo que es de una máquina deja de viajar como si fuera de todas.** Rutas de instalación por dispositivo; latido rápido solo en local.
4. **El móvil pasa a ser un cliente más del hub**, no un lector de tablas ajenas. Desaparecen la lógica duplicada, el buzón y los tokens de otros guardados a mano.

Además, por decisión de alcance (D-01), la 2.0 incluye la deuda estructural: partir el proceso main, contrato IPC validado, estadísticas calculadas en el main, logs a fichero, tests de varias réplicas y CI.

La migración se hace con una versión puente (1.8), un importador automático e idempotente, y una comparación de totales antes y después que aborta si algo no cuadra. La 1.x sigue en uso normal hasta el día del corte.

---

## §2. Objetivos, no-objetivos y supuestos

### §2.1 Objetivos

- **O1.** Una persona usa Afterplay en varios PCs (2-4) y un móvil, y todo converge sin intervención: sesiones, playthroughs, estados, gastos, logros, plan, notas.
- **O2.** Offline-first real: cada PC funciona entero sin red y se pone al día después, sin perder ni mezclar datos aunque dos PCs hayan escrito offline.
- **O3.** Jugar al mismo juego en PCs distintos no rompe nada: cada PC detecta su propia instalación y registra sus propias sesiones.
- **O4.** PCs con versiones distintas de la app conviven sin corromper datos; el peor caso es "este PC deja de sincronizar hasta que se actualice", nunca una pérdida.
- **O5.** El móvil aplica sus acciones al instante, sin depender de que haya un PC encendido (salvo el enriquecimiento de metadatos de un alta).
- **O6.** Coste cero con el uso previsto, y sin dependencia irreversible de un proveedor.
- **O7.** Migrar de 1.x a 2.0 exige como mucho una confirmación por PC. Ningún dato del usuario se pierde ni cambia de significado.
- **O8.** La base de código queda en condiciones de seguir creciendo: main troceado, contrato IPC único, lógica de dominio compartida, tests que cubren el caso multi-dispositivo.

### §2.2 No-objetivos

- Multiusuario colaborativo. Cada persona tiene su almacén; no hay datos compartidos entre personas.
- Restauración automática de partidas guardadas (D-02).
- Soporte de Linux o macOS **en la 2.0**. Linux queda previsto para después: el modelo no lo impide (D-14, §11.5).
- PWA con modo offline (D-24).
- Arreglos de los fallos entre PCs en la 1.7.x (D-17).
- Servidor autoalojado fuera de Cloudflare (D-19).
- Rediseño visual: lo lleva la rama `identity/afterglow` y es independiente de este documento.

### §2.3 Supuestos

- Volumen pequeño: cientos o pocos miles de juegos, miles de sesiones, pocos MB en total.
- Dos personas en el despliegue actual (el autor y un amigo), cada una con 2-4 PCs.
- En la 2.0 todos los PCs son Windows. Linux llegará después (D-14).
- El usuario ya tiene cuenta de Cloudflare con un Worker y un bucket R2.

---

## §3. Decisiones tomadas

| Id   | Decisión                                                                                                                                                                           | Origen                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| D-01 | **Alcance: todo de una vez.** La 2.0 incluye datos, sync, partidas, móvil y la deuda estructural (main, IPC, stats en main, logging, CI).                                          | Usuario, 2026-11-13                                               |
| D-02 | **Partidas guardadas: restaurar es siempre manual.** Sin restauración automática ni avisos activos. El estado se ve en la ficha del juego, y la 2.0 lo hace veraz entre PCs (§12). | Usuario, 2026-11-13                                               |
| D-03 | **Un solo hub multiusuario, alojado por el autor.** Un almacén separado por persona. Los demás se emparejan con un código; el anfitrión no guarda tokens ajenos.                   | Usuario, 2026-11-13                                               |
| D-04 | **Este documento vive en `docs/AFTERPLAY-2.0.md`**, dentro del repo.                                                                                                               | Usuario, 2026-11-13                                               |
| D-05 | **Se sigue en Cloudflare**, con el núcleo del hub portable para no depender de él de forma irreversible (§9.6).                                                                    | Usuario + recomendación                                           |
| D-06 | **Actualización en el sitio.** La 2.0 es la misma aplicación (mismo `appId`, misma carpeta de datos) con un fichero de base nuevo. La base 1.x no se toca y sirve de vuelta atrás. | Recomendación, a partir de "minimizar el trasteo entre versiones" |
| D-07 | **El salto a 2.0 pide una confirmación**, no se instala a ciegas. A partir de ahí las 2.x se actualizan solas como hoy.                                                            | Recomendación                                                     |
| D-08 | **Se abandona `@tursodatabase/sync`** por un sync lógico propio (§8).                                                                                                              | Usuario, 2026-11-13                                               |
| D-09 | **Sync basado en estado con última-escritura-gana por campo**, no en un log de operaciones (§8.1).                                                                                 | Recomendación                                                     |
| D-10 | **El esquema no viaja por el sync.** Cada lado migra su propia base. Dentro de 2.x, las migraciones de tablas sincronizadas son solo aditivas.                                     | Recomendación                                                     |
| D-11 | **El `machineId` de las partidas guardadas pasa a ser el `deviceId` de todo.** Da continuidad con los prefijos que ya existen en el bucket.                                        | Recomendación                                                     |
| D-12 | **La lógica de dominio es una sola**, en `src/shared/domain`, como funciones puras sobre filas planas. La usan el escritorio, el hub y la PWA.                                     | Recomendación                                                     |
| D-13 | **Los trabajos caros se arbitran en el hub** (recaps con LLM, radar, refresco externo, enriquecimiento de altas del móvil) mediante concesiones temporales (§14.3).                | Recomendación                                                     |
| D-14 | **Windows en la 2.0; Linux después.** No se implementa, pero el modelo no le cierra la puerta (§11.5).                                                                             | Usuario, 2026-11-13                                               |
| D-15 | **El mismo juego abierto a la vez en dos PCs son dos sesiones**, una por dispositivo, y sus horas se suman (§10.4).                                                                | Usuario, 2026-11-13                                               |
| D-16 | **El móvil mantiene el alcance de hoy**, aplicado al instante (§13.1).                                                                                                             | Usuario, 2026-11-13                                               |
| D-17 | **La 1.7.x no recibe arreglos de los fallos entre PCs.** Solo la versión puente. Todo va a la 2.0.                                                                                 | Usuario, 2026-11-13                                               |
| D-18 | **El hub se despliega con dirección nueva.** El Worker actual vive hasta que las dos personas hayan migrado (§19.8).                                                               | Usuario, 2026-11-13                                               |
| D-19 | **El servidor autoalojado no entra en la 2.0**; solo el núcleo portable (§9.6).                                                                                                    | Usuario, 2026-11-13                                               |
| D-20 | **Restaurar una partida no borra lo que sobra**, salvo que se marque "dejar la carpeta exactamente como en la copia" (§12.7).                                                      | Usuario, 2026-11-13                                               |
| D-21 | **Una sesión sin señal de vida se cierra a las 24 h** (§10.5).                                                                                                                     | Usuario, 2026-11-13                                               |
| D-22 | **Lo editado a mano queda protegido del refresco**: desarrollador, distribuidora, géneros, carátula y banner (§7.4).                                                               | Usuario, 2026-11-13                                               |
| D-23 | **Una sola moneda en la interfaz**; cada gasto guarda la suya por si algún día hay varias.                                                                                         | Usuario, 2026-11-13                                               |
| D-24 | **La PWA no funciona sin conexión.** Mejores mensajes de error y tiempos máximos, nada más.                                                                                        | Usuario, 2026-11-13                                               |
| D-25 | Las lápidas no se purgan en la 2.0 (§7.7).                                                                                                                                         | Recomendación técnica                                             |
| D-26 | Se renombran las columnas fósiles (`sgdbId`, `steamSpyCheckedAt`): el esquema es nuevo y ya no cuesta nada.                                                                        | Recomendación técnica                                             |

Las decisiones marcadas como "Recomendación" son propuestas de este documento. Están aplicadas en el resto del texto y se pueden revocar; la que más condiciona el diseño es D-09.

---

## §4. Diagnóstico de la 1.7.3

### §4.1 Sesiones y watcher

**F-01. Un PC encendido cierra la sesión viva de otro.** VERIFICADO.
`sweepUnseenWatchedSessions` (`src/main/watcher/watcher.ts:768-797`) cierra cualquier sesión abierta de un objetivo vigilado que no esté corriendo _en esta máquina_ tras 120 s. El objetivo está vigilado también en el otro PC porque `games.executablePath` se sincroniza (`getWatchTargets.ts:53-86`). Secuencia: juegas en el PC-A; el PC-B, encendido y desbloqueado, recibe la sesión abierta por el pull; a los dos minutos la cierra en el último latido que bajó y sube ese cierre. `reconcileOpenSessions` (`watcher.ts:672-706`) hace lo mismo al arrancar, y además antes del primer pull: decide sobre una réplica posiblemente vieja. La guarda `isLocalCopyFresh` que ya existe para los cronómetros no se aplicó a las sesiones del watcher.

**F-02. Un PC adopta la sesión de otro y pierde la suya.** Camino VERIFICADO; resultado final DEDUCIDO.
Si en el PC-B arranca el juego mientras la sesión del PC-A sigue abierta en su réplica, `startGameSession` devuelve `null` por la deduplicación local (`startGameSession.ts:21-27`) y el watcher adopta la sesión ajena (`watcher.ts:401-417`). El PC-B late una fila que no es suya y nunca crea la propia. Cuando llega el cierre del PC-A, la sesión entera del PC-B se pierde.

**F-03. Latido y cierre no comprueban el estado de la fila.** VERIFICADO.
`heartbeatSessions` actualiza `lastHeartbeatAt` sin mirar `endedAt`. `closeSessionIfOpen` lee y después hace el `UPDATE` sin `endedAt IS NULL` en el `WHERE` (`closeSession.ts:32-59`); el Worker sí pone esa guarda. En el PC víctima de F-01, el mapa `active` sigue apuntando a la sesión cerrada, la sigue latiendo y, al salir del juego, el cierre devuelve `null`: sin aviso, sin diario y con la sesión recortada a uno o dos minutos.

**F-04. Al salir no se cierra ni se sube nada.** VERIFICADO.
`before-quit` (`src/main/index.ts:1140-1154`) para el watcher y los temporizadores, pero no cierra sesiones, no espera el backup pendiente y no hace un último push. Es el momento exacto en que se cambia de PC.

**F-05. El latido de 5 s viaja por el sync.** VERIFICADO el ritmo; coste SOSPECHA.
Unas 720 mutaciones por hora de juego hacia una tabla sincronizada, cuando a los demás dispositivos les basta la última.

### §4.2 Datos de una máquina en tablas compartidas

**F-06. Rutas locales en `games` y `emulators`.** VERIFICADO.
`games.executablePath`, `installDirectory`, `installSizeBytes` (`schema.ts:85,91,95`) y `emulators.executablePath` (`schema.ts:435`) son hechos de un PC guardados en la fila de todos. El watcher exige la ruta completa (`watcher.ts:852`): con el juego en `C:\…` en un PC y `D:\…` en otro, el segundo no lo detecta; corregir la ruta allí rompe la detección en el primero. El escaneo de carpetas marca el juego como "ya en la biblioteca" y no ofrece vincular la instalación local. `installDirectory` también lo usan los logros de emuladores de Steam.

El propio proyecto ya aplica la regla correcta en otros sitios: `machine-saves.json`, `scan-cache.json`, `scanFolders` y `radarLastRunAt` en `config.json` son locales. Solo estas columnas se quedaron fuera.

### §4.3 Identidad y conflictos

**F-07. Ids autoincrementales con tres escritores.** REPRODUCIDO el 2026-11-13 con el cliente 0.7.2 contra el servidor de sync local de Turso 0.7.2 (`spikes/turso-collision`, §20.1.2). No se ha probado contra Turso Cloud.
Todas las claves primarias son `int autoincrement`. Escriben en local y suben por su cuenta cada PC, y el Worker inserta directamente en el remoto (`worker/src/queries/timer.ts:303-351`, `mailbox.ts:116`). La librería identifica cada mutación por número de fila (`@tursodatabase/sync-common/dist/types.d.ts:29-58`) y la app no usa el `transform` que permitiría resolver conflictos. El generador de reproducción del motor (leído en la rama principal, no en la etiqueta 0.7.2) aplica cada inserción como "insertar o, si la clave existe, sobrescribir". Consecuencia: dos PCs offline que insertan la sesión 5000 → la del segundo en subir pisa a la del primero, sin error. Con `iterations` es peor: las sesiones y eventos del primero quedan apuntando a la iteración de otro juego. La reproducción lo confirma tal cual, y añade dos cosas: quién pierde depende del orden de subida, y lo que el Worker escribe directo en la remota también queda pisado por un PC que sube después.

**F-08. Las claves únicas naturales pierden filas en silencio.** REPRODUCIDO en el mismo spike; es distinto de lo que se sospechaba.
`games.igdbId`, `achievements(gameId, apiName)`, `achievement_unlocks(achievementId, source)` y `generated_memories(scopeType, scopeKey)` son únicas. El mismo juego añadido en dos PCs con ids distintos no atasca el sync: el push falla **una sola vez**, deja aplicado en la remota el resto del lote, da el envío por hecho y no lo reintenta. La fila en conflicto y las que dependen de ella desaparecen sin aviso en el siguiente pull.

**F-09. El id se usa como orden causal.** VERIFICADO.
Desempate entre eventos simultáneos (`playthroughState.ts:91-92`), "la última iteración es la de id más alto" (`resolveIterationForPlay.ts:190-193`), la firma de "cerrado al vuelo" (`:153-160`), el reparto del gasto (`getGameById.ts:145-150`) y el promote (`promotePlannedGame.ts:73-78`). Con varios escritores el id no refleja el orden real.

**F-10. Invariantes que solo existen en TypeScript.** VERIFICADO.
"Un playthrough activo por juego" se impone en `addStateEvent`, pero `updateStateEvent` (`:14-38`) y `deleteStateEvent` lo pueden romper. "Una sesión abierta por juego" y "`iterationId` o `emulatorId`, exactamente uno" no los garantiza la base.

**F-11. Borrados sin lápida.** VERIFICADO por ausencia.
No hay borrado lógico. Un `DELETE` se replica por clave; con ids que chocan (F-07) puede borrar la fila de otro. Un hijo insertado offline cuyo padre se borró en otro PC se pierde: el push falla una vez por la clave foránea y no se reintenta (reproducido, §20.1.2). Entre un borrado y una edición de la misma fila gana siempre el borrado, suba quien suba primero.

**F-12. Verdades duplicadas.** VERIFICADO.
`games.planned`, el evento `plan_to_play` y la iteración vacía dicen lo mismo de tres formas (661 de unas 997 iteraciones son de juegos planeados). "Fecha desconocida" se adivina por cercanía temporal con una ventana de 5 s (`isAddedAtArtifact`, `playthroughState.ts:129-150`). `manualTotalPlayed` cambió de significado (de reemplazar a sumar) sin migrar los datos, así que las filas antiguas pueden contar doble (SOSPECHA).

### §4.4 Motor de sync (Turso)

**F-13. La capa de datos es mayoritariamente parche.** VERIFICADO por los comentarios del código.
De unas 1.450 líneas entre `db/index.ts`, `localConnection.ts`, `migrationSync.ts` y satélites, se estima que el 60-70 % tapa limitaciones del motor. El apéndice A lista cada incidente con su parche: dos pérdidas de producción (7 de agosto) y dos bloqueos del WAL (24 de septiembre y 5 de octubre), en tres meses.

**F-14. Producto beta, sin resolución de conflictos.** Dato externo.
`@tursodatabase/sync` se lanzó como beta en octubre de 2025 y no ha llegado a 1.0; la app va fijada en 0.7.2 y la actual es 0.8.3. Su modelo es "gana el último push": por fila entera en las inserciones y por columna en las actualizaciones (medido, §20.1.2). Tiene abierto un fallo de corrupción silenciosa tras cambios de columnas ([issue 5640](https://github.com/tursodatabase/turso/issues/5640)). El pragma que la app necesita se llama `unstable_capture_data_changes_conn`.

**F-15. Versiones mezcladas sin protocolo.** VERIFICADO.
Quien migra el remoto es el primer PC con la app nueva. Un PC con la versión anterior solo compara su propia carpeta de migraciones (`migrationSync.ts:91-109`), baja el esquema nuevo y sigue escribiendo. No hay versión mínima de cliente.

**F-16. Carreras de conexión.** Carrera VERIFICADA; efecto SOSPECHA.
En el primer arranque de un PC nuevo, `connectWithSync` corta a los 4 s pero su `connect()` sigue vivo mientras el `catch` abre una conexión local sobre el mismo fichero (`db/index.ts:265-270, 342-343`). La descarga completa tarda 4,3 s según el propio código. Dos conexiones sobre el mismo fichero es lo que ya corrompió la base una vez.

**F-17. Cambiar credenciales en caliente reparte el trabajo entre dos bases.** Desvío VERIFICADO.
La conexión guarda la URL al conectar (`db/index.ts:252`); `pushMigrationsToRemote` relee el entorno en cada llamada (`:195-197`).

**F-18. Las protecciones solo viven en memoria.** VERIFICADO.
`dataLossBlocksSync` no se recalcula tras reiniciar.

### §4.5 Partidas guardadas

**F-19. Backup por máquina, no "partida en la nube".** VERIFICADO.
El estado que muestra la ficha compara el disco con el último backup _de este PC_ (`saves/service.ts:124-147`, `orchestrator.ts:495`). Puede decir "Up to date" en verde (`SavesSection.tsx:263`) con una partida más nueva de otro PC en el bucket. `save_backups` no guarda de qué versión viene un estado restaurado, ni un hash del contenido.

**F-20. El backup pendiente no sobrevive a un cierre.** VERIFICADO.
El backup se programa 8 s después de cerrar la sesión con un temporizador que no retiene el proceso (`sessionHook.ts:17-37`).

**F-21. El índice se puede duplicar.** VERIFICADO.
`save_backups` no tiene clave única por `r2Key`. Una recuperación desde el bucket con el sync retrasado crea filas que luego se duplican (`recovery.ts:169-172`).

**F-22. Restaurar no es un reemplazo exacto.** VERIFICADO.
Los archivos locales que no están en el backup no se borran (`service.ts:381-383`).

**F-23. Un borrado desde otro PC se deshace solo.** VERIFICADO.
Borrar desde el PC-A una versión del PC-B elimina objeto y fila, pero el zip sigue en la carpeta local del PC-B, que la vuelve a subir en su siguiente backup (`ipc/saves.ts:563`, `orchestrator.ts:175-180`).

**F-24. La identidad de máquina es frágil.** Escritura no atómica VERIFICADA; duplicado SOSPECHA.
`machine-saves.json` se escribe sin atomicidad y, si queda corrupto, se genera un `machineId` nuevo sin avisar (`machine.ts:84, 103-107`). Si la carpeta de datos se copia a otro PC, dos máquinas comparten prefijo y cada una poda lo de la otra (`orchestrator.ts:226-227`).

**F-25. Sin tests en lo delicado.** VERIFICADO.
No hay tests de `syncGameToR2`, `mergeRemoteMapping`, `buildRedirects`, `recovery` ni `identity`.

### §4.6 Worker y PWA

**F-26. La lógica de dominio está portada a mano.** VERIFICADO.
Unas 1.500 líneas de consultas en el Worker reimplementan las del escritorio (`game.ts` ≈ `getGameById`, `library.ts` ≈ `getGames`, `resolveIterationForTimer` ≈ `resolveIterationForPlay`). Los comentarios documentan al menos ocho divergencias ya ocurridas y una sigue abierta (`worker/src/queries/sessions.ts:22-29`). Los tests de paridad del Worker no llaman al código del escritorio: repiten escenarios con números esperados.

**F-27. El buzón no tiene reclamo entre PCs.** VERIFICADO por ausencia.
El drenado sella en local (`drainMailbox.ts:352-422`) con una guarda que es una variable del proceso (`:343`). Dos PCs encendidos pueden ejecutar la misma orden.

**F-28. El cronómetro comprueba y luego inserta.** VERIFICADO.
Sin transacción y solo contra el remoto (`timer.ts:327-335`): una sesión del watcher aún no subida no la ve.

**F-29. El Worker guarda los secretos de cada persona.** VERIFICADO.
El secreto `TENANTS` contiene la URL, el token de escritura y las claves de Twitch de cada inquilino (`worker/src/tenants.ts:40-59`). Tocar el mapa exige volver a pedir los de los demás.

**F-30. Acoplamiento de esquema sin versionar.** VERIFICADO.
Rutas sin versión, despliegue manual. Con un Worker más viejo que la base, el mensaje le dice al usuario que actualice el PC (`worker/src/index.ts:418-424`): el diagnóstico al revés.

**F-31. Rutas locales enviadas al móvil.** VERIFICADO.
`GameDetail` lleva `installDirectory` y `executablePath` (`api-types.ts:113-115`).

### §4.7 Tareas de fondo e integraciones

**F-32. Nada coordina el trabajo caro entre máquinas.** VERIFICADO.
`claimQueue` es un `Set` en memoria (`lib/claimQueue.ts:80`). Dos PCs generan el mismo recap y se paga dos veces; si el modelo lo rechaza no queda marca y se reintenta cada día en cada PC (`memories/generate.ts:344-360`).

**F-33. El refresco semanal corre en cada PC y reescribe `games` entera.** VERIFICADO.
`radarLastRunAt` es local y la pasada lanza un refresco completo que hace `UPDATE` de todas las filas (`external/refresh.ts:504-572`). Como `games` mezcla datos del usuario y caché externa, un refresco y una edición simultánea en otro PC pueden pisarse (SOSPECHA, depende del motor).

**F-34. Ocho formas distintas de "ya lo miré".** VERIFICADO.
Conviven "null = pendiente para siempre", "caduca a los 4 días", "null = volver a preguntar siempre", "manual", `config.json` local, JSON en la carpeta de datos y un `Map` en memoria.

**F-35. Los logros de emulador "bailan" entre PCs.** VERIFICADO.
Una sola fila `'emu'` por logro (`schema.ts:569`); cada barrido de arranque la reescribe con la fecha de su fichero local (`steam/syncAchievements.ts:301-309`).

**F-36. No se distingue lo elegido a mano.** VERIFICADO.
Solo `steamAppIdManual` marca una elección manual. Carátula, banner e id de SteamGridDB elegidos a mano son indistinguibles de los automáticos.

### §4.8 Main, IPC y renderer

**F-37. `src/main/index.ts` (1.157 líneas) orquesta el arranque sin fases explícitas.** VERIFICADO.
El watcher arranca antes del primer sync. `push()` y `pull()` corren fuera de la puerta de acceso a la base (`db/index.ts:1085-1086`). Las tareas de fondo dependen de guardas sueltas por módulo y del orden de los `.then`.

**F-38. El contrato IPC depende de la disciplina.** VERIFICADO.
Unas 130 cadenas de canal duplicadas a ambos lados, tipos repetidos, ninguna entrada validada (zod solo se usa para APIs externas).

**F-39. La interfaz no se entera de todo lo que llega por sync.** VERIFICADO.
Un pull emite `games:changed`; `useWatcherSync` solo invalida juegos, sesiones y eventos de estado. Con `staleTime: Infinity`, quedan obsoletos hasta reiniciar: gastos, recaps, curiosidades, partidas y emuladores.

**F-40. La interfaz no tiene concepto de dispositivo.** VERIFICADO.
"En vivo" se deduce de `endedAt === null` (`GameDetail.tsx:106`, `NowPlayingCard.tsx:43,56`), así que una sesión abierta en otro PC aparece como propia y el botón Stop la cerraría desde aquí. La ruta del ejecutable se muestra y edita como valor global.

**F-41. Las estadísticas se calculan en el cliente con todas las filas.** VERIFICADO.
`Stats.tsx:579-585` trae todos los juegos, sesiones, gastos y eventos. `NowPlayingCard`, siempre montada, vuelve a pedir todas las sesiones en cada cambio.

**F-42. Los tipos del renderer salen del esquema físico.** VERIFICADO.
`shared/types.ts` reexporta tipos de Drizzle, y `UpdateGamePatch` permite sobrescribir cualquier columna de `games` (`types.ts:62`).

**F-43. Sin logs persistentes.** VERIFICADO.
Solo `console.*`. Los fallos de sync se guardan en memoria y se ven al abrir Ajustes. Los cierres de sesión hechos por barridos no dejan rastro.

### §4.9 Tests, tooling y seguridad

**F-44. Ningún test simula dos réplicas, y no hay CI.** VERIFICADO.
El arnés de tests usa `@libsql/client`, no el driver de producción, y lo admite (`db/__tests__/harness.ts:34-40`). No existe `.github/`.

**F-45. Dependencias en versiones frágiles.** VERIFICADO.
`drizzle-orm` y `drizzle-kit` en `1.0.0-rc.4`; `@tursodatabase/sync` fijado; TypeScript con doble alias (7 nativo para `tsc`, 6 para las herramientas); dos drivers de base distintos entre producción y tests.

**F-46. Pendientes de seguridad.** VERIFICADO.

- `docs/dependency-upgrade-2026-09-24.md` dejó sin cerrar la revisión de instaladores anteriores y la rotación de las claves que contenían.
- El protocolo `afterplay-image` sirve cualquier ruta del disco, sin acotarla a la caché (`images/protocol.ts:27-35`).
- `e2e/seed.ts` se genera a partir de la biblioteca real y está en un repo público.
- Si `ENVIRONMENT=development` llegara a producción, el Worker se saltaría Access (`worker/src/access.ts:158-163`).
- Las ventanas usan `sandbox: false` (`src/main/index.ts:311`).

### §4.10 Lo que está bien y se conserva

- **Dominio.** Playthroughs como entidad propia; estado derivado de un log de eventos con `latestRealStateEvent` compartido; precisión de fechas (año, mes, día, instante); sesiones como "solo tiempo medido" con `startedBy`; logros como hecho con origen, con `dateReliable` y fusión por la fecha más temprana.
- **Watcher.** Detección en dos fases (nombre y ruta) con el respaldo del fichero bloqueado para juegos con anti-cheat; pausa por bloqueo de pantalla con "generación" que invalida ciclos en vuelo; latido y cierre en el último latido para sobrevivir a un corte.
- **Partidas.** La separación `service` / `r2` / `orchestrator` / `contracts`; la cola única de ludusavi (`run.ts`); el binario fijado por hash; `mapping.ts`; la tokenización de rutas y los redirects; la copia previa a un restore; `recovery.ts` y `machines/<id>.json` (el bucket ya se describe a sí mismo); la disciplina "bucket primero, índice después" y "ante la duda, no borrar".
- **Worker.** Verificación del JWT de Access y fallo cerrado en cada capa; validación de entradas; un solo origen para API y PWA; códigos de error estables; los tipos de la API importados por la PWA.
- **Frontend.** Hooks por dominio con claves centralizadas; `lib/` como lógica pura y testeada; separación escritorio / TV / overlay; la ficha de juego bien troceada; cumplimiento de `AGENTS.md` en estilos; e2e con fixtures desechables. Se estima un 70-80 % intacto.
- **Disciplina.** Fallar cerrado, "un no de una fuente externa no borra lo que había", copias previas con recuento de filas, `claimQueue` dentro de un proceso, trazabilidad de los recaps (`model`, `promptVersion`, `sourceHash`), imágenes como URL en la base con caché local por hash.

---

## §5. Principios de la 2.0

1. **Cada dato tiene una clase y un dueño.** Antes de añadir una columna se decide: ¿es del usuario, es caché de una fuente externa, es de este dispositivo, o es derivado? La clase determina si sincroniza y quién puede escribirlo (§7.1).
2. **Los ids se generan donde nace el dato y no chocan.** Nunca dependen de un contador compartido.
3. **Lo que tiene clave natural la usa como id.** Así dos dispositivos que crean "lo mismo" crean la misma fila.
4. **El orden lo da un reloj, no el id.**
5. **Nada se borra: se marca.** Los borrados son lápidas que viajan como cualquier otro cambio.
6. **Los conflictos se resuelven por campo, no por fila.** Editar las notas en un PC y refrescar la carátula en otro no se pisan.
7. **El esquema no viaja.** Cada base se migra a sí misma.
8. **Decidir sobre copia fresca cuando se pueda, nunca bloquear cuando no.** Generaliza la regla de `remoteFreshness` que ya existe.
9. **Una regla de negocio, una implementación.** Lo que derivan el escritorio, el hub y la PWA sale del mismo módulo.
10. **Todo fallo de sincronización es visible y queda escrito.**

---

## §6. Arquitectura general

```
   PC-A (Electron)            PC-B (Electron)             Móvil (PWA)
 ┌──────────────────┐       ┌──────────────────┐       ┌──────────────┐
 │ SQLite local     │       │ SQLite local     │       │ sin base     │
 │  · sincronizado  │       │  · sincronizado  │       │ local        │
 │  · local (L)     │       │  · local (L)     │       └──────┬───────┘
 │ motor de sync    │       │ motor de sync    │              │ /api/v2
 └────────┬─────────┘       └────────┬─────────┘              │ (Access)
          │  /sync/v1 (token de dispositivo)                  │
          └───────────────┬──────────┴────────────────────────┘
                          ▼
              ┌───────────────────────────┐
              │ Worker "afterplay-hub"    │
              │  · enruta por inquilino   │
              │  · sirve la PWA           │
              └────────────┬──────────────┘
                           ▼
              ┌───────────────────────────┐      ┌──────────────────┐
              │ Durable Object por persona│      │ Bucket R2 (de    │
              │  · SQLite: filas + reloj  │      │ cada persona)    │
              │  · fusión por campo       │      │  partidas        │
              │  · concesiones de trabajo │      │  guardadas       │
              │  · alarmas (barridos)     │      └──────────────────┘
              └───────────────────────────┘        ▲ directo desde
                                                   │ cada PC, como hoy
```

- **Cada PC** tiene la base completa y funciona sin red. Su motor de sync sube las filas modificadas y baja las de los demás.
- **El hub** es el punto de encuentro: guarda la última versión de cada fila, serializa las escrituras de un inquilino (un Durable Object procesa una petición cada vez) y arbitra los trabajos caros.
- **El móvil** no tiene base local: lee y escribe a través del hub, con las mismas reglas de dominio.
- **Las partidas guardadas** siguen yendo de cada PC al bucket del usuario. El hub solo sincroniza su índice.
- **El hub no guarda nada único.** Cualquier PC puede volver a sembrar un hub vacío. Esa es la garantía contra la dependencia del proveedor.

Sin hub configurado, la app funciona entera en local, como hoy sin Turso.

---

## §7. Modelo de datos

### §7.1 Clases de datos

| Clase | Qué es                                                  | ¿Sincroniza? | Quién escribe                                 |
| ----- | ------------------------------------------------------- | ------------ | --------------------------------------------- |
| **U** | Dato del usuario                                        | Sí           | Cualquier dispositivo                         |
| **O** | Dato del usuario con dueño (pertenece a un dispositivo) | Sí           | El dueño; los demás solo campos acotados      |
| **C** | Caché de una fuente externa, re-derivable               | Sí           | El trabajo de refresco que tenga la concesión |
| **L** | Hecho de este dispositivo que no interesa a los demás   | No           | Solo este dispositivo                         |
| **D** | Derivado                                                | No se guarda | —                                             |

La clase C sincroniza para no repetir llamadas en cada PC y porque el móvil necesita esos datos (títulos, carátulas, catálogo de logros).

### §7.2 Identificadores

Todas las tablas sincronizadas usan `id TEXT PRIMARY KEY`. Hay tres formas de generarlo:

| Tipo             | Cuándo                                                               | Forma                                              |
| ---------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| **Aleatorio**    | Entidades sin clave natural: sesiones, playthroughs, eventos, gastos | UUIDv7 (ordenable por tiempo de creación)          |
| **Determinista** | Entidades con clave natural externa                                  | UUIDv5 sobre un espacio de nombres fijo y la clave |
| **Compuesto**    | Filas que son "la relación entre dos cosas"                          | Las partes unidas con `:`                          |

Asignación:

| Tabla                  | Id                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `devices`              | El `machineId` actual (UUID aleatorio ya existente) (D-11)                                 |
| `games`                | Con `igdbId`: UUIDv5 de `igdb:<igdbId>`. Sin él: UUIDv7                                    |
| `game_metadata`        | `gameId`                                                                                   |
| `game_installs`        | `<gameId>:<deviceId>`                                                                      |
| `emulators`            | UUIDv7                                                                                     |
| `emulator_installs`    | `<emulatorId>:<deviceId>`                                                                  |
| `plan_entries`         | `gameId`                                                                                   |
| `playthroughs`         | UUIDv7                                                                                     |
| `state_events`         | UUIDv7                                                                                     |
| `sessions`             | UUIDv7                                                                                     |
| `spend_events`         | UUIDv7                                                                                     |
| `achievement_catalogs` | `<gameId>:<source>` (una fila por juego y fuente)                                          |
| `achievement_unlocks`  | `<gameId>:<source>:<apiName>:<origin>`, donde `origin` es `steam`, `ra` o `emu@<deviceId>` |
| `save_backups`         | UUIDv5 de la clave del objeto en el bucket                                                 |
| `game_curiosities`     | `gameId`                                                                                   |
| `generated_memories`   | `<scopeType>:<scopeKey>` (por ejemplo `month:2026-06`)                                     |
| `radar_games`          | `igdb:<igdbId>`                                                                            |
| `external_checks`      | `<gameId>:<source>`                                                                        |

Consecuencias:

- Dos PCs que añaden offline el mismo juego de IGDB crean la **misma fila**, que se fusiona campo a campo. F-08 desaparece para el caso normal.
- Recuperar el índice de partidas desde el bucket no puede duplicar filas (F-21).
- Regenerar un recap o resincronizar un catálogo es un "escribir encima" natural.

Caso residual: un juego dado de alta sin `igdbId` (solo Steam) que más tarde gana `igdbId`, y que otro PC añade por IGDB. Quedan dos filas. No se resuelve en el sync: la interfaz detecta "dos juegos con el mismo `igdbId` o el mismo título y año" y ofrece **fusionarlos**, que es un conjunto normal de cambios (mover hijos al superviviente y marcar el otro como borrado). Por eso `igdbId` lleva índice pero **no** restricción única.

### §7.3 Columnas comunes de sincronización

Toda tabla sincronizada lleva:

| Columna       | Tipo        | Significado                                                                                                                                              |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | TEXT, PK    | §7.2                                                                                                                                                     |
| `syncCreated` | TEXT        | Reloj (§8.2) de la creación más antigua conocida de la fila                                                                                              |
| `syncUpdated` | TEXT        | El mayor reloj de la fila. Sirve para ordenar y para saber si cambió                                                                                     |
| `syncFields`  | TEXT (JSON) | Mapa `columna → reloj`, **solo** para las columnas cuyo reloj es distinto de `syncCreated`. Es una forma compacta de guardar un reloj por columna (§8.3) |
| `syncDeleted` | TEXT, null  | Reloj de la lápida. `null` = viva                                                                                                                        |
| `syncDirty`   | INTEGER     | Solo local: 1 = pendiente de subir. No se envía                                                                                                          |

El hub añade `syncSeq INTEGER`: el número de secuencia del inquilino en el que la fila cambió por última vez (§8.4).

**Cada columna tiene siempre un reloj.** La codificación de arriba solo ahorra espacio; al fusionar y al viajar, los relojes son explícitos. Hay un reloj especial, `BOTTOM`, menor que cualquier otro, para "nadie ha escrito esto todavía": lo llevan las columnas que no se indican al crear una fila y las que añade una migración. Sin él se pierden datos (§8.3).

### §7.4 Tablas

Notación: **(U)**, **(O)**, **(C)**, **(L)** según §7.1. Solo se listan las columnas propias; las de §7.3 se dan por incluidas en las sincronizadas.

#### `devices` (U)

| Columna         | Notas                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| `name`          | Editable. Por defecto, el nombre del equipo                                         |
| `kind`          | `desktop` \| `web` \| `legacy`                                                      |
| `os`            | `windows` \| `linux` \| `web`. En la 2.0 todos los escritorios son `windows` (D-14) |
| `home`          | Carpeta de usuario, para generar redirects al restaurar partidas                    |
| `appVersion`    | Última versión vista                                                                |
| `schemaVersion` | Última versión de esquema vista                                                     |
| `firstSeenAt`   |                                                                                     |
| `lastSeenAt`    | Se actualiza como mucho una vez al día, para no generar ruido                       |
| `revokedAt`     | Dispositivo dado de baja                                                            |

Hay dos dispositivos especiales por inquilino: `web` (lo que se hace desde el móvil) y `legacy` (dueño de las sesiones migradas de 1.x, cuyo origen no se conoce).

#### `games` (U)

Identidad y datos que el usuario decide.

| Columna                                                                                     | Notas                                                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `title`                                                                                     |                                                                                                                   |
| `igdbId`, `steamAppId`, `raGameId`, `sgdbId`                                                | Claves hacia las fuentes externas. Indexadas, no únicas                                                           |
| `steamAppIdSource`, `sgdbIdSource`                                                          | `auto` \| `manual`. Una clave fijada a mano no la sustituye ningún refresco. Generaliza `steamAppIdManual` (F-36) |
| `coverOverride`, `heroOverride`, `developerOverride`, `publisherOverride`, `genresOverride` | Lo que el usuario ha fijado a mano. `null` = usar el valor automático de `game_metadata` (D-22)                   |
| `notes`                                                                                     |                                                                                                                   |
| `endless`, `isEmulated`                                                                     |                                                                                                                   |
| `addedAt`, `promotedAt`                                                                     | `promotedAt` se conserva mientras exista la heurística de §7.5                                                    |
| `saveBackupEnabled`, `saveDetectionSource`, `saveLudusaviName`, `saveCustomPaths`           | Capa portable de las partidas, como hoy                                                                           |
| `saveKey`                                                                                   | Prefijo del juego en el bucket: `igdbId` si existe, si no el `id`                                                 |

Salen de `games`: las rutas (a `game_installs`), toda la caché externa (a `game_metadata` y `external_checks`), `planned` y `planPinnedAt` (a `plan_entries`) y `curiositiesGeneratedAt` (a `game_curiosities`).

#### `game_metadata` (C)

Una fila por juego. Solo la escribe el refresco.

`coverUrl`, `heroUrl`, `officialPlatforms`, `genres`, `developer`, `publisher`, `releaseYear`, `releaseDate`, `releaseDatePrecision`, `summary`, `igdbCollections`, `hltbMain`, `hltbMainExtras`, `hltbCompletionist`, `ratingCritics`, `ratingCriticsCount`, `ratingUsers`, `ratingUsersCount`, `steamTags`, `steamPositive`, `steamNegative`.

Regla de escritura: **solo se escribe un campo si su valor cambia.** El refresco semanal deja de reescribir la biblioteca entera (F-33).

**Valor efectivo (D-22).** Para carátula, banner, desarrollador, distribuidora y géneros, lo que se muestra es `games.…Override` si existe y, si no, el valor de `game_metadata`. El refresco solo escribe en `game_metadata`; el usuario solo escribe en `games`. Ninguno puede pisar al otro, y "volver al automático" es poner el override a `null`.

#### `external_checks` (C)

Sustituye a las ocho variantes de F-34. Una fila por juego y fuente.

| Columna       | Notas                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gameId`      |                                                                                                                                                            |
| `source`      | `igdb` \| `igdb_ratings` \| `steam_appid` \| `steam_store` \| `steam_achievements` \| `ra_match` \| `ra_achievements` \| `hltb` \| `sgdb` \| `curiosities` |
| `status`      | `ok` \| `empty` \| `error`. `empty` = la fuente respondió que no tiene nada                                                                                |
| `checkedAt`   |                                                                                                                                                            |
| `nextCheckAt` | Cuándo volver a preguntar. `null` = solo a mano                                                                                                            |
| `error`       | Último error, para mostrarlo                                                                                                                               |

La política de cada fuente (cada cuánto, con qué pausa, cuántos reintentos) pasa a ser una tabla de configuración en código, en un solo sitio.

Las comprobaciones que dependen de ficheros de este PC (emuladores de Steam) **no** van aquí: su estado es local (§7.6).

#### `game_installs` (O)

| Columna            | Notas                                              |
| ------------------ | -------------------------------------------------- |
| `gameId`           |                                                    |
| `deviceId`         | Dueño                                              |
| `executablePath`   |                                                    |
| `installDirectory` |                                                    |
| `installSizeBytes` |                                                    |
| `lastVerifiedAt`   | Última vez que este PC comprobó que la ruta existe |

Sincroniza para que la ficha pueda decir "instalado en PC-A y PC-B". Solo el dueño escribe su fila. El watcher lee únicamente las de su dispositivo (§11).

#### `emulators` (U) y `emulator_installs` (O)

`emulators`: `name`. `emulator_installs`: `emulatorId`, `deviceId`, `executablePath`.

#### `plan_entries` (U)

Una fila por juego planeado. Sustituye a `games.planned`, a la iteración vacía y al evento `plan_to_play` (F-12).

| Columna     | Notas                                                                |
| ----------- | -------------------------------------------------------------------- |
| `gameId`    |                                                                      |
| `plannedAt` |                                                                      |
| `pinnedAt`  | "Up next". `null` = cola normal                                      |
| `sortKey`   | Texto de orden fraccionario: mover un elemento escribe una sola fila |
| `note`      |                                                                      |

Un juego está "planeado" si tiene `plan_entries` viva. Promocionarlo a la biblioteca marca la fila como borrada (lápida) y fija `games.promotedAt`.

#### `playthroughs` (U) — antes `iterations`

| Columna                              | Notas                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `gameId`                             |                                                                                                |
| `customLabel`                        | `null` = etiqueta automática                                                                   |
| `playedPlatform`, `origin`, `format` |                                                                                                |
| `manualHours`                        | Antes `manualTotalPlayed`. Significado único: **horas no medidas que se suman** a las sesiones |
| `rating`                             | 1-5                                                                                            |
| `extraContent`                       |                                                                                                |

La etiqueta "Playthrough N" deja de guardarse: N es la posición del playthrough dentro del juego ordenando por `syncCreated`. Dos PCs que crean cada uno "el segundo" ya no producen dos "Playthrough 2".

#### `state_events` (U)

`playthroughId`, `type` (`started` \| `completed` \| `dropped` \| `on_hold` \| `resting`), `occurredAt`, `datePrecision` (`year` \| `month` \| `day` \| `datetime` \| `unknown`), `note`, `deviceId` (informativo).

- `plan_to_play` desaparece como tipo (lo cubre `plan_entries`).
- `unknown` sustituye a la adivinación por cercanía temporal (§7.5).
- Desempate entre eventos con el mismo `occurredAt`: por `syncCreated` (F-09).

#### `sessions` (O)

| Columna                                                | Notas                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `playthroughId`                                        | `null` = sesión de emulador sin asignar                                      |
| `emulatorId`                                           |                                                                              |
| `deviceId`                                             | **Obligatorio.** Dónde se jugó. Dueño de la sesión                           |
| `startedBy`                                            | `watcher` \| `play` \| `timer`                                               |
| `source`                                               | `measured` \| `legacy_manual`. Sustituye a `isManual`                        |
| `startedAt`, `endedAt`, `durationSec`, `datePrecision` |                                                                              |
| `lastSeenAt`                                           | Señal de vida **para los demás**. El dueño la actualiza como mucho cada 60 s |
| `closedBy`                                             | `owner` \| `janitor` \| `user`. Quién la cerró (§10.5)                       |
| `note`                                                 | Editable desde cualquier dispositivo                                         |

Quién puede escribir qué:

| Campo                                                    | Dueño | Otros dispositivos                     |
| -------------------------------------------------------- | ----- | -------------------------------------- |
| `startedAt`, `lastSeenAt`                                | Sí    | No                                     |
| `endedAt`, `durationSec`, `closedBy`                     | Sí    | Solo el barrido de abandonadas (§10.5) |
| `note`, `playthroughId` (asignar una sesión de emulador) | Sí    | Sí                                     |
| Borrar (lápida)                                          | Sí    | Sí, si está cerrada                    |

Las sesiones `timer` son la excepción: su dueño es el dispositivo `web`, pero cualquier dispositivo del usuario puede pararlas, como hoy.

#### `spend_events` (U)

`gameId`, `playthroughId` (opcional; `null` = repartir por fecha como hoy), `type`, `amount`, `currency` (D-23), `occurredAt`, `datePrecision`, `note`.

#### `achievement_catalogs` (C) — antes `achievements`

Una fila **por juego y fuente**, con el catálogo entero en una columna JSON: `gameId`, `source` (`steam` \| `ra`), `items` (lista de `apiName`, `displayName`, `description`, `iconUrl`, `iconGrayUrl`, `hidden`, `globalPercent`, `sortIndex`), `fetchedAt`.

Por qué agrupado: el catálogo real son 40.452 logros. Sincronizado fila a fila cuesta 161.889 filas escritas en el hub, más que el cupo gratuito de un día entero; agrupado son 1.812, y refrescar un juego son 2 (medido en `spikes/hub-do`, §20.1.2). Es caché: se escribe entera cuando cambia y no necesita fusión por campo. El escritorio puede mantener, si le conviene para sus consultas, una tabla local desplegada que se reconstruye a partir de esta.

#### `achievement_unlocks` (U)

`gameId`, `source`, `apiName`, `origin` (`steam` \| `ra` \| `emu@<deviceId>`), `unlockedAt`, `dateReliable`, `playthroughId`, `sessionId`. Fila a fila: es dato del usuario y sí se fusiona por campo. Se enlaza con su logro por (`gameId`, `source`, `apiName`), no por un id de fila.

Cada PC escribe su propia fila `emu@<su id>`. La lectura sigue fusionando por la fecha más temprana, ahora también entre PCs. Deja de haber una fila que cada arranque reescribe (F-35).

#### `save_backups` (O)

Como hoy (`gameId`, `backupName`, `r2Key`, `sizeBytes`, `ludusaviName`, `differential`, `parentBackupName`, `locations`, `hasRegistry`, `createdAt`) con estos cambios:

- `deviceId` sustituye a `machineId`; `machineName` y `machineHome` salen de `devices`.
- `contentHash`: huella del contenido de la partida (§12.2).
- `parentContentHash`: huella del estado del que partía este PC cuando hizo el backup (§12.3).

#### `game_curiosities` (C)

Una fila por juego: `items` (JSON con las curiosidades), `generatedAt`, `model`. Sustituye a la tabla `curiosities` y a `curiositiesGeneratedAt`. Regenerar es escribir encima.

#### `generated_memories` (C), `radar_games` (C)

Sin cambios de fondo. `radar_games.dismissedAt` es dato del usuario y se fusiona por campo como cualquier otro.

#### Tablas que desaparecen

- `plan_mailbox`: el móvil escribe directamente a través del hub (§13).
- `curiosities`: sustituida por `game_curiosities`.

### §7.5 Tratamiento de las heurísticas heredadas

**Fecha desconocida.** Hoy "el evento de alta no tiene fecha real" se deduce de que `occurredAt` cae a menos de 5 s de `addedAt` o `promotedAt`. En la 2.0 se escribe `datePrecision = 'unknown'` de forma explícita. La heurística se aplica **una sola vez**, en el importador (§19.5), y deja de existir en el código de lectura.

**Horas manuales.** `manualHours` significa siempre "se suma a lo medido". El importador conserva el número que el usuario ve hoy en cada playthrough (§19.5): si hay ambigüedad, gana lo que se muestra en pantalla en la 1.x.

### §7.6 Estado local (clase L)

Tablas en la misma base local, marcadas como no sincronizadas:

| Tabla                 | Contenido                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- |
| `local_session_beats` | `sessionId`, `beatAt`. Latido de 5 s para recuperarse de un corte (§10.3)             |
| `local_sync_state`    | Cursor de descarga, último push y pull correctos, último error, versión de protocolo  |
| `local_save_state`    | Por juego: `lastSyncedHash` (§12.3), ubicación elegida para restaurar                 |
| `local_emu_state`     | Estado de lectura de ficheros de emuladores de Steam en este PC                       |
| `local_legacy_ids`    | Mapa `tabla, id 1.x → id 2.0`, para enlaces antiguos y para remapear ficheros locales |
| `local_job_state`     | Últimas ejecuciones locales de trabajos de fondo                                      |

Siguen como ficheros en la carpeta de datos: `config.json`, `credentials.json`, `scan-cache.json`, `ra-state.json`. `machine-saves.json` conserva la identidad del dispositivo y pasa a escribirse de forma atómica (§12.6).

### §7.7 Integridad

- Claves foráneas declaradas **solo en el cliente**, y **sin** acciones en cascada: el borrado es lógico, y quien borra un padre marca también a sus hijos en la misma transacción.
- **El hub no declara claves foráneas.** En un Durable Object, una clave foránea rota al confirmar reinicia el objeto entero (medido, §20.1.2); y el hub tiene que poder guardar un hijo cuyo padre aún no ha llegado.
- **Al descargar, el cliente desactiva las claves foráneas** y, al terminar la descarga completa, cuenta los huérfanos. Comprobarlas al final de cada página no basta: un padre editado después que su hijo viaja en una página posterior, y la descarga se atasca para siempre (agujero H-4, §20.1.2). Entre página y página puede haber huérfanos reales; por eso la puerta de escritura solo toca las columnas que cambian.
- Regla de lectura: un hijo cuyo padre está marcado como borrado se trata como borrado. Cubre el caso "inserté un hijo offline y el padre se borró en otro PC" (F-11).
- En la 2.0 las lápidas no se purgan (D-25). El volumen lo permite y evita toda una clase de errores.
- Restricciones que sí se pueden imponer en local:
  - Como mucho una sesión abierta por dispositivo y objetivo vigilado. **La impone la puerta de escritura, no un índice único** (corregido en la fase 2): un índice único no se puede desactivar durante la descarga, y una fila ajena que lo violase la atascaría para siempre, como en H-4. Por lo mismo, ninguna tabla sincronizada lleva índices ni restricciones únicas; la unicidad la dan los ids deterministas y compuestos.
  - `sessions`: `playthroughId` o `emulatorId`, al menos uno.
- Restricciones que **no** se pueden imponer entre dispositivos y se tratan como estados posibles: dos playthroughs activos del mismo juego, creados offline en dos PCs. La derivación de estado los tolera (gana el de `syncCreated` más reciente) y la ficha ofrece fusionarlos (§10.7).

### §7.8 Índices

Todos los que faltaban en la 1.x se crean desde el principio: `sessions(playthroughId)`, `sessions(deviceId, endedAt)`, `sessions(emulatorId)`, `sessions(startedAt)`, `state_events(playthroughId)`, `playthroughs(gameId)`, `spend_events(gameId)`, `achievement_unlocks(gameId)`, `achievement_unlocks(sessionId)`, `save_backups(gameId)`, `game_installs(deviceId)`, `external_checks(source, nextCheckAt)`, y `syncDirty` parcial en cada tabla sincronizada.

### §7.9 Dónde vive cada cosa

| Qué                                                   | Dónde                                                                                       | Quién lo ve                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| Base completa de cada PC                              | `Afterplay2.db`, en la carpeta de datos de la app de ese PC. SQLite normal, un solo fichero | Ese PC                       |
| Base 1.x                                              | `Afterplay.db`, en la misma carpeta. La 2.0 no la abre ni la modifica                       | Solo sirve para volver atrás |
| Copia de reparto de cada persona                      | El SQLite del Durable Object de esa persona, en la cuenta de Cloudflare del anfitrión       | Sus dispositivos y su móvil  |
| Estado local (latidos, cursor, instalaciones propias) | Tablas locales de `Afterplay2.db`; no salen del PC                                          | Ese PC                       |
| Partidas guardadas                                    | El bucket de cada persona, como hoy                                                         | Sus PCs                      |
| Base remota de Turso                                  | Deja de usarse tras el corte. Se conserva 60 días y luego se archiva                        | Nadie                        |

Dos consecuencias:

- **Cada PC tiene todos los datos.** El hub es una copia de reparto, no el original: si desaparece, cualquier PC vuelve a sembrar uno nuevo (§9.6).
- **Los datos de la segunda persona viven en la cuenta de Cloudflare del anfitrión**, en un almacén separado. No es peor que hoy, donde el Worker del anfitrión ya tiene un token de escritura sobre su base, pero conviene que lo sepa.

**Copias de seguridad locales.** Se conservan las copias diarias y manuales de la base local, con su rotación. A diferencia de la 1.x, **restaurar una copia antigua es seguro**: sus filas llevan relojes antiguos, así que al sincronizar ganan las versiones más nuevas del hub y solo se recupera lo que el hub no tuviera. La 2.0 puede ofrecer "restaurar copia" desde Ajustes, que en la 1.x no existe.

---

## §8. Sincronización

### §8.1 Modelo

**Basado en estado, con última-escritura-gana por campo** (D-09). No hay log de operaciones: lo que viaja es "la fila X tiene ahora estos valores, y cada uno se escribió en este instante lógico". La fusión es la misma función en el cliente y en el hub.

Por qué no un log de operaciones: obliga a compactar, a hacer instantáneas y a razonar sobre el orden de reproducción. Con filas versionadas, sembrar un dispositivo nuevo es "dame todo desde cero" y la fusión es idempotente por construcción: aplicar dos veces lo mismo, o en otro orden, da el mismo resultado.

Por qué por campo y no por fila: `games` y `playthroughs` tienen campos que cambian por caminos distintos (el usuario edita notas, el refresco cambia la carátula). Fusionar por fila los haría pisarse.

### §8.2 Reloj

Reloj lógico híbrido por dispositivo. Formato de ancho fijo, comparable como texto:

```
<milisegundos, 13 dígitos>-<contador, 4 dígitos>-<id corto del dispositivo>
```

- Al escribir: `max(reloj de pared, último reloj visto) + 1` en el contador si coincide el milisegundo.
- Al recibir una fila: el dispositivo adelanta su reloj hasta el mayor que haya visto.
- El id del dispositivo desempata: el orden es total y determinista.
- Protección contra relojes de pared adelantados: el hub rechaza las filas cuyo reloj supere su hora en más de 10 minutos, con un error específico que el cliente muestra ("el reloj de este PC está adelantado").
- **Recuperación de un reloj adelantado.** El reloj lógico se queda en el futuro aunque se corrija el de pared, así que sin más el rechazo sería eterno. Al corregirse, el cliente reinicia su reloj y vuelve a fechar las celdas pendientes de subir que llevaban reloj futuro; es seguro porque el hub nunca las aceptó. El cliente ajusta su reloj con la hora que da `/status`.
- **Arranque.** El reloj empieza por encima del mayor reloj que haya en la base. Importa al restaurar una copia.
- **Contador.** Si el milisegundo no avanza y el contador se agota (10.000 escrituras), se avanza un milisegundo.
- **Id corto único.** El hub asigna el id corto de cada dispositivo al emparejarlo, para que no coincidan dos. Hasta entonces el dispositivo usa uno generado al azar y guardado en su estado local. El id `000000` está reservado: lo usa el barrido de sesiones abandonadas (§10.5) para escribir con el reloj siguiente al del dueño.
- **Reloj de pared atrasado.** Converge, pero sus ediciones offline pierden frente a otras aunque sean posteriores en tiempo real. Es una limitación aceptada.

### §8.3 Fusión

Reescrita tras el spike `spikes/sync-core` (§20.1.2). La versión anterior de esta sección no convergía y perdía datos en dos casos.

Cada columna de una fila tiene **su propio reloj, siempre explícito** al fusionar. Para una fila entrante `E` y la almacenada `A` (misma tabla e `id`):

1. Si `A` no existe, se inserta `E`.
2. Para **cada columna** de la fila (no solo las que trae `E`): gana el valor con el reloj mayor. Si los relojes empatan, decide el valor, con un orden fijo, para que todos elijan el mismo.
3. `syncDeleted` es una columna más y gana la escritura más reciente. Al crear una fila lleva el reloj de creación (no `BOTTOM`): por eso volver a añadir un juego borrado, que tiene id determinista, lo resucita. Sus hijos siguen borrados.
4. `syncCreated` es el menor de los dos; `syncUpdated`, el mayor reloj resultante.
5. Tras fusionar se vuelve a la forma compacta: `syncFields[c]` existe si y solo si el reloj de `c` es distinto de `syncCreated`.
6. Las columnas que el receptor no conoce se ignoran al aplicar y **no se pierden**: el emisor solo manda las suyas y el hub conserva las demás (§8.7).

Dos reglas al escribir, sin las cuales la fusión pierde datos:

- **Al crear una fila, las columnas que no se indican llevan `BOTTOM`**, no el reloj de creación. Si dos PCs añaden offline el mismo juego (mismo id), el segundo no pisa con valores vacíos las notas que escribió el primero.
- **Una columna que añade una migración nace con `BOTTOM`** en las filas existentes. Si heredara el reloj de creación, su valor por defecto empataría con el valor real que escriba otro dispositivo.

Propiedades demostradas en el spike con 20.000 casos aleatorios cada una: conmutativa, asociativa e idempotente. Convergencia comprobada con 3 réplicas y un hub en 2.000 secuencias aleatorias de 300 pasos.

### §8.4 Protocolo

Rutas bajo `/sync/v1`, con el token del dispositivo en la cabecera `Authorization`.

| Ruta                | Para qué                                                                              |
| ------------------- | ------------------------------------------------------------------------------------- |
| `POST /enroll`      | Canjea un código de emparejado por un token de dispositivo (§9.3)                     |
| `GET /status`       | Versión de protocolo, rango de esquema admitido, hora del hub                         |
| `POST /push`        | Sube filas modificadas. Respuesta: aceptadas, rechazadas con motivo, secuencia actual |
| `GET /pull?since=N` | Filas con `syncSeq > N`, en orden, paginadas. Respuesta: filas, `next`, `more`        |
| `POST /jobs/claim`  | Pide una concesión para un trabajo (§14.3)                                            |
| `POST /jobs/done`   | Cierra o libera una concesión                                                         |

Forma de una fila en tránsito:

```json
{
  "table": "sessions",
  "id": "0194c2f0-…",
  "created": "1763020800123-0000-a1b2c3",
  "deleted": null,
  "fields": { "endedAt": 1763024400000, "durationSec": 3600 },
  "clocks": { "endedAt": "1763024400017-0000-a1b2c3", "durationSec": "1763024400017-0000-a1b2c3" }
}
```

En el hub, cada cambio aceptado incrementa la secuencia del inquilino y la anota en la fila. `pull` devuelve "todo lo que cambió después de N". Un dispositivo recibe también el eco de sus propias subidas; la fusión lo absorbe sin efecto.

Reglas que salieron de los spikes (§20.1.2):

- **El hub no incrementa la secuencia si la fusión no cambia nada**, ni escribe en `tenant_meta`. Sin eso el eco nunca se agota y cada subida vacía cuesta una escritura.
- **Las subidas se agrupan.** Subir los cambios de uno en uno casi duplica las filas escritas; un día normal en un solo lote son 571 frente a 960.
- **Tamaño de lote.** Subida: como mucho 200 filas o 256 KB. Medido en Cloudflare: un lote de 100 cuesta 11-12 ms de CPU, uno de 200 cuesta 18 y uno de 500 cuesta 65, así que el coste por fila sube con el tamaño. Descarga: 1.000 filas por página (8-20 ms). El hub anuncia sus máximos en `/status`.
- **Límites de la API SQL del Durable Object** que el hub respeta: 100 parámetros y 100.000 bytes por sentencia; las búsquedas por id van en trozos de 99.
- **Hub nuevo o retrocedido.** El hub tiene un identificador y una época. Si cambian, o si el cursor del cliente es mayor que la secuencia del hub, el cliente vuelve a subirlo todo.
- **Filas que cambian durante una descarga paginada** se vuelven a entregar al final; no se pierde ninguna.

### §8.5 Motor del cliente

Ciclo:

1. **Subir.** Selecciona las filas con `syncDirty = 1`, las envía en lotes y, para cada una aceptada, borra la marca **solo si la fila no ha vuelto a cambiar** desde que se leyó (se compara `syncUpdated`).
2. **Bajar.** Pide desde el cursor guardado, aplica cada página en una transacción con la fusión de §8.3 y guarda el cursor en la misma transacción.
3. **Avisar.** Emite un evento con los dominios y los ids afectados (§15.4).

Cuándo se dispara:

| Disparador                                      | Detalle                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Arranque                                        | Primer ciclo con límite de tiempo antes de las tareas de fondo |
| Cambio local                                    | Agrupado: 2 s después del último cambio                        |
| Periódico                                       | Cada 60 s                                                      |
| Vuelta de suspensión, desbloqueo, red de vuelta |                                                                |
| Cierre de la app                                | Subida final con un tope de 5 s (§10.6)                        |

Un solo ciclo a la vez. Los fallos se reintentan con espera creciente y quedan en `local_sync_state` y en el log (§16).

### §8.6 La puerta única de escritura

Para que ningún cambio se quede sin marcar, **todas** las escrituras a tablas sincronizadas pasan por un módulo (`src/main/db/store/`) que:

- compara el parche con la fila y calcula qué columnas cambian;
- les asigna el reloj actual en `syncFields`;
- fija `syncUpdated` y `syncDirty = 1`;
- convierte los borrados en lápidas y marca a los hijos.

Dos barreras para que nadie la esquive:

- Una regla de lint que prohíbe importar los objetos de tabla sincronizada fuera de ese módulo y del motor de sync.
- Un test que recorre el esquema y falla si una tabla sincronizada no tiene las columnas de §7.3 o no está registrada en el motor.

El hub usa el mismo módulo de fusión; las escrituras del móvil entran por él con el reloj del dispositivo `web`.

### §8.7 Versionado del esquema y versiones mezcladas

- `protocolVersion`: cambia solo si cambia la forma de hablar. `schemaVersion`: entero que sube con cada migración que afecte a tablas sincronizadas.
- **Regla de despliegue: el hub va siempre por delante o a la par de cualquier cliente.** Se despliega primero.
- **Migraciones solo aditivas en 2.x** para tablas sincronizadas: columnas nuevas con valor por defecto, tablas nuevas. Nunca renombrar ni borrar; un renombrado es "columna nueva y dejar de usar la vieja". Toda columna nueva nace con reloj `BOTTOM` en las filas existentes (§8.3).
- Cliente más viejo que el hub: sigue funcionando. Solo envía las columnas que conoce; el hub conserva las que no. Ignora las columnas y tablas que no entiende al bajar.
- Cliente que se actualiza y gana tablas o columnas: pone su cursor a cero y vuelve a bajar todo. Es barato (pocos MB) y la fusión es idempotente.
- Cliente por debajo del mínimo admitido (`minSchema`, que el hub sube en cambios incompatibles): el hub responde con un código específico; el cliente deja de sincronizar, sigue en local y muestra "actualiza Afterplay para volver a sincronizar". Nunca escribe a ciegas (F-15).
- El esquema no viaja: desaparecen `pushMigrationsToRemote`, `migrateWithoutCapture`, `remoteSchemaAhead`, `pendingTableRebuild` y todo lo que el apéndice A lista como parche de DDL.

### §8.8 Qué no hace el sync

- No impone invariantes entre filas (§7.7). Las detecta la lectura.
- No ordena causalmente entre dispositivos más allá del reloj.
- No sincroniza ficheros. Las partidas van al bucket.

### §8.9 Driver local

Con `@tursodatabase/sync` fuera, la base local es un SQLite normal. Con una sola conexión para toda la vida del proceso desaparecen el cambio de conexión en caliente, `withDbAccess` como candado y los ficheros satélite del motor de sync.

**El driver tiene que ser síncrono.** El núcleo de sync se escribe una vez y corre en el hub y en el escritorio, y la API SQL de un Durable Object es síncrona. La propuesta inicial, `@libsql/client`, es asíncrona y no sirve para ejecutar ese mismo núcleo. Candidatos:

| Driver           | Síncrono | Dependencia nativa                     | Estado                                                                                                               |
| ---------------- | -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `node:sqlite`    | Sí       | Ninguna                                | Comprobado dentro de Electron 44 (Node 24.21, SQLite 3.53): disponible y funciona. Es el que usa el spike del núcleo |
| `better-sqlite3` | Sí       | Sí, hay que recompilarla para Electron | Sin probar. Plan B                                                                                                   |
| `@libsql/client` | No       | Ya instalada                           | Rápido de sobra (medido con los datos reales), pero asíncrono                                                        |

Propuesta: `node:sqlite`. Pendiente de confirmar antes de comprometerse: el grado de estabilidad que Node le asigna en la versión que trae Electron, y su comportamiento en ejecuciones largas.

---

## §9. Hub

### §9.1 Piezas

| Pieza                      | Responsabilidad                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Worker `afterplay-hub`     | Punto de entrada. Autentica, identifica al inquilino y delega. Sirve la PWA                               |
| Durable Object `TenantHub` | Uno por persona. Guarda sus filas en su SQLite, fusiona, sirve `pull`, arbitra concesiones, tiene alarmas |
| Durable Object `Directory` | Uno para todo el despliegue. Inquilinos, invitaciones, correo → inquilino                                 |
| Núcleo `hub-core`          | TypeScript puro: fusión, consultas de dominio, concesiones. Sin nada específico de Cloudflare             |

### §9.2 Autenticación

Dos puertas con mecanismos distintos:

- **PWA (`/` y `/api/v2/*`)**: Cloudflare Access, como hoy. El correo del JWT se traduce a inquilino en `Directory`. Fallo cerrado: correo desconocido, 403.
- **Dispositivos (`/sync/v1/*`)**: token propio. Access no cubre estas rutas (los clientes no son navegadores). El token tiene la forma `ap1.<inquilino>.<secreto>`: el Worker enruta por el inquilino y el `TenantHub` comprueba el secreto contra su huella guardada. Los tokens se guardan en el PC cifrados como el resto de credenciales, se listan en Ajustes y se pueden revocar.

El secreto `TENANTS` desaparece. El hub no guarda credenciales de terceros de ningún inquilino (F-29).

### §9.3 Emparejado

- **Primer inquilino (el anfitrión).** `ADMIN_EMAIL` es una variable del Worker. La primera vez que ese correo entra por la PWA, se crea su inquilino.
- **Primer PC de una persona.** En la PWA: "Añadir dispositivo" muestra un código de un solo uso que caduca en minutos. En el PC: dirección del hub y código. El PC recibe su token.
- **Siguientes PCs durante la migración.** Sin teclear nada: el primer PC deja en la base 1.x (Turso) la dirección del hub y un secreto de alta de varios usos con caducidad; los demás lo leen al actualizarse (§19.6). Después de la migración, un PC nuevo se empareja con código.
- **Otra persona (D-03).** El anfitrión crea una invitación para su correo desde la PWA. Esa persona entra con su correo (Access) y empareja su primer PC con un código. El anfitrión no toca nada suyo.

Las claves de IGDB para la búsqueda desde el móvil las sube el propio escritorio de cada persona al emparejarse (ya las tiene en local) y se guardan cifradas en su `TenantHub`. Nadie las copia a mano.

### §9.4 Almacenamiento

Dentro de cada `TenantHub`:

- Las mismas tablas sincronizadas de §7.4, con `syncSeq`.
- `tenant_meta`: secuencia actual, `minSchema`, fecha de creación.
- `device_tokens`: huella del token, dispositivo, creado, último uso, revocado.
- `job_leases`: concesiones (§14.3).

El esquema del hub se define con las mismas definiciones de tabla que el cliente (S-01, comprobado: §20.1.2), con dos diferencias: el hub no declara claves foráneas (§7.7) y tiene sus tablas propias.

### §9.5 Barridos en el servidor

Una alarma periódica del `TenantHub` sustituye al "GET que escribe" de hoy:

- Cierra sesiones abandonadas (§10.5).
- Caduca concesiones vencidas.
- Caduca códigos y secretos de alta.

### §9.6 Portabilidad (D-05)

`hub-core` no importa nada de Cloudflare. Depende de dos interfaces pequeñas: almacenamiento SQL síncrono y reloj. Hay dos adaptadores:

- **Durable Object**: el de producción.
- **Node, en memoria o fichero**: el de los tests (§17.2). Es, de paso, la mitad de un servidor autoalojado.

Empaquetar ese adaptador como servidor (HTTP, autenticación del móvil sin Access, imagen de contenedor) queda fuera de la 2.0 (D-19), pero el diseño no lo impide y el trabajo pendiente es acotado.

Garantía de fondo: el hub no tiene datos únicos. Mudarse es desplegar otro hub, emparejar un PC y dejar que suba todo.

### §9.7 Límites de Cloudflare

Límites del plan gratuito a 2026-11-13, por cuenta y por día (se reinician a medianoche UTC):

| Límite                       | Valor     |
| ---------------------------- | --------- |
| Peticiones al Worker         | 100.000   |
| Peticiones a Durable Objects | 100.000   |
| Filas leídas (SQLite)        | 5.000.000 |
| Filas escritas (SQLite)      | 100.000   |
| Almacenamiento total         | 5 GB      |
| CPU por petición del Worker  | 10 ms     |

Fuentes: [precios de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/). Al superar un límite, las operaciones de ese tipo fallan hasta el reinicio.

Uso estimado (estimación, no medición) con dos personas y cuatro PCs encendidos todo el día:

| Concepto                    | Cálculo                                   | Resultado        |
| --------------------------- | ----------------------------------------- | ---------------- |
| Sondeo periódico            | 4 PCs × 1.440 ciclos × 2 peticiones       | ~11.500 pet.     |
| Señal de vida de una sesión | 60 escrituras/hora × ~4 filas con índices | ~240 filas/h     |
| Día normal de uso           | sesiones, eventos, ediciones              | cientos de filas |
| Uso desde el móvil          | decenas de peticiones                     | despreciable     |

Margen de uno a dos órdenes de magnitud. Los dos casos que sí pueden rozar el límite de filas escritas:

- **La siembra inicial** (§19.7). Medido con el volumen real en `spikes/hub-do`: los datos del usuario son unas 16.000 filas escritas (cada índice cuenta como una escritura más: una sesión son 7) y caben el primer día. El catálogo de logros fila a fila serían 161.889, más que el cupo diario; por eso va agrupado por juego (§7.4), que son 1.812. El importador sube por prioridad (datos del usuario primero, caché después), en lotes, y si el hub responde "cuota agotada" continúa al día siguiente sin perder nada.
- **Refrescos masivos de caché.** Resuelto con la regla "solo se escribe lo que cambia" (§7.4).

Medido en Cloudflare el 2026-11-13 con un despliegue de prueba (§20.1.2): la CPU no es el problema. La biblioteca del móvil consume 6-17 ms dentro del Durable Object, cuyo límite es de 30 s por petición. Lo que sí pesa es el cupo de **filas leídas**: esa consulta lee 11.207 filas, así que el cupo gratuito de 5 millones da para unas 446 al día entre todos los inquilinos. Medida: el hub guarda el resultado en caché y solo lo recalcula cuando cambia la secuencia del inquilino; si aun así no bastara, tablas de proyección.

Si el hub no está disponible, los PCs siguen en local y se ponen al día después. Ese es el comportamiento de diseño, no un modo degradado.

---

## §10. Sesiones y watcher

### §10.1 Regla central

**Solo el dispositivo dueño de una sesión la adopta, la late y la cierra.** Todo lo demás de esta sección se sigue de ahí. Resuelve F-01, F-02 y F-03.

### §10.2 Ciclo de vida

```
            abrir (watcher/play, en el dueño)
                        │
                        ▼
   ┌──────────────── ABIERTA ────────────────┐
   │  latido local cada 5 s (no sincroniza)  │
   │  señal de vida cada 60 s (sincroniza)   │
   └───┬───────────────┬───────────────┬─────┘
       │ proceso muere │ bloqueo/      │ sin señal de vida
       │ o Stop        │ suspensión    │ durante 24 h
       ▼               ▼               ▼
   CERRADA         CERRADA         CERRADA
   closedBy=owner  closedBy=owner  closedBy=janitor
                                   (el dueño puede corregirla
                                    cuando vuelva)
```

### §10.3 Latido en dos niveles

- **Local, cada 5 s**, en `local_session_beats`. Sirve para que el dueño, tras un corte de luz, cierre su sesión en el último instante conocido. No sale del PC (F-05).
- **Señal de vida, cada 60 s**, en `sessions.lastSeenAt`. Sirve para que los demás dispositivos sepan si la sesión sigue viva.

### §10.4 Qué hace el watcher con cada sesión abierta

| Sesión                                       | Proceso corriendo aquí | Acción                                                             |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Mía                                          | Sí                     | Seguirla (adoptarla si no la seguía)                               |
| Mía                                          | No, al arrancar        | Cerrarla en mi último latido local                                 |
| Mía                                          | No, tras 120 s         | Cerrarla (el ejecutable nunca apareció)                            |
| De otro dispositivo                          | Indiferente            | **Nada.** Ni adoptar, ni latir, ni cerrar                          |
| De otro dispositivo, y el juego arranca aquí | Sí                     | Abrir **mi** sesión. Habrá dos abiertas, una por PC, y es correcto |
| Cronómetro vivo del mismo juego              | Sí                     | Como hoy: no se abre otra; el tiempo lo lleva el cronómetro        |

La deduplicación de `startGameSession` pasa de "una abierta por juego" a "una abierta por juego **y dispositivo**". Jugar a la vez en dos PCs produce dos sesiones, que es lo que ocurrió, y sus horas se suman (D-15).

`reconcileOpenSessions` y `sweepUnseenWatchedSessions` filtran por `deviceId = este dispositivo`. Ya no importa que la primera corra antes del primer pull: solo decide sobre lo suyo, que conoce mejor que nadie.

Los cierres llevan la guarda `endedAt IS NULL` en la propia escritura.

### §10.5 Sesiones abandonadas

Un PC que murió y no vuelve dejaría su sesión abierta para siempre. La cierra el **barrido del hub** (§9.5):

- Condición: `endedAt` nulo y `lastSeenAt` con más de 24 h (D-21).
- Cierre en `lastSeenAt`, con `closedBy = janitor`.
- **El barrido no escribe con la hora del hub.** Escribe con el reloj inmediatamente siguiente al mayor reloj de los campos del dueño de esa sesión. Así, cuando el dueño vuelve (estuvo offline, no muerto) y sube su cierre real, ese cierre gana siempre, aunque lo hiciera antes de que pasara el barrido. Con la hora del hub, un cierre hecho offline antes del barrido perdía y se perdían horas jugadas (agujero H-3, §20.1.2).
- La misma regla cubre los cronómetros abandonados; desaparece la lógica duplicada entre el watcher y el Worker.
- Sin hub configurado no hay otros dispositivos y el caso no existe.

Cada cierre hecho por un barrido queda en el log (§16).

### §10.6 Salida de la app

`before-quit` pasa a ser un cierre ordenado con tope de tiempo:

1. Cerrar las sesiones propias activas a la hora actual.
2. Lanzar ya los backups de partidas pendientes (sin el retardo de 8 s) y esperarlos hasta un tope.
3. Subida final al hub, con un tope de 5 s.
4. Salir, haya terminado o no. Lo que no dio tiempo se recupera en el siguiente arranque, como hoy.

Resuelve F-04 y F-20. Si el juego sigue corriendo cuando se cierra Afterplay, la sesión se cierra igualmente; al volver a abrir Afterplay se abre otra.

### §10.7 Playthroughs y arranque de sesión

`resolveIterationForPlay` decide a qué playthrough cuelga una sesión nueva y a veces crea uno. Dos PCs offline pueden crear cada uno el suyo.

- **Prevención**: antes de crear un playthrough nuevo, si hay red, un ciclo de sync rápido con tope de tiempo. Sin red, se decide con lo que hay.
- **Tolerancia**: la derivación de estado admite dos playthroughs activos; el vigente es el de `syncCreated` más reciente.
- **Reparación**: la ficha muestra "hay dos playthroughs en curso" y ofrece fusionarlos (mover sesiones y eventos a uno y marcar el otro como borrado).

Todas las derivaciones que usaban el id como orden (F-09) pasan a `syncCreated`.

### §10.8 Interfaz

- Una sesión abierta en otro dispositivo se muestra como "Jugando en PC-A", sin botón Stop.
- Si su `lastSeenAt` tiene más de 3 minutos: "Sin señal desde hace X".
- La lista de sesiones muestra en qué dispositivo se jugó cada una.

---

## §11. Instalaciones por dispositivo

### §11.1 Qué vigila el watcher

Sus objetivos salen de `game_installs` y `emulator_installs` **de este dispositivo**. Un juego instalado solo en otro PC no se vigila aquí. Resuelve F-06 y, de paso, elimina la condición que disparaba F-01.

### §11.2 Cómo se crea una instalación

- **Al elegir el ejecutable** en la ficha: escribe la fila de este dispositivo. La de los demás no se toca.
- **Vinculación automática por escaneo**: cuando el escaneo de carpetas encuentra un juego que ya está en la biblioteca pero sin instalación en este dispositivo, la crea. Hoy ese caso se descarta como "ya en la biblioteca".
- **Reclamo en la migración** (§19.6): si la ruta heredada de la 1.x existe en este disco, se adopta.

### §11.3 Mantenimiento

- Si el ejecutable deja de existir, la instalación no se borra: se marca como no verificada y la ficha lo indica. Borrarla es una acción explícita.
- `installSizeBytes` se recalcula al elegir carpeta, como hoy.

### §11.4 Interfaz

- La ficha muestra las instalaciones conocidas: "Instalado en: PC-A, PC-B".
- "Play" está habilitado solo si hay instalación en este dispositivo. El renderer lanza por `gameId`; el main resuelve la ruta local. La ruta cruda deja de cruzar el IPC.
- Los campos de ruta del modal de edición editan la instalación de este dispositivo y lo dicen.
- Las rutas locales no se envían al móvil (F-31); sí "en qué dispositivos está instalado".

Los logros de emuladores de Steam leen `installDirectory` de la instalación local, así que cada PC lee sus propios ficheros (F-35).

### §11.5 Preparado para Linux (D-14)

La 2.0 no se publica para Linux. Lo que sí hace es no cerrarle la puerta, para que añadirlo después sea sumar y no rehacer:

- **Ningún dato sincronizado asume Windows.** Las rutas viven en filas de un dispositivo (`game_installs`, `emulator_installs`, `devices.home`) y nadie más las interpreta.
- **`devices.os`** existe desde el principio.
- **La detección de procesos queda detrás de una interfaz** con una única implementación, la de Windows: listar procesos, confirmar la ruta, el respaldo del fichero bloqueado y la consulta de pantalla bloqueada. El resto del watcher (sesiones, latidos, cierres) no sabe de sistemas.
- **Las partidas guardadas** ya usan rutas tokenizadas y ludusavi es multiplataforma. Lo que no está resuelto ni probado es restaurar entre sistemas (una partida de Windows dentro de un prefijo de Proton): queda como trabajo de la versión que traiga Linux.
- **El cifrado de credenciales** usa el almacén seguro de Electron, que existe en los tres sistemas.

Lo que faltará entonces: la implementación Linux de la detección de procesos, el empaquetado y la actualización automática, el inicio con el sistema, y probar las rutas de partidas en Proton.

---

## §12. Partidas guardadas

### §12.1 Alcance (D-02)

Restaurar sigue siendo siempre una acción del usuario, y no hay avisos activos. Lo que cambia:

1. **La ficha dice la verdad entre PCs.**
2. Se corrigen los fallos de robustez (F-20 a F-25).
3. El índice deja de depender de un sync poco fiable y no se puede duplicar.

El formato del bucket no cambia: `saves/<clave>/<deviceId>/{mapping.yaml, backup-*.zip}` y `machines/<id>.json`. La 2.0 lee todo lo que escribió la 1.x.

### §12.2 Huella de contenido

`contentHash` identifica el estado de una partida con independencia de la máquina y de la hora:

- Entrada: la lista de archivos del backup, cada uno con su ruta **tokenizada** y su hash (ludusavi ya calcula los hashes por archivo y los deja en `mapping.yaml`), más las claves de registro si las hay.
- Se ordena, se serializa de forma canónica y se le aplica SHA-256.

Dos backups con la misma huella son la misma partida, vengan del PC que vengan.

### §12.3 Linaje

Cada PC recuerda en `local_save_state.lastSyncedHash` la huella de la última partida que **subió o restauró** para ese juego. Al hacer un backup nuevo, la guarda como `parentContentHash`.

Con eso cada backup dice "vengo de este estado", y se puede saber si dos partidas están en la misma línea o han divergido, sin fiarse de los relojes.

### §12.4 Estado que muestra la ficha

Se calcula con tres datos:

- `L`: la huella del disco local ahora.
- `S`: la última huella que este PC subió o restauró.
- **Las puntas**: las partidas de las que no desciende ninguna otra, entre todos los dispositivos. Se obtienen siguiendo `parentContentHash`. Si solo hay una, esa es la cabeza `H`.

Como las lápidas no se purgan (§7.7), el linaje sobrevive a la poda de versiones antiguas: la fila de un backup podado sigue diciendo de quién descendía.

| Puntas      | Disco vs. última mía | Última mía vs. cabeza | Estado                     | Texto                                                       |
| ----------- | -------------------- | --------------------- | -------------------------- | ----------------------------------------------------------- |
| Una         | `L = S`              | `S = H`               | Al día                     | "Al día"                                                    |
| Una         | `L ≠ S`              | `S = H`               | Cambios locales sin copiar | "Hay cambios sin copiar"                                    |
| Una         | `L = S`              | `S ≠ H`               | **Por detrás**             | "Hay una partida más nueva de PC-A (hace 3 h)"              |
| Una         | `L ≠ S`              | `S ≠ H`               | **Divergido**              | "Tienes cambios aquí y hay una partida más nueva de PC-A"   |
| Más de una  | Indiferente          | Indiferente           | **Divergido**              | "Las partidas de PC-A y PC-B han seguido caminos distintos" |
| Ninguna mía | —                    | Hay de otros          | Disponible                 | "Hay una partida de PC-A"                                   |

Con más de una punta, **todos** los PCs ven "divergido", también el que hizo el último backup: el progreso del otro no queda enterrado en silencio. La divergencia se cierra cuando el usuario restaura una de las puntas y sigue jugando desde ella; las demás quedan en el historial.

Si falta un eslabón del linaje (backups de la 1.x, que no tienen `parentContentHash`), no se puede demostrar descendencia. En ese caso se compara por fecha y el estado se muestra como informativo, sin afirmar divergencia.

Calcular `L` exige que ludusavi examine el disco. Se hace al abrir la sección de partidas y tras cerrar una sesión, no en cada pintado.

En "por detrás" y "divergido", la acción destacada es restaurar la versión indicada, con el mismo flujo manual de hoy (copia previa incluida). No hay notificación fuera de la ficha (D-02).

El modelo deja la puerta abierta a restaurar automáticamente en el estado "por detrás" si algún día se quiere: es el único caso en el que sería seguro.

### §12.5 Índice

- `save_backups.id` se deriva de la clave del objeto: recuperar desde el bucket no duplica (F-21).
- El orden entre versiones usa el reloj de sync, no la hora de pared.
- **Borrado cruzado** (F-23): borrar una versión de otro PC marca la fila como borrada. El PC dueño, al ver la lápida, borra su zip local antes de su siguiente backup. El objeto del bucket lo borra quien ejecuta la acción.
- El bucket sigue siendo autosuficiente: `recoverIndexFromCloud` se conserva como herramienta de reparación.

### §12.6 Identidad del dispositivo

- `machine-saves.json` se escribe de forma atómica (escribir a temporal y renombrar).
- Si está corrupto, la app **no** genera un id nuevo en silencio: lo dice y ofrece recuperar la identidad anterior (el hub conoce los dispositivos del inquilino) o crear una nueva a propósito.
- **Id duplicado**: cada instalación publica un valor aleatorio propio junto a su id (en `machines/<id>.json` y en `devices`). Si al arrancar el valor publicado no es el suyo, hay otra instalación con el mismo id: se bloquean la poda y los backups de ese dispositivo hasta que el usuario lo resuelva (F-24).
- Reinstalar: el emparejado ofrece "este PC ya existía, ¿recuperar su identidad?" con la lista de dispositivos, en vez de tener que adoptarlo a mano en Ajustes.

### §12.7 Otros arreglos

- **Juegos sin `igdbId`**: pueden ir a la nube usando `saveKey` (§7.4).
- **Borrar un juego no borra sus copias de partidas** (decisión del usuario, 2026-11-13). En la 1.x, borrar un juego borraba sus copias del bucket, las de todos los PCs. En la 2.0 se quedan, tanto los objetos como su índice: las partidas son irrecuperables, y volver a añadir el juego (mismo id) las recupera. Hace falta dar una forma de limpiar a mano las copias de juegos borrados.
- **Restauración exacta** (F-22): el diálogo de restaurar ofrece "dejar la carpeta exactamente como en la copia (borra lo que sobra)". Desmarcado por defecto: sin tocar nada, restaurar se comporta como hoy (D-20).
- **Subida a R2**: dejar de leer el zip entero en memoria (`r2.ts:186`).
- **Tarjetas de memoria compartidas entre juegos emulados**: hoy solo se advierte. Queda como está, documentado como limitación.
- **Tests** de `syncGameToR2`, `mergeRemoteMapping`, `buildRedirects`, `recovery`, `identity` y del cálculo de estado de §12.4 (F-25).

---

## §13. Móvil

### §13.1 Papel

"Control mínimo de Afterplay desde cualquier sitio." El alcance funcional es el de hoy (D-16): consultar biblioteca, ficha, sesiones, logros y plan; llevar un cronómetro; añadir, fijar y reordenar el plan. Sin conexión no funciona (D-24).

Lo que cambia es cómo: la PWA es un cliente del hub. Lee el estado del inquilino y escribe por la misma puerta de fusión que los PCs, con el reloj del dispositivo `web`.

### §13.2 Lecturas

`/api/v2/*`, detrás de Access. El `TenantHub` ejecuta las funciones de `src/shared/domain` (§15.2) sobre sus filas. No hay consultas reimplementadas (F-26): los tests de paridad dejan de existir porque ya no hay dos implementaciones que comparar.

### §13.3 Escrituras

| Acción                        | Hoy                                    | 2.0                                                                                                                                 |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fijar, soltar, reordenar plan | Buzón; se aplica cuando un PC lo drena | Escritura directa en `plan_entries`. Inmediata                                                                                      |
| Arrancar o parar cronómetro   | Inserción directa en Turso             | Escritura en `sessions` serializada por el Durable Object. Sin carrera                                                              |
| Añadir un juego al plan       | Buzón; lo crea un PC                   | El hub crea `games` y `plan_entries` al instante con lo que da la búsqueda (título, `igdbId`, carátula) y encola el enriquecimiento |

- El buzón desaparece, y con él F-27.
- La comprobación "¿hay ya una sesión en marcha?" del cronómetro ocurre dentro del Durable Object, que procesa una petición cada vez (F-28).
- **Enriquecimiento**: un alta desde el móvil deja filas `external_checks` pendientes. Cualquier PC del usuario, al sincronizar, pide la concesión del trabajo y completa los metadatos (§14.3). Mientras tanto el juego ya existe y es visible.

### §13.4 Contrato

- API versionada (`/api/v2`). La PWA y el Worker se despliegan juntos, así que no hay desfase entre ellos.
- Los mensajes de error distinguen "hub más viejo que tu PC" de "PC más viejo que el hub" (F-30).
- Los tipos de la API siguen importándose en la PWA.
- Tiempo máximo en las peticiones y mensaje específico cuando la sesión de Access ha caducado.
- Paleta y tokens: la PWA importa los mismos tokens de tema que el escritorio en vez de copiarlos a mano.

---

## §14. Integraciones y trabajos de fondo

### §14.1 Dónde vive cada cosa

| Qué                                               | 1.x                         | 2.0                                                |
| ------------------------------------------------- | --------------------------- | -------------------------------------------------- |
| Metadatos de IGDB, Steam, HLTB, SteamGridDB       | Columnas de `games`         | `game_metadata` (C)                                |
| "Ya lo miré"                                      | Ocho mecanismos             | `external_checks` (C)                              |
| Catálogo de logros                                | `achievements`              | `achievement_catalogs` (C), agrupado por juego     |
| Desbloqueos                                       | Una fila por logro y fuente | Una fila por logro y origen; `emu` por dispositivo |
| Estado de lectura de emuladores de Steam          | Implícito                   | `local_emu_state` (L)                              |
| Curiosidades y recaps                             | Tablas con ids numéricos    | Ids naturales; escribir encima                     |
| `radarLastRunAt`                                  | `config.json` local         | Concesión en el hub                                |
| Caché de imágenes, caché de escaneo, estado de RA | Local                       | Local, sin cambios                                 |

### §14.2 Reglas comunes

- **Escribir solo lo que cambia** (§7.4).
- **Respetar lo manual** (D-22): el refresco nunca escribe en los `…Override` de `games`, y no sustituye una clave con `…Source = manual`.
- **Un "no" externo no borra lo que había**: se conserva.
- **IGDB**: limitador de ritmo y reintento ante 429, que hoy no existen.
- **Modelos de LLM**: a configuración, no fijados en el código.

### §14.3 Concesiones de trabajo (D-13)

Los trabajos que cuestan dinero o cuota no deben correr en dos PCs a la vez (F-32, F-33).

`POST /sync/v1/jobs/claim` con `{kind, key, ttl}`. El `TenantHub` concede si no hay concesión viva para ese par, y registra dueño y caducidad. El dispositivo ejecuta, sube el resultado como filas normales y cierra con `jobs/done` (éxito, o fallo con motivo).

| Trabajo                   | `kind`        | `key`           | Notas                                                                 |
| ------------------------- | ------------- | --------------- | --------------------------------------------------------------------- |
| Recap de un periodo       | `memory`      | `month:2026-06` | Un fallo o rechazo del modelo queda registrado: no se repaga a diario |
| Curiosidades de un juego  | `curiosities` | `gameId`        |                                                                       |
| Radar semanal             | `radar`       | Semana ISO      | Una vez por semana **por persona**, no por PC                         |
| Refresco externo completo | `refresh_all` | Semana ISO      |                                                                       |
| Enriquecer un juego       | `enrich`      | `gameId`        | Altas del móvil y juegos pendientes                                   |

Reglas:

- Con hub configurado, los trabajos de pago (`memory`, `curiosities`) **exigen** concesión: sin conexión con el hub, no se ejecutan.
- Los demás, si el hub no responde, pueden correr en local: son idempotentes gracias a los ids naturales, y el peor caso es trabajo repetido.
- Sin hub configurado (un solo PC), no hay concesiones.
- `claimQueue` sigue coordinando dentro de un proceso.

### §14.4 Planificador

Un único planificador de trabajos de fondo en el main (§15.1) sustituye a los temporizadores y cadenas de `.then` de `index.ts`: trabajos con nombre, exclusión mutua, espera creciente ante fallos, y arranque solo después del primer ciclo de sync.

---

## §15. Proceso main, IPC y renderer

### §15.1 Main

`src/main/index.ts` se divide. Propuesta de estructura:

| Módulo        | Contenido                                                                      |
| ------------- | ------------------------------------------------------------------------------ |
| `bootstrap/`  | Fases de arranque, explícitas y en orden                                       |
| `windows/`    | Ventana principal, overlay, aviso de logros, estado de ventana                 |
| `lifecycle/`  | Instancia única, `before-quit` ordenado (§10.6), energía (suspensión, bloqueo) |
| `jobs/`       | Planificador (§14.4) y definición de cada trabajo                              |
| `sync/`       | Motor del cliente (§8.5), emparejado, estado                                   |
| `db/store/`   | Puerta única de escritura (§8.6)                                               |
| `db/queries/` | Lecturas, apoyadas en `shared/domain`                                          |

Fases de arranque:

1. Configuración y credenciales.
2. Base local: abrir y migrar. Si viene de 1.x, importador (§19).
3. Registro de IPC y ventana.
4. Primer ciclo de sync, con tope de tiempo.
5. Watcher.
6. Planificador de trabajos de fondo.
7. Actualizador.

Cada fase declara de qué depende. El watcher puede arrancar antes del primer sync sin riesgo porque solo decide sobre sesiones propias (§10.4), pero se coloca después para que la primera foto sea buena.

### §15.2 Dominio compartido (D-12)

`src/shared/domain/` contiene las reglas como funciones puras sobre arrays de filas planas, sin acceso a base ni a Electron:

- Estado de un juego y de un playthrough a partir de sus eventos.
- Horas por playthrough y por juego (medidas más manuales).
- Fechas de inicio y fin derivadas; último día jugado.
- Reparto del gasto entre playthroughs.
- A qué playthrough cuelga una sesión nueva (`resolvePlaythroughForPlay`), como decisión pura que devuelve "usa este" o "crea uno así".
- Orden del plan y redistribución de claves de orden.
- Fusión de desbloqueos por origen.
- Frescura de cronómetros y de señales de vida.
- Estado de una partida guardada (§12.4).

El escritorio las usa en sus consultas, el hub en su API y la PWA en lo que calcule en cliente. Los tests del dominio corren una vez y valen para los tres.

### §15.3 Contrato IPC

Un único mapa en `src/shared/ipc/contract.ts`:

```ts
export const contract = {
  'sessions:close': {
    input: z.object({ sessionId: z.string(), endedAt: z.date() }),
    output: sessionDto.nullable(),
  },
  // …
};
```

De él se generan el API del preload y el registro de manejadores en el main, con validación de la entrada en el borde. Desaparecen las ~130 cadenas duplicadas y los tipos repetidos (F-38).

Los tipos que cruzan el IPC son **DTOs propios** de `shared`, no tipos del esquema (F-42). `UpdateGamePatch` pasa a ser una lista cerrada de campos editables.

Se revisa `sandbox: false` en las ventanas (F-46).

### §15.4 Eventos de cambio

Un solo evento del main al renderer:

```ts
type DataChanged = {
  domains: Domain[];
  ids?: Record<Domain, string[]>;
  origin: 'local' | 'sync' | 'watcher';
};
```

Lo emiten las mutaciones, el watcher y cada descarga de sync que aplique algo. Un único oyente en el renderer lo traduce a invalidaciones de consulta. Sustituye a `useWatcherSync`, al oyente propio del overlay y a la invalidación a mano en cada mutación (F-39).

### §15.5 Renderer

Se adapta, no se reescribe.

- **Ids de `number` a `string`.** Cambio mecánico pero extenso: unas 300 apariciones de tipos de id, 76 colecciones `Map`/`Set` indexadas por número y 29 construcciones de ruta. Puntos donde TypeScript no avisa y hay que ir a mano:
  - `Number(id)` en las rutas (`GameDetailRoute.tsx:11`, `PlanGameDetailRoute.tsx:12`, `TvGameDetail.tsx:427`).
  - Desempates `b.id - a.id` (`HistoryList.tsx:166`, `CompletedGallery.tsx:56`, `GameJourneyCard.tsx:35`, `TvDetailHistory.tsx:247`).
  - "La más reciente es la última creada" (`GameDetail.tsx:89-92`).
  - `typeof queryKey[1] === 'number'` en `useSetSessionNote`.
  - Claves de consulta que comparten espacio de nombres entre detalle y listas.
- **Dispositivo en la interfaz**: §10.8 y §11.4.
- **Un solo gancho de lanzamiento** para escritorio y TV (hoy la TV lanza sin abrir sesión).
- **Estado de sync visible**: indicador en la barra lateral y en la bandeja (al día, pendiente, sin conexión, error), no solo en Ajustes.
- **`errorElement`** en el router.
- **Ficheros de más de mil líneas**: se parten cuando se toquen por otro motivo, no como proyecto aparte.

### §15.6 Estadísticas en el main

- El main expone agregados por rango: totales, actividad por día, por mes, por hora, distribución de duración, más jugados, estados, géneros.
- Se calculan en SQL donde sea natural y con las funciones de `shared/domain` donde haga falta la regla.
- El renderer deja de pedir todas las sesiones. `NowPlayingCard` y el overlay usan una consulta de "sesiones abiertas", no la lista completa (F-41).
- La lógica pura de `renderer/src/lib` (rachas, agrupación) se mueve a `shared` cuando la necesite el main, conservando sus tests.

### §15.7 Inventario de cambios visibles

**No es un rediseño.** Es la lista de lo que hay que **añadir o ajustar** en pantallas que ya existen para que varios PCs se entiendan a simple vista. Cada elemento reutiliza componentes y tokens actuales y sigue `AGENTS.md`; ninguno cambia la estructura de una pantalla. El aspecto concreto lo decide el trabajo de identidad visual en curso, no este documento.

Los nombres de componente son los de la 1.7.3 y sirven de orientación: el rediseño en marcha puede haberlos movido.

**Principio común:** un dispositivo se nombra siempre igual (su nombre editable, con un icono pequeño) y solo aparece cuando aporta algo. Con un único PC emparejado, la interfaz se ve como hoy.

#### Barra lateral y "Now Playing"

| Dónde                   | Qué se añade o cambia                                                                                          | Por qué     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| `NowPlayingCard`        | Si la sesión en marcha es de otro PC: etiqueta "en PC-A" y **sin botón Stop**                                  | F-40, §10.8 |
| `NowPlayingCard`        | Si lleva más de 3 min sin señal: "sin señal desde hace X" en tono apagado                                      | §10.8       |
| `NowPlayingCard`        | Dos sesiones a la vez (una aquí, otra en otro PC): se apilan; la local primero                                 | D-15        |
| Pie de la barra lateral | Indicador de sincronización de un vistazo: al día, pendiente, sin conexión, error. Al pulsarlo lleva a Ajustes | §15.5       |
| Bandeja del sistema     | El mismo estado en el texto emergente y en el menú                                                             | §16         |

#### Biblioteca

| Dónde                             | Qué se añade o cambia                                                | Por qué |
| --------------------------------- | -------------------------------------------------------------------- | ------- |
| `GameCard` (insignia "en marcha") | Distingue "en marcha aquí" de "en marcha en otro PC"                 | F-40    |
| Filtros (grupo de marcas)         | Nueva marca "Instalado en este PC"                                   | §11     |
| `GameCard` (reverso)              | Nada obligatorio. La instalación se ve en la ficha, no en la tarjeta | —       |

#### Ficha de juego

| Dónde                       | Qué se añade o cambia                                                                                                   | Por qué |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------- |
| `ActionBar` (Play)          | Habilitado solo con instalación en este PC. Sin ella: acción "Vincular instalación" que abre el selector de ejecutable  | §11.4   |
| `ActionBar` (Stop)          | Solo para la sesión de este PC. Una sesión ajena no se puede parar desde aquí                                           | §10.1   |
| `DetailsCard`               | Fila "Instalado en": lista de dispositivos. La ruta y el tamaño mostrados son los de este PC                            | §11.4   |
| Lista de sesiones del juego | Cada sesión muestra su dispositivo. Las migradas de la 1.x no muestran ninguno                                          | §7.4    |
| Lista de sesiones del juego | Una sesión cerrada por el barrido lleva una marca discreta ("cerrada automáticamente")                                  | §10.5   |
| `PlaythroughPanel`          | Aviso cuando hay dos playthroughs en curso, con la acción "Fusionar"                                                    | §10.7   |
| Cabecera de la ficha        | Aviso cuando otro juego de la biblioteca parece el mismo (mismo `igdbId`, o título y año), con "Fusionar"               | §7.2    |
| `SavesSection`              | Los estados nuevos: al día, cambios sin copiar, por detrás, divergido, disponible; con el nombre del PC y la antigüedad | §12.4   |
| `SavesSection` (versiones)  | Cada versión muestra su dispositivo (ya lo hace) y, si se conoce, de cuál desciende                                     | §12.3   |
| Diálogo de restaurar        | Casilla "dejar la carpeta exactamente como en la copia", desmarcada                                                     | D-20    |
| `AchievementsSection`       | Nada visible: la fecha mostrada pasa a ser la más temprana entre PCs                                                    | F-35    |

#### Editar y añadir juego

| Dónde                                          | Qué se añade o cambia                                                                                               | Por qué |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| `ExecutablePathField`, `InstallDirectoryField` | Etiqueta "en este PC". Editan solo la instalación local                                                             | §11.4   |
| Desarrollador, distribuidora, géneros          | Cuando hay un valor fijado a mano: indicador y acción "volver al automático"                                        | D-22    |
| Carátula y banner                              | La misma acción "volver al automático"                                                                              | D-22    |
| `FolderScanStep`                               | Un juego "ya en la biblioteca" sin instalación aquí deja de descartarse: se ofrece vincularlo (marcado por defecto) | §11.2   |

#### Sesiones

| Dónde             | Qué se añade o cambia                                                      | Por qué |
| ----------------- | -------------------------------------------------------------------------- | ------- |
| Fila de sesión    | Dispositivo en el que se jugó                                              | §7.4    |
| Bandeja "Pending" | Las sesiones de emulador de otros PCs también aparecen, con su dispositivo | §10     |
| Filtros           | Opcional: filtrar por dispositivo. No es necesario para la 2.0             | —       |

#### Plan

| Dónde                  | Qué se añade o cambia                                                                      | Por qué |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------- |
| Fila de juego planeado | Estado "completando datos" para un juego añadido desde el móvil que aún no tiene metadatos | §13.3   |
| Buzón de órdenes       | Desaparece cualquier referencia al buzón y a sus errores                                   | §13.3   |

#### Estadísticas

Nada obligatorio. Las horas de dos PCs ya suman en los totales. Un desglose por dispositivo sería una función nueva y queda fuera.

#### Ajustes

| Dónde                             | Qué se añade o cambia                                                                                                   | Por qué    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| "API & Sync"                      | El bloque de Turso se sustituye por **Sincronización**: dirección del hub, emparejar con código, estado                 | §9.3       |
| Sincronización → Dispositivos     | Lista con nombre editable, última señal, versión de la app y "dar de baja". Este PC, destacado                          | §16        |
| Sincronización → Estado           | Cambios pendientes de subir, último error con su causa, "sincronizar ahora", "volver a bajar todo"                      | §16        |
| Sincronización → Avisos           | Mensajes específicos: "actualiza Afterplay para volver a sincronizar", "el reloj de este PC está adelantado"            | §8.2, §8.7 |
| Emuladores                        | La ruta de cada emulador es la de este PC; se indica en qué otros dispositivos está configurado                         | §7.4       |
| Partidas (`CloudIdentitySection`) | La identidad del PC pasa a ser la de Sincronización. Aviso de identidad duplicada y recuperación guiada tras reinstalar | §12.6      |
| Copias de seguridad               | Acción "restaurar copia"                                                                                                | §7.9       |
| Diagnóstico                       | "Exportar diagnóstico"                                                                                                  | §16        |

#### Modo TV y overlay

| Dónde                    | Qué se añade o cambia                                                           | Por qué |
| ------------------------ | ------------------------------------------------------------------------------- | ------- |
| `TvHome`, `TvGameDetail` | Las mismas reglas de Play que el escritorio, con el mismo gancho de lanzamiento | §15.5   |
| `TvHome`, `TvGameDetail` | "En marcha en PC-A" donde hoy se pinta "en marcha"                              | F-40    |
| `OverlayHud`             | Solo habla de la sesión de este PC                                              | §10.1   |

#### Primer arranque, emparejado y migración

| Dónde                         | Qué se añade                                                                                                    | Por qué |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ------- |
| 1.8: diálogo de actualización | "Afterplay 2 está lista y migra tus datos. ¿Ahora?"                                                             | D-07    |
| 1.8: banda de solo lectura    | "Esta biblioteca se ha migrado a Afterplay 2"                                                                   | §19.3   |
| 2.0: pantalla de migración    | Sobre el splash actual: pasos (copiar, validar, emparejar, subir) con progreso. Sin preguntas en el caso normal | §19.6   |
| 2.0: pregunta de PC rezagado  | La única pregunta posible del proceso                                                                           | §19.6   |
| 2.0: fallo de validación      | "No se ha migrado nada. Sigues en la versión anterior", con acceso al informe                                   | §19.5   |
| 2.0: PC nuevo                 | Paso de emparejado: dirección del hub y código; después, progreso de la primera descarga                        | §9.3    |
| 2.0: PC reinstalado           | "Este PC ya existía, ¿recuperar su identidad?"                                                                  | §12.6   |

#### Móvil

| Dónde             | Qué se añade o cambia                                             | Por qué |
| ----------------- | ----------------------------------------------------------------- | ------- |
| Ficha de juego    | "Instalado en: PC-A, PC-B" en lugar de rutas                      | F-31    |
| Sesión en marcha  | En qué dispositivo                                                | §10.8   |
| Ajustes del móvil | "Añadir dispositivo": muestra el código de emparejado             | §9.3    |
| Plan              | Las acciones dejan de mostrar "pendiente de que tu PC lo aplique" | §13.3   |

#### Lo que no cambia

La estructura de la biblioteca, de la ficha, de las estadísticas y del modo TV; el aviso de sesión cerrada; el modo ambiente; el recorrido ("Journey"). Con un solo PC, la única novedad visible es el bloque de Sincronización en Ajustes.

---

## §16. Observabilidad

- **Log a fichero** en la carpeta de datos, rotado, con niveles. Sustituye a `console.*` como destino principal (F-43).
- **Qué se registra siempre**: cada ciclo de sync fallido con su causa; cada cierre de sesión hecho por un barrido, con el motivo; cada concesión pedida, concedida o denegada; cada paso del importador; cada operación sobre el bucket.
- **Estado de sync persistente** (`local_sync_state`): sobrevive a reinicios y se ve en la interfaz (§15.5).
- **Ajustes → Sincronización**: dispositivos del inquilino con su última señal y versión, cambios pendientes de subir, último error, botón "sincronizar ahora", botón "volver a bajar todo".
- **Exportar diagnóstico**: un botón que empaqueta logs y estado (sin credenciales) para depurar.
- El hub registra por inquilino: secuencia, filas por tabla, último acceso de cada dispositivo. Visible para el anfitrión sin exponer datos de otros.

---

## §17. Tests y CI

### §17.1 Capas

| Capa             | Qué prueba                                                 | Cómo                                                  |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Dominio          | Reglas de `shared/domain`                                  | Funciones puras, sin base                             |
| Almacén          | Puerta de escritura, consultas, migraciones                | SQLite real en fichero temporal, driver de producción |
| **Convergencia** | Fusión y protocolo con varias réplicas                     | §17.2                                                 |
| Hub              | Autenticación, emparejado, concesiones, barridos           | `hub-core` con el adaptador de Node                   |
| Importador       | Migración 1.x → 2.0                                        | Bases 1.x sintéticas y la semilla de e2e              |
| Partidas         | Estado, linaje, sincronización con el bucket, recuperación | Bucket simulado                                       |
| e2e              | Flujos de interfaz                                         | Playwright, como hoy                                  |

### §17.2 Arnés de convergencia

Un arnés que levanta en un proceso un hub (`hub-core` con SQLite en memoria) y N clientes, cada uno con su base y su reloj controlable. Permite guionizar: "A escribe esto offline, B escribe esto otro, A sincroniza, B sincroniza".

Dos tipos de test:

- **Escenarios con nombre** (§17.3).
- **Propiedades**: secuencias aleatorias de escrituras, cortes de red y sincronizaciones en N réplicas; al final, tras sincronizar todas, **todas las bases son idénticas** y coinciden con el hub. Se comprueban también conmutatividad e idempotencia de la fusión.

Es la pieza que hoy no existe (F-44) y la condición para atreverse con un sync propio.

### §17.3 Escenarios de aceptación

| Id   | Escenario                                                                             | Resultado exigido                                                       | Cubre            |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- |
| E-01 | A juega; B encendido y desbloqueado recibe la sesión abierta                          | B no la toca. La sesión de A conserva su duración real                  | F-01             |
| E-02 | A juega; B arranca el mismo juego antes de que llegue el cierre de A                  | Dos sesiones, una por PC, cada una con su duración                      | F-02             |
| E-03 | A y B crean offline una sesión cada uno, de juegos distintos                          | Existen las dos, cada una colgando de su juego                          | F-07             |
| E-04 | A y B añaden offline el mismo juego de IGDB                                           | Una sola fila de juego; los playthroughs de ambos cuelgan de ella       | F-08             |
| E-05 | A edita las notas de un juego; B refresca su carátula, ambos offline                  | Se conservan los dos cambios                                            | Fusión por campo |
| E-06 | A borra un juego; B, offline, le añade una sesión                                     | El juego queda borrado y la sesión no aparece; nada falla               | F-11             |
| E-07 | A cierra Afterplay justo tras jugar y se apaga; B se enciende                         | B ve la sesión cerrada y el backup de la partida                        | F-04, F-20       |
| E-08 | A muere con una sesión abierta y no vuelve                                            | El hub la cierra a las 24 h en su última señal de vida                  | §10.5            |
| E-09 | A estuvo 30 h offline con una sesión que cerró bien; el hub ya la había cerrado       | Gana el cierre de A                                                     | §10.5            |
| E-10 | El juego está en `C:\…` en A y en `D:\…` en B                                         | Cada PC detecta el suyo. Cambiar la ruta en B no afecta a A             | F-06             |
| E-11 | Dos PCs encendidos a primeros de mes                                                  | El recap del mes anterior se genera una vez                             | F-32             |
| E-12 | Desde el móvil se fija un juego con todos los PCs apagados                            | Se ve fijado al instante en el móvil y en cada PC cuando arranca        | F-27, O5         |
| E-13 | Cronómetro desde el móvil mientras un PC abre una sesión del mismo juego              | No se cuentan horas dobles                                              | F-28             |
| E-14 | B tiene una versión anterior de la app (esquema menor)                                | Sincroniza lo que entiende, no pierde ni corrompe lo que no             | F-15             |
| E-15 | B está por debajo del mínimo admitido                                                 | Deja de sincronizar, sigue en local, lo avisa                           | F-15             |
| E-16 | A sube una partida; B abre la ficha sin haber jugado                                  | "Hay una partida más nueva de A"                                        | F-19             |
| E-17 | A y B juegan cada uno desde la misma partida base sin restaurar, y ambos hacen backup | La ficha de ambos dice "divergido", también la del último en copiar     | F-19             |
| E-18 | Recuperar el índice desde el bucket con el sync a medias                              | Ninguna fila duplicada                                                  | F-21             |
| E-19 | A borra una versión de B                                                              | No reaparece tras el siguiente backup de B                              | F-23             |
| E-20 | La carpeta de datos de A se copia a B                                                 | Se detecta el id duplicado; no se poda nada                             | F-24             |
| E-21 | El mismo logro de emulador con fechas distintas en A y B                              | Dos filas; la ficha muestra la más temprana y no cambia entre arranques | F-35             |
| E-22 | Un cambio de gasto llega por sync con la pantalla de estadísticas abierta             | La pantalla se actualiza sin reiniciar                                  | F-39             |
| E-23 | El reloj de A está adelantado un día                                                  | El hub rechaza sus cambios y A lo muestra; no "gana siempre"            | §8.2             |
| E-24 | Hub vacío; un PC con todos los datos sincroniza                                       | El hub queda completo                                                   | §9.6             |

### §17.4 CI

GitHub Actions en cada push y PR: lint, comprobación de tipos, tests unitarios y de convergencia. Los e2e de Electron, en un ejecutor de Windows, al menos antes de cada release. El despliegue del hub sigue siendo manual al principio, con un paso de `--dry-run` en CI.

---

## §18. Seguridad

Antes o durante la 2.0:

1. **Cerrar el pendiente de `docs/dependency-upgrade-2026-09-24.md`**: revisar los instaladores publicados y rotar las claves afectadas. Independiente de la 2.0 y prioritario.
2. **Protocolo de imágenes** acotado a la carpeta de caché.
3. **Semilla de e2e** sintética, no derivada de la biblioteca real.
4. **Tokens de dispositivo**: aleatorios de 256 bits, guardados en el hub solo como huella, revocables.
5. **El hub no guarda credenciales de terceros en claro**: las claves de IGDB de cada inquilino van cifradas con una clave del Worker.
6. **Modo desarrollo del Worker**: que no dependa solo de una variable; exigir además que la petición venga de localhost.
7. **Validación de entradas** en las dos fronteras: IPC (§15.3) y API del hub.
8. **Aislamiento entre inquilinos**: garantizado por construcción (un Durable Object por persona); test que intenta leer con el token de otro.

---

## §19. Migración 1.x → 2.0

### §19.1 Principios

- La 1.x sigue en uso normal hasta el corte.
- Una confirmación por PC (D-07). Ninguna pregunta más en el caso normal.
- El importador es **idempotente y determinista**: ejecutarlo dos veces, o en dos PCs, produce los mismos ids y el mismo resultado.
- **Nada se destruye**: la base 1.x local, la base remota de Turso y los prefijos del bucket quedan intactos.
- **Comparación antes y después**: si los totales no cuadran, la migración se aborta y el PC sigue en 1.x.

### §19.2 Convivencia durante el desarrollo

| Riesgo                                                      | Medida                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La compilación de desarrollo abre la base real              | Hoy `npm run dev` usa la carpeta de datos de la app instalada (`app.setName`, `index.ts:138`). La rama 2.0 redirige su carpeta de datos en desarrollo, como ya hacen los e2e (`lib/e2e.ts:69`). **Primer cambio de la rama** |
| La 2.0 en pruebas escribe en los prefijos del bucket de 1.x | Bucket o prefijo de pruebas distinto                                                                                                                                                                                         |
| El hub en pruebas interfiere con el Worker actual           | Se despliega con otro nombre (`afterplay-hub-dev`)                                                                                                                                                                           |
| Una 2.0 publicada se instala sola sobre la 1.x              | No se publica en el canal de releases hasta el corte (§19.8)                                                                                                                                                                 |
| La 1.x cambia de esquema y el importador se queda atrás     | Esquema de 1.x congelado salvo la migración aditiva de la 1.8                                                                                                                                                                |

### §19.3 Versión puente 1.8

Una actualización normal de la 1.x, con cuatro funciones:

1. **Tabla `app_meta`** (migración aditiva) en la base 1.x, con:
   - `cutover`: estado del corte (`null` → `migrating` → `done`), quién y cuándo.
   - `hub`: dirección del hub y secreto de alta para los demás PCs (§9.3).
   - `device_status`: una entrada por PC con versión, último push correcto y cambios pendientes.
2. **Publicar su estado** en cada ciclo de sync.
3. **Modo solo lectura** cuando `cutover` no es `null`: la app deja de escribir y muestra "esta biblioteca se ha migrado a Afterplay 2".
4. **Actualizador con freno**: una versión mayor nueva no se descarga ni instala sola; muestra "Afterplay 2 está lista y migra tus datos. ¿Ahora?" (D-07).

El Worker actual recibe el cambio equivalente: con `cutover` activo, cronómetro y buzón responden "en mantenimiento".

**La 1.8 es estable por sí sola.** Mientras nadie inicie el corte de una biblioteca, se comporta exactamente como la 1.7.x y puede usarse sin límite de tiempo. El corte es por persona (por base de Turso): una puede migrar y la otra quedarse en la 1.8. Quedarse tiene un precio, que conviene tener presente:

- Conserva todos los fallos entre PCs del §4 (D-17).
- Sigue dependiendo de Turso y de una librería fijada en versión beta.
- Obliga a mantener vivo el Worker antiguo y su secreto `TENANTS` para el móvil de quien no haya migrado.
- No recibe funciones nuevas.

#### §19.3.1 Contrato de `app_meta` (fijado el 2026-11-17)

La 1.8 vive en `main` y la 2.0 en `v2`: este es el único punto en el que se tocan, así que el formato se fija aquí y ninguna de las dos lo cambia sin cambiarlo antes en este documento.

**Tabla** (migración aditiva de la 1.8 en la base 1.x; viaja a Turso como las demás):

| Columna     | Tipo               | Notas                       |
| ----------- | ------------------ | --------------------------- |
| `key`       | `TEXT PRIMARY KEY` |                             |
| `value`     | `TEXT NOT NULL`    | JSON                        |
| `updatedAt` | `INTEGER NOT NULL` | milisegundos desde la época |

**Claves:**

| Clave                       | Valor (JSON)                                                                                                | Quién la escribe                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `cutover`                   | `{ "state": "migrating" \| "done", "deviceId", "deviceName", "appVersion", "at" }`. Sin fila = no hay corte | La 2.0 del PC migrador          |
| `hub`                       | `{ "url", "enrollSecret", "expiresAt" }`. Solo existe con `cutover.state = "done"`                          | La 2.0 del PC migrador          |
| `device_status:<machineId>` | `{ "deviceName", "appVersion", "lastPushOkAt", "pendingChanges", "at" }`. `lastPushOkAt` puede ser `null`   | Cada 1.8, en cada ciclo de sync |

`deviceId` es el `machineId` de la 1.x, que la 2.0 conserva (§19.6). Las fechas, en milisegundos.

**Operaciones de la 2.0**, directas contra Turso, cada una en una sola sentencia:

- **Reclamar:** `INSERT INTO app_meta (key, value, updatedAt) VALUES ('cutover', ?, ?) ON CONFLICT (key) DO NOTHING`. Gana quien ve `rowsAffected = 1`. Si ve 0, lee la fila: si es suya y está en `migrating`, sigue (reintento tras un cierre); si no, no migra.
- **Soltar** (la importación o la validación fallaron): `DELETE FROM app_meta WHERE key = 'cutover' AND json_extract(value, '$.state') = 'migrating' AND json_extract(value, '$.deviceId') = ?`.
- **Terminar:** en una transacción, `cutover` pasa a `done` y se escribe `hub`.

**Lo que hace la 1.8:** ve `cutover` (en cualquier estado) → modo solo lectura en ese mismo ciclo. No escribe nunca `cutover` ni `hub`.

**Secreto de alta** (§9.3). Lo emite el hub a petición del PC migrador, ya emparejado, con su token; vale para varios emparejados y caduca (7 días). El hub guarda solo su huella. Un PC que se empareja con él recibe su propio token, como con el código de un solo uso.

**Por qué la 2.0 habla con Turso** (decidido el 2026-11-17): reclamar el corte tiene que ser una escritura condicional en la base que comparten todos los PCs de la 1.x. La 2.0 lleva para eso un cliente de Turso por HTTP en un módulo puente, y solo en él (`PUENTE 1.x → L3`). La alternativa, un punto nuevo en el Worker antiguo, obligaba a modificar y desplegar `afterplay-web`.

### §19.4 Auditoría previa de los datos

Antes de fijar las reglas del importador, ejecutar las consultas del apéndice B sobre **una copia** (los backups diarios son copias completas; nunca sobre `Afterplay.db` en uso). Sirven para saber:

- Si ya hay daño por colisión de ids (F-07).
- Cuántas sesiones hay recortadas a uno o dos minutos (huella de F-01).
- Cuántas filas `isManual`, cuántos playthroughs con horas manuales y sesiones a la vez, cuántas sesiones abiertas.

El resultado puede añadir reglas de saneamiento al importador. Es la primera tarea del plan (§20.1).

**Resultado sobre los datos del autor (2026-11-13, `scripts/audit-1x-data.ts`).** La base está limpia:

| Comprobación                                                          | Resultado                                     |
| --------------------------------------------------------------------- | --------------------------------------------- |
| Referencias rotas o cruzadas entre juegos (indicios de F-07)          | 0                                             |
| Sesiones solapadas, abiertas, imposibles o `isManual`                 | 0                                             |
| Sesiones cortas (130 s o menos)                                       | 17 de 278, todas cerradas al morir el proceso |
| Sesiones cortas cerradas en su último latido (la firma de F-01)       | 0                                             |
| Máquinas distintas que han subido partidas                            | 1                                             |
| Playthroughs con horas manuales y además sesiones                     | 2                                             |
| Playthroughs solo con horas manuales                                  | 326                                           |
| Juegos planeados, playthroughs vacíos y eventos `plan_to_play`        | 665, 667 y 677                                |
| Juegos sin `igdbId`; appids de Steam compartidos; appid fijado a mano | 2; 3; 1                                       |
| Desbloqueos por origen (Steam, emulador, RetroAchievements)           | 3.300, 70, 0; 83 con fecha no fiable          |
| Órdenes pendientes en el buzón                                        | 0                                             |

Lectura: los fallos entre PCs del §4 son reales en el código (F-07 está reproducido), pero **no han dejado daño en estos datos**. Todo apunta a que hasta hoy la biblioteca se ha usado en la práctica desde un solo PC. El importador no necesita reglas de saneamiento por colisiones; sí tiene que resolver a mano los 2 playthroughs con horas manuales y sesiones, y tratar los 2 juegos sin `igdbId`. La auditoría hay que repetirla sobre los datos de la segunda persona antes de su corte.

### §19.5 Importador

Entrada: la base 1.x **consolidada**. La fuente de verdad es el remoto de Turso tras confirmar que todos los PCs han subido lo suyo (`device_status`). Se lee con `@libsql/client`. Sin Turso configurado (un solo PC), la entrada es la base local.

Salida: la base 2.0 local (`Afterplay2.db`, en la misma carpeta de datos).

**Ids.** Deterministas a partir de los antiguos:

- Juegos con `igdbId`: el id natural de §7.2.
- Todo lo demás: UUIDv5 de `legacy:<tabla>:<id antiguo>`.
- Se guarda el mapa en `local_legacy_ids`.

**Relojes.** Todas las filas importadas llevan un reloj fijo y antiguo, derivado de su fecha de dominio (`addedAt`, `startedAt`, `occurredAt`) y, como desempate, del id antiguo. Así se conserva el orden que hoy da el id (F-09), y cualquier edición posterior en 2.0 gana a lo importado.

**Mapeo tabla a tabla.**

| Origen 1.x                                                     | Destino 2.0                                    | Regla                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games` (datos del usuario)                                    | `games`                                        | Copia. `steamAppIdManual` → `steamAppIdSource`. `sgdbId` → `sgdbIdSource = manual`. Carátula, banner, desarrollador, distribuidora y géneros → `…Override` para **todos** (ver "Elecciones manuales") |
| `games` (caché externa)                                        | `game_metadata`, `external_checks`             | Copia; no se vuelve a preguntar a las APIs. Cada `…CheckedAt` → una fila de `external_checks`                                                                                                         |
| `games.planned = 1`                                            | `plan_entries`                                 | `plannedAt` = primer evento `plan_to_play`, o `addedAt`. `pinnedAt` = `planPinnedAt`. Se descartan su iteración vacía y ese evento                                                                    |
| `games.executablePath`, `installDirectory`, `installSizeBytes` | `game_installs`                                | No se importan aquí. Se reclaman por PC (§19.6)                                                                                                                                                       |
| `games.curiositiesGeneratedAt` + `curiosities`                 | `game_curiosities`                             | Una fila por juego                                                                                                                                                                                    |
| `emulators`                                                    | `emulators`; ruta a `emulator_installs` por PC | Igual que los juegos                                                                                                                                                                                  |
| `iterations`                                                   | `playthroughs`                                 | `label` → `customLabel` solo si no es el automático "Playthrough N". `manualTotalPlayed` → `manualHours` (ver abajo)                                                                                  |
| `sessions`                                                     | `sessions`                                     | `deviceId = legacy`. `isManual = 1` → `source = legacy_manual`. `lastHeartbeatAt` → `lastSeenAt`. Las abiertas se cierran antes (§19.7)                                                               |
| `state_events`                                                 | `state_events`                                 | Los que `isAddedAtArtifact` reconoce como artefacto de alta → `datePrecision = unknown`. `plan_to_play` se descarta                                                                                   |
| `spend_events`                                                 | `spend_events`                                 | Copia. `currency` = la moneda única de hoy                                                                                                                                                            |
| `achievements`                                                 | `achievement_catalogs`                         | Se agrupan por juego y fuente en una fila con el catálogo en JSON (§7.4)                                                                                                                              |
| `achievement_unlocks`                                          | `achievement_unlocks`                          | Copia **siempre** (los de emulador son irrecuperables). `source = emu` → `origin = emu@legacy`                                                                                                        |
| `save_backups`                                                 | `save_backups`                                 | No se migran filas: se **reindexa desde el bucket** (más fiable que las filas, F-21). `contentHash` se calcula de cada `mapping.yaml`                                                                 |
| `generated_memories`                                           | `generated_memories`                           | Copia. `sourceHash` se **recalcula** con los ids nuevos; si no, todos quedarían como obsoletos y se repagarían                                                                                        |
| `radar_games`                                                  | `radar_games`                                  | Copia                                                                                                                                                                                                 |
| `plan_mailbox`                                                 | —                                              | Debe estar vacío de pendientes (§19.7). No se migra                                                                                                                                                   |

**Elecciones manuales.** Hoy no se distingue una carátula, un desarrollador o unos géneros elegidos a mano de los automáticos, y perder una corrección es irrecuperable. El importador los trata a todos como manuales y los copia a `…Override`. Después, la primera vez que el refresco traiga el valor automático de un juego, si coincide con el override, el override se borra: no era una corrección. Lo que de verdad se editó a mano queda protegido (D-22).

**Horas manuales.** Para cada playthrough, el importador calcula las horas que **la 1.x muestra hoy** (con el código de la 1.x) y fija `manualHours` de modo que la 2.0 muestre exactamente el mismo total. No se reinterpreta nada.

**Validación (aborta si falla).** Con la base de origen y la de destino:

- Recuento por tabla, descontando lo que se descarta a propósito.
- Suma de `durationSec` de sesiones, total y por juego.
- Suma de gasto, total y por juego.
- Para cada juego: estado, horas totales y último día jugado, calculados con el código de 1.x sobre el origen y con el de 2.0 sobre el destino. Deben coincidir.
- Ninguna referencia huérfana.
- **Conciliación columna a columna** (añadida el 2026-11-13). Las comprobaciones de arriba no detectan que se pierda o se altere un dato que no entra en ningún cálculo: una nota, una valoración, una etiqueta, una carátula elegida a mano, el texto de un recap. Por eso:
  - Cada columna del esquema 1.x tiene declarado en el código del importador su destino en el 2.0, o el motivo por el que se descarta. Un test recorre el esquema 1.x y falla si alguna columna no está declarada.
  - La validación recorre todas las filas del origen y compara cada valor con el del destino, tras la transformación declarada. Cualquier diferencia hace fallar la migración.
  - El informe da, por tabla y columna, las filas comprobadas, las coincidencias, las diferencias (por id antiguo, nunca el contenido) y los descartes con su motivo.

El informe de validación se guarda en el log. Si falla, se borra `Afterplay2.db`, se suelta el reclamo del corte y la 1.x sigue como estaba.

### §19.6 Lo que hace cada PC

**El primer PC que acepta la 2.0 (el "migrador"):**

1. Reclama el corte con una escritura condicional directa en Turso (`cutover = migrating`). Solo uno puede ganar. A partir de aquí las 1.8 y el Worker antiguo quedan en solo lectura.
2. Comprueba `device_status`: todos los PCs conocidos sin cambios pendientes. Si alguno no ha informado, **la única pregunta posible**: "PC-B no ha sincronizado desde X. Enciéndelo, o continúa y lo suyo se recuperará después desde su copia local."
3. Cierra en origen cualquier sesión abierta, en su último latido.
4. Cierra su conexión 1.x, saca una copia consistente de `Afterplay.db` a `backups/`, e importa y valida desde esa copia (§19.5). El importador solo escribe en la carpeta de datos con la opción `cutover`, y solo `Afterplay2.db`.
5. Se empareja con el hub y lo siembra (§19.7).
6. Escribe `cutover = done` y los datos del hub en `app_meta`.
7. Migración local (abajo).

**Los demás PCs, al aceptar la 2.0:**

1. Ven `cutover = done`. No importan.
2. Se emparejan con el hub usando el secreto de alta que dejó el migrador.
3. Bajan todo del hub.
4. Migración local.

**Migración local (todos):**

- **Identidad**: `machineId` → `deviceId`. Se conserva.
- **Instalaciones**: para cada juego y emulador con ruta en la base 1.x local, si el fichero existe en este disco, se crea su fila en `game_installs` / `emulator_installs`. Si no existe, no se crea: la ruta era de otro PC. Después, un escaneo de las carpetas configuradas vincula lo que falte (§11.2).
- **`machine-saves.json`**: las ubicaciones de restauración indexadas por id de juego antiguo se remapean con `local_legacy_ids`.
- **Estado de partidas**: `lastSyncedHash` de cada juego = huella del último backup de este dispositivo.
- **Credenciales y configuración**: se quedan donde están (D-06). Las de Turso se conservan mientras dure el periodo de vuelta atrás.
- **Lo que se regenera**: caché de escaneo. La caché de imágenes vale tal cual (va por URL).

**PC rezagado** (se saltó el paso 2 del migrador y tenía cambios sin subir): al actualizarse, un importador secundario compara su base 1.x local con lo que hay en el hub y propone las filas que faltan, emparejando por contenido (`startedAt`, juego, duración), no por id. Con informe y confirmación: es el caso anómalo.

### §19.7 Siembra del hub

- El migrador sube su base 2.0 por el camino normal (`push`), en lotes.
- Orden: `devices`, `games`, `playthroughs`, `state_events`, `sessions`, `spend_events`, `plan_entries`, `achievement_unlocks`, `save_backups`; después la caché (`game_metadata`, `external_checks`, `achievement_catalogs`, `game_curiosities`, `generated_memories`, `radar_games`).
- Si el hub responde "cuota agotada", la siembra se pausa y continúa sola más tarde. El PC es usable entretanto; los demás PCs ven llegar los datos por orden de importancia.
- La siembra termina cuando no quedan filas pendientes; entonces se marca `cutover = done`.

### §19.8 Despliegue y canal

- El hub de producción se despliega **antes** del corte, vacío. No interfiere con nada.
- **Dirección del móvil** (D-18): el hub se despliega con un nombre nuevo y el Worker antiguo sigue vivo hasta que las dos personas hayan migrado. Coste: volver a añadir la PWA a la pantalla de inicio una vez.
- La 2.0 se publica en el canal de releases cuando el hub está desplegado y el ensayo general (§20, fase 9) ha pasado. La 1.8 se publica antes y debe estar instalada en todos los PCs.
- Cada persona migra por separado: su base de Turso, su inquilino. El orden entre personas no importa mientras el Worker antiguo siga vivo.

### §19.9 Vuelta atrás

| Momento                                     | Cómo                                                                            | Qué se pierde                       |
| ------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Durante la importación o la validación      | Automática: se borra `Afterplay2.db` y se suelta el reclamo                     | Nada                                |
| Tras `cutover = done`, antes de usar la 2.0 | Reinstalar la 1.8 y limpiar `cutover` en `app_meta` (procedimiento documentado) | Nada                                |
| Tras usar la 2.0                            | Lo mismo                                                                        | Lo registrado en 2.0 desde el corte |

La base de Turso, la base local 1.x y los backups locales se conservan al menos 60 días. La 2.0 no escribe en ninguno de ellos.

### §19.10 Qué se migra y qué se regenera

| Dato                                                          | Decisión                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| Sesiones, playthroughs, eventos, gastos, notas, plan          | **Migrar.** Es el dato del usuario                             |
| Desbloqueos de logros (todas las fuentes)                     | **Migrar.** Los de emulador son irrecuperables                 |
| Carátulas y banners elegidos, `steamAppId` manual, `raGameId` | **Migrar.** Irrecuperables o con riesgo de emparejar mal       |
| Recaps y curiosidades                                         | **Migrar.** Pagados, y el usuario ya los ha leído              |
| Metadatos externos y catálogo de logros                       | Migrar para no repetir llamadas; regenerables si hiciera falta |
| Índice de partidas                                            | **Reindexar** desde el bucket                                  |
| Rutas de instalación                                          | **Reclamar** por PC                                            |
| Caché de imágenes, de escaneo, estado de RetroAchievements    | Conservar o regenerar; no viajan                               |
| Buzón                                                         | Vaciar antes; no se migra                                      |

---

## §20. Plan de trabajo

Sin fechas: cada fase tiene un tamaño relativo (S, M, L, XL) y una condición de salida. El orden busca que cada fase se pueda probar sola.

### §20.1 Fase 0 — Preparación (S)

- Rotar las claves pendientes (§18.1).
- Auditoría de datos sobre una copia (§19.4, apéndice B).
- Aislar la carpeta de datos de las compilaciones de desarrollo (§19.2). **Hecho el 2026-11-13** (§20.1.1).
- CI mínimo (§17.4).
- Comprobaciones previas:

| Id   | Qué hay que comprobar                                                                                                              | Si falla                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| S-01 | Drizzle (la versión en uso) funciona sobre el SQLite de un Durable Object con las mismas definiciones de tabla                     | SQL a mano en el hub para un conjunto pequeño de consultas |
| S-02 | `@libsql/client` en modo fichero rinde y es estable como driver local en Electron                                                  | `better-sqlite3`                                           |
| S-03 | La consulta más pesada del móvil (portada de la biblioteca) cabe en el límite de CPU del plan gratuito dentro de un Durable Object | Tablas de proyección, o plan de pago                       |
| S-04 | Cloudflare Access puede cubrir `/` y `/api/*` y dejar `/sync/*` fuera en el mismo Worker                                           | Dos nombres de host                                        |
| S-05 | `hub-core` corre sin cambios en Node con SQLite en memoria                                                                         | Rehacer la interfaz de almacenamiento                      |
| S-06 | La colisión de ids de F-07 se reproduce con dos réplicas contra una base de pruebas de Turso                                       | No bloquea: confirma o rebaja la gravedad del diagnóstico  |
| S-07 | La huella de contenido (§12.2) es estable entre dos PCs para la misma partida                                                      | Normalizar más (mayúsculas en rutas, separadores)          |

**Salida:** auditoría hecha, comprobaciones resueltas, CI en verde.

#### §20.1.1 Entorno de desarrollo

El desarrollo vive en la rama `v2` y se prueba en un **perfil de desarrollo**: la app de verdad sobre una copia de los datos reales, en una carpeta distinta de la de la app instalada (`%APPDATA%\Afterplay-dev-v2`). Las dos pueden estar abiertas a la vez.

| Orden                                                      | Qué hace                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev:v2:seed`                                      | Crea el perfil con la copia de seguridad más reciente de la app instalada                 |
| `npm run dev:v2:seed -- --force`                           | Sustituye la base del perfil por una copia fresca                                         |
| `npm run dev:v2:seed -- --keys-file <afterplay-keys.json>` | Lleva al perfil las claves de consulta de un fichero exportado, sin las de base ni bucket |
| `… --keys-file <fichero> --bucket afterplay2-test`         | Además, las credenciales del almacenamiento, con el bucket cambiado por el de pruebas     |
| `npm run dev:v2:seed -- --empty`                           | Deja el perfil sin base para que la descargue entera de su remota de pruebas              |
| `npm run dev:v2`                                           | Arranca la app en el perfil                                                               |

`npm run dev` a secas sigue abriendo la carpeta de la app instalada: no usarlo para la 2.0.

**Copia local o remota, no las dos.** Un perfil sin remota configurada trabaja con la copia local. Un perfil con remota de pruebas tiene que partir de `--empty`: una base local con contenido no se "une" a una remota. El motor la sustituye por la descarga y deja a su lado el WAL anterior, que ya no cuadra; la app no arranca ("Conversion error: Expected text value", visto el 2026-11-13). Es un ejemplo más de F-13.

Cerrojos del perfil (`src/main/lib/devProfile.ts`, `devProfileRules.ts`):

- Nunca importa el `.env` del proyecto.
- Solo sincroniza con una base remota cuyo nombre empiece por `afterplay-dev`, `afterplay-test`, `afterplay-v2` o `afterplay2-`. Con cualquier otra, se queda en local.
- Solo hace copias de partidas en un bucket con uno de esos mismos prefijos.
- No toca "iniciar con Windows".
- Estrena identidad de máquina: para el bucket es otro PC.
- En una app empaquetada, la variable que lo activa se ignora.

Recursos de desarrollo que acompañan al perfil, todos separados de producción:

| Recurso            | Nombre              | Para qué                                                        |
| ------------------ | ------------------- | --------------------------------------------------------------- |
| Base de Turso      | `afterplay2-test`   | Copia de la base real: origen del importador y ensayo del corte |
| Bucket de partidas | `afterplay2-test`   | Copias de partidas del perfil                                   |
| Hub                | `afterplay-hub-dev` | Cuando exista el código (fase 3)                                |

Comprobado el 2026-11-13: el perfil conecta con la base de pruebas y sincroniza; un juego añadido en el perfil no aparece en la app instalada. La lectura del bucket de pruebas responde "The bucket is empty", como corresponde a un bucket recién creado. Para eso hubo que dar al usuario del almacenamiento permisos de lectura, escritura y listado sobre el bucket nuevo: compartir las credenciales no basta, los permisos van por bucket. Queda sin probar una subida real de partida.

Volumen real medido en la copia del 2026-11-13, para dimensionar la siembra del hub (§9.7): 1.011 juegos, 1.014 iteraciones, 278 sesiones, 1.280 eventos de estado, 239 gastos, **40.452 logros de catálogo**, 3.370 desbloqueos, 51 copias de partidas, 119 recaps. El catálogo de logros es, con diferencia, lo que más filas escribiría: por eso va agrupado por juego (§7.4) y se sube al final.

#### §20.1.2 Resultado de las comprobaciones previas (2026-11-13)

Los prototipos vivían en `spikes/` y no formaban parte del producto. Se borraron en la limpieza L0 (2026-11-16, Apéndice C); siguen en el historial de git.

| Id   | Resultado                                                                                                                                                                                                                                                                                                     | Dónde                                            | Qué queda                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | **Sí.** Drizzle 1.0.0-rc.4 funciona sobre el SQLite de un Durable Object con su migrador, y el mismo fichero de esquema lo usa Node. La misma función de biblioteca da resultados idénticos en los dos lados                                                                                                  | `spikes/hub-do`                                  | Nada                                                                                                                                                                          |
| S-02 | **Sí en rendimiento.** Con los datos reales: biblioteca entera en 5 ms, una escritura suelta en 2,3 ms, aplicar 40.000 filas en 1,2 s. Pero el driver debe ser síncrono (§8.9): `node:sqlite` existe y funciona dentro de Electron 44                                                                         | `spikes/local-driver`                            | Estabilidad de `node:sqlite` en ejecuciones largas                                                                                                                            |
| S-03 | **Sí, medido en Cloudflare.** La biblioteca consume 6-17 ms de CPU dentro del Durable Object (25 ms en frío), y el límite de CPU de un Durable Object es de 30 s por petición en los dos planes; los 10 ms del plan gratuito aplican al Worker, que gasta 0-1 ms. Ningún error de límites en 118 invocaciones | `spikes/hub-do`, `results/cloud-cpu-summary.txt` | El coste real está en las **filas leídas**: 11.207 por llamada, unas 446 llamadas al día con el cupo gratuito. Hay que guardar en caché la biblioteca por número de secuencia |
| S-04 | **Probablemente sí, por documentación.** Access protege rutas concretas y la regla más específica manda; no permite proteger solo la raíz. La PWA iría bajo un prefijo propio, `/api/*` protegido y `/sync/*` sin aplicación de Access                                                                        | —                                                | Confirmarlo en el panel al desplegar. Plan B: dos nombres de host                                                                                                             |
| S-05 | **Sí.** El núcleo corre en Node sobre una interfaz SQL síncrona y converge en 2.000 secuencias aleatorias con 3 réplicas. Encontró cuatro agujeros en el diseño, ya corregidos en este documento                                                                                                              | `spikes/sync-core`                               | El adaptador de Durable Object y el transporte HTTP                                                                                                                           |
| S-06 | **F-07 reproducido.** Con el cliente 0.7.2 contra el servidor de sync local de Turso 0.7.2. F-08 se comporta distinto de lo sospechado: pierde filas en silencio en vez de atascarse                                                                                                                          | `spikes/turso-collision`                         | Repetirlo contra Turso Cloud, si se quiere: hace falta otra base desechable                                                                                                   |
| S-07 | **Sin hacer.** Necesita dos PCs con la misma partida                                                                                                                                                                                                                                                          | —                                                | Pendiente para la fase 6                                                                                                                                                      |

**Agujeros que el spike del núcleo encontró en la primera versión de este diseño.** Cada uno tiene un test que lo reproduce en `spikes/sync-core/test/holes.test.ts`:

| Id  | Qué pasaba                                                                                                                                                                                     | Corrección                                                     | Sección    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| H-1 | **No convergía.** Con relojes implícitos y "`syncCreated` = el menor", una columna que ganaba quedaba re-fechada al mínimo, y una tercera réplica con la versión vieja no la actualizaba nunca | Relojes explícitos al fusionar; desempate por valor            | §8.3       |
| H-2 | **Perdía datos.** Al añadir el mismo juego en dos PCs, el segundo pisaba con valores vacíos lo que el primero había escrito                                                                    | Las columnas no indicadas al crear llevan `BOTTOM`             | §7.3, §8.3 |
| H-3 | **Perdía horas jugadas.** El barrido de sesiones abandonadas, con la hora del hub, ganaba a un cierre real hecho offline antes                                                                 | El barrido escribe con el reloj siguiente al del dueño         | §10.5      |
| H-4 | **Atascaba la descarga.** Comprobar las claves foráneas por página fallaba para siempre si un padre viajaba en una página posterior a su hijo                                                  | Sin claves foráneas durante la descarga; el hub no las declara | §7.7       |
| H-6 | Una columna añadida por migración empataba su valor por defecto con el real                                                                                                                    | Nace con `BOTTOM`                                              | §8.7       |

Otras cosas que cambian por los spikes: el catálogo de logros va agrupado por juego (§7.4), las subidas se agrupan y tienen tamaño máximo (§8.4), y el driver local tiene que ser síncrono (§8.9).

**Hallazgo lateral.** La base de pruebas de Turso a la que apuntan `.env` y `worker/.dev.vars` ya no existe: responde "no route configured for host". Los E2E que piden sync y el Worker en local no pueden conectar hasta que se apunte a otra.

**CI.** `.github/workflows/ci.yml` ejecuta lint, tipos y tests en Windows. Sus tres órdenes pasan en local (1.071 tests); el flujo en sí no se ha ejecutado en GitHub.

### §20.2 Fase 1 — Dominio compartido (M)

Mover las reglas a `shared/domain` como funciones puras (§15.2), con sus tests. DTOs propios. Se puede hacer sobre el esquema actual.

**Salida:** el escritorio lee a través de `shared/domain`; los tests de dominio cubren lo que hoy cubren los de paridad.

#### §20.2.1 Estado de la fase 1 (2026-11-13)

Hechas las reglas, los tipos propios y las copias del renderer. Queda una decisión de producto (el recuento de sesiones) y tres fallos anotados.

| Regla                                                                   | Módulo en `src/shared/domain/` | Quién lo usa                                                              |
| ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Horas por playthrough y por juego; horas de un año                      | `hours.ts`                     | `getGames`, `getGameById`, Worker (biblioteca, ficha, estadísticas, saga) |
| Reparto del gasto, coste por hora                                       | `spend.ts`                     | `getGameById`, Worker (ficha)                                             |
| Ficha: fechas derivadas, estado, en vivo                                | `gameDetail.ts`                | `getGameById`, Worker (ficha)                                             |
| Biblioteca: estado, último día jugado, horas manuales con su año        | `library.ts`                   | `getGames`, Worker (biblioteca y estadísticas)                            |
| A qué playthrough cuelga una sesión nueva                               | `resolvePlaythrough.ts`        | `resolveIterationForPlay`, cronómetro del Worker                          |
| Orden de "Up next", validez de un pin del móvil, vista previa del buzón | `planOrder.ts`                 | `reorderUpNext`, drenado del buzón, Worker (buzón), PWA                   |

- **Tamaño.** Las cuatro consultas de lectura pasan de 1.510 líneas a 844; `resolveIterationForTimer` (107 líneas) desaparece del Worker. En conjunto: 730 líneas añadidas y 2.339 quitadas, sin contar los módulos y tests nuevos.
- **Comprobado.** Lint y tipos de los cinco proyectos sin errores; 1.162 tests en verde; build y 37 casos de Playwright (Plan, Stats, lógica, notas, Steam App ID, biblioteca) en verde tras la segunda pasada. **Sobre una copia de los datos reales**, las consultas nuevas devuelven exactamente lo mismo que las anteriores: 346 juegos de biblioteca, 665 planeados y las 1.011 fichas, en el escritorio y en el Worker, sin una sola diferencia.
- **Rendimiento.** `getGames` no empeora (19,7 ms frente a 19,9-22,4 en el banco sintético de 300 juegos y 18.000 sesiones).

Lo que cambia de comportamiento, todo en el móvil:

- El cronómetro elige mejor entre playthroughs existentes: ve un playthrough ya activo aunque su `started` tenga fecha posterior, y no apila un `started` de más.
- **El cronómetro sigue sin crear playthroughs.** La regla compartida sabe contestar "crea uno", porque el botón Play del escritorio lo necesita; el Worker convierte esa respuesta en el rechazo de siempre ("ábrelo en tu PC"). Es una política deliberada del cronómetro, no una carencia.
- Con varias sesiones abiertas del mismo juego, "en vivo desde" es el arranque más reciente, como en el escritorio.
- La vista previa de un pin pendiente con marca no válida usa "ahora", como el drenado.

Excepción que se mantiene: el Worker decide "en vivo" con la frescura del cronómetro y el escritorio con "toda sesión abierta". Unificarlo haría que un cronómetro olvidado saliera en vivo en el móvil. Se resuelve de verdad con la señal de vida de §10.3.

Segunda pasada (tipos y renderer):

- **Tipos propios (F-42).** `src/shared/dto.ts` declara a mano las entidades (`GameRow`, `Iteration`, `Session`, `StateEvent`, `SpendEvent`, `Emulator`, `SaveBackupRow`) y los inputs del IPC; `shared/types.ts` los reexporta. Ni el renderer ni la PWA cargan ya `schema.ts`. `src/main/db/dtoSync.ts` hace fallar la compilación si un tipo y su tabla se separan, en los dos sentidos.
- **Parches cerrados.** `UpdateGamePatch` pasa de "cualquier columna de `games`" a diez campos (título, carátula, hero, id de SteamGridDB, notas, ejecutable, carpeta y tamaño de instalación, endless, emulado). `games:update` descarta en ejecución cualquier otra clave (`src/main/ipc/gamePatch.ts`), con test contra una base real. Solo se filtran claves, no valores: la validación completa del contrato es de la fase 7 (§20.8). Lo que el main escribe por su cuenta (IGDB, notas, partidas guardadas) usa tipos internos en `src/main/db/writeTypes.ts`.
- **Copias del renderer.** `renderer/src/lib/plan.ts` reparte las estanterías con `shared/planShelves` y solo añade la lente sobre la cola; `statsTotals.ts` saca las horas de un año de `hoursByGameInYear`. Sin cambios de comportamiento. Los casos del Plan que vivían en el test de paridad son ahora tests de la regla compartida.

Pendiente de la fase 1:

- **La discrepancia de recuento de sesiones** entre la portada y la pantalla de Sesiones. Causa encontrada: la portada suma solo juegos de la biblioteca y Sesiones cuenta también las de juegos devueltos al Plan. El escritorio tiene la misma asimetría. Arreglarla es elegir una sola población, y eso es una decisión de producto. Con los datos de hoy no se manifiesta: ningún juego planeado tiene sesiones.
- Fallos vistos y no tocados: el ancla de las horas manuales en la biblioteca incluye sesiones del modelo v1 y la ficha no; las sesiones de la ficha no tienen orden explícito; el Worker rechaza un reorden con ids repetidos y el escritorio lo acepta.

### §20.3 Fase 2 — Esquema 2.0 y puerta de escritura (L)

Esquema nuevo (§7), driver local (§8.9), módulo de escritura (§8.6), consultas adaptadas, reloj (§8.2).

**Salida:** la app funciona entera en local con el esquema nuevo y una base vacía; los tests de almacén pasan.

#### §20.3.1 Estado de la fase 2 (2026-11-14)

La fase se hace en dos tandas. La primera es solo añadir: la app sigue funcionando con el esquema 1.x. La segunda cambia las consultas, el IPC y el renderer al esquema nuevo.

**Primera tanda, hecha:**

| Pieza                                       | Dónde                                    |
| ------------------------------------------- | ---------------------------------------- |
| Reloj, relojes por columna, identificadores | `src/shared/sync/`                       |
| Esquema 2.0, registro de tablas, migración  | `src/main/db/v2/`, `drizzle-v2/`         |
| Mapa de cada columna 1.x a su destino       | `src/main/db/v2/MAPA-1X.md`              |
| Conexión local y puerta de escritura        | `src/main/db/v2/connection.ts`, `store/` |
| Ids con nombre en todo el código            | `src/shared/entityIds.ts`                |

- **Driver.** `node:sqlite` con `drizzle-orm/node-sqlite` y su migrador. Comprobado dentro de Electron 44.4.5 (Node 24.21, SQLite 3.53.4): abrir, migrar, escribir por la puerta y reabrir con el reloj por encima del máximo de la base. Queda sin medir su comportamiento en ejecuciones largas; en Node 22 sigue avisando de que es experimental.
- **Rendimiento de la puerta**, sobre un fichero con WAL y `synchronous = FULL`: 5.000 creaciones en 759 ms, 5.000 parches con cambio en 554 ms, 5.000 parches sin cambio en 41 ms, 100 escrituras sueltas en 234 ms, reabrir la base en 6 ms.
- **Ids con nombre.** Unos 150 ficheros dejan de escribir `number` para los ids y de asumir que lo son (rutas, desempates, claves de consulta). Con el alias cambiado a texto, los únicos errores de tipos que quedan son la frontera con la base 1.x y los ids literales de tests y fixtures (unos 580). La app sigue con ids numéricos y se comporta igual.
- **Comprobado.** Lint y tipos de los cinco proyectos sin errores, 1.538 tests, build y la suite completa de Playwright.

**Segunda tanda, en curso.** Es mayor de lo que este plan contaba: además de las 65 consultas de `db/queries/` hay 39 ficheros fuera de `db/` que tocan la base, 26 de ellos directamente (refrescos externos, Steam, RetroAchievements, radar, imágenes, `index.ts`). El inventario completo, el contrato de cada DTO, las decisiones tomadas y el reparto están en `src/main/db/v2/CONSULTAS.md`.

| Paso                              | Qué es                                                                                                                                                                                              | Estado a 2026-11-13                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipos y reglas genéricos en el id | Para que convivan consultas con ids de texto y el Worker con ids numéricos                                                                                                                          | Hecho                                                                                                                                                                                                            |
| Inventario y contrato             | `CONSULTAS.md`                                                                                                                                                                                      | Hecho                                                                                                                                                                                                            |
| P0 · Piezas comunes               | `src/main/db/v2/queries/common/`: contexto, dispositivo, lectura de un juego, filas vivas, etiquetas, comprobaciones externas, cierre de sesiones, fixtures                                         | Hecho                                                                                                                                                                                                            |
| Importador, primera versión       | `src/main/db/v2/importer/` y `scripts/import-1x-to-v2.ts`. Adelantado desde la fase 8 para trabajar con datos reales y comparar la 2.0 con la 1.x juego a juego                                     | Hecho. Valida contra las consultas 2.0: en el ensayo con datos reales, 774.257 valores comparados sin diferencias no esperadas, conciliación columna a columna sin diferencias y los 119 recaps con firma válida |
| P1 a P8 · Consultas por dominio   | Biblioteca y ficha; altas y Plan; playthroughs, estados y gasto; sesiones y watcher; logros; refresco externo; partidas; recaps, curiosidades y radar. En paralelo, cada uno en su carpeta          | Hecho e integrado, con una prueba que recorre todos los paquetes juntos                                                                                                                                          |
| P9 · El cambio                    | El main abre la base 2.0, el IPC y los 39 ficheros pasan a las consultas nuevas y a la puerta, `EntityId` pasa a texto, desaparece el sync de Turso del escritorio, se rehace la semilla de los e2e | Hecho (2026-11-14), detalle abajo                                                                                                                                                                                |

**P9, hecho (2026-11-14).** La rama `v2` ya es la app 2.0 de escritorio:

- **Base.** El main abre `<userData>/Afterplay2.db` (`db/v2/appDb.ts`, `db/v2/runtime.ts`) con las migraciones de `drizzle-v2/`, registra este PC (`ensureThisDevice`, con el `deviceId` de `machine-saves.json`) y pasa todo por las consultas 2.0 y la puerta. Si no hay base 2.0 y la carpeta tiene una `Afterplay.db` 1.x, la importa, pero **solo** en el perfil de desarrollo y en los e2e; la app instalada no lo hará hasta el corte. Las copias diarias y manuales se llaman `Afterplay2-*.db` y no cuentan ni rotan las `Afterplay-*.db` de la 1.x.
- **Código 1.x.** Las consultas de `db/queries/` que ya tienen sustituta y sus tests se borran. Se queda lo que aún usan el Worker (que sigue en 1.x hasta la fase 5) y las herramientas de la 1.x.
- **Ids.** `EntityId` es texto (UUIDv7). Los tipos compartidos con el Worker y la PWA son genéricos en el id, y estos los usan con `number` (`PlanMailboxEntry<number>`, `worker/src/api-types.ts`).
- **Turso fuera (R-14).** Ni el main ni el preload importan `@tursodatabase/sync`, `@libsql/client` ni `drizzle-orm/libsql`; `src/main/__tests__/noTursoInMain.test.ts` recorre el grafo de imports y falla si vuelven. Los dos paquetes pasan a `devDependencies` (los usan los spikes, el andamio de tests 1.x y las herramientas de la 1.x) y el instalador empaqueta `drizzle-v2/` en vez de `drizzle/`. Los e2e quitan siempre las credenciales de la base y ya no existe la bandera para dejar sincronizar al sandbox.
- **Interfaz.** El paso por el Plan (R-06) sale en el historial, la vista de TV y el Journey como "Added to Plan" y "Left the Plan", de solo lectura; "Added to Afterplay" se oculta cuando el juego entró por el Plan, y el "tiempo esperando" cuenta desde `planHistory.plannedAt`. La precisión `'unknown'` (R-07) se pinta como "Date unknown", la duración como "Length unknown", y el Journey no la sitúa en la línea de tiempo. El completado por fuente (R-11) sale en la vitrina de logros cuando un juego tiene Steam y RetroAchievements, en el muro del 100 % y en "almost there" (con la fuente), y en Ajustes con una línea por fuente.
- **E2E.** `e2e/sandbox.ts` siembra la base 2.0 con las mismas fixtures que los tests de consultas, desde la semilla de `e2e/seed.ts` (que sigue saliendo de una copia 1.x con `scripts/gen-e2e-seed.ts`). Los tests buscan los juegos por título (`gameIdOf`), porque los ids cambian en cada sandbox. El de módulos nativos prueba `node:sqlite` en lugar de libSQL.
- **Perfil de desarrollo.** `npm run dev:v2:seed -- --force` copia la 1.x más reciente de `backups/` y borra la `Afterplay2.db` del perfil; el siguiente `npm run dev:v2` la importa. Así se rehace también una base 2.0 creada con un esquema anterior.
- **Comprobado.** Lint y tipos de los cinco proyectos sin errores, 2.066 tests, build y la suite completa de Playwright (92 tests; un test de hover de Stats falla de vez en cuando y pasa al repetirlo).

**Para retomar el trabajo otro día:** la fase 2 está cerrada en la rama `v2`. La revisión del motor de fusión queda para la fase 3, cuando exista. Las decisiones de la fase están en `CONSULTAS.md` §5.0 (R-01 a R-18, I-01 a I-19).

**Revisión independiente (2026-11-14).** Una revisión hecha por quien no escribió el código, con el único encargo de buscar formas de perder o alterar datos en la puerta de escritura, la conexión, el reloj y el importador. Encontró siete fallos, cada uno reproducido con un test, y cinco sospechas. Todos están arreglados:

- Un sello con fecha futura en la 1.x (el PC con la hora mal) adelantaba el reloj del dispositivo para siempre. Ahora el reloj importado no pasa de "ahora"; los datos se importan tal cual y el informe cuenta los sellos futuros.
- Un texto con el carácter nulo se cortaba al leerlo y la validación no lo veía, porque comparaba contra la misma lectura cortada. La puerta lo rechaza y el importador aborta si encuentra alguno, contándolos en SQL sobre los bytes.
- Una función asíncrona dentro de una transacción la dejaba a medias: se rechaza antes de ejecutarla.
- Si SQLite deshacía la transacción entera a mitad de un savepoint, el error quedaba tapado y lo siguiente se escribía suelto. Ahora la transacción queda abortada con el error original.
- Se podía crear un hijo vivo bajo un padre con lápida: la puerta lo rechaza.
- El id corto del reloj vivía en la base, así que copiarla a otro PC duplicaba el firmante. Ahora va ligado al `deviceId` y se sortea de nuevo si no coincide. La migración única se regeneró por esa columna.
- La puerta aceptaba `Set`, `Map` o `Date` en columnas JSON y los guardaba como `{}`: ahora los rechaza.
- Sospechas resueltas: el importador lee el origen como una foto coherente, dentro de una transacción; el script copia la base con su `-wal`; solo se resellan las firmas de los recaps insertados en esa ejecución; un `Math.min(...)` que desbordaba con muchas filas se cambió por un bucle; la protección contra leer la base en uso está en la función, no solo en el script.

Ensayo repetido con datos reales: 0 diferencias inesperadas, 119 recaps casando, idempotente y determinista, 0 sellos futuros y 0 textos con nulo. Esa protección tiene una sola excepción, para el corte de la fase 10: la opción `cutover` de `importLegacyDatabase` deja escribir exactamente `Afterplay2.db` de la carpeta de datos de la app, y ninguna otra ruta. El origen no tiene excepción: en el corte la app cierra su conexión 1.x, saca una copia consistente de `Afterplay.db` a `backups/` e importa desde esa copia.

**Decisiones del usuario (2026-11-13):**

- El completado al 100 % de logros se cuenta por fuente: Steam y RetroAchievements son dos hitos distintos. Cómo se enseña en la interfaz se decide al adaptar el renderer.
- El paso por el Plan tiene dos eventos visibles en la ficha y en el Journey: "Añadido al Plan" y "Salió del Plan". Se enseña el último paso; el "tiempo esperando" cuenta desde la última vez que el juego entró al Plan.
- Borrar un juego no borra sus copias de partidas del bucket (§12.7).

El Worker y la PWA siguen sobre el esquema 1.x hasta la fase 5.

Decisiones tomadas en esta fase que el documento no fijaba:

- **Borrar un juego no borra sus cachés ni sus copias de partidas.** `game_metadata`, `external_checks`, `achievement_catalogs` y `game_curiosities` se quedan: si el juego se vuelve a añadir (mismo id) reaparecen sin repetir llamadas ni repagar curiosidades. `save_backups` se queda porque indexa objetos reales del bucket. Sí reciben lápida los playthroughs, eventos, sesiones, gastos, instalaciones, la entrada del plan y los desbloqueos.
- **Volver a añadir un juego borrado hace reaparecer lo que tenía** (notas, ajustes de partidas): la fila resucita con sus valores anteriores, que es lo mismo que haría la fusión de §8.3. Sus playthroughs y sesiones siguen borrados.
- **`NOT NULL` solo donde la fila siempre nace con valor.** No se puede desactivar durante la descarga, así que una fila incompleta llegada por sync la atascaría. La puerta rechaza las creaciones incompletas; el motor de la fase 3 debe apartar esas filas en vez de abortar la página.
- **Valores por defecto al crear.** Una columna no indicada se guarda con su valor por defecto pero con reloj `BOTTOM`, para que no pise el valor real que escriba otro dispositivo. Indicar `null` cuenta como indicar: quien llama tiene que **omitir** lo que no sabe.
- **Parchear una fila borrada o inexistente es un error**, no un no-op: esconderlo taparía ediciones sobre algo que otro PC acaba de borrar.
- **La cascada de un borrado alcanza filas de otros dispositivos**, sesiones abiertas incluidas: borrar un juego es una decisión explícita del usuario. El borrado directo de una fila ajena sí pasa por la regla del dueño.
- **"Una sesión abierta por objetivo" se mide por juego**, no por playthrough (§10.4), o por emulador si la sesión no tiene playthrough.
- **`synchronous = FULL`**: con WAL y `NORMAL`, un corte de luz pierde lo confirmado desde el último checkpoint, y el volumen de escritura es pequeño.
- **La regla de lint de §8.6 no es viable tal como está escrita**: las consultas de lectura necesitan los objetos de tabla. La barrera es un test que busca escrituras a tablas sincronizadas fuera de `store/`; la regla de lint se limitará a impedir que el IPC y el renderer importen el esquema.
- **`devices.installNonce`**, que §12.6 da por supuesto y §7.4 no listaba, y `local_sync_state.shortDeviceId` para el id corto del reloj.

Huecos de este documento encontrados en la fase 2 y **todavía sin resolver**. Ninguno bloquea la primera tanda; cada uno indica la fase que lo necesita:

| Hueco                                                                                                                                                               | Lo necesita |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| El historial de la ficha desempata estados y gastos de la misma fecha comparando ids de dos tablas distintas                                                        | Fase 2      |
| Los tests y la semilla de e2e usan ids numéricos fijos (`refreshGame(1)`, `FIRST_LIGHT = 3`): hay que buscarlos por título                                          | Fase 2      |
| Ids de los dispositivos `web` y `legacy`, y su id corto de reloj                                                                                                    | Fase 3      |
| Dónde se guardan el identificador y la época del hub                                                                                                                | Fase 3      |
| Restaurar una copia con relojes muy futuros adelanta el reloj y el hub rechazaría las escrituras                                                                    | Fase 3      |
| Borrar un juego alcanza sesiones de otros PCs que pueden estar abiertas; el watcher del dueño tiene que saber qué hacer si su sesión abierta recibe una lápida      | Fase 4      |
| §11.3 habla de instalación "no verificada", pero solo existe `lastVerifiedAt`                                                                                       | Fase 4      |
| Quién puede escribir qué en las tablas con dueño distintas de `sessions`. Hoy: solo el dueño, así que un PC no puede borrar del índice la copia de partidas de otro | Fases 4 y 6 |
| Forma exacta de la clave de objeto de la que sale el id de `save_backups` (prefijo, separadores)                                                                    | Fase 6      |
| `machineHome` pasa de ser por copia a ser por dispositivo: si la carpeta de usuario de un PC cambió, las copias antiguas generarían redirects equivocados           | Fase 6      |
| Ubicación de restauración: §7.6 la pone en `local_save_state` y §19.6 en `machine-saves.json`, que hoy la guarda con el id numérico del juego como clave            | Fase 6      |

Los seis huecos del importador que esta tabla apuntaba para la fase 8 se resolvieron al escribir su primera versión (revisado el 2026-11-17):

- **Ids.** Las tablas de id natural o compuesto (catálogos y desbloqueos de logros, `external_checks`, recaps, radar) usan su id natural (`importer/build.ts`). Las demás llevan un UUIDv7 determinista cuyo tiempo es el id antiguo, no el UUIDv5 de §19.5: así el orden de creación sigue siendo el de la 1.x (`importer/legacyIds.ts`).
- **Firmas de los recaps.** Se recalculan con los hechos de la 2.0 y se vuelven a sellar si coincidían (`importer/memorySignatures.ts`). La firma depende de la zona horaria: un recap solo se vuelve a sellar si se importa en la zona en que se generó.
- **Logros de Steam y de RetroAchievements.** Se separan por indicios (origen del desbloqueo, icono de RA, `raGameId`); si hay indicios de los dos lados, la fila va a los dos y cuenta como conflicto (`importer/achievements.ts`).
- **`achievementsUnlocksSyncedAt`.** Las dos marcas 1.x se reparten entre `steam_achievements`, `steam_unlocks` y `ra_achievements` (`importer/achievementStamps.ts`).
- **Orden de los playthroughs.** `syncCreated` sale de la fecha y, como desempate, del id antiguo; la etiqueta solo se guarda si no es la automática de su posición.
- **`plan_to_play` de un juego ya empezado.** La fecha y la nota del primero van a `plan_entries` con lápida en la fecha en que se empezó. Los siguientes de un mismo juego se descartan y se cuentan en el informe.

### §20.4 Fase 3 — Motor de sync y hub (XL)

Fusión, protocolo, `hub-core`, adaptador de Durable Object, motor del cliente, emparejado, arnés de convergencia.

**Salida:** E-03 a E-06, E-14, E-15, E-23 y E-24 pasan; los tests de propiedades pasan de forma sostenida.

#### §20.4.1 Estado de la fase 3 (2026-11-15)

Hecha en la rama `v2`. Solo está desplegado el hub de desarrollo (§20.4.2). Las piezas:

| Pieza                    | Dónde                                      | Qué hace                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fusión                   | `src/shared/sync/merge.ts`                 | La del spike, sobre valores de SQL crudos: por columna, desempate por valor, forma compacta normalizada, forma en tránsito. Propiedades comprobadas con 20.000 casos                                                         |
| Protocolo                | `src/shared/sync/protocol.ts`              | Rutas, peticiones y respuestas, códigos de error, token `ap1.<inquilino>.<secreto>`, límites e interfaz de transporte. En los GET las versiones van en la query                                                              |
| Núcleo del hub           | `hub/core/`                                | Esquema derivado de las mismas tablas del cliente (sin claves foráneas, con `syncSeq`), subida y bajada con secuencia, versiones, emparejado con código, tokens guardados como huella, concesiones, barridos. Sin Cloudflare |
| Worker y Durable Objects | `hub/worker/`                              | `afterplay-hub`: enrutado, autenticación de dispositivos, `TenantHub` (uno por persona, alarma de barrido cada hora), `Directory` (inquilinos e invitaciones), API mínima de la PWA tras Access, límite de intentos          |
| Motor del cliente        | `src/main/sync/`                           | Ciclo subir, bajar y avisar; hub nuevo o de otra época; esquema demasiado viejo; reloj adelantado y su recuperación; transporte HTTP; planificador de disparadores                                                           |
| Integración en la app    | `src/main/sync/runtime.ts`, Ajustes → Sync | Emparejar con dirección y código, token cifrado fuera de las claves exportables, estado y "Sync now", desemparejar, avisos al renderer, subida final al cerrar (tope de 5 s). Sin hub emparejado no hace nada                |
| Arnés de convergencia    | `hub/convergence/`                         | Hub real y varios clientes reales en un proceso, con relojes controlables y transporte con ida y vuelta JSON                                                                                                                 |

**Comprobado.**

- Pasan los escenarios E-03, E-04, E-05, E-06, E-14, E-15, E-23 y E-24, afirmados con las consultas reales de lectura.
- Las propiedades de convergencia (3 clientes y un hub, escrituras reales al azar, cortes de red, relojes desviados y cambios de época) pasan con la semilla por defecto en cada `npm test`. También pasan en ejecuciones largas: 600 de 200 pasos y 200 de 200 pasos con otra semilla.
- Lint y tipos de todos los proyectos (también los tres de `hub/`), 2.320 tests, build y la suite de Playwright.

**Decisiones de esta fase:**

- **Migración única.** Las columnas nuevas de `local_sync_state` (hub, época, versión de esquema sincronizada, bloqueo, código de error) entran en la migración inicial, que se regeneró, como dice la regla de "una sola migración hasta publicar". Una base 2.0 de desarrollo creada antes se rehace con `npm run dev:v2:seed -- --force`.
- **Id corto en caliente.** Al emparejar, el id corto que asigna el hub se aplica sin reiniciar (`HybridClock.setDev`).
- **Relojes del barrido.** Un reloj firmado con `000000` solo se acepta en una subida si el hub ya lo tiene guardado en esa misma celda. Así un PC puede reenviar sin bloquearse una fila que tocó el barrido de sesiones (fase 4), y nadie puede inventar uno.
- **Concesiones.** Una concesión terminada, con éxito o con fallo, sigue ocupando su trabajo hasta que caduca. Así otro PC que aún no ha bajado el resultado no vuelve a pagarlo. El cliente debe pedir un plazo largo (horas) para `memory` y `curiosities`.
- **Código de emparejado.** Lleva delante el id del inquilino (`7k2m9p-K7M2P-9XQ4T`), así que no hace falta un índice de códigos. Cinco fallos en diez minutos bloquean el emparejado de ese inquilino quince minutos.
- **Credenciales del hub.** Van cifradas en `credentials.json`, pero fuera de las claves que viajan al renderer o se exportan. Los e2e las quitan siempre y el perfil de desarrollo solo acepta hubs locales o de desarrollo.

**Pendiente o sin comprobar:**

- **Cloudflare, en parte.** El hub de desarrollo (§20.4.2) ya prueba el empaquetado, el Durable Object real y Access. Falta la alarma de barrido y el hub de producción.
- **E-14 se cubre al revés.** Un cliente real no puede tener dos esquemas a la vez, así que el "cliente nuevo" es un dispositivo de prueba que habla el protocolo y los clientes reales hacen de versión anterior.
- **Barrido de sesiones abandonadas.** Queda como punto de extensión del núcleo: es de la fase 4 (E-08, E-09).
- **Concesiones en el cliente.** Ningún trabajo de fondo las usa aún (§14.3, E-11, fase 5).
- **Turso en Ajustes.** La pestaña Connections sigue enseñando los campos antiguos de Turso, que el escritorio ya no usa.
- **Límite de intentos por IP.** No hay; solo por inquilino.

#### §20.4.2 Hub de desarrollo (2026-11-15)

`afterplay-dev-hub`, en `https://afterplay-dev-hub.afterplay-worker.workers.dev`. Se despliega **solo** con `wrangler deploy --env dev` desde `hub/worker/`. La configuración de arriba de `wrangler.jsonc` es la de producción (`afterplay-hub`) y no se despliega. Sus Durable Objects son propios y no comparte datos con el Worker de la 1.x (`afterplay-web`), que no se ha tocado.

- **Access delante (desde el 2026-11-15).** Dos aplicaciones de Access en la cuenta. «Afterplay hub (dev)» cubre todo el host, con sesión de un mes. Tiene dos políticas: «Accesos por email» (Allow) y «Scripts dev» (Service Auth, con el token de servicio «Afterplay dev scripts»). «Afterplay hub (dev) - sync de los PCs» cubre `/sync/*` con Bypass, porque los PCs no son navegadores; ahí el hub sigue exigiendo el token de dispositivo. El hub valida el JWT de Access él mismo (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`).
- **Anfitrión.** `ADMIN_EMAIL` es el correo real de la cuenta, así que el inquilino del anfitrión es el que abre la PWA. El inquilino anterior, atado a un correo de relleno, queda huérfano.
- **Token de administración.** Además, `/api/v2/*` abre con la cabecera `x-afterplay-admin-token` (`hub/worker/src/adminToken.ts`), que actúa como `ADMIN_EMAIL` y se mira antes que Access. El token es un secret del Worker (`HUB_ADMIN_TOKEN`, de 32 caracteres como mínimo). La comparación es de tiempo constante.
- **Credenciales de los scripts.** Viven en `hub/worker/.dev.vars.admin-token`, que git ignora: `HUB_ADMIN_TOKEN` y el token de servicio (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`). `scripts/devHubAuth.ts` las convierte en cabeceras para `hub:dev`, la prueba de humo y el proxy de `dev:pwa:hub`. Sin el token de servicio, Access redirige al login y los scripts lo dicen. Una política de Access creada desde la ficha de la aplicación no queda enlazada hasta que se guarda la aplicación.
- **Administración.** `npm run hub:dev -- code` da un código de emparejado de un solo uso, `devices` lista los dispositivos y `revoke <tokenId>` revoca uno. El token nunca se imprime.
- **Emparejar el perfil de desarrollo.** Con `npm run dev:v2`, en Ajustes → Connections → Sync, se ponen la dirección del hub y el código. El perfil de desarrollo solo acepta hubs cuyo nombre empieza por `afterplay-dev`.
- **Prueba de humo.** `npm run hub:dev:smoke` usa el transporte real del cliente. Empareja un dispositivo de prueba y comprueba que el código no se reutiliza. Luego prueba status y hora, subida, eco sin secuencia nueva, rechazo de reloj adelantado, bajada, concesión concedida, denegada y cerrada, y la lista de dispositivos. Al final lo revoca y comprueba que su token ya no entra. Pasa entera (13 de 13).

**Lo que encontró.** La bajada fallaba en el Durable Object real con `too many terms in compound SELECT`. Juntaba en un solo `UNION ALL` la búsqueda de secuencias de todas las tablas, y el SQLite de Cloudflare tiene un tope de términos mucho más bajo que el de Node. Ahora es una consulta por tabla, mezclada en memoria. Un test exige que ninguna sentencia del pull use `UNION`, `INTERSECT` ni `EXCEPT`, y otro pagina mezclando tablas. Los tests de Node no podían verlo: cualquier sentencia nueva del hub que dependa de límites de SQLite hay que probarla también en el hub de desarrollo.

**Comprobado en el runtime real.** Enrutado y RPC entre Worker y los dos Durable Objects, `blockConcurrencyWhile` con la creación del esquema (`PRAGMA table_info`), `json_set`, `RETURNING` (revocar y cerrar concesión), fallo cerrado (401 sin token y en `/api/v2` sin credencial, 404 en rutas desconocidas).

**Dos PCs reales (2026-11-15).** El PC principal subió su biblioteca entera (unas 13.600 filas). Un segundo PC, que arrancó con el perfil vacío, se emparejó y la bajó. Una nota editada en el segundo PC llegó al principal al abrir la app, sin pulsar "Sync now".

**Access (2026-11-15).** `/` y `/api/v2/*` sin sesión redirigen al login de Access; `/sync/v1/*` llega al Worker (401 sin token). La prueba de humo pasa entera a través de Access con el token de servicio. El PC principal se reemparejó con el inquilino del correo real y lo subió todo; la PWA, con sesión de Access, enseña la biblioteca.

**Sin comprobar.** La alarma de barrido horaria y el límite de intentos de emparejado.

### §20.5 Fase 4 — Sesiones, watcher e instalaciones (L)

§10 y §11.

**Salida:** E-01, E-02, E-07 a E-10 pasan.

#### §20.5.1 Estado de la fase 4 (2026-11-15)

Hecha en la rama `v2`. Las piezas:

| Pieza                         | Dónde                                                                      | Qué hace                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barrido de sesiones           | `hub/core/hub.ts` (`sweepAbandonedSessions`)                               | Cierra a las 24 h sin señal, en la última señal de vida, con `closedBy = 'janitor'` y un reloj `000000` justo encima de la última escritura del dueño. Un cierre real del dueño siempre le gana |
| Cierre ordenado               | `src/main/watcher/quitSequence.ts`, `before-quit`                          | Cierra las sesiones propias, hace el backup pendiente (hueco para la fase 6) y la subida final, con un tope total de 10 s                                                                       |
| Sync antes de crear           | `SyncScheduler.runOnceWithin`                                              | Antes de abrir un playthrough nuevo, un sync rápido (3 s como mucho) para no duplicar el de otro PC                                                                                             |
| Regla del dueño               | `queries/sessions/timerRule.ts`                                            | Solo el dueño cierra su sesión; un cronómetro lo puede parar cualquier PC                                                                                                                       |
| Orden por creación            | `src/shared/domain/creationOrder.ts`                                       | Con dos playthroughs activos, manda el creado más tarde (`syncCreated`), en todos los PCs igual                                                                                                 |
| Fusión de playthroughs        | `queries/playthroughs/merge.ts`, `ConcurrentPlaythroughsNotice.tsx`        | La ficha avisa de "Two playthroughs are in progress" y los junta en el vigente                                                                                                                  |
| Sesiones de otro dispositivo  | `src/shared/liveSession.ts`, `RemoteLive.tsx`                              | "Playing on PC-A", sin Stop salvo cronómetros, y "No signal for X" a los 3 minutos                                                                                                              |
| Instalaciones por dispositivo | `queries/library/installs.ts`, `InstallNotice.tsx`, `scan/linkInstalls.ts` | "Installed on", aviso de ejecutable que ya no está, lanzar por juego y vincular por escaneo solo con identidad fiable                                                                           |

**Comprobado.**

- Pasan E-01, E-02, E-07 (sesión y backup de partidas, con la secuencia de cierre real), E-08, E-09 y E-10 en `hub/convergence/__tests__/phase4.test.ts`. El barrido tiene además sus propios tests en el núcleo, comprobados con mutaciones.
- Lint, tipos, 2.506 tests, build y los 93 e2e.
- El hub de desarrollo está desplegado con el barrido y la prueba de humo pasa.

**Dos PCs reales (2026-11-15).** Con el PC principal jugando, el segundo enseñó "Playing on" con su nombre y sin Stop, e "Installed on" en la ficha. Al cerrar el juego vio la sesión cerrada con su duración. Al salir de Afterplay justo después de jugar, la sesión llegó cerrada al segundo PC con la hora correcta.

**Decisiones de esta fase:**

- **Sesiones huérfanas.** Una sesión propia abierta bajo un playthrough borrado no cuenta como abierta, ni en la consulta ni en la puerta de escritura. Antes bloqueaba el juego para siempre.
- **Vinculación por escaneo.** Con varios juegos del mismo título y ninguno instalado aquí, solo se vincula si la ficha de IGDB señala a uno. Una ruta en el juego equivocado se sincronizaría.

**Pendiente o sin comprobar:**

- **Sesiones offline huérfanas.** Si un PC fusiona o borra un playthrough mientras otro juega sin red bajo él, la sesión del segundo queda huérfana al llegar (como E-06). No se reasigna.
- **Overlay y modo ambiente.** `OverlayHud` y el `LiveOverlay` de la columna central no distinguen aún las sesiones de otro dispositivo.
- **Sin e2e** de la sesión remota, la fusión y el ejecutable perdido: los fixtures no tienen dos dispositivos. La fusión y el ejecutable perdido tampoco se han visto en la app.
- **Alarma de barrido en Cloudflare.** Desplegada, pero no se ha visto cerrar una sesión de verdad (hacen falta 24 h).

### §20.6 Fase 5 — Móvil (M)

API v2 sobre el hub, PWA adaptada, concesiones, enriquecimiento.

**Salida:** E-11, E-12, E-13 pasan; no queda ninguna consulta de dominio reimplementada en el Worker.

#### §20.6.1 Estado de la fase 5 (2026-11-15)

Hecha en la rama `v2`. Las piezas:

| Pieza                    | Dónde                                                                     | Qué hace                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consultas del escritorio | `hub/core/queries.ts` (`HubQueries`)                                      | Ejecuta en el Durable Object las funciones de `src/main/db/v2/queries` con Drizzle sobre su almacén. Las lecturas que escriben fallan; las escrituras usan la puerta como `web` |
| Puerta de escritura      | `WriteStore` con `transactionRunner`                                      | La misma del PC, con el ejecutor de transacciones del almacén (un Durable Object no admite BEGIN). Cada fila tocada recibe secuencia nueva en la misma transacción              |
| Rutas                    | `hub/worker/src/web/{reads,writes,igdb}.ts`, tipos en `src/shared/api/v2` | Una sola llamada RPC `web` del Worker al Durable Object y el reparto por ruta dentro de él                                                                                      |
| Caché de lecturas        | `hub/worker/src/web/readCache.ts`                                         | Cada respuesta vale mientras no cambie la secuencia del inquilino. 128 entradas y 4 MiB                                                                                         |
| Cronómetro               | `queries/sessions/timer.ts`                                               | Uno vivo a la vez; no arranca si el juego tiene señal en otro dispositivo en los últimos 10 min                                                                                 |
| Altas del móvil          | `createPlannedGame(…, {stampChecks:false})`, `external/enrichPending.ts`  | El juego existe al instante; un PC lo completa después bajo la concesión `enrich:<gameId>`                                                                                      |
| Concesiones              | `src/main/sync/jobClaims.ts`                                              | Los trabajos de pago (recuerdos, curiosidades) exigen concesión si hay hub; los demás corren en local si el hub no responde                                                     |
| Claves de IGDB           | `hub/core/secretBox.ts`, `hub/worker/src/igdbCredentials.ts`              | El PC las sube al cambiar; el hub las guarda cifradas (AES-GCM, clave derivada por inquilino de `HUB_SECRETS_KEY`) y las usa para buscar, saga y media                          |
| PWA                      | `web/`                                                                    | Cliente de `/api/v2` sin buzón, con tope de 15 s por petición y mensaje de sesión de Access caducada. El hub la sirve como assets                                               |
| Acceso de desarrollo     | `npm run dev:pwa:hub` (`web/vite.config.ts`, modo `hub`)                  | Proxy de Vite al hub de desarrollo que añade el token de administración en el lado del servidor; el navegador no lo ve                                                          |

#### §20.6.2 Credenciales entre PCs

Las claves de Ajustes → Connections ya no son solo de cada PC: viajan por el hub a los demás PCs emparejados.

- **Qué viaja.** Todas las claves de servicios (IGDB, SteamGridDB, R2, S3, Anthropic, Steam, RetroAchievements) y el destino de las partidas guardadas (`saveStorageProvider`).
- **Qué no viaja jamás.** `databaseUrl` y `databaseAuthToken` (Turso es de la 1.x y decide con qué base habla cada PC) ni el token de emparejado del hub.
- **Regla de fusión.** Clave a clave, gana la entrada más nueva (`updatedAt`). Un borrado es una entrada con `value: null` y también gana si es más nuevo. En un empate con distinto valor gana el hub, para que todos los PCs converjan.
- **Sellos.** Cada PC guarda en `config.json` (`credentialStamps`) cuándo cambió una persona cada clave. Solo se sella lo que cambia de verdad; lo que llega del hub conserva el sello de origen. Una clave anterior a los sellos sube con `updatedAt` 0.
- **Cifrado.** Una sola ruta, `POST /sync/v1/credentials`: sube y baja en la misma vuelta. El hub guarda el paquete entero cifrado (AES-GCM, clave derivada por inquilino de `HUB_SECRETS_KEY`, finalidad `credentials-bundle`) y solo se lo devuelve a un dispositivo autenticado. Sin `HUB_SECRETS_KEY` no guarda nada. No hay contraseña propia.
- **Cuándo se sincroniza.** Al arrancar emparejado, al emparejar, al guardar o importar claves en Ajustes y, tras un ciclo de sync correcto, como mucho cada 10 minutos. Nunca en E2E ni con un hub bloqueado.
- **Qué pasa al recibir.** Se escriben las claves, se actualiza `process.env` y se invalidan los clientes cacheados. Un cambio remoto del destino de las partidas **no** lanza la migración R2/S3: esa solo corre en el PC donde la persona cambió el destino.
- **PWA.** El hub busca en IGDB con `twitchClientId` y `twitchClientSecret` del paquete; si faltan, cae al almacén antiguo (`/sync/v1/igdb-credentials`), que se mantiene para clientes viejos. El escritorio ya no lo llama.
- **Coste.** El hub guarda todas las claves de la persona, cifradas con un único secret del Worker. Si se rota `HUB_SECRETS_KEY`, el paquete deja de abrirse y se lee como vacío. Como cada PC conserva sus sellos locales, el siguiente intercambio sube lo suyo y el hub se reconstruye solo; no hace falta volver a teclear nada.

**Comprobado.** Pasan E-11 (`hub/convergence/__tests__/jobs.test.ts`), E-12 y E-13 (`hub/convergence/__tests__/webWrites.test.ts`). Ninguna respuesta de lectura lleva rutas de disco (F-31, `webReads.test.ts`). Lint, tipos, 2.975 tests, la build de la PWA y el bundle del hub.

**Límites conocidos:**

- **Radar entre PCs.** La concesión dura como mucho 24 h, así que la deduplicación del radar semanal solo cubre ese margen.
- **Recap regenerado.** Pedir otra vez el recap queda bloqueado por la concesión hasta 24 h.
- **Cronómetro y PC sin red.** Si un PC sin red empieza a jugar y, antes de sincronizar, el móvil arranca el cronómetro del mismo juego, ese rato cuenta doble (D-15). Se corrige editando la sesión.
- **Rotar `HUB_SECRETS_KEY`.** El paquete de credenciales guardado deja de abrirse y el hub lo trata como vacío; el primer PC que sincronice lo vuelve a subir entero (ver §20.6.2). Las claves de IGDB del almacén antiguo (clientes viejos) sí se pierden hasta que ese cliente las resuba.
- **Access.** La aplicación de Access tiene que cubrir todo el dominio del hub, no solo `/api/v2/*`: los assets de la PWA se sirven sin pasar por el Worker.

**Pendiente o sin comprobar:**

- La PWA carga a través de Access en el hub de desarrollo (escritorio); falta probarla en un móvil real.

#### §20.6.3 Filas grandes (2026-11-16)

Dos catálogos de logros de 675 KB y 284 KB no cabían en un lote de subida (256 KB) y se quedaban sin subir.

- **Subida.** El hub anuncia en `/status` `pushMaxRowBytes` (1,5 MiB, por debajo de los 2 MB por fila del SQLite de los Durable Objects). Una fila que no cabe en `pushMaxBytes` pero sí en ese tope sube sola en su lote. El router admite cuerpos de `push` hasta ese tope.
- **Hubs anteriores.** Un hub que no anuncia `pushMaxRowBytes` se trata como antes: nada por encima de `pushMaxBytes`, y la fila queda como `oversized` sin atascar el ciclo. Por eso el hub se despliega antes que los clientes.
- **Bajada.** Cada página de `pull` lleva como mucho 4 MiB de filas (`PULL_PAGE_MAX_BYTES`), además de las 1.000 filas; siempre al menos una. Si se corta, `next` es la última fila entregada y `more` es true. El cliente no cambia: ya sigue `next`.
- **Lo que sigue sin caber.** Un catálogo de más de 1,5 MiB (unos 3.000 logros) sigue sin subir y lo dice el log. Haría falta guardar las URLs de los iconos sin su prefijo común.

### §20.7 Fase 6 — Partidas guardadas (M)

§12.

**Salida:** E-16 a E-20 pasan.

#### §20.7.1 Estado de la fase 6 (2026-11-15)

Hecha y unida a `v2` el 2026-11-15, sin el esquema ni las migraciones tocados. Las piezas:

| Pieza                          | Dónde                                                         | Qué hace                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Huella del contenido           | `src/main/saves/contentHash.ts`                               | SHA-256 de las rutas tokenizadas (`<home>` de la máquina que hizo el backup, minúsculas, barras `/`) con el SHA-1 que ludusavi deja en `mapping.yaml`, más el hash del registro. Si falta un hash, no hay huella                                                                              |
| Linaje                         | `queries/saves/backupWrites.ts`, `localState.ts`              | El indexado de copias propias encadena `parentContentHash` desde `lastSyncedHash` y lo actualiza en la misma transacción. La restauración lo fija a la huella restaurada                                                                                                                      |
| Estado de la ficha             | `src/main/saves/syncState.ts`                                 | Función pura con la tabla de §12.4: puntas por el grafo (también a través de filas podadas), ciclos colapsados, divergencia solo si se demuestra un antepasado común, versiones superadas por el propio PC                                                                                    |
| Orden y borrado cruzado        | `queries/saves/backupIndex.ts`, `backupWrites.ts`             | Versiones por reloj de sync. Una versión propia con lápida no resucita nunca: el siguiente backup quita su zip de la carpeta local antes de llamar a ludusavi, y si no puede, no hay backup                                                                                                   |
| Identidad del PC               | `src/main/saves/machine.ts`, `identity.ts`, `installNonce.ts` | `machine-saves.json` atómico con `.bak`; dañado se recupera del `.bak` o del id guardado en la base, y si no, pregunta. Valor propio de la instalación (con la huella de `MachineGuid`) publicado en `devices` y en el manifiesto del bucket: si no es el nuestro, backups y poda se bloquean |
| Juegos sin `igdbId` y limpieza | `recovery.ts`, Ajustes → inventario                           | Carpetas por `saveKey`; borrar un juego no borra sus copias; las de juegos borrados o desconocidos se limpian a mano, en todos los PCs                                                                                                                                                        |
| Restauración exacta            | `src/main/saves/exactRestore.ts`, `ipc/saves.ts`              | Casilla desmarcada por defecto, solo "en su sitio". Borra solo archivos de la lista de ludusavi que la copia previa acaba de guardar; nunca carpetas                                                                                                                                          |
| Subida por streaming           | `src/main/saves/r2.ts`                                        | `Upload` multiparte (16 MB, dos a la vez) para todos los proveedores: el zip no pasa entero por memoria                                                                                                                                                                                       |
| Cierre                         | `src/main/saves/sessionHook.ts`                               | `flushPendingSaveBackups(timeoutMs)`: adelanta los backups que esperaban su margen y espera, con tope. `before-quit` lo llama tras cerrar las sesiones, con 4 s de tope                                                                                                                       |
| Interfaz                       | `SavesSection`, `RestoreSaveDialog`, Ajustes                  | Texto de §12.4 con nombre del PC y antigüedad, restaurar destacado en "por detrás" y "divergido", aviso de id duplicado con sus dos salidas, botón de limpieza de copias huérfanas                                                                                                            |

**Comprobado.**

- Pasan E-16, E-17, E-18, E-19 y E-20 (`hub/convergence/__tests__/saves.test.ts`), afirmados con las consultas reales y `computeSaveSyncState`. E-17 incluye el cierre de la divergencia en los dos sentidos.
- F-25: tests de huella, estado (unos 60 casos de la tabla, ciclos, filas podadas, versiones superadas), restauración exacta, `mapping.yaml`, espejo a R2 y recuperación sobre un bucket en memoria, identidad (escritura atómica, `.bak`, fichero dañado, instalación copiada) y consultas.
- `npm test` (2.611 tests), lint, tipos (todos los proyectos menos `hub/worker`, sin dependencias instaladas en la copia de trabajo), build y los e2e de partidas (`storage-provider`, `notes-loading`).

**Decisiones de esta fase:**

- **Solo `<home>` como token.** Cualquier otro dependería del entorno del proceso que recalcula. Una partida fuera de la carpeta de usuario solo coincide entre PCs si la ruta es la misma; si no, la ficha queda informativa.
- **Partidas con registro.** `L` es "desconocido": no se puede leer el registro sin ludusavi. La ficha no mira el disco y lo dice.
- **Divergencia que se cierra.** La partida de un PC es lineal en el tiempo: si un PC tiene una versión posterior que no desciende de otra suya, esa otra queda superada (sigue en el historial, ya no es punta). Así restaurar una punta y seguir jugando cierra la divergencia, como pide §12.4. Se compara por la hora del backup y solo dentro del mismo PC.
- **Linaje solo hacia delante.** Solo se encadenan las versiones más nuevas que cualquier otra propia ya indexada. Una versión vieja que se sube tarde (tras un fallo de red) entra sin padre.
- **Recuperación del índice.** Calcula la huella solo si el manifiesto de la máquina dice su `home`, y nunca pone `parentContentHash`: el padre real lo pone quien subió la copia.
- **Mapping local ilegible.** El espejo falla cerrado: ni sube ni poda. Antes lo trataba como "no hay versiones" y habría borrado del bucket las copias de este PC.
- **Id duplicado.** "Este PC es el original" vuelve a publicar su valor (la otra instalación se bloquea); "Este PC es otro" crea una identidad nueva, borra los `lastSyncedHash` y reinicia.
- **Limpieza de huérfanas.** Por `saveKey` y en todos los PCs, con confirmación. Se niega si un juego vivo usa ese `saveKey`.

**Pendiente o sin comprobar:**

- **Recuperar la identidad al emparejar** (§12.6, reinstalar): fuera de esta fase. Tampoco se recupera la identidad desde la lista de dispositivos del hub; solo desde el `.bak` o la base local.
- **Bucket real.** Ya se ha probado lo básico (ver abajo). Faltan una subida multiparte de verdad (un zip de más de 16 MB), el bloqueo por instalación copiada y la limpieza de huérfanas.
- **Restauración exacta.** La casilla no se ha probado con un juego real.
- **Discos clonados.** Dos PCs con el mismo `MachineGuid` (un disco clonado) no se distinguen si ninguno publicó antes su valor.
- **Filas recuperadas.** Su reloj de sync es el de la recuperación, así que en la lista pueden salir antes que versiones más nuevas.
- **TV.** La ficha de TV sigue con su comparación local, sin el estado entre PCs.

**Probado con partidas reales (2026-11-16).** Con R2 y los dos PCs emparejados: un juego jugado en JONATHAN subió su copia, la ficha de SABRINA mostró la versión más nueva de JONATHAN con la restauración destacada, y al restaurar la partida quedó bien en el juego. En una copia del proyecto hay que ejecutar antes `npm run ludusavi:fetch`; si no, la ficha dice que falta el motor de partidas.

### §20.8 Fase 7 — Main, IPC, renderer, estadísticas, logs (L)

§15 y §16. Buena parte se hace al paso de las fases 2 a 6; aquí se cierra lo que quede.

**Salida:** `index.ts` reducido a componer módulos; todo el IPC pasa por el contrato; ninguna pantalla pide todas las sesiones; E-21 y E-22 pasan; los e2e pasan.

#### §20.8.1 Estado de la fase 7 (2026-11-16)

Los cinco criterios de salida se cumplen en la rama `v2`.

| Criterio                                         | Dónde                                                                                                                | Qué hay                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` compone módulos                       | `src/main/{bootstrap,windows,lifecycle}/`, `ipc/mainProcess.ts`                                                      | `index.ts` pasa de 1.166 a 39 líneas. Las fases del arranque son funciones en orden (`bootstrap/startup.ts`); el estado vivo tiene un dueño (`bootstrap/appState.ts`, `windows/mainWindow.ts`)                                                                                                                              |
| Todo el IPC por el contrato                      | `src/shared/ipc/{contract,schemas,define}.ts`, `main/ipc/contractHandlers.ts`, `preload/ipc.ts`                      | 173 canales: 145 con respuesta, 9 sin respuesta y 19 avisos del main. La entrada se valida con zod en el main; la salida es solo de tipos. `games:update` rechaza cualquier campo fuera de los diez editables. Un test de barrera prohíbe `ipcMain`, `ipcRenderer` y `webContents.send` sueltos y canales huérfanos         |
| Evento único de cambios (§15.4)                  | `shared/ipc/dataChanged.ts`, `main/windows/dataChanged.ts`, `renderer/hooks/{useDataChangedSync,domainQueryKeys}.ts` | `data:changed` con dominios, ids y origen. Sale de la puerta de escritura (uno por transacción confirmada) y del motor de sync (uno por página aplicada), hacia la ventana y el overlay. Un único oyente por ventana invalida desde una tabla dominio → consultas. Un test falla si una tabla sincronizada no tiene dominio |
| Ninguna pantalla pide todas las sesiones (§15.6) | `queries/stats/`, `shared/domain/{sessionStats,streaks,sessionActivity,journeyEntries,sessionMeasure}.ts`            | `sessions:getAll` ya no existe. Hay lecturas de sesiones abiertas, de un juego, de un rango y por páginas, y los agregados `stats:getSessionStats` y `stats:getJourney`                                                                                                                                                     |
| E-21 y E-22                                      | `hub/convergence/__tests__/{achievements,dataChanged}.test.ts`, `e2e/data-changed.spec.ts`                           | E-21 ya se cumplía sin tocar código. E-22: un gasto llegado por sync produce el aviso del dominio `spend`, y con Estadísticas abierta el total cambia sin recargar                                                                                                                                                          |

**Comprobado.** Lint, tipos, 3.018 tests y los 94 e2e (`npx playwright test`). `statsEquality.test.ts` compara, sobre tres años de datos sembrados, los agregados del main con las fórmulas que usaba el renderer sobre todas las sesiones.

**Decisiones de esta fase:**

- **Salida sin validar.** Validar también la respuesta costaría en cada llamada y no protege de nada que el compilador no vea ya: el main y el preload se compilan juntos.
- **Granularidad del aviso.** El aviso dice qué tipo de dato cambió, no qué columna. Fijar un juego en el Plan o escribir la nota de una sesión vuelve a pedir la lista de juegos.
- **Un aviso por página de sync.** Una bajada larga (el primer emparejado) va enseñando lo que llega, a costa de recargar la biblioteca varias veces seguidas. Si se nota, se agrupan los avisos en el oyente.
- **Las fórmulas viejas no se copian.** Las reglas de las estadísticas pasaron de `renderer/src/lib` a `shared/domain` casi sin cambios y con sus tests; la prueba de igualdad las reescribe aparte para no compararlas consigo mismas.

**Lo que queda de §15 y §16** (no es criterio de salida; entra cuando se toque cada pieza, o en la fase 9):

- `sandbox: false` sigue en la ventana principal, el overlay y el aviso de logros (F-46).
- No hay `errorElement` en el router.
- El log sigue yendo a la consola: falta el log a fichero rotado (F-43) y "Exportar diagnóstico".
- El estado del sync solo se ve en Ajustes: falta el indicador de la barra lateral y de la bandeja.
- Las estadísticas de estados y géneros se siguen derivando en el renderer desde la lista de juegos, que no es "todas las sesiones".
- `spend:getAll` y `stateEvents:getAll` siguen existiendo: son tablas pequeñas, no sesiones.
- La mayor parte del inventario de cambios visibles (§15.7) está por revisar pieza a pieza.

### §20.9 Fase 8 — Importador y versión puente (L)

§19.3 a §19.7.

**Salida:** el importador pasa la validación sobre bases sintéticas y sobre la semilla de e2e; la 1.8 entra en solo lectura al ver el corte.

### §20.10 Fase 9 — Ensayo general (M)

Sobre una **copia** completa de los datos reales: importar, validar, sembrar un hub de pruebas, emparejar un segundo perfil, usar la app unos días.

**Antes de empezar el ensayo: todas las dependencias a su última versión.** Las del escritorio, la web móvil, el Worker antiguo mientras siga vivo y el hub (`package.json` de cada uno, Electron, Drizzle, wrangler y la `compatibility_date` del hub incluidos). Van antes del ensayo y no justo antes de publicar: así el ensayo prueba las versiones que se publican y no otras. Si una actualización mayor rompe algo, se arregla aquí; si no se puede, se apunta por qué se queda atrás. Después del ensayo solo entran parches de seguridad.

**Antes de empezar el ensayo: una revisión independiente** de la puerta de escritura (`src/main/db/v2/store/`), del importador y del motor de fusión, hecha por alguien que no haya participado en escribirlos y con un único encargo: buscar formas de perder o alterar datos. Ese código se escribió deprisa y se ha comprobado con tests y con informes, no leyendo cada línea.

**Salida:** dependencias al día (o la excepción apuntada); validación limpia sobre datos reales; ningún escenario de §17.3 en rojo; lista de sorpresas vacía o resuelta; revisión independiente hecha y sus hallazgos resueltos.

### §20.11 Fase 10 — Corte (S)

1. Publicar la 1.8 y esperar a que esté en todos los PCs.
2. Desplegar el hub de producción.
3. Publicar la 2.0.
4. Antes de aceptar la actualización en cada PC: una copia manual de `Afterplay.db` y de `machine-saves.json` **fuera** de la carpeta de datos de la app, además de las copias automáticas. Es la red que queda si falla todo lo demás.
5. Aceptar la actualización en el primer PC. Vigilar la validación y la siembra.
6. Aceptarla en los demás.
7. Segunda persona, cuando quiera.
8. A los 60 días: retirar el Worker antiguo y archivar la base de Turso.

#### §20.11.1 Limpieza del código 1.x

El borrado no es una fase aparte: va por tandas, cada una con su condición (Apéndice C).

- **L0, durante la fase 7:** lo que ya no usa nadie, y el test que impide que la 2.0 vuelva a importar código 1.x.
- **L1, al cerrar la fase 8:** `worker/` sale de la rama `v2` (el hub pasa a tener sus propias dependencias), y con él los ids genéricos y el buzón de `shared`.
- **L2, paso 8 de esta fase:** el Worker antiguo desplegado, Turso y la rama de la 1.x.
- **L3, en la 2.1:** el importador, el esquema y las lecturas 1.x, `drizzle/` y los paquetes de Turso.

**Salida de cada tanda:** lint, tipos, tests y e2e en verde, y su fila del Apéndice C movida a "Lo que ya desapareció".

### §20.12 Dependencias entre fases

```
0 ─► 1 ─► 2 ─► 3 ─┬─► 4 ─┐
                  ├─► 5 ─┼─► 7 ─► 8 ─► 9 ─► 10
                  └─► 6 ─┘
```

Las fases 4, 5 y 6 son independientes entre sí una vez existe el sync.

---

## §21. Criterios de aceptación de la 2.0

- Todos los escenarios E-01 a E-24 pasan en CI.
- Los tests de propiedades de convergencia pasan.
- El importador valida sin diferencias sobre una copia de los datos reales de las dos personas.
- No queda ninguna dependencia de `@tursodatabase/sync` en el código de ejecución.
- No queda ninguna regla de dominio implementada dos veces.
- Ningún canal IPC fuera del contrato.
- La app funciona sin hub configurado y sin red.
- Un PC nuevo se pone en marcha con: instalar, emparejar con un código, esperar a la descarga.

---

## §22. Riesgos

| Id   | Riesgo                                                                                                                                                        | Mitigación                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | **El sync propio tiene un fallo sutil que mezcla o pierde datos.** Es el riesgo principal: pasa a ser código nuestro                                          | Arnés de convergencia y tests de propiedades desde el primer día; fusión pequeña, pura y compartida; lápidas sin purga; la base 1.x y Turso intactas durante 60 días                     |
| R-02 | El alcance "todo de una vez" (D-01) alarga el proyecto y retrasa el arreglo de los fallos multi-PC                                                            | Cada fase se puede probar por separado. La 1.7.x no recibe arreglos (D-17); mientras tanto, no dejar otro PC encendido y desbloqueado mientras se juega evita el fallo más dañino (F-01) |
| R-03 | Los datos reales tienen suciedad que el importador no prevé                                                                                                   | Auditoría en la fase 0; validación que aborta; ensayo general                                                                                                                            |
| R-04 | Los límites del plan gratuito no bastan. Medido (§20.1.2): la CPU sobra; el cupo que aprieta es el de filas leídas, y el de filas escritas solo en la siembra | Caché de la biblioteca por secuencia; catálogo de logros agrupado; siembra por prioridad con pausa; plan de pago como último recurso                                                     |
| R-05 | Un PC rezagado con cambios sin subir en el momento del corte                                                                                                  | `device_status`; pregunta única; importador secundario (§19.6)                                                                                                                           |
| R-06 | Relojes de pared mal ajustados deciden conflictos                                                                                                             | Reloj híbrido; rechazo de relojes adelantados; los campos con dueño no dependen del reloj                                                                                                |
| R-07 | Dependencia de Cloudflare                                                                                                                                     | Núcleo portable (§9.6); el hub no guarda nada único                                                                                                                                      |
| R-08 | Drizzle sigue en versión candidata y cambia                                                                                                                   | Fijar versión; el motor de sync no depende de sus interioridades (hoy `migrationSync` sí)                                                                                                |
| R-09 | El cambio de ids rompe sitios que TypeScript no detecta                                                                                                       | Lista explícita en §15.5; e2e                                                                                                                                                            |
| R-10 | Dos playthroughs activos tras trabajar offline en dos PCs                                                                                                     | Sync previo cuando hay red; tolerancia en la derivación; fusión desde la ficha (§10.7)                                                                                                   |
| R-11 | La segunda persona migra tarde y el Worker antiguo debe seguir vivo                                                                                           | Previsto: conviven hasta que ambas migren (§19.8)                                                                                                                                        |
| R-12 | La huella de contenido difiere entre PCs para la misma partida                                                                                                | S-07; mientras no sea fiable, el estado de §12.4 se muestra como informativo                                                                                                             |

---

## §23. Preguntas resueltas

Todas las preguntas que este documento dejó abiertas en su primer borrador se cerraron el 2026-11-13. Se conservan aquí con su identificador porque el texto las cita.

| Id   | Pregunta                                                              | Resolución                                                     | Decisión |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| P-01 | ¿Solo Windows, o entra algún dispositivo Linux?                       | Windows en la 2.0; Linux después, sin cerrarle la puerta       | D-14     |
| P-02 | ¿El mismo juego abierto a la vez en dos PCs cuenta como dos sesiones? | Sí, una por dispositivo, y las horas se suman                  | D-15     |
| P-03 | ¿A partir de cuánto tiempo sin señal se cierra una sesión ajena?      | 24 h                                                           | D-21     |
| P-04 | Al restaurar una partida, ¿se borra lo que sobra?                     | No, salvo que se marque la casilla                             | D-20     |
| P-05 | ¿Dirección nueva para el hub o la misma?                              | Dirección nueva; el Worker antiguo vive hasta que ambos migren | D-18     |
| P-06 | ¿El servidor autoalojado entra en la 2.0?                             | No: solo el núcleo portable                                    | D-19     |
| P-07 | ¿El móvil gana funciones?                                             | No: el alcance de hoy, aplicado al instante                    | D-16     |
| P-08 | ¿PWA con modo offline?                                                | No                                                             | D-24     |
| P-09 | ¿Se llevan a la 1.7.x arreglos mientras tanto?                        | No: todo va a la 2.0                                           | D-17     |
| P-10 | ¿Lo editado a mano queda protegido del refresco?                      | Sí                                                             | D-22     |
| P-11 | ¿Moneda en los gastos?                                                | Una sola en la interfaz; cada gasto guarda la suya             | D-23     |
| P-12 | ¿Se purgan las lápidas?                                               | No en la 2.0                                                   | D-25     |
| P-13 | ¿Se renombran las columnas fósiles?                                   | Sí                                                             | D-26     |

No queda ninguna pregunta de producto abierta. Lo que falta por saber es técnico y está en las comprobaciones previas de la fase 0 (§20.1).

---

## Apéndice A. Incidentes con Turso y sus parches

Recogidos de los comentarios del código. Todo este apéndice describe código que la 2.0 elimina.

| Incidente                                                                             | Parche actual                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Reconstrucción de tabla replicada por la captura de cambios; el remoto queda a medias | DDL directo por una conexión aparte (`db/index.ts:135-142`, `migrationSync.ts`)       |
| 7 de agosto: producción perdida dos veces por la doble aplicación de una migración    | `migrateWithoutCapture` (`db/index.ts:472-520`)                                       |
| 7 de agosto: tiempo límite que cerraba la conexión con DDL en vuelo                   | Fases separadas, aplicar sin límite, registrar tras verificar (`db/index.ts:176-191`) |
| `DROP COLUMN` prohibido sobre columna indexada                                        | Política de "expandir sin contraer" (`db/index.ts:362-398`); columnas fósil           |
| Riesgo de reconstrucción local sin red                                                | `applyRebuildVerified`, `pendingTableRebuild` (`db/index.ts:546-713`)                 |
| Remoto a medio migrar                                                                 | `remoteSchemaAhead` (`db/index.ts:149-166, 1059-1077`)                                |
| 3 de agosto: entorno de pruebas conectado a la base real                              | `remoteLabel` (`db/index.ts:48-59`), puerta en `credentials.ts:378-391`               |
| Dos conexiones sobre el mismo fichero corrompen la base                               | Candado y cambio de conexión (`db/index.ts:297-313, 760-908`)                         |
| "connection is not open" durante el cambio de conexión                                | `withDbAccess`                                                                        |
| La conexión offline no captura cambios                                                | `PRAGMA unstable_capture_data_changes_conn('full')` (`db/index.ts:75-99`)             |
| 24 de septiembre y 5 de octubre: WAL reiniciado; el pull bloqueado para siempre       | Motor en pausa con `url: () => null` (`localConnection.ts`)                           |
| Metadatos de sync huérfanos                                                           | Limpieza de ficheros satélite y reintento (`db/index.ts:276-295`)                     |
| Fallos de sync silenciosos durante horas                                              | `lastSyncFailure` y pistas de esquema (`db/index.ts:917-958, 1012-1021`)              |
| Cronómetro cerrado a cero con una copia local vieja                                   | `remoteFreshness.ts`                                                                  |

Nota: los comentarios dicen que el replicador va "por posición de columna". El código de la rama principal del motor reproduce por nombre de columna. No se ha contrastado con la versión 0.7.2 instalada.

De esta capa se conservan como ideas: fallar cerrado, la copia previa con recuento, la regla de frescura, y la etiqueta que impide equivocarse de base.

---

## Apéndice B. Consultas de auditoría sobre los datos 1.x

Ejecutar **solo sobre una copia** (un backup diario de la carpeta de datos), nunca sobre la base en uso. Los nombres de columna siguen el esquema de la 1.7.3; comprobarlos contra el último `snapshot.json` de `drizzle/`.

```sql
-- B1. Sesiones "manuales" heredadas del modelo v1
SELECT count(*) FROM sessions WHERE "isManual" = 1;

-- B2. Sesiones abiertas
SELECT id, "iterationId", "emulatorId", "startedBy", "startedAt", "lastHeartbeatAt"
FROM sessions WHERE "endedAt" IS NULL;

-- B3. Sesiones imposibles
SELECT id FROM sessions WHERE "endedAt" < "startedAt";
SELECT id FROM sessions WHERE "iterationId" IS NULL AND "emulatorId" IS NULL;

-- B4. Huella de F-01: sesiones medidas de dos minutos o menos, por mes
SELECT strftime('%Y-%m', "startedAt" / 1000, 'unixepoch') AS mes,
       count(*) AS cortas,
       (SELECT count(*) FROM sessions s2
         WHERE s2."isManual" = 0
           AND strftime('%Y-%m', s2."startedAt" / 1000, 'unixepoch')
             = strftime('%Y-%m', s."startedAt" / 1000, 'unixepoch')) AS total
FROM sessions s
WHERE "isManual" = 0 AND "durationSec" BETWEEN 0 AND 130
GROUP BY mes ORDER BY mes;

-- B5. Sesiones medidas que se solapan en el tiempo
SELECT a.id AS a, b.id AS b
FROM sessions a JOIN sessions b
  ON a.id < b.id AND a."startedAt" < b."endedAt" AND b."startedAt" < a."endedAt"
WHERE a."isManual" = 0 AND b."isManual" = 0;

-- B6. Indicio de colisión de ids: un logro asignado a un playthrough de otro juego
SELECT u.id
FROM achievement_unlocks u
JOIN achievements a ON a.id = u."achievementId"
JOIN iterations   i ON i.id = u."iterationId"
WHERE i."gameId" <> a."gameId";

-- B7. Indicio de colisión de ids: la sesión del logro no es de su playthrough
SELECT u.id
FROM achievement_unlocks u
JOIN sessions s ON s.id = u."sessionId"
WHERE u."iterationId" IS NOT NULL AND s."iterationId" <> u."iterationId";

-- B8. Referencias huérfanas
PRAGMA foreign_key_check;

-- B9. Playthroughs con horas manuales y además sesiones (ambigüedad de F-12)
SELECT i.id, i."gameId", i."manualTotalPlayed", count(s.id) AS sesiones
FROM iterations i JOIN sessions s ON s."iterationId" = i.id
WHERE i."manualTotalPlayed" > 0
GROUP BY i.id;

-- B10. Juegos planeados con actividad real
SELECT g.id, g.title
FROM games g
JOIN iterations i ON i."gameId" = g.id
JOIN sessions   s ON s."iterationId" = i.id
WHERE g.planned = 1
GROUP BY g.id;

-- B11. Juegos emulados con ejecutable propio
SELECT id, title FROM games WHERE "isEmulated" = 1 AND "executablePath" IS NOT NULL;

-- B12. Mismo appid de Steam en varios juegos (legítimo, pero a tener en cuenta)
SELECT "steamAppId", count(*) FROM games
WHERE "steamAppId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

-- B13. Índice de partidas duplicado
SELECT "r2Key", count(*) FROM save_backups GROUP BY 1 HAVING count(*) > 1;

-- B14. Juegos con más de un playthrough cuyo último evento es 'started'
SELECT i."gameId", count(*) AS activos
FROM iterations i
WHERE (SELECT e.type FROM state_events e
        WHERE e."iterationId" = i.id AND e.type <> 'plan_to_play'
        ORDER BY e."occurredAt" DESC, e.id DESC LIMIT 1) = 'started'
GROUP BY i."gameId" HAVING count(*) > 1;

-- B15. Volumen por tabla (para dimensionar la siembra del hub)
SELECT 'games', count(*) FROM games
UNION ALL SELECT 'iterations', count(*) FROM iterations
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'state_events', count(*) FROM state_events
UNION ALL SELECT 'spend_events', count(*) FROM spend_events
UNION ALL SELECT 'achievements', count(*) FROM achievements
UNION ALL SELECT 'achievement_unlocks', count(*) FROM achievement_unlocks
UNION ALL SELECT 'save_backups', count(*) FROM save_backups
UNION ALL SELECT 'curiosities', count(*) FROM curiosities
UNION ALL SELECT 'generated_memories', count(*) FROM generated_memories
UNION ALL SELECT 'radar_games', count(*) FROM radar_games;
```

B14 simplifica la derivación real (que ignora artefactos de alta); sirve como indicio, no como veredicto.

---

## Apéndice C. Qué desaparece del código, y cuándo

Inventario hecho el 2026-11-16 sobre la rama `v2`, mirando quién importa cada pieza. Es una **lista viva**: cada fase que deje algo sin uso, o que descubra otra pieza de la 1.x, añade su fila aquí (§C.6).

### C.1 Cómo conviven hoy las dos versiones

- **La 1.x está congelada.** En `v2` no se mantiene: nadie la edita salvo para borrarla. La 1.7.x y la versión puente 1.8 (§19.3) salen de `main`.
- **La app 2.0 no usa código 1.x.** Comprobado: ni el proceso principal, ni el preload, ni el renderer, ni el hub, ni la PWA importan nada de `src/main/db/queries/`, `src/main/db/schema.ts` o `worker/`. La única excepción es el **importador** (`src/main/db/v2/importer/`), que tiene que leer la base 1.x y comprobar que la 2.0 enseña lo mismo.
- **Por qué sigue ahí.** Lo que queda de la 1.x en `v2` está por tres motivos, y cada uno caduca en un momento distinto:
  1. Lo necesita el importador (hasta que se retire el importador).
  2. Le presta herramientas al hub (`worker/node_modules`), por comodidad, no por necesidad.
  3. Nadie lo ha borrado todavía.
- **El riesgo no es mantener dos versiones, sino el código muerto.** Piezas sin uso que siguen pasando por lint, tipos y tests, y comentarios que hablan de módulos que ya no existen. Eso es lo que ataca la tanda L0.

### C.2 Cuándo se borra cada cosa

| Tanda  | Cuándo                                                        | Condición para empezar                                                                                         |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **L0** | Ya, durante la fase 7                                         | Ninguna: no lo usa nadie                                                                                       |
| **L1** | Al cerrar la fase 8 (importador y 1.8 hechos)                 | El importador ya no cambia; el hub tiene sus propias dependencias                                              |
| **L2** | Fase 10, paso 8: a los 60 días del corte de la última persona | Nadie usa ya la 1.x ni su web móvil; el Worker antiguo está retirado y Turso archivado                         |
| **L3** | Una versión después de L2 (2.1)                               | Todos los PCs migraron, pasó el plazo de vuelta atrás (§19.7) y nadie conserva una `Afterplay.db` por importar |

L2 y L3 son los únicos borrados sin vuelta atrás práctica: después de L3, una base 1.x solo se puede migrar instalando antes una 2.0 antigua.

### C.3 Inventario

Los tamaños son líneas de TypeScript, sin `node_modules`.

#### L0: sin uso hoy

Hecha el 2026-11-16 (ver §C.4).

Las citas a documentos de diseño de la 1.x que no están en el repositorio (`PARTIDAS-GUARDADAS.md`, `BIG-PICTURE.md` y otros, unas 450) **no** son código muerto: esos documentos existen y se guardan aparte (§0). Se quedan. La excepción es `LOGROS.md`, que ya no existe con ese nombre (hay `LOGROS-REDISENO.md` y `LOGROS-IDEAS.md`): sus 28 citas se revisan cuando se toque el código de logros.

#### L1: al cerrar la fase 8

| Pieza                                                                                                            | Tamaño                            | Qué lo retiene hoy                                                                                                                                                                        | Qué hay que hacer antes                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `worker/` entero: la web móvil 1.x, sus consultas reimplementadas, el buzón, `tenants.ts` y los tests de paridad | ~5.800 (2.500 de tests)           | `hub/worker/tsconfig.json` toma los tipos de Workers de `worker/node_modules` y el despliegue usa su `wrangler`. El CI instala `worker/`. `lint`, `typecheck:worker` y `test` lo recorren | Darle a `hub/worker` su propio `package.json` con `wrangler` y `@cloudflare/workers-types`; quitar `worker/` de los scripts de `package.json` y de `ci.yml`. El Worker desplegado (`afterplay-web`) **no se toca**: sigue sirviendo a la 1.x desde `main` hasta L2 |
| `src/shared/planMailbox.ts` y la tabla `plan_mailbox` del esquema 1.x                                            | ~60                               | `worker/src/api-types.ts` y `db/schema.ts` (1.x)                                                                                                                                          | Se va con `worker/`. Comprobar antes que el importador no lee el buzón (§13.3: se drena antes del corte)                                                                                                                                                           |
| `db/queries/games/iterationHours.ts` y `sessions/sessionDuration.ts`                                             | ~80                               | Solo `worker/src`                                                                                                                                                                         | Se van con `worker/`                                                                                                                                                                                                                                               |
| Ids genéricos en `shared` (`EntityIdLike`, `GameId<Id>`, `PlanMailboxEntry<number>`)                             | 20 ficheros, 35 usos con `number` | Existen para que el Worker 1.x use ids numéricos con las mismas funciones                                                                                                                 | Con `worker/` fuera, los ids son siempre texto: se quita el parámetro de tipo, y con él `shared/__tests__/idRepresentations.test.ts`. Comprobar antes que el importador usa tipos propios para los ids numéricos                                                   |
| `isCrediblePinStamp` en `planOrder.ts`                                                                           | ~10                               | `worker/src/queries/mailbox.ts`                                                                                                                                                           | Se va con `worker/`                                                                                                                                                                                                                                                |
| `src/shared/planPinOrder.ts`                                                                                     | pequeño                           | Nació para compartir el orden con el Worker; hoy lo usa el renderer                                                                                                                       | Fundirlo con `domain/planOrder` si queda como alias                                                                                                                                                                                                                |
| `POST /sync/v1/igdb-credentials` y `hub/worker/src/igdbCredentials.ts`                                           | ~150                              | "Clientes viejos" de la 2.0 en desarrollo. El escritorio ya usa el paquete de credenciales (§20.6.2)                                                                                      | La 2.0 no se ha publicado, así que no hay clientes viejos reales: se puede quitar antes del ensayo (fase 9). Las claves guardadas ahí se pierden y el paquete nuevo las repone                                                                                     |

#### L2: a los 60 días del corte

Nada de esto vive en la rama `v2`: es infraestructura y `main`.

| Pieza                                                          | Qué lo retiene hasta entonces                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| El Worker desplegado `afterplay-web` y su secreto `TENANTS`    | El móvil de quien siga en la 1.8                                  |
| La base de Turso de cada persona (se **archiva**, no se borra) | Es la copia de la 1.x y la fuente del importador de los rezagados |
| La rama de la 1.x en `main`, que pasa a ser una etiqueta       | Parches de la 1.8                                                 |
| El canal de actualización de la 1.x                            | Los PCs que no hayan aceptado la 2.0                              |

#### L3: con la retirada del importador (2.1)

| Pieza                                                                                          | Tamaño                    | Qué lo retiene                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `src/main/db/v2/importer/`, `scripts/import-1x-to-v2.ts` y `scripts/audit-1x-data.ts`          | ~6.500 más 2.100 de tests | Es la migración. Mientras exista una `Afterplay.db` sin migrar, se queda |
| `src/main/db/schema.ts` (esquema 1.x), `db/index.ts` (`getDb` que lanza) y `db/projections.ts` | ~850                      | Lo leen el importador y sus lecturas de comprobación                     |
| Lo que queda de `src/main/db/queries/` (20 lecturas 1.x)                                       | ~1.850                    | `importer/legacyQueries.ts` las ejecuta para comparar la 1.x con la 2.0  |
| `drizzle/` (migraciones 1.x) y `drizzle.config.ts`                                             | carpeta                   | Los tests del importador montan una base 1.x con ellas                   |
| `src/main/db/__tests__/harness.ts`                                                             | 1 fichero                 | Andamio de tests 1.x que usa el importador                               |
| `@libsql/client`, `@tursodatabase/sync` (ya en `devDependencies`) y `drizzle-orm/libsql`       | 2 paquetes                | `importer/source.ts`, `legacyQueryHost.ts` y `scripts/gen-e2e-seed.ts`   |
| `src/main/__tests__/noTursoInMain.test.ts`                                                     | 1 test                    | Deja de tener sentido cuando los paquetes ya no están instalados         |
| El aviso de la 1.8 y la pantalla de migración de la 2.0 (§15.7)                                | por escribir (fase 8)     | Nacen ya con fecha de retirada: L3                                       |

**Lo que parece 1.x y no se borra nunca**, porque son datos y no código:

- El dispositivo `legacy` (`DEVICE_KINDS`, `LEGACY_DEVICE_SHORT_ID`) y los ids `legacy:<tabla>:<id>`: las filas migradas los llevan para siempre.
- La rama `ids: 'legacy'` de `queries/loop/memorySignature.ts`: firma los recuerdos generados en la 1.x, y se queda mientras existan.
- `datePrecision = 'unknown'` y los textos "Date unknown" y "Length unknown".

### C.4 Lo que ya desapareció

| Pieza                                                                                                                                                        | Cuándo                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| El sync con Turso en el escritorio: captura de cambios, ficheros satélite, `localConnection.ts`, cambio de conexión en caliente, `withDbAccess` como candado | Fase 2 (P9)                                                                        |
| Las consultas 1.x con sustituta en la 2.0, y sus tests                                                                                                       | Fase 2 (P9)                                                                        |
| `drainMailbox.ts` y el buzón en el escritorio                                                                                                                | Fases 2 a 5                                                                        |
| `remoteFreshness.ts` y el barrido de cronómetros                                                                                                             | Fase 4                                                                             |
| `games.planned`, `plan_to_play`, `sessions.isManual`, `sessions.lastHeartbeatAt`, las columnas `…CheckedAt` y `…SyncedAt`, `isAddedAtArtifact`               | Fase 2: no están en el esquema 2.0. Siguen en el esquema 1.x que lee el importador |
| El buzón y el estado "pendiente" en la PWA                                                                                                                   | Fase 5                                                                             |
| La vista previa del buzón en `planOrder.ts`                                                                                                                  | 2026-11-16                                                                         |
| `migrationSync.ts`, su test, `scripts/push-migrations-to-turso.ts` y `db:push:remote`                                                                        | L0, 2026-11-16                                                                     |
| `scripts/benchmark-db.ts` y `benchmark:db`                                                                                                                   | L0, 2026-11-16                                                                     |
| `spikes/` (44 ficheros; siguen en el historial de git)                                                                                                       | L0, 2026-11-16                                                                     |
| `useWatcherSync`, los avisos `games:changed` y `sync:changed`, el oyente propio del overlay y la invalidación a mano en las mutaciones                       | Fase 7 (§15.4)                                                                     |
| `sessions:getAll`, `useSessions` y el cálculo de estadísticas sobre todas las sesiones en el renderer                                                        | Fase 7 (§15.6)                                                                     |
| Los comentarios que citaban módulos borrados (`drainMailbox.ts`, `handleDb`, `withDbAccess`, el pull de Turso)                                               | Fase 7                                                                             |
| `handleDb` y las ~130 cadenas de canal duplicadas                                                                                                            | Fase 7 (§15.3)                                                                     |

### C.5 Barreras para que no vuelva

- **Ya existe:** `noTursoInMain.test.ts` recorre el grafo de imports del main y falla si aparece Turso.
- **Ya existe (L0, 2026-11-16):** `noLegacyOutsideImporter.test.ts`. Nada fuera del importador y sus herramientas puede importar `src/main/db/schema.ts`, `src/main/db/queries/`, `src/main/db/index.ts`, `db/projections.ts` ni `worker/`, tampoco como tipo.
- **Falta (L1):** que `lint`, `typecheck` y `test` dejen de recorrer `worker/`.

### C.6 Cómo se mantiene esta lista

- Al cerrar cada fase se revisa qué ha dejado de usarse, qué código puente se ha añadido y con qué tanda se va.
- **El código puente nace con fecha.** Todo lo que se escriba solo para convivir con la 1.x (sobre todo en la fase 8) lleva un comentario `PUENTE 1.x → Lx` y una fila aquí.
- Pendiente de clasificar según avance el trabajo:
  - **Fase 7:** cerrada. Lo que dejó sin uso ya está en §C.4. Queda revisar si los tipos del esquema que aún cruzan el IPC (F-42) tienen DTO propio.
  - **Fase 8:** qué parte del importador sirve también para "restaurar copia" y cuál es solo migración.
  - **Fase 9:** dependencias que solo usaba la 1.x y que la actualización general permita quitar.

---

## Apéndice D. Glosario

| Término             | Significado                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Hub                 | El servicio que guarda la última versión de cada fila y reparte los cambios entre dispositivos          |
| Inquilino           | Una persona en el hub, con su almacén separado                                                          |
| Dispositivo         | Una instalación de Afterplay (un PC) o el pseudo-dispositivo `web` del móvil                            |
| Dueño               | El dispositivo al que pertenece una fila de clase O; el único que puede escribir sus campos principales |
| Lápida              | Marca de borrado que viaja por el sync en lugar de eliminar la fila                                     |
| Reloj               | Marca de tiempo lógica híbrida que ordena las escrituras entre dispositivos                             |
| Fusión por campo    | Al chocar dos versiones de una fila, cada columna se queda con su escritura más reciente                |
| Cursor              | El número de secuencia del hub hasta el que un dispositivo ya ha descargado                             |
| Señal de vida       | `sessions.lastSeenAt`: prueba, para los demás, de que una sesión sigue en marcha                        |
| Concesión           | Permiso temporal del hub para que un solo dispositivo ejecute un trabajo                                |
| Huella de contenido | Hash que identifica el estado de una partida guardada, igual en cualquier PC                            |
| Cabeza              | La partida más reciente de un juego entre todos los dispositivos                                        |
| Siembra             | La primera subida completa de datos a un hub vacío                                                      |
| Versión puente      | La 1.8: última versión de la 1.x, que prepara y protege el corte                                        |
| Corte               | El momento en que una persona pasa de la base 1.x al hub                                                |

---

## Apéndice E. Trazabilidad: cada fallo y dónde se resuelve

| Fallo | Resumen                                           | Se resuelve en                                                         | Escenario  |
| ----- | ------------------------------------------------- | ---------------------------------------------------------------------- | ---------- |
| F-01  | Un PC cierra la sesión viva de otro               | §10.1, §10.4                                                           | E-01       |
| F-02  | Adopción de una sesión ajena                      | §10.4                                                                  | E-02       |
| F-03  | Latido y cierre sin comprobar la fila             | §10.4                                                                  | E-01       |
| F-04  | Nada se cierra ni se sube al salir                | §10.6                                                                  | E-07       |
| F-05  | El latido de 5 s viaja por el sync                | §10.3                                                                  | —          |
| F-06  | Rutas locales en tablas compartidas               | §7.4 (`game_installs`), §11                                            | E-10       |
| F-07  | Ids autoincrementales con tres escritores         | §7.2                                                                   | E-03       |
| F-08  | Claves únicas naturales que atascan el push       | §7.2                                                                   | E-04       |
| F-09  | El id como orden causal                           | §7.4 (`state_events`), §10.7, §19.5                                    | —          |
| F-10  | Invariantes solo en TypeScript                    | §7.7, §8.6, §10.7                                                      | —          |
| F-11  | Borrados sin lápida                               | §7.3, §7.7                                                             | E-06       |
| F-12  | Verdades duplicadas y heurísticas                 | §7.4 (`plan_entries`), §7.5                                            | —          |
| F-13  | La capa de datos es mayoritariamente parche       | §8, apéndices A y C                                                    | —          |
| F-14  | Motor beta sin resolución de conflictos           | D-08, §8.3                                                             | E-05       |
| F-15  | Versiones mezcladas sin protocolo                 | §8.7                                                                   | E-14, E-15 |
| F-16  | Carreras de conexión                              | §8.9 (una sola conexión local)                                         | —          |
| F-17  | Cambio de credenciales en caliente                | §8.9, §9.3 (cambiar de hub es emparejar de nuevo)                      | —          |
| F-18  | Protecciones solo en memoria                      | §16 (estado persistente)                                               | —          |
| F-19  | Backup por máquina, no partida en la nube         | §12.2 a §12.4                                                          | E-16, E-17 |
| F-20  | El backup pendiente no sobrevive al cierre        | §10.6                                                                  | E-07       |
| F-21  | Índice de partidas duplicable                     | §7.2, §12.5                                                            | E-18       |
| F-22  | Restaurar no es un reemplazo exacto               | §12.7, D-20                                                            | —          |
| F-23  | Un borrado desde otro PC se deshace               | §12.5                                                                  | E-19       |
| F-24  | Identidad de máquina frágil                       | §12.6                                                                  | E-20       |
| F-25  | Partidas sin tests en lo delicado                 | §12.7, §17.1                                                           | —          |
| F-26  | Lógica de dominio portada a mano                  | §13.2, §15.2                                                           | —          |
| F-27  | Buzón sin reclamo entre PCs                       | §13.3                                                                  | E-12       |
| F-28  | El cronómetro comprueba y luego inserta           | §13.3                                                                  | E-13       |
| F-29  | El Worker guarda secretos de cada persona         | §9.2, §9.3                                                             | —          |
| F-30  | Acoplamiento de esquema sin versionar             | §8.7, §13.4                                                            | E-14       |
| F-31  | Rutas locales enviadas al móvil                   | §11.4                                                                  | —          |
| F-32  | Trabajo caro sin coordinar                        | §14.3                                                                  | E-11       |
| F-33  | El refresco semanal reescribe `games`             | §7.4 (`game_metadata`), §14.3                                          | E-05       |
| F-34  | Ocho formas de "ya lo miré"                       | §7.4 (`external_checks`)                                               | —          |
| F-35  | Los logros de emulador bailan                     | §7.4 (`achievement_unlocks`), §11.4                                    | E-21       |
| F-36  | No se distingue lo elegido a mano                 | §7.4 (`games`), §14.2                                                  | —          |
| F-37  | Arranque sin fases explícitas                     | §14.4, §15.1                                                           | —          |
| F-38  | IPC sin contrato ni validación                    | §15.3                                                                  | —          |
| F-39  | La interfaz no se entera de lo que llega por sync | §15.4                                                                  | E-22       |
| F-40  | La interfaz no tiene concepto de dispositivo      | §10.8, §11.4                                                           | E-01, E-10 |
| F-41  | Estadísticas en el cliente con todas las filas    | §15.6                                                                  | —          |
| F-42  | Tipos del renderer acoplados al esquema           | §15.3                                                                  | —          |
| F-43  | Sin logs persistentes                             | §16                                                                    | —          |
| F-44  | Sin tests de varias réplicas ni CI                | §17                                                                    | Todos      |
| F-45  | Dependencias en versiones frágiles                | §8.9, R-08. El doble alias de TypeScript queda fuera de este documento | —          |
| F-46  | Pendientes de seguridad                           | §18                                                                    | —          |
