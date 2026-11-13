import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { externalCheckId } from '../../../../../shared/sync/ids';
import {
  externalChecks,
  games,
  type CheckStatus,
  type ExternalCheckRow,
  type ExternalCheckSource,
} from '../../schema';
import type { QueryContext } from './context';

// `external_checks`: cuándo se preguntó a cada fuente por cada juego y cuándo
// volver a preguntar (AFTERPLAY-2.0.md §7.4, F-34; CONSULTAS.md §3.5).
//
// Sustituye a los ocho `…CheckedAt`/`…SyncedAt` de la 1.x. La tabla guarda
// solo el resultado; la POLÍTICA (cada cuánto se repite) vive aquí, en código,
// y reproduce la cadencia de hoy sin cambiar a quién se pregunta:
//
// - Casi todo lo vuelve a preguntar solo el refresco completo (el botón, o la
//   pasada semanal del radar), que recorre todos los juegos sin mirar sellos,
//   o una pasada de arranque que recoge los que NUNCA se preguntaron
//   (`…CheckedAt IS NULL`). En 2.0 eso es `nextCheckAt = null` ("solo a mano")
//   para las respuestas, y "sin fila" para lo nunca preguntado.
// - Un FALLO hoy no deja sello (la red va antes de escribir), y por eso la
//   siguiente pasada lo reintenta. En 2.0 el fallo sí deja fila (con su
//   error, para poder enseñarlo), y para no cambiar quién se reintenta queda
//   pendiente YA: `nextCheckAt = checkedAt`.
// - La excepción es el emparejado con RetroAchievements (`ra_match`): hoy
//   fecha cada intento sin set y lo repite a los 4 días (`REMATCH_AFTER_MS`
//   de src/main/ra/backfill.ts:21), porque los sets se publican cada semana.
//
// "Pendiente" = sin fila viva, o con `nextCheckAt <= ahora` (ver `isCheckDue`
// y `checkIsDue`).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cuándo volver a preguntar tras una respuesta: ms desde `checkedAt`, `0` = ya, `null` = solo a mano. */
export type RecheckAfter = number | null;

export type CheckPolicy = { readonly [S in CheckStatus]: RecheckAfter };

/** Reintento inmediato del fallo, como hoy (un fallo no dejaba sello). */
const RETRY_NOW = 0;

/** Solo el refresco completo o una acción del usuario vuelven a preguntar. */
const MANUAL_ONLY: CheckPolicy = { ok: null, empty: null, error: RETRY_NOW };

/** Copia de `REMATCH_AFTER_MS` (src/main/ra/backfill.ts:21): 4 días. */
export const RA_REMATCH_AFTER_MS = 4 * DAY_MS;

export const CHECK_POLICIES: { readonly [S in ExternalCheckSource]: CheckPolicy } = {
  igdb: MANUAL_ONLY,
  igdb_ratings: MANUAL_ONLY,
  // Un "no está en Steam" caduca (refresh.ts:69-110), pero hoy solo lo
  // re-pregunta el refresco completo, que mira a todos los que no tienen
  // appid sin consultar el sello. Se mantiene así.
  steam_appid: MANUAL_ONLY,
  steam_store: MANUAL_ONLY,
  // La pasada de arranque de logros solo trae catálogos que FALTAN
  // (steam/backfill.ts): sin fila = pendiente. Los fallos se reintentan.
  steam_achievements: MANUAL_ONLY,
  steam_unlocks: MANUAL_ONLY,
  // Con set: hecho (solo a mano). Sin set o con fallo: a los 4 días.
  ra_match: { ok: null, empty: RA_REMATCH_AFTER_MS, error: RA_REMATCH_AFTER_MS },
  ra_achievements: MANUAL_ONLY,
  // Hoy un "no" de HLTB o SGDB no deja marca (§3.5): ahora deja `empty`, sin
  // cambiar quién se pregunta (la repesca mira los que no tienen dato).
  hltb: MANUAL_ONLY,
  sgdb: MANUAL_ONLY,
  curiosities: MANUAL_ONLY,
};

/** `nextCheckAt` que toca tras una respuesta, según la política de la fuente. */
export function nextCheckAtFor(
  source: ExternalCheckSource,
  status: CheckStatus,
  checkedAt: Date,
): Date | null {
  const after = CHECK_POLICIES[source][status];
  return after === null ? null : new Date(checkedAt.getTime() + after);
}

/** ¿Toca volver a preguntar? Sin fila (o con lápida) = nunca preguntado = sí. */
export function isCheckDue(
  check: Pick<ExternalCheckRow, 'nextCheckAt' | 'syncDeleted'> | null | undefined,
  now: Date,
): boolean {
  if (!check || check.syncDeleted !== null) return true;
  return check.nextCheckAt !== null && check.nextCheckAt.getTime() <= now.getTime();
}

/** La comprobación viva de un juego y fuente, o undefined. */
export function readCheck(
  ctx: QueryContext,
  gameId: string,
  source: ExternalCheckSource,
): ExternalCheckRow | undefined {
  const row = ctx.db
    .select()
    .from(externalChecks)
    .where(eq(externalChecks.id, externalCheckId(gameId, source)))
    .get();
  return row && row.syncDeleted === null ? row : undefined;
}

