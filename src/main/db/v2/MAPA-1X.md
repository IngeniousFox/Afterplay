# Mapa del esquema 1.x al 2.0

Entrada del importador de la fase 8 (AFTERPLAY-2.0.md §19.5). Cubre **cada tabla y columna** de `src/main/db/schema.ts` (1.x) y dice adónde va en `src/main/db/v2/schema.ts`.

**La versión ejecutable de este mapa es `importer/columnMap.ts`**: declara el destino de cada columna, un test falla si alguna columna 1.x queda sin declarar, y la validación del importador comprueba cada valor en el destino. Si este documento y `columnMap.ts` discrepan, manda el código; corrige aquí.

Leyenda del destino:

- `tabla.columna`: copia directa (con el id remapeado si es una referencia).
- **derivado**: se calcula a partir de otros datos de la 1.x.
- **desaparece**: no se migra, con el motivo.
- **SIN DESTINO**: el dato existe en la 1.x y el 2.0 no tiene dónde guardarlo, o la regla no está decidida. Hay que resolverlo antes de escribir el importador.

Ids: los juegos con `igdbId` toman el id natural (UUIDv5 de `igdb:<igdbId>`); las de id compuesto o determinista usan su id natural (nota 1); las tablas de id aleatorio (y los juegos sin `igdbId`) toman un **UUIDv7 determinista** (`importer/legacyIds.ts`): tiempo = 2001-01-01 + id antiguo, resto = SHA-256 de `legacy:<tabla>:<id>`. **Desviación de §19.5** (que decía UUIDv5): así el orden por id sigue siendo el de creación (`compareByCreation`, R-04). Donde abajo dice "UUIDv5 de `legacy:…`" léase este UUIDv7. El mapa id antiguo → id nuevo queda en `local_legacy_ids`.

## `games`

| Columna 1.x                   | Destino 2.0                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                          | `games.id` (UUIDv5 de `igdb:<igdbId>`, o `legacy:games:<id>`) + `local_legacy_ids`                                                                                                         |
| `title`                       | `games.title`                                                                                                                                                                              |
| `coverUrl`                    | `games.coverOverride` (todos, §19.5 "Elecciones manuales") **y** `game_metadata.coverUrl` (corregido: el importador copia a los dos)                                                       |
| `heroUrl`                     | `games.heroOverride` y `game_metadata.heroUrl` (igual que `coverUrl`)                                                                                                                      |
| `igdbId`                      | `games.igdbId`                                                                                                                                                                             |
| `sgdbId` (`steamGridDbId`)    | `games.sgdbId`; `games.sgdbIdSource` = `manual` si no es null (§19.5)                                                                                                                      |
| `officialPlatforms`           | `game_metadata.officialPlatforms`                                                                                                                                                          |
| `releaseYear`                 | `game_metadata.releaseYear`                                                                                                                                                                |
| `hltbMain`                    | `game_metadata.hltbMain`                                                                                                                                                                   |
| `hltbMainExtras`              | `game_metadata.hltbMainExtras`                                                                                                                                                             |
| `hltbCompletionist`           | `game_metadata.hltbCompletionist`                                                                                                                                                          |
| `notes`                       | `games.notes`                                                                                                                                                                              |
| `executablePath`              | `game_installs.executablePath`, solo si existe en el disco de cada PC (reclamo, §19.6)                                                                                                     |
| `developer`                   | `games.developerOverride` (todos, §19.5) y `game_metadata.developer`                                                                                                                       |
| `publisher`                   | `games.publisherOverride` (todos, §19.5) y `game_metadata.publisher`                                                                                                                       |
| `installDirectory`            | `game_installs.installDirectory` (reclamo por PC)                                                                                                                                          |
| `installSizeBytes`            | `game_installs.installSizeBytes` (reclamo por PC)                                                                                                                                          |
| `genres`                      | `games.genresOverride` (todos, §19.5) y `game_metadata.genres`                                                                                                                             |
| `endless`                     | `games.endless`                                                                                                                                                                            |
| `isEmulated`                  | `games.isEmulated`                                                                                                                                                                         |
| `planned`                     | **derivado**: `planned = 1` crea una fila viva en `plan_entries`                                                                                                                           |
| `addedAt`                     | `games.addedAt` (y base del reloj importado)                                                                                                                                               |
| `promotedAt`                  | `games.promotedAt`                                                                                                                                                                         |
| `saveBackupEnabled`           | `games.saveBackupEnabled`                                                                                                                                                                  |
| `saveDetectionSource`         | `games.saveDetectionSource`                                                                                                                                                                |
| `saveLudusaviName`            | `games.saveLudusaviName`                                                                                                                                                                   |
| `saveCustomPaths`             | `games.saveCustomPaths`                                                                                                                                                                    |
| `curiositiesGeneratedAt`      | `game_curiosities.generatedAt` (con `items = []` si no hay curiosidades) y `external_checks(curiosities).checkedAt`                                                                        |
| `steamAppId`                  | `games.steamAppId`                                                                                                                                                                         |
| `steamAppIdManual`            | `games.steamAppIdSource` (`manual`/`auto`; null si `steamAppId` es null)                                                                                                                   |
| `steamAppIdCheckedAt`         | `external_checks(steam_appid).checkedAt`; `status` **derivado** (`ok` si hay appid, `empty` si no)                                                                                         |
| `achievementsSyncedAt`        | `external_checks(steam_achievements / ra_achievements).checkedAt`, una fila por cada fuente con catálogo (sin catálogo: `empty` de la fuente enlazada), y `achievement_catalogs.fetchedAt` |
| `achievementsUnlocksSyncedAt` | `external_checks(steam_unlocks).checkedAt` (fuente nueva, R-05). En un juego solo de RA se descarta: lo escribió el sync de RA y lo cubre `ra_achievements`                                |
| `raGameId`                    | `games.raGameId`                                                                                                                                                                           |
| `raCheckedAt`                 | `external_checks(ra_match).checkedAt`                                                                                                                                                      |
| `ratingCritics`               | `game_metadata.ratingCritics`                                                                                                                                                              |
| `ratingCriticsCount`          | `game_metadata.ratingCriticsCount`                                                                                                                                                         |
| `ratingUsers`                 | `game_metadata.ratingUsers`                                                                                                                                                                |
| `ratingUsersCount`            | `game_metadata.ratingUsersCount`                                                                                                                                                           |
| `ratingsCheckedAt`            | `external_checks(igdb_ratings).checkedAt`                                                                                                                                                  |
| `summary`                     | `game_metadata.summary`                                                                                                                                                                    |
| `igdbCollections`             | `game_metadata.igdbCollections`                                                                                                                                                            |
| `steamTags`                   | `game_metadata.steamTags`                                                                                                                                                                  |
| `steamPositive`               | `game_metadata.steamPositive`                                                                                                                                                              |
| `steamNegative`               | `game_metadata.steamNegative`                                                                                                                                                              |
| `steamSpyCheckedAt`           | `external_checks(steam_store).checkedAt`                                                                                                                                                   |
| `planPinnedAt`                | `plan_entries.pinnedAt`                                                                                                                                                                    |
| `releaseDate`                 | `game_metadata.releaseDate`                                                                                                                                                                |
| `releaseDatePrecision`        | `game_metadata.releaseDatePrecision`                                                                                                                                                       |

