import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Registry, SyncedTableName } from '../../registry';
import {
  achievementCatalogs,
  achievementUnlocks,
  devices,
  emulatorInstalls,
  emulators,
  externalChecks,
  gameCuriosities,
  gameInstalls,
  gameMetadata,
  games,
  generatedMemories,
  planEntries,
  playthroughs,
  radarGames,
  saveBackups,
  sessions,
  spendEvents,
  stateEvents,
} from '../../schema';
import { alive } from '../../store';

// "Solo filas vivas" con la regla F-11 incluida (AFTERPLAY-2.0.md §7.7,
// CONSULTAS.md §1.1.1).
//
// `alive()` de la puerta filtra la FILA. Pero un hijo cuyo padre tiene lápida
// también está borrado aunque su propia lápida no haya llegado todavía (sync a
// medias, o un hijo creado en otro PC después del borrado): borrar un juego
// tiene que hacer desaparecer sus sesiones de las estadísticas aunque alguna
// llegue viva más tarde. Esa es la regla F-11, y depende de qué padre mira
// cada tabla. Para que no se pueda olvidar, cada tabla tiene aquí su condición
// con nombre, que ya incluye la cadena entera de padres del registro
// (`registry.ts`, listas `children`):
//
//   juego → playthrough → evento de estado
//   juego → playthrough → sesión          (sesión asignada)
//   emulador → sesión                     (sesión SIN asignar)
//   juego → gasto, plan, instalación, desbloqueo
//   emulador → instalación del emulador
//
// Las cachés (`game_metadata`, `external_checks`, catálogos, curiosidades) y
// `save_backups` NO son hijos (el registro las marca `keep`), pero la app no
// enseña nada de un juego borrado: su condición también exige el juego vivo.
// Quien necesite la caché de un juego borrado (resucitar sin repetir llamadas)
// usa `alive()` a secas, a propósito y con un comentario.
//
// Son condiciones `EXISTS` correlacionadas sobre la clave primaria del padre:
// valen en cualquier consulta, con o sin unión, y con la tabla con alias. Si la
// consulta YA une el padre (para leer sus columnas), poner `alive(padre)` en la
// unión es equivalente; aun así, la condición con nombre del hijo es la forma
// de no equivocarse con la cadena entera (el abuelo también cuenta).

type Column = AnySQLiteColumn;
type Tombstoned = { readonly syncDeleted: Column };

// Alias internos para que el EXISTS nunca se confunda con una tabla de la
// consulta de fuera que se llame igual.
const GAME = sql.raw(`"${getTableName(games)}" AS "f11_game"`);
const PLAYTHROUGH = sql.raw(`"${getTableName(playthroughs)}" AS "f11_pt"`);
const EMULATOR = sql.raw(`"${getTableName(emulators)}" AS "f11_emu"`);

/** ¿Existe el juego `gameId` y está vivo? */
export function gameIsAlive(gameId: Column | SQL): SQL {
  return sql`exists (select 1 from ${GAME} where "f11_game"."id" = ${gameId} and "f11_game"."syncDeleted" is null)`;
}

/** ¿Existe el playthrough `playthroughId`, vivo y con su juego vivo? */
export function playthroughIsAlive(playthroughId: Column | SQL): SQL {
  return sql`exists (select 1 from ${PLAYTHROUGH} join ${GAME} on "f11_game"."id" = "f11_pt"."gameId" where "f11_pt"."id" = ${playthroughId} and "f11_pt"."syncDeleted" is null and "f11_game"."syncDeleted" is null)`;
}

/** ¿Existe el emulador `emulatorId` y está vivo? */
export function emulatorIsAlive(emulatorId: Column | SQL): SQL {
  return sql`exists (select 1 from ${EMULATOR} where "f11_emu"."id" = ${emulatorId} and "f11_emu"."syncDeleted" is null)`;
}

const and2 = (a: SQL, b: SQL): SQL => sql`(${a} and ${b})`;

// ── Una condición por tabla ─────────────────────────────────────────────────
//
// Todas aceptan la tabla del esquema o un alias suyo (`alias(sessions, 's')`);
// sin argumento, la tabla del esquema.

