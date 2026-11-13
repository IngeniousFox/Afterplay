# Consultas 2.0: convenciones

Lo primero que hay que leer antes de escribir en `queries/<dominio>/`. La especificación de cada paquete está en `../CONSULTAS.md` (§1 contrato, §4 reparto, §5.0 decisiones); esto son las reglas de la casa. Las piezas comunes viven en `common/` (`common/index.ts` lo exporta todo).

## Firma

```ts
export function getAlgo(ctx: QueryContext, id: string, …): Resultado {
```

- **Síncrona**, siempre. El driver (`node:sqlite`) es síncrono; un `async` aquí solo esconde que no hay nada que esperar. La red va **fuera**, antes o después, nunca entre una lectura y la escritura que depende de ella.
- **`ctx` primero** (`common/context.ts`): `{ db, store, deviceId, now }`. Nunca `getDb()`, nunca `new Date()` suelto (usa `ctx.now()`), nunca `os`/Electron (llegan por parámetro).
- Ids de texto. Los DTO se devuelven con `Id = string` (`GameRow<string>`, `StateEvent<string>`…). Con texto, los DTO ya incluyen lo del 2.0, y con `Id = number` (la app 1.x y el Worker) no cambian nada (`main/db/dtoSync.ts` lo vigila). Los ayudantes están en `shared/dto.ts`: `SchemaValues` (valores que se añaden a un enumerado), `SchemaWithout` (valores que se quitan) y `SchemaFields` (campos que solo existen con texto). Lo que hay hoy:
  - Valores: `'unknown'` en `StateEventPrecision<Id>` (también en `IterationEdgeEvent`), `'play'` en `SessionStartedBy<Id>`; `WritableStateEventType<Id>` pierde `'plan_to_play'` (`AddStateEventInput<Id>`, `UpdateStateEventPatch<Id>`).
  - Campos: `deviceId`/`closedBy` en `Session<Id>` y `SessionWithGame<Id>` (`SessionOwnership`); `planHistory` en `GameDetail<Id>` (`PlanHistory`, R-06); `playthroughId?` en `AddSpendEventInput<Id>`; `saveKey` en `SaveGame<Id>`; `completion` en `GameAchievements<Id>`, `source` en `perfectGames`/`almostThere` de `AchievementsOverview<Id>` y `bySource` en `AchievementsStatus<Id>` (R-11).
  - Sin ids: `OwnedGameRef<Id>`, `SaveSettingsPatch`, `SourceCompletion`, `AchievementsSourceStatus`, `AchievementCatalogSource`.
  - Ningún paquete define ya su `…V2` o `…Dto` local: si una consulta necesita algo que el DTO no tiene, se añade en `shared/` con estos ayudantes. Un constructor GENÉRICO en `Id` tiene que dar también los campos de `SchemaFields` (ver `shared/__tests__/idRepresentations.test.ts`).
- Reglas de negocio: las de `src/shared/domain` y `src/shared/playthroughState.ts`, llamadas con ids de texto (`src/shared/__tests__/idRepresentations.test.ts` enseña cómo). No se reescriben aquí.

## Leer solo filas vivas

- Toda tabla sincronizada se filtra con la condición con nombre de `common/alive.ts`, que ya lleva la regla F-11 (hijo de un padre con lápida = borrado) con la cadena entera de padres: `liveGame()`, `livePlaythrough()`, `liveStateEvent()`, `liveSession()`, `liveSpendEvent()`, `livePlanEntry()`, `liveGameInstall()`, `liveUnlock()`, `liveEmulator()`, `liveEmulatorInstall()`, y `liveRow[tabla]()` para cualquiera. Aceptan la tabla con alias: `liveSession(alias(sessions, 's'))`.
- `alive(t)` a secas (de `store/`) solo para la fila de una tabla unida cuyo padre ya filtras en la misma consulta, o cuando quieres a propósito la caché de un juego borrado. Déjalo comentado.
- En los `LEFT JOIN`, la condición de vida va en el `ON`, no en el `WHERE` (si no, el `LEFT` se convierte en `INNER`).
- Orden por creación: `syncCreated, id` (`playthroughCreationOrder` para playthroughs).
- **Un juego tal como lo ve la app**: `readGameRow(ctx, id)` / `readGameRows(ctx, ids?)` (`common/gameView.ts`). Ahí están los valores efectivos (override del usuario ?? caché), `planned`, las rutas de **este** PC y los sellos. Si tu consulta necesita solo parte, `gameViewRows(ctx, where)` admite un `where` sobre `games` y los alias `viewPlan`, `viewInstall`, `viewMetadata`, `viewCuriosities` (p. ej. `isNull(viewPlan.id)` = no planeados). No repitas el mapeo.
- "Playthrough N": `playthroughPositions(ctx, gameIds)` + `effectivePlaythroughLabel(customLabel, n)` (`common/labels.ts`). Cuenta también los borrados (R-03): no filtres por vivos al numerar.
- El papeleo del alta en 2.0 es **exactamente** `datePrecision = 'unknown'`. Las reglas compartidas eligen la regla de forma explícita: `deriveLibrary({ …, paperwork: 'datePrecision' })`, `manualHoursAnchor(…, 'datePrecision')`, y los eventos del Loop con `datePrecision` y **sin** `addedAt`/`promotedAt`. Nunca la heurística de los 5 s sobre filas 2.0.

## Escribir