## `radar_games`

| Columna 1.x            | Destino 2.0                                         |
| ---------------------- | --------------------------------------------------- |
| `id`                   | **desaparece**: el id 2.0 es `igdb:<igdbId>` (§7.2) |
| `igdbId`               | `radar_games.igdbId`                                |
| `collectionId`         | `radar_games.collectionId`                          |
| `collectionName`       | `radar_games.collectionName`                        |
| `title`                | `radar_games.title`                                 |
| `coverUrl`             | `radar_games.coverUrl`                              |
| `releaseDate`          | `radar_games.releaseDate`                           |
| `releaseDatePrecision` | `radar_games.releaseDatePrecision`                  |
| `releaseYear`          | `radar_games.releaseYear`                           |
| `discoveredAt`         | `radar_games.discoveredAt`                          |
| `dismissedAt`          | `radar_games.dismissedAt`                           |

## `sessions`

| Columna 1.x       | Destino 2.0                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `id`              | `sessions.id` (UUIDv5 de `legacy:sessions:<id>`) + `local_legacy_ids`    |
| `iterationId`     | `sessions.playthroughId` (remapeado)                                     |
| `emulatorId`      | `sessions.emulatorId` (remapeado)                                        |
| `isManual`        | `sessions.source` (`1` → `legacy_manual`, `0` → `measured`)              |
| `startedAt`       | `sessions.startedAt`                                                     |
| `endedAt`         | `sessions.endedAt` (las abiertas se cierran antes en origen, §19.6)      |
| `durationSec`     | `sessions.durationSec`                                                   |
| `lastHeartbeatAt` | `sessions.lastSeenAt`                                                    |
| `startedBy`       | `sessions.startedBy` (`watcher` y `timer` se conservan; `play` es nuevo) |
| `datePrecision`   | `sessions.datePrecision`                                                 |
| `note`            | `sessions.note`                                                          |
| (nuevo)           | `sessions.deviceId` = `legacy` (§19.5)                                   |
| (nuevo)           | `sessions.closedBy` = null con reloj `BOTTOM` (nota 5)                   |