/**
 * Condición SQL "a este juego le toca preguntar a `source`", para elegir
 * candidatos en una sola consulta. Correlacionada con `gameId` (por defecto
 * `games.id`): sin fila viva, o vencida.
 */
export function checkIsDue(
  source: ExternalCheckSource,
  now: Date,
  gameId: SQL | typeof games.id = games.id,
): SQL {
  const ec = alias(externalChecks, 'due_ec');
  return sql`not exists (select 1 from ${externalChecks} as ${sql.identifier('due_ec')} where ${and(
    eq(ec.gameId, gameId),
    eq(ec.source, source),
    isNull(ec.syncDeleted),
    or(isNull(ec.nextCheckAt), sql`${ec.nextCheckAt} > ${now.getTime()}`),
  )})`;
}

export interface WriteCheckOptions {
  /** Texto del fallo. Solo con `status = 'error'`; en otro caso se borra el anterior. */
  readonly error?: string | null;
  /** Por defecto, `ctx.now()`. */
  readonly checkedAt?: Date;
}

/**
 * Apunta que se preguntó a `source` por el juego, con su resultado, y fija
 * `nextCheckAt` según la política. Escribe encima de la anterior (id
 * compuesto `<gameId>:<source>`) y resucita la que tuviera lápida; si nada
 * cambia, no escribe (F-33).
 *
 * No escribe nada y devuelve false si el juego no existe o tiene lápida
 * (decisión R-15): un trabajo de fondo que termina después de que borres el
 * juego no debe dejar filas colgando de él.
 */
export function writeCheck(
  ctx: QueryContext,
  gameId: string,
  source: ExternalCheckSource,
  status: CheckStatus,
  options: WriteCheckOptions = {},
): boolean {
  return ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) return false;
    const checkedAt = options.checkedAt ?? ctx.now();
    ctx.store.create('external_checks', {
      gameId,
      source,
      status,
      checkedAt,
      nextCheckAt: nextCheckAtFor(source, status, checkedAt),
      error: status === 'error' ? (options.error ?? null) : null,
    });
    return true;
  });
}

/**
 * Apunta una comprobación con dos reglas encima de `writeCheck`. Es la que
 * deben usar las pasadas de fondo, que vuelven a preguntar lo mismo una y
 * otra vez:
 *
 * 1. Un FALLO no pisa una respuesta anterior (`ok`/`empty`). En la 1.x un
 *    fallo no dejaba sello y el anterior seguía en pie; pisarlo convertiría un
 *    juego ya preguntado en "nunca preguntado" (y lo volvería pendiente) por
 *    un 503 pasajero. "Un no externo no borra lo que había" (§14.2) vale
 *    también para los sellos.
 * 2. Una respuesta IGUAL a la anterior y sin cadencia (`nextCheckAt` null en
 *    la política: casi todas) no se re-sella. Si no, cada pasada reescribiría
 *    una fila por juego y fuente, que es justo F-33. Consecuencia: con esta
 *    regla `checkedAt` es "desde cuándo la fuente responde esto", no "la
 *    última vez que se preguntó". Las respuestas con cadencia (`ra_match` sin
 *    set, los fallos) sí se re-sellan siempre: su `nextCheckAt` se mueve.
 *
 * Una comprobación con lápida (`clearCheck`) cuenta como inexistente: la
 * siguiente respuesta se escribe siempre.
 *
 * Devuelve si escribió. No escribe nada si el juego no está vivo (R-15).
 * `writeCheck` sigue siendo la regla para una escritura puntual que debe
 * fechar ESTE momento (ver README, "Comprobaciones externas").
 */
export function recordCheck(
  ctx: QueryContext,
  gameId: string,
  source: ExternalCheckSource,
  status: CheckStatus,
  options: WriteCheckOptions = {},
): boolean {
  return ctx.store.transaction(() => {
    const previous = readCheck(ctx, gameId, source);
    if (previous) {
      if (status === 'error' && previous.status !== 'error') return false;
      const error = status === 'error' ? (options.error ?? null) : null;
      const sameAnswer = previous.status === status && (previous.error ?? null) === error;
      if (sameAnswer && CHECK_POLICIES[source][status] === null) return false;
    }
    return writeCheck(ctx, gameId, source, status, options);
  });
}

/**
 * Olvida una comprobación (lápida): la fuente vuelve a estar "nunca
 * preguntada". Lo usa, por ejemplo, cambiar el appid de Steam (CONSULTAS.md
 * §2.2, `setSteamAppId`). No falla si no existe o ya estaba borrada.
 */
export function clearCheck(ctx: QueryContext, gameId: string, source: ExternalCheckSource): void {
  ctx.store.transaction(() => {
    if (readCheck(ctx, gameId, source)) {
      ctx.store.remove('external_checks', externalCheckId(gameId, source));
    }
  });
}

/**
 * El sello que enseñaba la 1.x (`…CheckedAt`): cuándo respondió la fuente. Un
 * fallo no cuenta, porque en la 1.x un fallo no dejaba sello.
 */
export const answeredAt = (
  check: { readonly status: CheckStatus | null; readonly checkedAt: Date | null } | undefined,
): Date | null =>
  check && check.checkedAt && (check.status === 'ok' || check.status === 'empty')
    ? check.checkedAt
    : null;

// Reexportado para que quien escriba comprobaciones no tenga que importar ids.
export { externalCheckId };