- **Solo por la puerta**: `ctx.store.create / patch / remove`. Escribir con `ctx.db.insert/update/delete` en una tabla sincronizada lo rechaza `../__tests__/writeBarrier.test.ts`. Las `local_*` sí se escriben directamente.
- `store.create` sobre un id determinista o compuesto es "escribir encima" (upsert) y **resucita** una fila con lápida conservando lo no indicado: indica explícitamente lo que no quieras recuperar (`common/updateGame.ts`, instalación). Antes de crear filas de id determinista desde un trabajo de fondo, comprueba que el juego está vivo (R-15; `writeCheck` ya lo hace).
- Omitir no es lo mismo que `null` al crear (H-2): omite lo que no consta.
- `store.patch` sin cambios no escribe (F-33): no hace falta comparar antes. Sobre una fila inexistente o con lápida lanza: compruébalo antes y devuelve lo que diga el contrato (`null`, `false`…).
- **`ctx.store.transaction(() => …)`** en cuanto una operación hace más de una escritura, o lee algo y escribe según lo leído (releer dentro). Es síncrona y anidable (SAVEPOINT). Nada de `db.transaction` de Drizzle. La relectura para devolver el DTO puede ir fuera.
- Filas de otro dispositivo: la puerta lanza `StoreError('not_owner')`. Si es un caso esperado (sesión abierta en otro PC), compruébalo antes y devuelve un resultado; no captures errores para decidir.
- Comprobaciones externas (`common/checks.ts`); candidatos con `checkIsDue(source, now)`, la cadencia en `CHECK_POLICIES`, olvidar con `clearCheck`. Dos formas de apuntar:
  - `recordCheck(ctx, gameId, source, status, { error, checkedAt })` para todo lo que **repite** la misma pregunta (pasadas de fondo, refrescos, sincronización de logros): un fallo no pisa una respuesta anterior y una respuesta igual sin cadencia no se re-sella (F-33). Con ella `checkedAt` es "desde cuándo responde esto". La usan `external/` y `achievements/` (`steam_achievements`, `ra_achievements`, `steam_unlocks`).
  - `writeCheck(…)` para una escritura **puntual** que debe fechar ese momento y nunca lleva fallo: el alta (`games/newGame`), fijar el appid a mano (`games/setSteamAppId`) y guardar curiosidades (`loop/storeCuriosities`, cuyo `checkedAt` tiene que ser el `generatedAt` de la fila que escribe).
- Moneda de los gastos: `DEFAULT_CURRENCY` (`common/currency.ts`). No escribas `'EUR'` a mano.
- "¿Se puede devolver al Plan?": `canMoveToPlan` / `canMoveToPlanCondition` (`common/canMoveToPlan.ts`). La usan la ficha y la escritura; no hagas otra.
- Cerrar sesiones: `closeOwnSession` / `closeOpenOwnSessions` de `common/sessionsClose.ts`, con `closedBy` explícito (`'user'` si lo pide una persona, `'owner'` si es automático, R-12). No escribas otro.
- Errores: `StoreError` con `code` estable (`store/errors.ts`). Documenta en la cabecera de cada función qué devuelve en cada caso esperado y qué se propaga.

## Tests

```ts
import { openQueryDb, seedGame, seedPlaythrough, asOtherDevice, at, type QueryFixture } from '../../common/__tests__/fixtures';

let fx: QueryFixture;
beforeEach(() => { fx = openQueryDb(); });
afterEach(() => fx.close());

it('…', () => {
  const gameId = seedGame(fx.ctx, { title: 'Celeste', planned: true });
  …
});
```

- `openQueryDb()`: base 2.0 en memoria con las migraciones reales, este PC ya creado (`LOCAL`) y un reloj falso parado en `T0` (`fx.wall.advance(ms)`; `at(ms)`, `day(n)`, `hours(n)`).
- `seed*` escriben por la puerta con valores por defecto y devuelven el id: `seedGame`, `seedPlanEntry`, `seedInstall`, `seedPlaythrough`, `seedStateEvent`, `seedSession`, `seedSpendEvent`, `seedEmulator`, `seedCatalog`, `seedUnlock`, `seedCheck`, `seedCuriosities`, `seedSaveBackup`, `seedRadarGame`. Guarda los ids que devuelven (o busca por título); nunca ids literales.
- **Otra máquina**: `asOtherDevice(fx.ctx)` crea su `devices` y escribe sus filas como llegadas por sync (`seedSession`, `seedInstall`, `seedEmulatorInstall`, `seedSaveBackup`, `insert(tabla, valores)`). Úsalo para probar que filtras por dispositivo. `insertSynced` para cualquier fila "llegada por sync" (también del propio PC, p. ej. dos sesiones abiertas que la puerta no deja crear). `tombstoneOnly` pone una lápida sin cascada (caso F-11).
- Porta los casos de los tests 1.x de la columna "Referencia" de CONSULTAS.md §4. Ejemplos completos: `common/__tests__/gameView.test.ts` (lectura) y `updateGame.test.ts` (escritura).
- `__tests__/integracion.test.ts` cuenta una historia entera solo con las funciones públicas de los paquetes y comprueba en cada paso que biblioteca, ficha, Plan, Sesiones y logros dicen lo mismo (`assertCoherent`). Si cambias lo que una consulta devuelve, pásala.
- Ejecutar: `npx tsx --test --experimental-test-module-mocks "src/main/db/v2/queries/**/*.test.ts"`.

## Qué no se toca

Tras la integración, un paquete puede importar la API pública de otro cuando es la misma regla (p. ej. `loop/` lee los desbloqueos fiables con `achievements/getReliableUnlocks`); lo que comparten dos o más va a `common/`. Durante el trabajo en paralelo la regla era esta: cada paquete escribe **solo** en `queries/<dominio>/`. No se tocan `common/` (pide el cambio a P0 o déjalo anotado), `schema.ts`, `registry.ts`, `store/`, `importer/`, `src/shared/`, `ipc/`, el código 1.x (`src/main/db/queries`, `projections.ts`…), el renderer, `worker/` ni `web/`. Lo que importes del 1.x desaparecerá en P9: copia las funciones puras que necesites.