## `iterations` → `playthroughs`

| Columna 1.x         | Destino 2.0                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `id`                | `playthroughs.id` (UUIDv5 de `legacy:iterations:<id>`) + `local_legacy_ids`                 |
| `gameId`            | `playthroughs.gameId` (remapeado)                                                           |
| `label`             | `playthroughs.customLabel`, solo si no es el automático "Playthrough N"                     |
| `playedPlatform`    | `playthroughs.playedPlatform`                                                               |
| `origin`            | `playthroughs.origin`                                                                       |
| `format`            | `playthroughs.format`                                                                       |
| `manualTotalPlayed` | `playthroughs.manualHours`, **derivado** para que el total mostrado no cambie (§19.5)       |
| `rating`            | `playthroughs.rating`                                                                       |
| `extraContent`      | `playthroughs.extraContent`                                                                 |
| (fila entera)       | La iteración vacía de un juego planeado **desaparece** (la sustituye `plan_entries`, §19.5) |
| (orden)             | `syncCreated` derivado del alta del juego y, como desempate, del id antiguo (nota 3)        |

## `state_events`

| Columna 1.x     | Destino 2.0                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `id`            | `state_events.id` (UUIDv5 de `legacy:state_events:<id>`) + `local_legacy_ids`                        |
| `iterationId`   | `state_events.playthroughId` (remapeado)                                                             |
| `type`          | `state_events.type`. `plan_to_play` **desaparece** como tipo (§7.4)                                  |
| `occurredAt`    | `state_events.occurredAt`; si es la fecha del alta, también `plan_entries.plannedAt` (§19.5)         |
| `datePrecision` | `state_events.datePrecision`; `unknown` donde `isAddedAtArtifact` lo reconozca (§7.5)                |
| `note`          | `state_events.note`. En `plan_to_play`: `plan_entries.note` (con lápida si ya se promocionó, nota 6) |
| (nuevo)         | `state_events.deviceId` = null                                                                       |

## `emulators`

| Columna 1.x      | Destino 2.0                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `id`             | `emulators.id` (UUIDv5 de `legacy:emulators:<id>`) + `local_legacy_ids` |
| `name`           | `emulators.name`                                                        |
| `executablePath` | `emulator_installs.executablePath`, reclamo por PC (§19.6)              |

## `save_backups`

No se migran filas: el índice se reconstruye desde el bucket (§19.5, F-21). Para cada columna, de dónde sale en esa reconstrucción:

| Columna 1.x        | Destino 2.0                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `id`               | **desaparece**: id = UUIDv5 de `r2Key`                                                                              |
| `gameId`           | `save_backups.gameId` (por el prefijo `saves/<clave>/…` y `games.saveKey`)                                          |
| `createdAt`        | `save_backups.createdAt`                                                                                            |
| `backupName`       | `save_backups.backupName`                                                                                           |
| `r2Key`            | `save_backups.r2Key`                                                                                                |
| `sizeBytes`        | `save_backups.sizeBytes`                                                                                            |
| `ludusaviName`     | `save_backups.ludusaviName`                                                                                         |
| `differential`     | `save_backups.differential`                                                                                         |
| `parentBackupName` | `save_backups.parentBackupName`                                                                                     |
| `machineId`        | `save_backups.deviceId` (D-11). Cada máquina del bucket necesita su fila en `devices`                               |
| `machineName`      | `devices.name`                                                                                                      |
| `machineHome`      | `devices.home`. **SIN DESTINO** por backup: si la carpeta de usuario de un PC cambió, se pierde la antigua (nota 7) |
| `locations`        | `save_backups.locations`                                                                                            |
| `hasRegistry`      | `save_backups.hasRegistry`                                                                                          |
| (nuevo)            | `save_backups.contentHash`: **derivado** de cada `mapping.yaml` (§19.5)                                             |
| (nuevo)            | `save_backups.parentContentHash` = null (sin linaje en la 1.x, §12.4)                                               |

## `curiosities` → `game_curiosities`

| Columna 1.x | Destino 2.0                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `id`        | **desaparece**: una fila por juego, id = `gameId`. Fija el orden de `items` |
| `gameId`    | `game_curiosities.id` y `game_curiosities.gameId` (remapeado)               |
| `text`      | Un elemento de `game_curiosities.items`, en orden de id antiguo             |
| (nuevo)     | `game_curiosities.model` = null (la 1.x no lo guardaba)                     |