/** Juego vivo. */
export const liveGame = (t: Tombstoned = games): SQL => alive(t);

/** Playthrough vivo con su juego vivo. */
export const livePlaythrough = (t: Tombstoned & { readonly gameId: Column } = playthroughs): SQL =>
  and2(alive(t), gameIsAlive(t.gameId));

/** Evento de estado vivo, con su playthrough y su juego vivos. */
export const liveStateEvent = (
  t: Tombstoned & { readonly playthroughId: Column } = stateEvents,
): SQL => and2(alive(t), playthroughIsAlive(t.playthroughId));

/**
 * Sesión viva. Si está asignada, con su playthrough y su juego vivos; si no
 * (sesión de emulador pendiente), con su emulador vivo. El emulador de una
 * sesión YA asignada no cuenta: es una referencia `keep` (tiempo jugado que se
 * queda aunque borres el emulador).
 */
export const liveSession = (
  t: Tombstoned & { readonly playthroughId: Column; readonly emulatorId: Column } = sessions,
): SQL =>
  and2(
    alive(t),
    sql`((${t.playthroughId} is not null and ${playthroughIsAlive(t.playthroughId)}) or (${t.playthroughId} is null and ${emulatorIsAlive(t.emulatorId)}))`,
  );

/**
 * Fila "de un juego" viva con su juego vivo: gastos, plan, instalaciones,
 * desbloqueos (hijos F-11) y las cachés y copias de partidas (ver arriba).
 * `spend_events.playthroughId` y `achievement_unlocks.playthroughId/sessionId`
 * son referencias `nullify`, no padres: un playthrough borrado no oculta el
 * gasto ni el desbloqueo (y su columna ya se anuló al borrarlo).
 */
export const ofLiveGame = (t: Tombstoned & { readonly gameId: Column }): SQL =>
  and2(alive(t), gameIsAlive(t.gameId));

export const liveSpendEvent = (t: Tombstoned & { readonly gameId: Column } = spendEvents): SQL =>
  ofLiveGame(t);
export const livePlanEntry = (t: Tombstoned & { readonly gameId: Column } = planEntries): SQL =>
  ofLiveGame(t);
export const liveGameInstall = (t: Tombstoned & { readonly gameId: Column } = gameInstalls): SQL =>
  ofLiveGame(t);
export const liveUnlock = (t: Tombstoned & { readonly gameId: Column } = achievementUnlocks): SQL =>
  ofLiveGame(t);

/** Emulador vivo. */
export const liveEmulator = (t: Tombstoned = emulators): SQL => alive(t);

/** Instalación de emulador viva con su emulador vivo. */
export const liveEmulatorInstall = (
  t: Tombstoned & { readonly emulatorId: Column } = emulatorInstalls,
): SQL => and2(alive(t), emulatorIsAlive(t.emulatorId));

/**
 * La condición de cada tabla sincronizada. El tipo obliga a que estén todas:
 * una tabla nueva en el registro no compila hasta que alguien decida aquí qué
 * padres mira. `alive.test.ts` comprueba además cada enlace `children` del
 * registro contra su condición.
 */
export const liveRow: { readonly [N in SyncedTableName]: (table?: Registry[N]['table']) => SQL } = {
  devices: (t = devices) => alive(t),
  games: liveGame,
  game_metadata: (t = gameMetadata) => ofLiveGame(t),
  external_checks: (t = externalChecks) => ofLiveGame(t),
  game_installs: liveGameInstall,
  emulators: liveEmulator,
  emulator_installs: liveEmulatorInstall,
  plan_entries: livePlanEntry,
  playthroughs: livePlaythrough,
  state_events: liveStateEvent,
  sessions: liveSession,
  spend_events: liveSpendEvent,
  achievement_catalogs: (t = achievementCatalogs) => ofLiveGame(t),
  achievement_unlocks: liveUnlock,
  save_backups: (t = saveBackups) => ofLiveGame(t),
  game_curiosities: (t = gameCuriosities) => ofLiveGame(t),
  generated_memories: (t = generatedMemories) => alive(t),
  radar_games: (t = radarGames) => alive(t),
};
