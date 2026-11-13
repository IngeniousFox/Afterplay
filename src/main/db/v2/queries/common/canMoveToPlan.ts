import { and, eq, not, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from './context';

// ¿Se puede devolver este juego de la biblioteca al Plan? (CONSULTAS.md §2.2,
// `moveToPlan`, nota 1; sustituye a `canMoveToPlanWhere` de
// db/queries/games/moveToPlan.ts).
//
// UNA sola definición para el gesto y para la escritura: la ficha
// (`library/getGameById`, `GameDetail.canMoveToPlan`) ofrece el botón con
// esta condición, y `games/moveToPlan` la vuelve a comprobar dentro de su
// transacción para autorizar el cambio con lo que hay en la base y no con lo
// que enseñaba la ficha. Si fueran dos copias podrían discrepar (la ficha
// ofrece algo que la escritura rechaza, o al revés). Antes de la integración
// las dos copias existían (`library/canMoveToPlan.ts` y
// `games/moveToPlan.ts#hasNoPlayRecords`) y eran equivalentes condición por
// condición; esta es la unión de las dos.
//
// QUÉ PROTEGE. En la 1.x era "exactamente una iteración vacía, sin sesiones,
// sin eventos salvo `plan_to_play`, sin gastos salvo compras, sin logros, sin
// copias". La parte "una iteración" existía porque todo juego tenía una (el
// alta la creaba) y lo que se quería decir era "nunca se ha jugado":
// devolverlo al Plan no puede esconder ni tirar registros de partida. En 2.0
// se dice lo mismo sobre filas vivas:
//
// - como mucho UN playthrough vivo (cero también vale: si borraste el único,
//   no queda nada que perder), y sin horas manuales, valoración ni contenido
//   extra. Se conserva al moverlo (ver `games/moveToPlan.ts`);
// - ni sesiones ni eventos de estado vivos en sus playthroughs. Ya no existe
//   `plan_to_play` que perdonar: cualquier evento bloquea, también el papeleo
//   del alta (`'unknown'`), porque dar de alta un juego como "jugando" ya dice
//   algo de él, igual que en la 1.x;
// - solo cuenta lo vivo, con la regla F-11: la sesión o el evento de un
//   playthrough con lápida no bloquean (están borrados);
// - ni gastos que no sean compras (comprar y no jugar es justo el caso del
//   Plan);
// - ni desbloqueos ni copias de partidas vivos (el catálogo de logros es caché
//   y no cuenta).
//
// SQL con alias propios y nombres literales, como en la 1.x: es una condición
// correlacionada para el WHERE de una consulta sobre `games`, y con alias no
// se confunde con ninguna tabla de la consulta de fuera.

/**
 * "No tiene registros de partida" (la condición de arriba), sin mirar si el
 * juego está vivo ni si ya está planeado. `gameId` puede ser un id o una
 * columna (`games.id`) de la consulta de fuera.
 */
export function canMoveToPlanCondition(gameId: string | AnySQLiteColumn | SQL): SQL {
  return sql`(
    (select count(*) from "playthroughs" as "cmp_pt"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null) <= 1
    and not exists (
      select 1 from "playthroughs" as "cmp_pt"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null
        and (coalesce("cmp_pt"."manualHours", 0) <> 0
          or "cmp_pt"."rating" is not null
          or "cmp_pt"."extraContent" <> 0)
    )
    and not exists (
      select 1 from "sessions" as "cmp_s"
      join "playthroughs" as "cmp_pt" on "cmp_pt"."id" = "cmp_s"."playthroughId"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null
        and "cmp_s"."syncDeleted" is null
    )
    and not exists (
      select 1 from "state_events" as "cmp_se"
      join "playthroughs" as "cmp_pt" on "cmp_pt"."id" = "cmp_se"."playthroughId"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null
        and "cmp_se"."syncDeleted" is null
    )
    and not exists (
      select 1 from "spend_events" as "cmp_sp"
      where "cmp_sp"."gameId" = ${gameId} and "cmp_sp"."syncDeleted" is null
        and "cmp_sp"."type" <> 'purchase'
    )
    and not exists (
      select 1 from "achievement_unlocks" as "cmp_u"
      where "cmp_u"."gameId" = ${gameId} and "cmp_u"."syncDeleted" is null
    )
    and not exists (
      select 1 from "save_backups" as "cmp_sb"
      where "cmp_sb"."gameId" = ${gameId} and "cmp_sb"."syncDeleted" is null
    )
  )`;
}

/**
 * ¿Tiene el juego una entrada VIVA en el Plan? Por la clave primaria: el id
 * de `plan_entries` ES el `gameId` (store/ids.ts), así que es una búsqueda
 * por índice y no necesita uno sobre `plan_entries.gameId` (que no existe).
 */
export const hasLivePlanEntry = (gameId: string | AnySQLiteColumn | SQL): SQL =>
  sql`exists (select 1 from "plan_entries" as "cmp_plan" where "cmp_plan"."id" = ${gameId} and "cmp_plan"."syncDeleted" is null)`;

/**
 * Si el juego se puede devolver al Plan: existe, está vivo, no está ya en el
 * Plan y cumple `canMoveToPlanCondition`. False en cualquier otro caso
 * (también si no existe). Una consulta.
 */
export function canMoveToPlan(ctx: QueryContext, gameId: string): boolean {
  const row = ctx.db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        eq(games.id, gameId),
        alive(games),
        not(hasLivePlanEntry(games.id)),
        canMoveToPlanCondition(games.id),
      ),
    )
    .get();
  return row !== undefined;
}