## `achievements` → `achievement_catalogs`

| Columna 1.x     | Destino 2.0                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | **desaparece**; solo sirve para enlazar los desbloqueos de la 1.x con su `(gameId, apiName)`                                                        |
| `gameId`        | `achievement_catalogs.gameId` (remapeado)                                                                                                           |
| (fuente)        | `achievement_catalogs.source`: **SIN DESTINO directo**; la tabla 1.x no tiene fuente (nota 4)                                                       |
| `apiName`       | `items[].apiName`                                                                                                                                   |
| `displayName`   | `items[].displayName`                                                                                                                               |
| `description`   | `items[].description`                                                                                                                               |
| `iconUrl`       | `items[].iconUrl`                                                                                                                                   |
| `iconGrayUrl`   | `items[].iconGrayUrl`                                                                                                                               |
| `hidden`        | `items[].hidden`                                                                                                                                    |
| `globalPercent` | `items[].globalPercent`                                                                                                                             |
| `sortIndex`     | `items[].sortIndex`                                                                                                                                 |
| (nuevo)         | `achievement_catalogs.fetchedAt` ← `games.achievementsSyncedAt` (o `addedAt` del juego si es null: la hora de la importación no sería determinista) |

## `achievement_unlocks`

| Columna 1.x     | Destino 2.0                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `id`            | **desaparece**: id = `<gameId>:<source>:<apiName>:<origin>`                                             |
| `achievementId` | **derivado**: `gameId` y `apiName` del logro 1.x; `source` según la nota 4                              |
| `unlockedAt`    | `achievement_unlocks.unlockedAt`                                                                        |
| `dateReliable`  | `achievement_unlocks.dateReliable`                                                                      |
| `source`        | `steam` → (`steam`, origen `steam`); `emu` → (`steam`, origen `emu@legacy`); `ra` → (`ra`, origen `ra`) |
| `iterationId`   | `achievement_unlocks.playthroughId` (remapeado)                                                         |
| `sessionId`     | `achievement_unlocks.sessionId` (remapeado)                                                             |

## `generated_memories`

| Columna 1.x     | Destino 2.0                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `id`            | **desaparece**: id = `<scopeType>:<scopeKey>`                                  |
| `scopeType`     | `generated_memories.scopeType`                                                 |
| `scopeKey`      | `generated_memories.scopeKey`                                                  |
| `payload`       | `generated_memories.payload` (prosa; no contiene ids)                          |
| `sourceHash`    | `generated_memories.sourceHash`, **derivado**: se recalcula con los ids nuevos |
| `model`         | `generated_memories.model`                                                     |
| `promptVersion` | `generated_memories.promptVersion`                                             |
| `createdAt`     | `generated_memories.createdAt`                                                 |

## `spend_events`

| Columna 1.x     | Destino 2.0                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------- |
| `id`            | `spend_events.id` (UUIDv5 de `legacy:spend_events:<id>`) + `local_legacy_ids`                |
| `gameId`        | `spend_events.gameId` (remapeado)                                                            |
| `type`          | `spend_events.type`                                                                          |
| `amount`        | `spend_events.amount`                                                                        |
| `occurredAt`    | `spend_events.occurredAt`                                                                    |
| `datePrecision` | `spend_events.datePrecision`                                                                 |
| `note`          | `spend_events.note`                                                                          |
| (nuevo)         | `spend_events.currency` = `EUR`: la 1.x no la configura, pinta siempre euros (`formatMoney`) |
| (nuevo)         | `spend_events.playthroughId` = null (reparto por fecha, como en la 1.x)                      |

## `plan_mailbox`

**Desaparece entera** (`id`, `type`, `payload`, `createdAt`, `requestedBy`, `processedAt`, `error`): el móvil escribe a través del hub (§13). Debe estar vacía de pendientes antes del corte (§19.6).

## Fuera de `schema.ts`

| Dato 1.x                                       | Destino 2.0                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `__drizzle_migrations`                         | **desaparece**; la 2.0 tiene sus propias migraciones (`drizzle-v2/`)                       |
| `machine-saves.json` → `machineId`             | `devices.id` de este PC (D-11)                                                             |
| `machine-saves.json` → `machineName`, `home`   | `devices.name`, `devices.home`                                                             |
| `machine-saves.json` → `saveLocationOverrides` | `local_save_state.restoreTarget` / `restoreTargetSetAt` (ver nota 8: §19.6 dice otra cosa) |
| `machine-saves.json` → `identity`              | Sigue en el fichero (§7.6)                                                                 |

## Columnas 2.0 sin origen en la 1.x

