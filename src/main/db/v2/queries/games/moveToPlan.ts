import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { GameRow } from '../../../../../shared/dto';
import { games } from '../../schema';
import { alive } from '../../store';
import { readGameRow, type QueryContext } from '../common';
import { GameWriteError } from './errors';
import { writePlanEntry } from './planEntry';

// games:moveToPlan en 2.0 (CONSULTAS.md §2.2, `moveToPlan` y nota 1).
//
// QUÉ PROTEGE LA CONDICIÓN. En la 1.x era "exactamente una iteración vacía,
// sin sesiones, sin eventos salvo `plan_to_play`, sin gastos salvo compras,
// sin logros, sin copias" (`canMoveToPlanWhere`). La parte "una iteración"
// existía porque todo juego tenía una (el alta la creaba) y lo que se quería
// decir era "nunca se ha jugado": devolverlo al Plan no puede esconder ni
// tirar registros de partida. En 2.0 se dice lo mismo sobre filas vivas:
//
// - como mucho UN playthrough vivo (cero también vale: si borraste el único,
//   no queda nada que perder), y sin horas manuales, valoración ni contenido
//   extra;
// - ni sesiones ni eventos de estado vivos en sus playthroughs (ya no existe
//   `plan_to_play` que exceptuar);
// - ni gastos que no sean compras (la compra de un juego sin empezar es justo
//   el caso típico de "lo compré y lo dejo para luego");
// - ni desbloqueos ni copias de partidas vivos.
//
// DESVIACIÓN de la nota 1 (que proponía poner la lápida al playthrough vacío):
// se CONSERVA, como en la 1.x ("se conserva su iteración"), y la promoción lo
// reutiliza. Con R-03 la etiqueta cuenta también los borrados, así que
// borrarlo y crear otro al promocionar haría que un juego que va y vuelve del
// Plan acabara llamándose "Playthrough 3" sin haberse jugado nunca. Y un id
// aleatorio con lápida no se puede resucitar (`store.create` → `exists`).

// Las tablas van por su nombre en SQL: es una condición correlacionada que
// sirve igual con un id suelto que con `games.id` dentro de otra consulta (P1
// la necesita para `GameDetail.canMoveToPlan`).
const livePt = sql.raw('p."syncDeleted" is null');

/**
 * "No tiene registros de partida" (la condición de arriba), sin mirar si el
 * juego está vivo ni si ya está planeado. `gameId` puede ser un id o una
 * columna (`games.id`).
 */
export function hasNoPlayRecords(gameId: string | AnySQLiteColumn | SQL): SQL {
  return sql`(
    (select count(*) from "playthroughs" p where p."gameId" = ${gameId} and ${livePt}) <= 1
    and not exists (
      select 1 from "playthroughs" p where p."gameId" = ${gameId} and ${livePt}
        and (coalesce(p."manualHours", 0) <> 0 or p."rating" is not null or p."extraContent" <> 0)
    )
    and not exists (
      select 1 from "sessions" s join "playthroughs" p on p."id" = s."playthroughId"
      where p."gameId" = ${gameId} and ${livePt} and s."syncDeleted" is null
    )
    and not exists (
      select 1 from "state_events" e join "playthroughs" p on p."id" = e."playthroughId"
      where p."gameId" = ${gameId} and ${livePt} and e."syncDeleted" is null
    )
    and not exists (
      select 1 from "spend_events" sp
      where sp."gameId" = ${gameId} and sp."syncDeleted" is null and sp."type" <> 'purchase'
    )
    and not exists (
      select 1 from "achievement_unlocks" u where u."gameId" = ${gameId} and u."syncDeleted" is null
    )
    and not exists (
      select 1 from "save_backups" b where b."gameId" = ${gameId} and b."syncDeleted" is null
    )
  )`;
}

/** No planeado: sin entrada del Plan viva. */
function notPlanned(gameId: string | AnySQLiteColumn | SQL): SQL {
  return sql`not exists (select 1 from "plan_entries" pe where pe."gameId" = ${gameId} and pe."syncDeleted" is null)`;
}

/**
 * ¿Se puede devolver al Plan? Juego vivo, no planeado y sin registros de
 * partida. Es lo que la ficha usa para ofrecer el gesto y lo que la
 * escritura vuelve a comprobar dentro de su transacción.
 */
export function canMoveToPlan(ctx: QueryContext, gameId: string): boolean {
  const row = ctx.db
    .select({ id: games.id })
    .from(games)
    .where(
      and(eq(games.id, gameId), alive(games), notPlanned(games.id), hasNoPlayRecords(games.id)),
    )
    .get();
  return row !== undefined;
}

const CANNOT_MOVE = 'This game has play records or is already in Plan to Play.';

/**
 * Devuelve el juego al Plan y lo devuelve como `GameRow` (`planned: true`).
 *
 * Una transacción: relee la condición; resucita (o crea) la entrada del Plan
 * con `plannedAt` nuevo, sin pin y conservando su nota (R-06); y deja
 * `games.promotedAt` a null. El juego, su `addedAt`, su playthrough vacío y
 * sus compras se quedan.
 *
 * Lanza `GameWriteError('not_found')` si el juego no existe o tiene lápida, y
 * `GameWriteError('cannot_move_to_plan')` si ya está planeado o tiene
 * registros de partida (mensaje de la 1.x). Sin escribir nada.
 */
export function moveToPlan(ctx: QueryContext, gameId: string): GameRow<string> {
  ctx.store.transaction(() => {
    const game = ctx.db
      .select({ deleted: games.syncDeleted })
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    if (!game || game.deleted !== null) {
      throw new GameWriteError('not_found', `No existe el juego ${gameId}`);
    }
    if (!canMoveToPlan(ctx, gameId)) throw new GameWriteError('cannot_move_to_plan', CANNOT_MOVE);
    writePlanEntry(ctx, gameId);
    ctx.store.patch('games', gameId, { promotedAt: null });
  });
  const row = readGameRow(ctx, gameId);
  if (!row) throw new Error(`moveToPlan: el juego ${gameId} no se puede releer`);
  return row;
}