Para que nadie las busque en el mapa de arriba: `devices.*` (salen de `machine-saves.json`, de `machines/<id>.json` del bucket y de la app), `devices.installNonce`, `games.saveKey` (derivado: `igdbId` o el id), `plan_entries.plannedAt` (derivado, §19.5), `plan_entries.sortKey` (null: la 1.x no tiene orden manual más allá de `pinnedAt`, que se conserva), `external_checks.status` / `nextCheckAt` / `error` (derivados de la política de cada fuente), `game_installs.lastVerifiedAt` (hora del reclamo), `sessions.closedBy`, `state_events.deviceId`.

## Notas

1. **Ids compuestos y deterministas en el importador.** §19.5 dice "todo lo demás: UUIDv5 de `legacy:<tabla>:<id antiguo>`", pero `game_metadata`, `external_checks`, `plan_entries`, `game_installs`, `emulator_installs`, `achievement_catalogs`, `achievement_unlocks`, `game_curiosities`, `generated_memories`, `radar_games` y `save_backups` tienen que usar su id natural (§7.2). Si no, el primer refresco o la primera lectura de Steam crea una segunda fila en vez de escribir encima.
2. **Reloj de lo importado.** §19.5 lo deriva de "`addedAt`, `startedAt`, `occurredAt`". Las tablas sin fecha de dominio (`iterations`, `emulators`, `curiosities`, `achievements`) necesitan otra fuente; ver la nota 3.
3. **Orden de los playthroughs.** La etiqueta automática pasa a ser la posición por `syncCreated`. Para que "Playthrough 2" siga siendo el mismo, el reloj de creación de cada playthrough importado debe respetar el orden por id antiguo dentro de su juego, aunque su primera sesión o su primer evento sean anteriores a los de otro. Sin regla en §19.5.
4. **Fuente del catálogo y de las marcas de logros.** La tabla `achievements` de la 1.x mezcla Steam y RetroAchievements sin columna de fuente; hoy se distinguen por heurística (`setSteamAppId.ts`: `iconUrl` de `media.retroachievements.org`, `apiName` numérico con `raGameId`, desbloqueos `ra`). El importador tendrá que usar esa misma heurística, y decidir qué hace con un logro que no encaje. Además `achievementsSyncedAt` lo escriben los dos syncs (RA escribe las dos marcas a la vez) y `achievementsUnlocksSyncedAt` no tiene fuente en `external_checks`: propuesta, añadir `steam_unlocks` a `EXTERNAL_CHECK_SOURCES` (es un cambio de TypeScript, no de esquema).
5. **`closedBy` de las sesiones importadas.** La 1.x no sabe quién cerró una sesión. Propuesta: null (desconocido); la interfaz no debe interpretarlo como "abierta".
6. **Historial "Planeado el X" de los juegos ya promocionados.** Sus eventos `plan_to_play` se descartan y su `plan_entries` no existe. Se pierden la fecha y la nota de cuándo se planeó. Opción: crear su `plan_entries` ya con lápida, que conserva `plannedAt` y `note` sin que el juego cuente como planeado.
7. **`machineHome` por backup.** En la 2.0 la carpeta de usuario es una por dispositivo (`devices.home`). Si un PC cambió de carpeta de usuario, los backups anteriores generarían redirects con la carpeta nueva. Hay que comprobar si `mapping.yaml` basta para reconstruirla.
8. **Ubicación de restauración.** §7.6 la pone en `local_save_state`; §19.6 dice que se remapean las claves de `machine-saves.json` con `local_legacy_ids`. El esquema sigue a §7.6: el importador debería moverlas a la tabla.

## Resolución en el importador (fase 8, primera versión)

- Nota 1: resuelta (ids naturales; UUIDv7 determinista en las tablas de id aleatorio).
- Notas 2 y 3: relojes deterministas por tabla en orden (fecha de dominio, id antiguo), recortados al techo del origen (el sello de la app más reciente de la base); `playthroughs` toma el alta de su juego y `emulators` no tiene fecha. Firmados con el id corto reservado `legacy`.
- Nota 4: clasificación por evidencia (desbloqueo o icono) y, sin evidencia, la regla de `setSteamAppId.ts` (`importer/achievements.ts`); `steam_unlocks` añadida (R-05).
- Nota 5: `closedBy` null.
- Nota 6: `plan_entries` con lápida para los promocionados que conservan su `plan_to_play`.
- Notas 7 y 8: siguen abiertas (fase 6).
- `generated_memories.sourceHash`: **pendiente**; se copia tal cual hasta que existan las consultas 2.0 de recaps.
